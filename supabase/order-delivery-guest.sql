-- Guest customer records are CRM contacts, never authentication identities.
create table if not exists public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  phone text not null,
  phone_digits text not null,
  cpf text not null,
  address text not null,
  address_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists customer_contacts_cpf_unique on public.customer_contacts(cpf);
create index if not exists customer_contacts_phone_email on public.customer_contacts(phone_digits,email);
alter table public.customer_contacts enable row level security;
revoke all on public.customer_contacts from public, anon, authenticated;
grant select on public.customer_contacts to authenticated;
create policy "Staff sees customer contacts" on public.customer_contacts
  for select to authenticated using ((select private.is_admin()));

alter table public.profiles drop constraint profiles_position_check;
alter table public.profiles add constraint profiles_position_check
  check (position in ('Gerente','Vendedor','Outro','Entregador'));
alter table public.profiles drop constraint profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role in ('customer','admin','master','driver'));

create or replace function private.promote_customer(p_user_id uuid, p_position text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, private as $$
begin
  if not private.is_master() then raise exception 'Somente a conta principal pode alterar permissões.'; end if;
  if p_position not in ('Gerente','Vendedor','Outro','Entregador') then raise exception 'Cargo inválido.'; end if;
  update public.profiles
    set role=case when p_position='Entregador' then 'driver' else 'admin' end,
        position=p_position
    where user_id=p_user_id and role='customer';
  if not found then raise exception 'Cliente não encontrado.'; end if;
end;
$$;
revoke all on function private.promote_customer(uuid,text) from public, anon, authenticated;
grant execute on function private.promote_customer(uuid,text) to authenticated;

create or replace function private.is_manager()
returns boolean language sql stable security definer
set search_path = pg_catalog, private, public as $$
  select private.is_master() or exists (
    select 1 from public.profiles where user_id=auth.uid()
      and role='admin' and position='Gerente')
$$;
revoke all on function private.is_manager() from public, anon, authenticated;
grant execute on function private.is_manager() to authenticated;

-- A staff PATCH must not silently remove historical orders, bypassing the
-- manager-only deletion function. Public orders and driver updates only add/edit.
create or replace function private.guard_order_removal()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private as $$
begin
  if auth.uid() is not null and not private.is_manager() and exists (
    select 1 from jsonb_array_elements(coalesce(old.data->'orders','[]'::jsonb)) as prior
    where not exists (
      select 1 from jsonb_array_elements(coalesce(new.data->'orders','[]'::jsonb)) as latest
      where latest.value->>'id'=prior.value->>'id'
    )
  ) then
    raise exception 'Somente a conta principal ou gerente pode excluir pedidos.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_order_removal() from public, anon, authenticated;
drop trigger if exists guard_order_removal on public.app_state;
create trigger guard_order_removal before update of data on public.app_state
for each row execute function private.guard_order_removal();

-- Store the customer's selected options as part of each order item. Prices and
-- stock continue to come exclusively from the locked product state.
create or replace function private.place_order(p_request jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public as $$
declare
  state_row public.app_state%rowtype;
  requested_item jsonb;
  requested_options jsonb;
  product jsonb;
  product_option jsonb;
  order_items jsonb := '[]'::jsonb;
  order_data jsonb;
  product_id integer;
  quantity integer;
  already_selected integer;
  reserved_qty integer;
  order_id bigint;
  option_name text;
  option_value text;
  option_summary text;
  option_count integer;
  customer_email text := lower(trim(p_request->>'email'));
  regular_price numeric;
  promotional_price numeric;
  customer_cpf text := regexp_replace(coalesce(p_request->>'cpf',''), '[^0-9]', '', 'g');
  customer_phone text := regexp_replace(coalesce(p_request->>'phone',''), '[^0-9]', '', 'g');
  requested_address_key text := lower(regexp_replace(coalesce(p_request->>'address',''), '[^[:alnum:]]', '', 'g'));
  contact_id uuid;
  signed_in_user uuid := auth.uid();
  guest_token uuid := gen_random_uuid();
  payment_timing text := coalesce(p_request->>'paymentTiming','Na entrega');
begin
  if coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then signed_in_user := null; end if;
  if length(trim(coalesce(p_request->>'customer', ''))) not between 2 and 120
     or length(customer_phone) not between 10 and 13
     or length(customer_cpf) <> 11
     or customer_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or length(trim(coalesce(p_request->>'address', ''))) not between 8 and 400
     or p_request->>'delivery' not in ('Entrega', 'Retirada')
     or p_request->>'payment' not in ('Pix', 'Cartão de crédito', 'Cartão de débito', 'Dinheiro')
     or payment_timing not in ('Na entrega','Na retirada','Antecipado')
     or (p_request->>'delivery'='Entrega' and payment_timing='Na retirada')
     or (p_request->>'delivery'='Retirada' and payment_timing='Na entrega')
     or jsonb_typeof(p_request->'items') <> 'array'
     or jsonb_array_length(p_request->'items') not between 1 and 20 then
    raise exception 'Confira os dados do pedido.';
  end if;
  select * into state_row from public.app_state where id = 1 for update;
  if not found then raise exception 'Loja indisponível.'; end if;
  -- CPF wins. If it was mistyped, two independent contact signals may reuse
  -- the existing CRM record. No auth account ownership is inferred from PII.
  select id into contact_id from public.customer_contacts
    where cpf=customer_cpf for update;
  if contact_id is null then
    select id into contact_id from public.customer_contacts
      where phone_digits=customer_phone
        and (email=customer_email or (address_key=requested_address_key and length(requested_address_key)>12))
      order by updated_at desc limit 1 for update;
  end if;
  if contact_id is null then
    insert into public.customer_contacts(name,email,phone,phone_digits,cpf,address,address_key)
      values (trim(p_request->>'customer'),customer_email,trim(p_request->>'phone'),
        customer_phone,customer_cpf,trim(p_request->>'address'),requested_address_key)
      returning id into contact_id;
  else
    update public.customer_contacts set
      name=trim(p_request->>'customer'),email=customer_email,
      phone=trim(p_request->>'phone'),phone_digits=customer_phone,
      address=trim(p_request->>'address'),address_key=requested_address_key,
      updated_at=now() where id=contact_id;
  end if;
  for requested_item in select value from jsonb_array_elements(p_request->'items') loop
    if (requested_item->>'id') !~ '^[0-9]+$'
       or (requested_item->>'qty') !~ '^[0-9]+$' then
      raise exception 'Item inválido.';
    end if;
    product_id := (requested_item->>'id')::integer;
    quantity := (requested_item->>'qty')::integer;
    requested_options := coalesce(requested_item->'options', '{}'::jsonb);
    if jsonb_typeof(requested_options) <> 'object' or quantity not between 1 and 20 then
      raise exception 'Opções ou quantidade inválidas.';
    end if;
    if exists (
      select 1 from jsonb_array_elements(order_items) as item
      where (item.value->>'id')::integer = product_id
        and item.value->'options' = requested_options
    ) then
      raise exception 'Item repetido no pedido.';
    end if;
    select value into product from jsonb_array_elements(state_row.data->'products')
      where (value->>'id')::integer = product_id and (value->>'active')::boolean;
    if product is null then raise exception 'Produto indisponível.'; end if;
    option_summary := '';
    option_count := 0;
    for product_option in select value from jsonb_array_elements(coalesce(product->'variations', '[]'::jsonb)) loop
      option_name := product_option->>'name';
      option_value := requested_options->>option_name;
      if option_name is null or option_value is null
         or not exists (
           select 1 from jsonb_array_elements_text(product_option->'values') as choice
           where choice.value = option_value
         ) then
        raise exception 'Escolha uma variação válida para %.', product->>'name';
      end if;
      option_summary := option_summary || ' · ' || option_name || ': ' || option_value;
      option_count := option_count + 1;
    end loop;
    if (select count(*) from jsonb_object_keys(requested_options)) <> option_count then
      raise exception 'As variações do produto mudaram. Selecione novamente.';
    end if;
    select coalesce(sum((item.value->>'qty')::integer), 0) into reserved_qty
      from jsonb_array_elements(coalesce(state_row.data->'orders', '[]'::jsonb)) as ord
      cross join lateral jsonb_array_elements(ord.value->'items') as item
      where ord.value->>'status' in ('pending', 'ready')
        and (item.value->>'id')::integer = product_id;
    select coalesce(sum((item.value->>'qty')::integer), 0) into already_selected
      from jsonb_array_elements(order_items) as item
      where (item.value->>'id')::integer = product_id;
    if quantity + already_selected > (product->>'stock')::integer - reserved_qty then
      raise exception 'Estoque insuficiente para %.', product->>'name';
    end if;
    regular_price := (product->>'price')::numeric;
    promotional_price := nullif(product->>'promoPrice', '')::numeric;
    order_items := order_items || jsonb_build_array(jsonb_build_object(
      'id', product_id, 'name', product->>'name' || option_summary,
      'options', requested_options, 'qty', quantity,
      'price', case when promotional_price > 0 and promotional_price < regular_price
        then promotional_price else regular_price end,
      'cost', (product->>'cost')::numeric));
  end loop;
  order_id := nextval('public.online_order_number');
  order_data := jsonb_build_object(
    'id', order_id, 'user_id', signed_in_user::text,
    'customer_id', contact_id::text, 'guestToken', guest_token::text,
    'date', to_char(current_date, 'YYYY-MM-DD'),
    'customer', trim(p_request->>'customer'), 'email', customer_email,
    'phone', trim(p_request->>'phone'), 'cpf', trim(p_request->>'cpf'),
    'address', trim(p_request->>'address'), 'seller', 'Loja online',
    'channel', 'Loja online', 'items', order_items, 'status', 'pending',
    'paid', false, 'receipt', null, 'freight', 0,
    'freightPending', p_request->>'delivery' = 'Entrega',
    'payment', p_request->>'payment', 'paymentTiming', payment_timing,
    'delivery', p_request->>'delivery',
    'notes', left(coalesce(p_request->>'notes', ''), 1000));
  update public.app_state set data = jsonb_set(state_row.data, '{orders}',
      jsonb_build_array(order_data) || coalesce(state_row.data->'orders', '[]'::jsonb)),
      version = version + 1, updated_at = now() where id = 1;
  return jsonb_build_object('id', order_id, 'token', guest_token,
    'order', order_data - 'guestToken' - 'receipt' - 'cpf' - 'user_id' ||
      jsonb_build_object('items',
        (select coalesce(jsonb_agg(value - 'cost'),'[]'::jsonb)
         from jsonb_array_elements(order_items))));
end;
$$;

revoke all on function private.place_order(jsonb) from public, anon, authenticated;
grant execute on function private.place_order(jsonb) to anon, authenticated;
grant execute on function public.place_order(jsonb) to anon, authenticated;

create or replace function private.guest_order(p_order_id bigint, p_token uuid)
returns jsonb language sql stable security definer
set search_path = pg_catalog, public as $$
  select (ord.value - 'guestToken' - 'receipt' - 'cpf' - 'user_id') ||
    jsonb_build_object('items',
      (select coalesce(jsonb_agg(item.value - 'cost'),'[]'::jsonb)
       from jsonb_array_elements(ord.value->'items') as item))
  from public.app_state state
  cross join lateral jsonb_array_elements(state.data->'orders') as ord
  where state.id=1 and ord.value->>'id'=p_order_id::text
    and ord.value->>'guestToken'=p_token::text
  limit 1
$$;
revoke all on function private.guest_order(bigint,uuid) from public, anon, authenticated;
grant execute on function private.guest_order(bigint,uuid) to anon, authenticated;
create or replace function public.guest_order(p_order_id bigint, p_token uuid)
returns jsonb language sql security invoker
set search_path = pg_catalog, public, private as $$
  select private.guest_order(p_order_id,p_token)
$$;
revoke all on function public.guest_order(bigint,uuid) from public, anon, authenticated;
grant execute on function public.guest_order(bigint,uuid) to anon, authenticated;

create or replace function private.driver_deliveries()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public as $$
declare result jsonb;
begin
  if not exists (select 1 from public.profiles
      where user_id=auth.uid() and role='driver') then
    raise exception 'Acesso restrito aos entregadores.';
  end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',ord.value->'id','customer',ord.value->'customer',
      'phone',ord.value->'phone','address',ord.value->'address',
      'payment',ord.value->'payment','paid',ord.value->'paid',
      'freight',ord.value->'freight','status',ord.value->'status',
      'date',ord.value->'date','deliveryDate',ord.value->'deliveryDate',
      'items',(select coalesce(jsonb_agg(
        jsonb_build_object('name',item.value->'name','qty',item.value->'qty',
          'price',item.value->'price')),'[]'::jsonb)
        from jsonb_array_elements(ord.value->'items') as item))
    order by (ord.value->>'id')::bigint desc),'[]'::jsonb) into result
  from public.app_state state
  cross join lateral jsonb_array_elements(state.data->'orders') as ord
  where state.id=1 and ord.value->>'driver_id'=auth.uid()::text
    and ord.value->>'status'='transit';
  return result;
end;
$$;
revoke all on function private.driver_deliveries() from public, anon, authenticated;
grant execute on function private.driver_deliveries() to authenticated;
create or replace function public.driver_deliveries()
returns jsonb language sql security invoker
set search_path = pg_catalog, public, private as $$
  select private.driver_deliveries()
$$;
revoke all on function public.driver_deliveries() from public, anon, authenticated;
grant execute on function public.driver_deliveries() to authenticated;

create or replace function private.complete_delivery(p_order_id bigint, p_collected boolean)
returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
declare state_row public.app_state%rowtype; target jsonb; revised jsonb;
begin
  if not exists (select 1 from public.profiles
      where user_id=auth.uid() and role='driver') then
    raise exception 'Acesso restrito aos entregadores.';
  end if;
  select * into state_row from public.app_state where id=1 for update;
  select value into target from jsonb_array_elements(state_row.data->'orders')
    where value->>'id'=p_order_id::text;
  if target is null or target->>'driver_id'<>auth.uid()::text
      or target->>'status'<>'transit' then
    raise exception 'Entrega não encontrada para este entregador.';
  end if;
  if not coalesce((target->>'paid')::boolean,false) and p_collected is not true then
    raise exception 'Confirme o recebimento do pagamento antes de concluir.';
  end if;
  revised := target || jsonb_build_object('status','delivered','paid',true,
    'deliveredAt',now(),'paidAt',case when coalesce((target->>'paid')::boolean,false)
      then target->'paidAt' else to_jsonb(now()) end,
    'paymentCollectedBy',case when p_collected then auth.uid()::text else target->>'paymentCollectedBy' end);
  update public.app_state set data=jsonb_set(state_row.data,'{orders}',
    (select coalesce(jsonb_agg(case when value->>'id'=p_order_id::text
      then revised else value end order by ord),'[]'::jsonb)
     from jsonb_array_elements(state_row.data->'orders') with ordinality as item(value,ord))),
    version=version+1,updated_at=now() where id=1;
end;
$$;
revoke all on function private.complete_delivery(bigint,boolean) from public, anon, authenticated;
grant execute on function private.complete_delivery(bigint,boolean) to authenticated;
create or replace function public.complete_delivery(p_order_id bigint, p_collected boolean)
returns void language sql security invoker
set search_path = pg_catalog, public, private as $$
  select private.complete_delivery(p_order_id,p_collected)
$$;
revoke all on function public.complete_delivery(bigint,boolean) from public, anon, authenticated;
grant execute on function public.complete_delivery(bigint,boolean) to authenticated;

create or replace function private.delete_order(p_order_id bigint)
returns void language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare state_row public.app_state%rowtype; target jsonb; revised_products jsonb;
begin
  if not private.is_manager() then
    raise exception 'Somente a conta principal ou gerente pode excluir pedidos.';
  end if;
  select * into state_row from public.app_state where id=1 for update;
  select value into target from jsonb_array_elements(state_row.data->'orders')
    where value->>'id'=p_order_id::text;
  if target is null then raise exception 'Pedido não encontrado.'; end if;
  select coalesce(jsonb_agg(
    case when target->>'status' in ('transit','delivered') then
      jsonb_set(product.value,'{stock}',to_jsonb(
        coalesce((product.value->>'stock')::integer,0) +
        coalesce((select sum((item.value->>'qty')::integer)
          from jsonb_array_elements(target->'items') item
          where item.value->>'id'=product.value->>'id'),0)))
    else product.value end order by product.ord),'[]'::jsonb)
    into revised_products
  from jsonb_array_elements(state_row.data->'products') with ordinality as product(value,ord);
  update public.app_state set data=
    jsonb_set(jsonb_set(jsonb_set(state_row.data,'{products}',revised_products),
      '{orders}',(select coalesce(jsonb_agg(value order by ord),'[]'::jsonb)
        from jsonb_array_elements(state_row.data->'orders') with ordinality as item(value,ord)
        where value->>'id'<>p_order_id::text)),
      '{movements}',(select coalesce(jsonb_agg(value order by ord),'[]'::jsonb)
        from jsonb_array_elements(coalesce(state_row.data->'movements','[]'::jsonb)) with ordinality as movement(value,ord)
        where value->>'reason'<>'Saída do pedido #'||p_order_id::text
          and value->>'order_id' is distinct from p_order_id::text)),
    version=version+1,updated_at=now() where id=1;
end;
$$;
revoke all on function private.delete_order(bigint) from public, anon, authenticated;
grant execute on function private.delete_order(bigint) to authenticated;
create or replace function public.delete_order(p_order_id bigint)
returns void language sql security invoker
set search_path = pg_catalog, public, private as $$
  select private.delete_order(p_order_id)
$$;
revoke all on function public.delete_order(bigint) from public, anon, authenticated;
grant execute on function public.delete_order(bigint) to authenticated;
