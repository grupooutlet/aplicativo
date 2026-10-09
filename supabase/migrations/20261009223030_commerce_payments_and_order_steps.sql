-- Public payment titles and rates are part of the published catalog.
update public.app_state set data=jsonb_set(data,'{settings,paymentMethods}',
  '[{"id":"pay-pix","title":"Pix","kind":"pix","active":true,"installments":[{"count":1,"rate":0}]},
    {"id":"pay-credit","title":"Cartão de crédito","kind":"credit","active":true,"installments":[{"count":1,"rate":0}]},
    {"id":"pay-debit","title":"Cartão de débito","kind":"debit","active":true,"installments":[{"count":1,"rate":0}]},
    {"id":"pay-cash","title":"Dinheiro","kind":"cash","active":true,"installments":[{"count":1,"rate":0}]}]'::jsonb),
  version=version+1,updated_at=now() where id=1 and data->'settings'->'paymentMethods' is null;

create function private.payment_quote(p_methods jsonb,p_id text,p_count integer,p_base numeric)
returns jsonb language plpgsql immutable
set search_path=pg_catalog as $$
declare method jsonb; option jsonb; rate numeric; fee numeric; total numeric; each numeric;
begin
  select value into method from jsonb_array_elements(p_methods)
    where value->>'id'=p_id and value->>'active'='true';
  select value into option from jsonb_array_elements(coalesce(method->'installments','[]'::jsonb))
    where (value->>'count')::integer=p_count;
  if method is null or option is null or p_count not between 1 and 24 or p_base is null or p_base<0
    or (method->>'kind'<>'credit' and p_count<>1) then
    raise exception 'Selecione um pagamento e parcelamento disponíveis.';
  end if;
  rate:=(option->>'rate')::numeric;
  if rate is null or rate<0 or rate>100 then raise exception 'Taxa inválida.'; end if;
  fee:=round(p_base*rate/100,2); total:=round(p_base,2)+fee;
  each:=floor(total*100/p_count)/100;
  return jsonb_build_object('payment',method->>'title','paymentMethodId',p_id,
    'paymentKind',method->>'kind','paymentRate',rate,'paymentFee',fee,'paymentBase',round(p_base,2),
    'installments',p_count,'installmentAmount',each,'lastInstallmentAmount',total-each*(p_count-1),'total',total);
end;
$$;
revoke all on function private.payment_quote(jsonb,text,integer,numeric) from public,anon,authenticated;

create function private.guard_payment_methods()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare method jsonb; option jsonb;
begin
  if old.data->'settings'->'paymentMethods' is not distinct from new.data->'settings'->'paymentMethods' then return new; end if;
  if auth.uid() is not null and not private.is_manager() then raise exception 'Somente principal e gerente configuram pagamentos.'; end if;
  if jsonb_typeof(new.data->'settings'->'paymentMethods') is distinct from 'array' then raise exception 'Pagamentos inválidos.'; end if;
  if exists(select 1 from jsonb_array_elements(new.data->'settings'->'paymentMethods') group by value->>'id' having count(*)>1) then raise exception 'Pagamento repetido.'; end if;
  for method in select value from jsonb_array_elements(new.data->'settings'->'paymentMethods') loop
    if length(coalesce(method->>'id','')) not between 1 and 80 or length(trim(coalesce(method->>'title',''))) not between 1 and 60
      or coalesce(method->>'kind','') not in ('pix','credit','debit','cash','other')
      or jsonb_typeof(method->'active') is distinct from 'boolean'
      or jsonb_typeof(method->'installments') is distinct from 'array'
      or jsonb_array_length(method->'installments') not between 1 and 24 then raise exception 'Confira os dados do pagamento.'; end if;
    if exists(select 1 from jsonb_array_elements(method->'installments') group by value->>'count' having count(*)>1) then raise exception 'Parcelamento repetido.'; end if;
    for option in select value from jsonb_array_elements(method->'installments') loop
      if coalesce(option->>'count','') !~ '^[0-9]+$' or (option->>'count')::integer not between 1 and 24
        or (method->>'kind'<>'credit' and (option->>'count')::integer<>1)
        or coalesce(option->>'rate','') !~ '^[0-9]{1,3}([.][0-9]{1,2})?$' or (option->>'rate')::numeric>100 then raise exception 'Parcelas ou taxas inválidas.'; end if;
    end loop;
  end loop;
  return new;
end;
$$;
revoke all on function private.guard_payment_methods() from public,anon,authenticated;
create trigger guard_payment_methods before update of data on public.app_state for each row execute function private.guard_payment_methods();

alter function private.place_order(jsonb) rename to place_order_with_shipping;
revoke all on function private.place_order_with_shipping(jsonb) from public,anon,authenticated;
create function private.place_order(p_request jsonb)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare state_row public.app_state%rowtype; method jsonb; response jsonb; target jsonb; quote jsonb; base numeric; first_name text; last_name text; canonical text;
begin
  first_name:=trim(regexp_replace(coalesce(p_request->>'firstName',''),'[[:space:]]+',' ','g'));
  last_name:=trim(regexp_replace(coalesce(p_request->>'lastName',''),'[[:space:]]+',' ','g'));
  if length(first_name) not between 2 and 60 or length(last_name) not between 2 and 60
    or first_name !~ '^[[:alpha:]][[:alpha:] .’''-]*$' or last_name !~ '^[[:alpha:]][[:alpha:] .’''-]*$'
    or length(regexp_replace(first_name,'[^[:alpha:]]','','g'))<2 or length(regexp_replace(last_name,'[^[:alpha:]]','','g'))<2 then raise exception 'Confira nome e sobrenome.'; end if;
  select * into state_row from public.app_state where id=1 for update;
  select value into method from jsonb_array_elements(state_row.data->'settings'->'paymentMethods')
    where value->>'id'=p_request->>'paymentMethodId' and value->>'active'='true';
  if method is null or p_request->>'installments' !~ '^[0-9]+$' then raise exception 'Selecione uma forma de pagamento disponível.'; end if;
  canonical:=case method->>'kind' when 'pix' then 'Pix' when 'credit' then 'Cartão de crédito' when 'debit' then 'Cartão de débito' else 'Dinheiro' end;
  response:=private.place_order_with_shipping(p_request||jsonb_build_object('customer',first_name||' '||last_name,'payment',canonical));
  select * into state_row from public.app_state where id=1 for update;
  select value into target from jsonb_array_elements(state_row.data->'orders') where value->>'id'=response->>'id';
  select sum((value->>'price')::numeric*(value->>'qty')::numeric) into base from jsonb_array_elements(target->'items');
  quote:=private.payment_quote(state_row.data->'settings'->'paymentMethods',method->>'id',(p_request->>'installments')::integer,base+(target->>'freight')::numeric);
  if p_request->>'expectedTotal' is null or (p_request->>'expectedTotal')::numeric is distinct from (quote->>'total')::numeric then
    raise exception 'Os valores mudaram. Atualize o checkout e confira o total antes de concluir.';
  end if;
  target:=target||quote||jsonb_build_object('firstName',first_name,'lastName',last_name,'date',to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD'));
  update public.app_state set data=jsonb_set(state_row.data,'{orders}',
    (select jsonb_agg(case when value->>'id'=target->>'id' then target else value end order by ord)
      from jsonb_array_elements(state_row.data->'orders') with ordinality as item(value,ord))),version=version+1,updated_at=now() where id=1;
  return jsonb_set(response,'{order}',(response->'order')||quote||jsonb_build_object('firstName',first_name,'lastName',last_name,'customer',first_name||' '||last_name,'date',target->'date'));
end;
$$;
revoke all on function private.place_order(jsonb) from public,anon,authenticated;
grant execute on function private.place_order(jsonb) to anon,authenticated;
create or replace function public.place_order(p_request jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog,public,private as $$ select private.place_order(p_request) $$;

create function private.valid_payment_photo(p_photo text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
begin
  return p_photo is not null and left(p_photo,23)='data:image/jpeg;base64,' and length(p_photo) between 100 and 2400000
    and encode(substring(decode(substring(p_photo from 24),'base64') from 1 for 3),'hex')='ffd8ff';
exception when others then return false;
end;
$$;
revoke all on function private.valid_payment_photo(text) from public,anon,authenticated;

-- Freeze the selected rate, recalculate cents if freight changes, and stamp actual events.
create function private.guard_order_steps()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare latest jsonb; prior jsonb; revised jsonb; orders jsonb:='[]'::jsonb; base numeric; fee numeric; total numeric; each numeric; quote jsonb;
begin
  for latest in select value from jsonb_array_elements(coalesce(new.data->'orders','[]'::jsonb)) loop
    select value into prior from jsonb_array_elements(coalesce(old.data->'orders','[]'::jsonb)) where value->>'id'=latest->>'id';
    revised:=latest;
    if latest->>'paymentMethodId' is not null then
      select sum((value->>'price')::numeric*(value->>'qty')::numeric) into base from jsonb_array_elements(latest->'items');
      base:=coalesce(base,0)+coalesce((latest->>'freight')::numeric,0);
      if prior->>'paymentMethodId' is null then
        quote:=private.payment_quote(new.data->'settings'->'paymentMethods',latest->>'paymentMethodId',(latest->>'installments')::integer,base);
        revised:=revised||quote;
      else
        if prior->>'paymentMethodId' is distinct from latest->>'paymentMethodId' or prior->'paymentRate' is distinct from latest->'paymentRate'
          or prior->'installments' is distinct from latest->'installments' or prior->'payment' is distinct from latest->'payment' then raise exception 'O pagamento escolhido deve ser preservado no pedido.'; end if;
        fee:=round(base*(prior->>'paymentRate')::numeric/100,2); total:=round(base,2)+fee;
        each:=floor(total*100/(prior->>'installments')::integer)/100;
        revised:=revised||jsonb_build_object('paymentBase',base,'paymentFee',fee,'total',total,'installmentAmount',each,
          'lastInstallmentAmount',total-each*((prior->>'installments')::integer-1));
      end if;
    end if;
    if coalesce((latest->>'paid')::boolean,false) and not coalesce((prior->>'paid')::boolean,false) then
      if not private.valid_payment_photo(latest->>'receipt') then raise exception 'Anexe a foto do comprovante para confirmar o pagamento.'; end if;
      if latest->>'delivery'='Entrega' and (latest->>'deliveryDate' is null or coalesce((latest->>'freightPending')::boolean,false)
        or (latest->>'paymentTiming'<>'Antecipado' and prior->>'status' is distinct from 'transit')) then raise exception 'Conclua agendamento e liberação antes do pagamento na entrega.'; end if;
      revised:=revised||jsonb_build_object('paidAt',now());
    end if;
    if latest->>'status'='transit' and prior->>'status' is distinct from 'transit' then
      if latest->>'paymentTiming'='Antecipado' and not coalesce((latest->>'paid')::boolean,false) then raise exception 'Confirme o pagamento antecipado antes da saída.'; end if;
      revised:=revised||jsonb_build_object('releasedAt',now());
    end if;
    if latest->>'status'='delivered' and prior->>'status' is distinct from 'delivered' then
      if not coalesce((latest->>'paid')::boolean,false) or not private.valid_payment_photo(latest->>'receipt') then raise exception 'Confirme o pagamento com comprovante antes de finalizar.'; end if;
      if latest->>'delivery'='Entrega' and (prior->>'status' is distinct from 'transit' or latest->>'deliveryDate' is null
        or coalesce((latest->>'freightPending')::boolean,false)) then raise exception 'Conclua o agendamento e a saída antes de finalizar a entrega.'; end if;
      revised:=revised||jsonb_build_object('deliveredAt',now());
      if latest->>'delivery'='Retirada' then revised:=revised||jsonb_build_object('releasedAt',now()); end if;
    end if;
    orders:=orders||jsonb_build_array(revised);
  end loop;
  new.data:=jsonb_set(new.data,'{orders}',orders); return new;
end;
$$;
revoke all on function private.guard_order_steps() from public,anon,authenticated;
create trigger guard_order_steps before update of data on public.app_state for each row execute function private.guard_order_steps();

create function private.confirm_delivery_payment(p_order_id bigint,p_receipt text)
returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare state_row public.app_state%rowtype; target jsonb;
begin
  if not exists(select 1 from public.profiles where user_id=auth.uid() and role='driver') then raise exception 'Acesso restrito ao entregador.'; end if;
  if not private.valid_payment_photo(p_receipt) then raise exception 'Anexe uma foto válida do comprovante.'; end if;
  select * into state_row from public.app_state where id=1 for update;
  select value into target from jsonb_array_elements(state_row.data->'orders') where value->>'id'=p_order_id::text;
  if target is null or target->>'status'<>'transit' or target->>'driver_id' is distinct from auth.uid()::text or coalesce((target->>'paid')::boolean,false) then raise exception 'Pagamento não disponível para este entregador.'; end if;
  target:=target||jsonb_build_object('paid',true,'paidAt',now(),'receipt',p_receipt,'paymentCollectedBy',auth.uid()::text);
  update public.app_state set data=jsonb_set(state_row.data,'{orders}',
    (select jsonb_agg(case when value->>'id'=p_order_id::text then target else value end order by ord)
      from jsonb_array_elements(state_row.data->'orders') with ordinality as item(value,ord))),version=version+1,updated_at=now() where id=1;
end;
$$;
revoke all on function private.confirm_delivery_payment(bigint,text) from public,anon,authenticated;
grant execute on function private.confirm_delivery_payment(bigint,text) to authenticated;
create function public.confirm_delivery_payment(p_order_id bigint,p_receipt text)
returns void language sql security invoker set search_path=pg_catalog,public,private as $$ select private.confirm_delivery_payment(p_order_id,p_receipt) $$;
revoke all on function public.confirm_delivery_payment(bigint,text) from public,anon,authenticated;
grant execute on function public.confirm_delivery_payment(bigint,text) to authenticated;

-- A driver changes only their own display name, without altering role or permissions.
create function private.update_my_profile(p_name text)
returns void language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  if not exists(select 1 from public.profiles where user_id=auth.uid() and role='driver') then raise exception 'Perfil indisponível.'; end if;
  if length(trim(p_name)) not between 2 and 120 then raise exception 'Confira seu nome.'; end if;
  update public.profiles set name=trim(p_name) where user_id=auth.uid();
end;
$$;
revoke all on function private.update_my_profile(text) from public,anon,authenticated;
grant execute on function private.update_my_profile(text) to authenticated;
create function public.update_my_profile(p_name text)
returns void language sql security invoker set search_path=pg_catalog,public,private as $$ select private.update_my_profile(p_name) $$;
revoke all on function public.update_my_profile(text) from public,anon,authenticated;
grant execute on function public.update_my_profile(text) to authenticated;

create or replace function private.complete_delivery(p_order_id bigint,p_collected boolean,p_receipt text)
returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare state_row public.app_state%rowtype; target jsonb;
begin
  if not exists(select 1 from public.profiles where user_id=auth.uid() and role='driver') then raise exception 'Acesso restrito ao entregador.'; end if;
  select * into state_row from public.app_state where id=1 for update;
  select value into target from jsonb_array_elements(state_row.data->'orders') where value->>'id'=p_order_id::text;
  if target is null or target->>'status'<>'transit' or target->>'driver_id' is distinct from auth.uid()::text then raise exception 'Entrega não encontrada.'; end if;
  if not coalesce((target->>'paid')::boolean,false) or not private.valid_payment_photo(target->>'receipt') then raise exception 'Confirme o pagamento com comprovante antes de concluir a entrega.'; end if;
  target:=target||jsonb_build_object('status','delivered','deliveredAt',now());
  update public.app_state set data=jsonb_set(state_row.data,'{orders}',
    (select jsonb_agg(case when value->>'id'=p_order_id::text then target else value end order by ord)
      from jsonb_array_elements(state_row.data->'orders') with ordinality as item(value,ord))),version=version+1,updated_at=now() where id=1;
end;
$$;

create or replace function private.driver_deliveries()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare result jsonb;
begin
  if not exists(select 1 from public.profiles where user_id=auth.uid() and role='driver') then raise exception 'Acesso restrito aos entregadores.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o->'id','customer',o->'customer','cpf',o->'cpf','phone',o->'phone','address',o->'address',
    'payment',o->'payment','paid',o->'paid','freight',o->'freight','shippingOptionName',o->'shippingOptionName',
    'status',o->'status','delivery','Entrega','date',o->'date','deliveryDate',o->'deliveryDate',
    'driver_id',o->'driver_id','notes',o->'notes','releasedAt',o->'releasedAt','paidAt',o->'paidAt','deliveredAt',o->'deliveredAt',
    'paymentTiming',o->'paymentTiming','paymentMethodId',o->'paymentMethodId','paymentFee',o->'paymentFee',
    'paymentRate',o->'paymentRate','paymentBase',o->'paymentBase','installments',o->'installments',
    'installmentAmount',o->'installmentAmount','lastInstallmentAmount',o->'lastInstallmentAmount',
    'items',(select coalesce(jsonb_agg(jsonb_build_object('name',value->'name','qty',value->'qty','price',value->'price')),'[]'::jsonb) from jsonb_array_elements(o->'items')))
    order by o->>'deliveryDate',(o->>'id')::bigint),'[]'::jsonb) into result
  from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') as ord(o)
  where s.id=1 and o->>'delivery'='Entrega' and o->>'status' in ('pending','ready','transit','delivered')
    and nullif(o->>'deliveryDate','') is not null and (nullif(o->>'driver_id','') is null or o->>'driver_id'=auth.uid()::text);
  return result;
end;
$$;
