-- Frete is configured by the shop owner and priced by the server at checkout.
update public.app_state
set data = jsonb_set(data, '{settings,shippingOptions}',
  '[{"id":"pickup","name":"Retirada na loja","delivery":"Retirada","price":0,"active":true}]'::jsonb,
  true),
  version = version + 1,
  updated_at = now()
where id = 1 and jsonb_typeof(data->'settings'->'shippingOptions') is distinct from 'array';

create function private.guard_shipping_options()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public, private as $$
begin
  if old.data->'settings'->'shippingOptions' is distinct from
      new.data->'settings'->'shippingOptions'
    and auth.uid() is not null and not private.is_master() then
    raise exception 'Somente a conta principal pode configurar o frete.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_shipping_options() from public, anon, authenticated;
create trigger guard_shipping_options before update of data on public.app_state
for each row execute function private.guard_shipping_options();

-- Keep the existing product, stock and contact validation. A new wrapper
-- validates the selected shipping option against the locked published state.
alter function private.place_order(jsonb) rename to place_order_core;
revoke all on function private.place_order_core(jsonb) from public, anon, authenticated;

create function private.place_order(p_request jsonb)
returns jsonb language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare
  state_row public.app_state%rowtype;
  selected jsonb;
  choice jsonb;
  response jsonb;
  freight numeric;
  order_id bigint;
  revised jsonb;
begin
  select * into state_row from public.app_state where id = 1 for update;
  if not found then raise exception 'Loja indisponível.'; end if;
  if nullif(p_request->>'shippingOptionId', '') is null then
    raise exception 'Selecione uma opção de frete ou retirada.';
  end if;
  select option.value into selected
  from jsonb_array_elements(coalesce(state_row.data->'settings'->'shippingOptions','[]'::jsonb)) as option
  where option.value->>'id'=p_request->>'shippingOptionId'
    and option.value->>'delivery'=p_request->>'delivery'
    and option.value->>'active'='true'
  limit 1;
  if selected is null or (selected->>'price') !~ '^[0-9]{1,6}([.][0-9]{1,2})?$'
      or nullif(trim(selected->>'name'), '') is null then
    raise exception 'Esta opção de frete não está mais disponível. Atualize o checkout.';
  end if;
  freight := (selected->>'price')::numeric;
  if freight > 100000 then raise exception 'Preço de frete inválido.'; end if;
  response := private.place_order_core(p_request);
  order_id := (response->>'id')::bigint;
  select * into state_row from public.app_state where id = 1 for update;
  select value into choice from jsonb_array_elements(state_row.data->'orders')
    where value->>'id'=order_id::text;
  if choice is null then raise exception 'Não foi possível concluir o pedido.'; end if;
  revised := choice || jsonb_build_object(
    'freight', freight, 'freightPending', false,
    'shippingOptionId', selected->>'id', 'shippingOptionName', selected->>'name',
    'createdAt', now());
  update public.app_state
  set data=jsonb_set(state_row.data,'{orders}',
    (select jsonb_agg(case when item.value->>'id'=order_id::text
      then revised else item.value end order by item.ord)
     from jsonb_array_elements(state_row.data->'orders') with ordinality as item(value,ord))),
    version=version+1, updated_at=now()
  where id=1;
  return jsonb_set(response, '{order}',
    (response->'order') || jsonb_build_object(
      'freight', freight, 'freightPending', false,
      'shippingOptionId', selected->>'id', 'shippingOptionName', selected->>'name',
      'createdAt', revised->'createdAt'));
end;
$$;
revoke all on function private.place_order(jsonb) from public, anon, authenticated;
grant execute on function private.place_order(jsonb) to anon, authenticated;
create or replace function public.place_order(p_request jsonb)
returns jsonb language sql security invoker
set search_path = pg_catalog, public, private as $$
  select private.place_order(p_request)
$$;
revoke all on function public.place_order(jsonb) from public, anon, authenticated;
grant execute on function public.place_order(jsonb) to anon, authenticated;

-- No direct app_state edit or legacy delivery RPC can mark an unpaid order
-- paid without a photo. Previously paid orders need no rewrite.
create function private.guard_payment_receipt()
returns trigger language plpgsql
set search_path = pg_catalog, public as $$
declare prior jsonb; latest jsonb;
begin
  for latest in select value from jsonb_array_elements(coalesce(new.data->'orders','[]'::jsonb))
  loop
    if not coalesce((latest->>'paid')::boolean,false) then continue; end if;
    select value into prior
    from jsonb_array_elements(coalesce(old.data->'orders','[]'::jsonb))
    where value->>'id'=latest->>'id'
    limit 1;
    if not coalesce((prior->>'paid')::boolean,false)
       and (left(coalesce(latest->>'receipt',''),23) <> 'data:image/jpeg;base64,'
         or length(latest->>'receipt') > 2400000) then
      raise exception 'Anexe uma foto do comprovante antes de confirmar o pagamento.';
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function private.guard_payment_receipt() from public, anon, authenticated;
drop trigger if exists guard_payment_receipt on public.app_state;
create trigger guard_payment_receipt before update of data on public.app_state
for each row execute function private.guard_payment_receipt();

create or replace function private.driver_deliveries()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public as $$
declare result jsonb;
begin
  if not exists (select 1 from public.profiles
    where user_id=auth.uid() and role='driver') then
    raise exception 'Acesso restrito aos entregadores.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',ord.value->'id','customer',ord.value->'customer',
    'phone',ord.value->'phone','address',ord.value->'address',
    'payment',ord.value->'payment','paid',ord.value->'paid',
    'freight',ord.value->'freight','status',ord.value->'status',
    'date',ord.value->'date','deliveryDate',ord.value->'deliveryDate',
    'driver_id',ord.value->'driver_id',
    'items',(select coalesce(jsonb_agg(jsonb_build_object(
      'name',item.value->'name','qty',item.value->'qty',
      'price',item.value->'price')),'[]'::jsonb)
      from jsonb_array_elements(ord.value->'items') as item))
    order by (ord.value->>'id')::bigint desc),'[]'::jsonb) into result
  from public.app_state state
  cross join lateral jsonb_array_elements(state.data->'orders') as ord
  where state.id=1 and ord.value->>'status'='transit'
    and ord.value->>'delivery'='Entrega'
    and (nullif(ord.value->>'driver_id','') is null
      or ord.value->>'driver_id'=auth.uid()::text);
  return result;
end;
$$;
revoke all on function private.driver_deliveries() from public, anon, authenticated;
grant execute on function private.driver_deliveries() to authenticated;

create function private.claim_delivery(p_order_id bigint)
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
  if target is null or target->>'status'<>'transit'
    or target->>'delivery'<>'Entrega'
    or (nullif(target->>'driver_id','') is not null
      and target->>'driver_id'<>auth.uid()::text) then
    raise exception 'Esta entrega não está mais disponível.';
  end if;
  revised := target || jsonb_build_object('driver_id',auth.uid()::text);
  update public.app_state set data=jsonb_set(state_row.data,'{orders}',
    (select jsonb_agg(case when value->>'id'=p_order_id::text then revised
      else value end order by ord)
     from jsonb_array_elements(state_row.data->'orders') with ordinality as item(value,ord))),
    version=version+1,updated_at=now() where id=1;
end;
$$;
revoke all on function private.claim_delivery(bigint) from public, anon, authenticated;
grant execute on function private.claim_delivery(bigint) to authenticated;
create function public.claim_delivery(p_order_id bigint)
returns void language sql security invoker
set search_path = pg_catalog, public, private as $$
  select private.claim_delivery(p_order_id)
$$;
revoke all on function public.claim_delivery(bigint) from public, anon, authenticated;
grant execute on function public.claim_delivery(bigint) to authenticated;

-- Remove the old signature so it cannot bypass the required receipt.
drop function public.complete_delivery(bigint,boolean);
drop function private.complete_delivery(bigint,boolean);
create function private.complete_delivery(p_order_id bigint, p_collected boolean, p_receipt text)
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
  if not coalesce((target->>'paid')::boolean,false) and
    (p_collected is not true or left(coalesce(p_receipt,''),23) <> 'data:image/jpeg;base64,'
      or length(p_receipt)>2400000) then
    raise exception 'Confirme o recebimento e anexe uma foto do comprovante.';
  end if;
  revised := target || jsonb_build_object(
    'status','delivered','paid',true,'deliveredAt',now(),
    'paidAt',case when coalesce((target->>'paid')::boolean,false)
      then target->'paidAt' else to_jsonb(now()) end,
    'receipt',case when coalesce((target->>'paid')::boolean,false)
      then target->'receipt' else to_jsonb(p_receipt) end,
    'paymentCollectedBy',case when p_collected
      then auth.uid()::text else target->>'paymentCollectedBy' end);
  update public.app_state set data=jsonb_set(state_row.data,'{orders}',
    (select jsonb_agg(case when value->>'id'=p_order_id::text then revised
      else value end order by ord)
     from jsonb_array_elements(state_row.data->'orders') with ordinality as item(value,ord))),
    version=version+1,updated_at=now() where id=1;
end;
$$;
revoke all on function private.complete_delivery(bigint,boolean,text) from public, anon, authenticated;
grant execute on function private.complete_delivery(bigint,boolean,text) to authenticated;
create function public.complete_delivery(p_order_id bigint, p_collected boolean, p_receipt text)
returns void language sql security invoker
set search_path = pg_catalog, public, private as $$
  select private.complete_delivery(p_order_id,p_collected,p_receipt)
$$;
revoke all on function public.complete_delivery(bigint,boolean,text) from public, anon, authenticated;
grant execute on function public.complete_delivery(bigint,boolean,text) to authenticated;
