-- Forte Outlet: one private operational state and a public, sanitized catalog.
-- Run once on the Grupo Outlet / Aplicativo project.
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to anon, authenticated;

create table if not exists public.app_state (
  id integer primary key check (id = 1),
  version bigint not null default 1,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);
create table if not exists public.shop_public (
  id integer primary key check (id = 1),
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_state enable row level security;
alter table public.shop_public enable row level security;
revoke all on public.app_state, public.shop_public from anon, authenticated;
grant select, update on public.app_state to authenticated;
grant select on public.shop_public to anon, authenticated;

create policy "Verified owner reads operational state" on public.app_state
  for select to authenticated
  using ((select auth.jwt()->>'email') = 'grupooutlet.rj@gmail.com'
    and (select auth.uid()) is not null);
create policy "Verified owner updates operational state" on public.app_state
  for update to authenticated
  using ((select auth.jwt()->>'email') = 'grupooutlet.rj@gmail.com'
    and (select auth.uid()) is not null)
  with check ((select auth.jwt()->>'email') = 'grupooutlet.rj@gmail.com'
    and (select auth.uid()) is not null);
create policy "Anyone reads public catalog" on public.shop_public
  for select to anon, authenticated using (true);

create or replace function private.publish_catalog()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  product jsonb;
  public_products jsonb := '[]'::jsonb;
  reserved_qty integer;
begin
  for product in select value from jsonb_array_elements(new.data->'products') loop
    select coalesce(sum((item.value->>'qty')::integer), 0) into reserved_qty
      from jsonb_array_elements(coalesce(new.data->'orders', '[]'::jsonb)) as ord
      cross join lateral jsonb_array_elements(ord.value->'items') as item
      where ord.value->>'status' in ('pending', 'ready')
        and (item.value->>'id')::integer = (product->>'id')::integer;
    public_products := public_products || jsonb_build_array(
      (product - 'cost') || jsonb_build_object(
        'stock', greatest(0, (product->>'stock')::integer - reserved_qty)));
  end loop;
  insert into public.shop_public(id, data, updated_at)
  values (1, jsonb_build_object(
    'products', public_products,
    'collections', coalesce(new.data->'collections', '[]'::jsonb),
    'pages', coalesce(new.data->'pages', '[]'::jsonb),
    'storefront', coalesce(new.data->'storefront', '{}'::jsonb),
    'settings', (coalesce(new.data->'settings', '{}'::jsonb) - 'goal')),
    now())
  on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at;
  return new;
end;
$$;
revoke all on function private.publish_catalog() from public;
create trigger app_state_publish_catalog
after insert or update of data on public.app_state
for each row execute function private.publish_catalog();

create sequence if not exists public.online_order_number start 5000;
revoke all on sequence public.online_order_number from public, anon, authenticated;

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
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
     or lower(coalesce(auth.jwt()->>'email', '')) <> customer_email then
    raise exception 'Confirme o e-mail antes de enviar o pedido.';
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
    order_items := order_items || jsonb_build_array(jsonb_build_object(
      'id', product_id, 'name', product->>'name', 'qty', quantity,
      'price', (product->>'price')::numeric, 'cost', (product->>'cost')::numeric));
  end loop;
  order_id := nextval('public.online_order_number');
  order_data := jsonb_build_object(
    'id', order_id, 'date', to_char(current_date, 'YYYY-MM-DD'),
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
revoke all on function private.place_order(jsonb) from public;
grant execute on function private.place_order(jsonb) to authenticated;
create or replace function public.place_order(p_request jsonb)
returns jsonb language sql security invoker
set search_path = pg_catalog, public as $$
  select private.place_order(p_request)
$$;
revoke all on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to authenticated;

create or replace function private.my_orders()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(
    jsonb_set(ord.value - 'receipt', '{items}',
      (select coalesce(jsonb_agg(item.value - 'cost'), '[]'::jsonb)
       from jsonb_array_elements(ord.value->'items') as item))
    order by (ord.value->>'id')::bigint desc), '[]'::jsonb)
  from public.app_state as state
  cross join lateral jsonb_array_elements(state.data->'orders') as ord
  where state.id = 1 and auth.uid() is not null
    and lower(coalesce(auth.jwt()->>'email', '')) = lower(ord.value->>'email')
    and not coalesce((auth.jwt()->>'is_anonymous')::boolean, false)
$$;
revoke all on function private.my_orders() from public;
grant execute on function private.my_orders() to authenticated;
create or replace function public.my_orders()
returns jsonb language sql stable security invoker
set search_path = pg_catalog, public as $$
  select private.my_orders()
$$;
revoke all on function public.my_orders() from public;
grant execute on function public.my_orders() to authenticated;
