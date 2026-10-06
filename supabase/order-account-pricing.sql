-- Keep customer orders tied to Auth user IDs and use the displayed promotional price.
create or replace function private.place_order(p_request jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  state_row public.app_state%rowtype;
  requested_item jsonb;
  product jsonb;
  order_items jsonb := '[]'::jsonb;
  order_data jsonb;
  product_id integer;
  quantity integer;
  reserved_qty integer;
  order_id bigint;
  customer_email text := lower(trim(p_request->>'email'));
  regular_price numeric;
  promotional_price numeric;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception 'Entre na sua conta antes de enviar o pedido.';
  end if;
  if length(trim(coalesce(p_request->>'customer', ''))) not between 2 and 120
     or length(trim(coalesce(p_request->>'phone', ''))) not between 8 and 30
     or length(regexp_replace(coalesce(p_request->>'cpf', ''), '[^0-9]', '', 'g')) <> 11
     or length(trim(coalesce(p_request->>'address', ''))) not between 8 and 400
     or p_request->>'delivery' not in ('Entrega', 'Retirada')
     or p_request->>'payment' not in ('Pix', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro')
     or jsonb_typeof(p_request->'items') <> 'array'
     or jsonb_array_length(p_request->'items') not between 1 and 20 then
    raise exception 'Confira os dados do pedido.';
  end if;
  select * into state_row from public.app_state where id = 1 for update;
  if not found then raise exception 'Loja indisponível.'; end if;
  for requested_item in select value from jsonb_array_elements(p_request->'items') loop
    if (requested_item->>'id') !~ '^[0-9]+$'
       or (requested_item->>'qty') !~ '^[0-9]+$' then
      raise exception 'Item inválido.';
    end if;
    product_id := (requested_item->>'id')::integer;
    quantity := (requested_item->>'qty')::integer;
    if quantity not between 1 and 20
       or exists (select 1 from jsonb_array_elements(order_items) as item
                  where (item.value->>'id')::integer = product_id) then
      raise exception 'Quantidade inválida.';
    end if;
    select value into product from jsonb_array_elements(state_row.data->'products')
      where (value->>'id')::integer = product_id and (value->>'active')::boolean;
    if product is null then raise exception 'Produto indisponível.'; end if;
    select coalesce(sum((item.value->>'qty')::integer), 0) into reserved_qty
      from jsonb_array_elements(coalesce(state_row.data->'orders', '[]'::jsonb)) as ord
      cross join lateral jsonb_array_elements(ord.value->'items') as item
      where ord.value->>'status' in ('pending', 'ready')
        and (item.value->>'id')::integer = product_id;
    if quantity > (product->>'stock')::integer - reserved_qty then
      raise exception 'Estoque insuficiente para %.', product->>'name';
    end if;
    regular_price := (product->>'price')::numeric;
    promotional_price := nullif(product->>'promoPrice','')::numeric;
    order_items := order_items || jsonb_build_array(jsonb_build_object(
      'id', product_id, 'name', product->>'name', 'qty', quantity,
      'price', case when promotional_price > 0 and promotional_price < regular_price
        then promotional_price else regular_price end,
      'cost', (product->>'cost')::numeric));
  end loop;
  order_id := nextval('public.online_order_number');
  order_data := jsonb_build_object(
    'id', order_id, 'user_id', auth.uid()::text,
    'date', to_char(current_date, 'YYYY-MM-DD'),
    'customer', trim(p_request->>'customer'), 'email', customer_email,
    'phone', trim(p_request->>'phone'), 'cpf', trim(p_request->>'cpf'),
    'address', trim(p_request->>'address'), 'seller', 'Loja online',
    'channel', 'Loja online', 'items', order_items, 'status', 'pending',
    'paid', false, 'receipt', null, 'freight', 0,
    'freightPending', p_request->>'delivery' = 'Entrega',
    'payment', p_request->>'payment', 'delivery', p_request->>'delivery',
    'notes', left(coalesce(p_request->>'notes', ''), 1000));
  update public.app_state set data = jsonb_set(state_row.data, '{orders}',
      jsonb_build_array(order_data) || coalesce(state_row.data->'orders', '[]'::jsonb)),
      version = version + 1, updated_at = now() where id = 1;
  return jsonb_build_object('id', order_id);
end;
$$;
