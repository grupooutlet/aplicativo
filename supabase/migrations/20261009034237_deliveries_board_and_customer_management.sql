-- Owner and managers configure reusable checkout rates in Entregas.
create or replace function private.guard_shipping_options()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private as $$
begin
  if old.data->'settings'->'shippingOptions' is distinct from new.data->'settings'->'shippingOptions'
    and auth.uid() is not null and not private.is_manager() then
    raise exception 'Somente a conta principal ou gerente pode configurar os fretes.';
  end if;
  return new;
end;
$$;

create function private.schedule_delivery(p_order_id bigint, p_date date, p_shipping_option_id text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare state_row public.app_state%rowtype; target jsonb; revised jsonb; option jsonb; price numeric;
begin
  if not private.is_admin() then raise exception 'Acesso restrito à equipe.'; end if;
  if p_date is null or p_date < (now() at time zone 'America/Sao_Paulo')::date then
    raise exception 'Selecione uma data válida para a entrega.';
  end if;
  select * into state_row from public.app_state where id=1 for update;
  select value into target from jsonb_array_elements(state_row.data->'orders')
    where value->>'id'=p_order_id::text;
  if target is null or target->>'delivery'<>'Entrega'
    or target->>'status' in ('delivered','cancelled') then
    raise exception 'Este pedido não pode ser agendado.';
  end if;
  revised := target || jsonb_build_object('deliveryDate',p_date);
  if coalesce((target->>'freightPending')::boolean,false) then
    select value into option
    from jsonb_array_elements(coalesce(state_row.data->'settings'->'shippingOptions','[]'::jsonb))
    where value->>'id'=p_shipping_option_id and value->>'delivery'='Entrega'
      and value->>'active'='true' limit 1;
    if option is null or (option->>'price') !~ '^[0-9]{1,6}([.][0-9]{1,2})?$' then
      raise exception 'Selecione um frete disponível em Entregas.';
    end if;
    price := (option->>'price')::numeric;
    if price>100000 then raise exception 'Frete inválido.'; end if;
    revised := revised || jsonb_build_object('freight',price,'freightPending',false,
      'shippingOptionId',option->>'id','shippingOptionName',option->>'name');
  end if;
  update public.app_state set data=jsonb_set(state_row.data,'{orders}',
    (select jsonb_agg(case when value->>'id'=p_order_id::text then revised else value end order by ord)
     from jsonb_array_elements(state_row.data->'orders') with ordinality as item(value,ord))),
    version=version+1,updated_at=now() where id=1;
end;
$$;
revoke all on function private.schedule_delivery(bigint,date,text) from public, anon, authenticated;
grant execute on function private.schedule_delivery(bigint,date,text) to authenticated;
create function public.schedule_delivery(p_order_id bigint,p_date date,p_shipping_option_id text)
returns void language sql security invoker
set search_path = pg_catalog, public, private as $$
  select private.schedule_delivery(p_order_id,p_date,p_shipping_option_id)
$$;
revoke all on function public.schedule_delivery(bigint,date,text) from public, anon, authenticated;
grant execute on function public.schedule_delivery(bigint,date,text) to authenticated;

create function private.guard_delivery_schedule()
returns trigger language plpgsql
set search_path = pg_catalog, public as $$
declare latest jsonb; prior jsonb; day_text text;
begin
  for latest in select value from jsonb_array_elements(coalesce(new.data->'orders','[]'::jsonb)) loop
    if latest->>'delivery'<>'Entrega' then continue; end if;
    select value into prior from jsonb_array_elements(coalesce(old.data->'orders','[]'::jsonb))
      where value->>'id'=latest->>'id' limit 1;
    if (prior is null and latest->>'channel'='Loja física')
       or (latest->>'status'='transit' and prior->>'status' is distinct from 'transit') then
      day_text := latest->>'deliveryDate';
      if day_text is null or day_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Defina a data da entrega antes de continuar.';
      end if;
      perform day_text::date;
    end if;
    if latest->>'status'='transit' and prior->>'status' is distinct from 'transit'
      and coalesce((latest->>'freightPending')::boolean,false) then
      raise exception 'Defina o frete antes de liberar a entrega.';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.guard_delivery_schedule() from public, anon, authenticated;
create trigger guard_delivery_schedule before update of data on public.app_state
for each row execute function private.guard_delivery_schedule();

-- Drivers see logistics and payment amounts for scheduled deliveries only.
create or replace function private.driver_deliveries()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public as $$
declare result jsonb;
begin
  if not exists (select 1 from public.profiles where user_id=auth.uid() and role='driver') then
    raise exception 'Acesso restrito aos entregadores.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',ord.value->'id','customer',ord.value->'customer','cpf',ord.value->'cpf',
    'phone',ord.value->'phone','address',ord.value->'address',
    'payment',ord.value->'payment','paid',ord.value->'paid',
    'freight',ord.value->'freight','shippingOptionName',ord.value->'shippingOptionName',
    'status',ord.value->'status','delivery','Entrega',
    'date',ord.value->'date','deliveryDate',ord.value->'deliveryDate',
    'driver_id',ord.value->'driver_id','notes',ord.value->'notes',
    'items',(select coalesce(jsonb_agg(jsonb_build_object(
      'name',item.value->'name','qty',item.value->'qty','price',item.value->'price')),'[]'::jsonb)
      from jsonb_array_elements(ord.value->'items') as item))
    order by ord.value->>'deliveryDate',(ord.value->>'id')::bigint),'[]'::jsonb) into result
  from public.app_state state
  cross join lateral jsonb_array_elements(state.data->'orders') as ord
  where state.id=1 and ord.value->>'delivery'='Entrega'
    and ord.value->>'status' in ('pending','ready','transit','delivered')
    and nullif(ord.value->>'deliveryDate','') is not null
    and (nullif(ord.value->>'driver_id','') is null or ord.value->>'driver_id'=auth.uid()::text);
  return result;
end;
$$;
revoke all on function private.driver_deliveries() from public, anon, authenticated;
grant execute on function private.driver_deliveries() to authenticated;

-- The Edge function checks this live session before any Auth admin operation.
create function private.customer_admin_authority()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, private as $$
declare profile public.profiles%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from auth.sessions where user_id=auth.uid()
      and id::text=auth.jwt()->>'session_id') then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;
  select * into profile from public.profiles where user_id=auth.uid();
  if profile.role='master' and private.is_master() then
    return jsonb_build_object('promote',true,'delete',true);
  end if;
  if profile.role='admin' and profile.position='Gerente' then
    return jsonb_build_object('promote',false,'delete',true);
  end if;
  raise exception 'Seu perfil não pode gerenciar clientes.';
end;
$$;
revoke all on function private.customer_admin_authority() from public, anon, authenticated;
grant execute on function private.customer_admin_authority() to authenticated;
create function public.customer_admin_authority()
returns jsonb language sql security invoker
set search_path = pg_catalog, public, private as $$
  select private.customer_admin_authority()
$$;
revoke all on function public.customer_admin_authority() from public, anon, authenticated;
grant execute on function public.customer_admin_authority() to authenticated;

-- Called only by the authorized Edge function after removing a customer's Auth user.
-- Historical order snapshots and sales metrics are preserved; account links are removed.
grant usage on schema private to service_role;
create function private.finalize_customer_removal(p_user_id uuid,p_email text,p_contact_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public as $$
declare contact_ids text[]; state_row public.app_state%rowtype;
begin
  if exists (select 1 from public.profiles
    where (user_id=p_user_id or lower(email)=lower(p_email)) and role<>'customer') then
    raise exception 'Este perfil pertence à equipe.';
  end if;
  select * into state_row from public.app_state where id=1 for update;
  select array_agg(id::text) into contact_ids from public.customer_contacts
    where id=p_contact_id or lower(email)=lower(p_email);
  delete from public.customer_contacts where id::text=any(coalesce(contact_ids,array[]::text[]));
  update public.app_state set data=jsonb_set(state_row.data,'{orders}',
    (select coalesce(jsonb_agg(
      value || case when value->>'user_id'=p_user_id::text then '{"user_id":null}'::jsonb else '{}'::jsonb end
      || case when value->>'customer_id'=any(coalesce(contact_ids,array[]::text[]))
        then '{"customer_id":null}'::jsonb else '{}'::jsonb end order by ord),'[]'::jsonb)
     from jsonb_array_elements(state_row.data->'orders') with ordinality as item(value,ord))),
    version=version+1,updated_at=now() where id=1;
end;
$$;
revoke all on function private.finalize_customer_removal(uuid,text,uuid) from public,anon,authenticated;
grant execute on function private.finalize_customer_removal(uuid,text,uuid) to service_role;
create function public.finalize_customer_removal(p_user_id uuid,p_email text,p_contact_id uuid)
returns void language sql security invoker
set search_path = pg_catalog, public, private as $$
  select private.finalize_customer_removal(p_user_id,p_email,p_contact_id)
$$;
revoke all on function public.finalize_customer_removal(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.finalize_customer_removal(uuid,text,uuid) to service_role;

-- Deleted accounts cannot use an unexpired token to read their previous orders.
create or replace function private.my_orders()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(jsonb_set(ord.value - 'receipt' - 'guestToken','{items}',
    (select coalesce(jsonb_agg(item.value - 'cost'),'[]'::jsonb)
     from jsonb_array_elements(ord.value->'items') item))
    order by (ord.value->>'id')::bigint desc),'[]'::jsonb)
  from public.app_state state cross join lateral jsonb_array_elements(state.data->'orders') ord
  where state.id=1 and ord.value->>'user_id'=auth.uid()::text
    and exists (select 1 from public.profiles where user_id=auth.uid())
    and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
$$;
