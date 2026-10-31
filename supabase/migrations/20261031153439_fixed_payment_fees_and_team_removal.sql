-- Existing installments default to percentage; historical orders retain their agreed fee.
CREATE OR REPLACE FUNCTION private.payment_quote(p_methods jsonb, p_id text, p_count integer, p_base numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
declare method jsonb; option jsonb; rate numeric; fee_type text; fee numeric; total numeric; each numeric;
begin
  select value into method from jsonb_array_elements(p_methods)
    where value->>'id'=p_id and value->>'active'='true';
  select value into option from jsonb_array_elements(coalesce(method->'installments','[]'::jsonb))
    where (value->>'count')::integer=p_count;
  if method is null or option is null or p_count not between 1 and 24 or p_base is null or p_base<0
    or coalesce(method->>'kind','') not in ('pix','credit','debit','cash') or (method->>'kind'<>'credit' and p_count<>1) then
    raise exception 'Selecione um pagamento e parcelamento disponíveis.';
  end if;
  fee_type:=coalesce(option->>'feeType','percent');
  rate:=(option->>'rate')::numeric;
  if fee_type not in ('percent','fixed') or rate is null or rate<0 or rate<>round(rate,2) or rate>(case when fee_type='fixed' then 1000000 else 100 end) or (method->>'kind'<>'credit' and (rate<>0 or fee_type<>'percent')) then raise exception 'Taxa inválida.'; end if;
  fee:=case when fee_type='fixed' then rate else round(round(p_base,2)*rate/100,2) end; total:=round(p_base,2)+fee;
  each:=floor(total*100/p_count)/100;
  return jsonb_build_object('payment',method->>'title','paymentMethodId',p_id,
    'paymentKind',method->>'kind','paymentRate',case when fee_type='percent' then rate else 0 end,'paymentFeeType',fee_type,'paymentFeeValue',rate,'paymentFee',fee,'paymentBase',round(p_base,2),
    'installments',p_count,'installmentAmount',each,'lastInstallmentAmount',total-each*(p_count-1),'total',total);
end;
$function$;


CREATE OR REPLACE FUNCTION private.guard_order_steps()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare latest jsonb; prior jsonb; revised jsonb; orders jsonb:='[]'::jsonb; base numeric; fee numeric; total numeric; each numeric; quote jsonb;
begin
  if private.is_history_reversal() then return new; end if;
  if old.data->'orders' is not distinct from new.data->'orders' then return new; end if;
  for latest in select value from jsonb_array_elements(coalesce(new.data->'orders','[]'::jsonb)) loop
    select value into prior from jsonb_array_elements(coalesce(old.data->'orders','[]'::jsonb)) where value->>'id'=latest->>'id';
    revised:=latest;
    if latest->>'pickupReadyAt' is distinct from prior->>'pickupReadyAt' or latest->>'pickupNotifiedAt' is distinct from prior->>'pickupNotifiedAt' then
      if not exists(select 1 from public.profiles where user_id=auth.uid() and role in ('master','admin'))
        or latest->>'delivery' is distinct from 'Retirada' or latest->>'status' not in ('pending','ready') then raise exception 'Alteração de retirada não autorizada.'; end if;
      if nullif(prior->>'pickupReadyAt','') is not null and latest->>'pickupReadyAt' is distinct from prior->>'pickupReadyAt' then raise exception 'A preparação já foi registrada.'; end if;
      if nullif(latest->>'pickupReadyAt','') is null then raise exception 'Confira a preparação da retirada.'; end if;
      if nullif(prior->>'pickupReadyAt','') is null then revised:=revised||jsonb_build_object('pickupReadyAt',now(),'pickupReadyBy',auth.uid()); end if;
      if latest->>'pickupNotifiedAt' is distinct from prior->>'pickupNotifiedAt' then
        if nullif(prior->>'pickupReadyAt','') is null or nullif(latest->>'pickupNotifiedAt','') is null then raise exception 'Prepare o pedido antes de registrar o aviso.'; end if;
        if length(coalesce(btrim(latest->>'pickupNoticeMessage'),'')) not between 10 and 2000 or private.normalize_registration_phone(latest->>'phone') is null then raise exception 'Confira a mensagem e o telefone do cliente.'; end if;
        revised:=revised||jsonb_build_object('pickupNotifiedAt',now(),'pickupNotifiedBy',auth.uid());
      end if;
    end if;
    if latest->>'paymentMethodId' is not null then
      select sum((value->>'price')::numeric*(value->>'qty')::numeric) into base from jsonb_array_elements(latest->'items');
      base:=coalesce(base,0)+coalesce((latest->>'freight')::numeric,0);
      if prior->>'paymentMethodId' is null then
        quote:=private.payment_quote(new.data->'settings'->'paymentMethods',latest->>'paymentMethodId',(latest->>'installments')::integer,base);
        revised:=revised||quote;
      else
        if prior->>'paymentMethodId' is distinct from latest->>'paymentMethodId' or prior->'paymentRate' is distinct from latest->'paymentRate'
          or coalesce(prior->>'paymentFeeType','percent') is distinct from coalesce(latest->>'paymentFeeType','percent')
          or coalesce(prior->'paymentFeeValue',prior->'paymentRate') is distinct from coalesce(latest->'paymentFeeValue',latest->'paymentRate')
          or prior->'paymentKind' is distinct from latest->'paymentKind'
          or prior->'installments' is distinct from latest->'installments' or prior->'payment' is distinct from latest->'payment' then raise exception 'O pagamento escolhido deve ser preservado no pedido.'; end if;
        fee:=case when prior->>'paymentFeeType'='fixed' then (prior->>'paymentFeeValue')::numeric else round(base*coalesce((prior->>'paymentFeeValue')::numeric,(prior->>'paymentRate')::numeric)/100,2) end; total:=round(base,2)+fee;
        each:=floor(total*100/(prior->>'installments')::integer)/100;
        revised:=revised||jsonb_build_object('paymentBase',base,'paymentFee',fee,'total',total,'installmentAmount',each,
          'lastInstallmentAmount',total-each*((prior->>'installments')::integer-1));
      end if;
    end if;
    if coalesce((latest->>'paid')::boolean,false) and not coalesce((prior->>'paid')::boolean,false) then
      if latest->>'delivery'='Retirada' and (nullif(prior->>'pickupReadyAt','') is null or nullif(prior->>'pickupNotifiedAt','') is null) then raise exception 'Conclua a preparação e o aviso ao cliente antes do pagamento.'; end if;
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
      if latest->>'delivery'='Retirada' and (nullif(prior->>'pickupReadyAt','') is null or nullif(prior->>'pickupNotifiedAt','') is null) then raise exception 'Conclua a preparação e o aviso ao cliente antes da retirada.'; end if;
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
$function$;


CREATE OR REPLACE FUNCTION private.driver_deliveries()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare result jsonb;
begin
  if not exists(select 1 from public.profiles where user_id=auth.uid() and role='driver') then raise exception 'Acesso restrito aos entregadores.'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',o->'id','customer',o->'customer','cpf',o->'cpf','phone',o->'phone','address',o->'address',
    'payment',o->'payment','paid',o->'paid','freight',o->'freight','shippingOptionName',o->'shippingOptionName',
    'status',o->'status','delivery','Entrega','date',o->'date','deliveryDate',o->'deliveryDate',
    'driver_id',o->'driver_id','notes',o->'notes','releasedAt',o->'releasedAt','paidAt',o->'paidAt','deliveredAt',o->'deliveredAt',
    'paymentTiming',o->'paymentTiming','paymentMethodId',o->'paymentMethodId','paymentFee',o->'paymentFee',
    'paymentRate',o->'paymentRate','paymentFeeType',o->'paymentFeeType','paymentFeeValue',o->'paymentFeeValue','paymentBase',o->'paymentBase','installments',o->'installments',
    'installmentAmount',o->'installmentAmount','lastInstallmentAmount',o->'lastInstallmentAmount',
    'items',(select coalesce(jsonb_agg(jsonb_build_object('name',value->'name','qty',value->'qty','price',value->'price')),'[]'::jsonb) from jsonb_array_elements(o->'items')))
    order by o->>'deliveryDate',(o->>'id')::bigint),'[]'::jsonb) into result
  from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') as ord(o)
  where s.id=1 and o->>'delivery'='Entrega' and o->>'status' in ('pending','ready','transit','delivered')
    and nullif(o->>'deliveryDate','') is not null and (nullif(o->>'driver_id','') is null or o->>'driver_id'=auth.uid()::text);
  return result;
end;
$function$;


CREATE OR REPLACE FUNCTION private.guard_payment_methods()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare method jsonb; option jsonb; fee_type text; fee_value numeric;
begin
  if old.data->'settings'->'paymentMethods' is not distinct from new.data->'settings'->'paymentMethods' then return new; end if;
  if auth.uid() is not null and not private.can_edit_site() then raise exception 'Somente a equipe autorizada configuram pagamentos.'; end if;
  if jsonb_typeof(new.data->'settings'->'paymentMethods') is distinct from 'array' then raise exception 'Pagamentos inválidos.'; end if;
  if jsonb_array_length(new.data->'settings'->'paymentMethods')<>4 or exists(select 1 from jsonb_array_elements(new.data->'settings'->'paymentMethods') group by value->>'kind' having count(*)>1) or exists(select 1 from jsonb_array_elements(new.data->'settings'->'paymentMethods') group by value->>'id' having count(*)>1) then raise exception 'Pagamento repetido.'; end if;
  for method in select value from jsonb_array_elements(new.data->'settings'->'paymentMethods') loop
    if length(coalesce(method->>'id','')) not between 1 and 80 or length(trim(coalesce(method->>'title',''))) not between 1 and 60
      or coalesce(method->>'kind','') not in ('pix','credit','debit','cash')
      or jsonb_typeof(method->'active') is distinct from 'boolean'
      or jsonb_typeof(method->'installments') is distinct from 'array'
      or jsonb_array_length(method->'installments') not between 1 and 24 or (method->>'kind'<>'credit' and jsonb_array_length(method->'installments')<>1) then raise exception 'Confira os dados do pagamento.'; end if;
    if exists(select 1 from jsonb_array_elements(method->'installments') group by value->>'count' having count(*)>1) then raise exception 'Parcelamento repetido.'; end if;
    for option in select value from jsonb_array_elements(method->'installments') loop
      fee_type:=coalesce(option->>'feeType','percent');
      if fee_type not in ('percent','fixed') or coalesce(option->>'rate','') !~ '^[0-9]{1,7}([.][0-9]{1,2})?$' then raise exception 'Confira o tipo e o valor da taxa.'; end if;
      fee_value:=(option->>'rate')::numeric;
      if coalesce(option->>'count','') !~ '^[0-9]+$' or (option->>'count')::integer not between 1 and 24
        or (method->>'kind'<>'credit' and (option->>'count')::integer<>1)
        or fee_value>(case when fee_type='fixed' then 1000000 else 100 end) or (method->>'kind'<>'credit' and (fee_value<>0 or fee_type<>'percent')) then raise exception 'Parcelas ou taxas inválidas.'; end if;
    end loop;
  end loop;
  return new;
end;
$function$;


-- Removing a team member revokes panel access, without deleting their identity or sales.
create or replace function private.remove_team_member(p_user_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare target public.profiles%rowtype;
begin
  perform private.customer_admin_authority();
  if p_user_id is null or p_user_id=auth.uid() then raise exception 'Você não pode remover seu próprio acesso.'; end if;
  select * into target from public.profiles where user_id=p_user_id for update;
  if not found then raise exception 'Integrante não encontrado. Atualize a equipe.'; end if;
  if target.role='master' or exists(select 1 from private.master_account where user_id=p_user_id)
    then raise exception 'A conta principal está protegida.'; end if;
  if target.role not in ('admin','driver') then raise exception 'Este perfil não faz parte da equipe.'; end if;
  update public.profiles set role='customer',position=null where user_id=p_user_id;
  -- Refresh sessions are revoked too. Every privileged endpoint also checks the live profile.
  delete from auth.sessions where user_id=p_user_id;
end;
$$;
revoke all on function private.remove_team_member(uuid) from public,anon,authenticated;
grant execute on function private.remove_team_member(uuid) to authenticated;
create or replace function public.remove_team_member(p_user_id uuid)
returns void language sql security invoker set search_path=pg_catalog,private as $$
 select private.remove_team_member(p_user_id)
$$;
revoke all on function public.remove_team_member(uuid) from public,anon,authenticated;
grant execute on function public.remove_team_member(uuid) to authenticated;

