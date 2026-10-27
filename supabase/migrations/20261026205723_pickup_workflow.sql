-- Separate pickup preparation, staff-confirmed WhatsApp notice, payment and stock exit.
-- Existing delivery flow and historical paid/completed orders remain intact.
CREATE OR REPLACE FUNCTION private.order_action(p_order_id bigint, p_action text, p_receipt text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare s public.app_state%rowtype; target jsonb; revised jsonb; products jsonb; movements jsonb; item jsonb;
  actor public.profiles%rowtype; product jsonb; qty integer; units integer:=0; delta integer:=0;
begin
  select * into actor from public.profiles where user_id=auth.uid();
  if actor.role is null or actor.role not in ('master','admin','driver') then raise exception 'Acesso restrito à equipe.'; end if;
  if p_action not in ('release','payment','finish','cancel','pickup_ready') or p_action is null then raise exception 'Ação inválida.'; end if;
  if p_action='cancel' and not private.is_manager() then raise exception 'Somente a conta principal ou gerente pode cancelar.'; end if;
  select * into s from public.app_state where id=1 for update;
  select value into target from jsonb_array_elements(s.data->'orders') where value->>'id'=p_order_id::text;
  if target is null then raise exception 'Pedido não encontrado.'; end if;
  if target->>'status'='cancelled' then raise exception 'Este pedido já foi cancelado.'; end if;
  if actor.role='driver' and (target->>'delivery'<>'Entrega' or
    (nullif(target->>'driver_id','') is not null and target->>'driver_id'<>auth.uid()::text)) then raise exception 'Entrega não disponível para este entregador.'; end if;
  products:=s.data->'products'; movements:=coalesce(s.data->'movements','[]'); revised:=target;
  -- The first successful confirmation claims an unassigned delivery under this row lock.
  -- Invalid proofs or stages raise before any state is saved, leaving it unassigned.
  if actor.role='driver' and p_action in ('payment','finish') and nullif(target->>'driver_id','') is null then
    revised:=revised||jsonb_build_object('driver_id',auth.uid(),'driverAssignedAt',now());
  end if;
  if p_action='pickup_ready' then
    if actor.role not in ('master','admin') or target->>'delivery'<>'Retirada' or target->>'status' not in ('pending','ready') then raise exception 'Retirada não disponível para preparação.'; end if;
    if nullif(target->>'pickupReadyAt','') is not null then raise exception 'Este pedido já está pronto para retirada.'; end if;
    revised:=revised||jsonb_build_object('pickupReadyAt',now(),'pickupReadyBy',auth.uid());
  elsif p_action='release' then
    if target->>'status' not in ('pending','ready') then raise exception 'Este pedido já saiu para entrega.'; end if;
    if target->>'delivery'='Entrega' and (nullif(target->>'deliveryDate','') is null or coalesce((target->>'freightPending')::boolean,false)) then raise exception 'Conclua o agendamento e o frete antes de liberar.'; end if;
    if (target->>'paymentTiming'='Antecipado' or target->>'delivery'='Retirada') and not coalesce((target->>'paid')::boolean,false) then raise exception 'Confirme o pagamento antes de liberar.'; end if;
    if target->>'delivery'='Retirada' and (nullif(target->>'pickupReadyAt','') is null or nullif(target->>'pickupNotifiedAt','') is null) then raise exception 'Conclua a preparação e o aviso ao cliente antes do pagamento ou retirada.'; end if;
    delta:=-1;
    revised:=revised||jsonb_build_object('status',case when target->>'delivery'='Retirada' then 'delivered' else 'transit' end,'releasedAt',now(),'stockDebited',true);
    if target->>'delivery'='Retirada' then revised:=revised||jsonb_build_object('deliveredAt',now(),'deliveryConfirmedBy',auth.uid()); end if;
  elsif p_action='payment' then
    if coalesce((target->>'paid')::boolean,false) or target->>'status'='delivered' then raise exception 'Pagamento já confirmado.'; end if;
    if target->>'delivery'='Retirada' and (nullif(target->>'pickupReadyAt','') is null or nullif(target->>'pickupNotifiedAt','') is null) then raise exception 'Conclua a preparação e o aviso ao cliente antes do pagamento ou retirada.'; end if;
    if not private.valid_payment_photo(p_receipt) then raise exception 'Anexe uma foto válida do comprovante.'; end if;
    if target->>'delivery'='Entrega' and (nullif(target->>'deliveryDate','') is null or coalesce((target->>'freightPending')::boolean,false)
      or (target->>'paymentTiming' is distinct from 'Antecipado' and target->>'status'<>'transit')) then raise exception 'Conclua agendamento e liberação antes do pagamento na entrega.'; end if;
    revised:=revised||jsonb_build_object('paid',true,'paidAt',now(),'receipt',p_receipt,'paymentCollectedBy',auth.uid(),
      'status',case when target->>'status'='pending' then 'ready' else target->>'status' end);
  elsif p_action='finish' then
    if target->>'status'<>'transit' or not coalesce((target->>'paid')::boolean,false) or not private.valid_payment_photo(target->>'receipt') then raise exception 'Conclua a saída e o pagamento com comprovante antes de finalizar.'; end if;
    revised:=revised||jsonb_build_object('status','delivered','deliveredAt',now(),'deliveryConfirmedBy',auth.uid());
  else
    if target->>'status' in ('transit','delivered') then delta:=1; end if;
    revised:=revised||jsonb_build_object('status','cancelled','cancelledAt',now(),'stockDebited',false,'stockReturnedAt',now());
  end if;
  if delta<>0 then
    -- Group identical product IDs: multiple variations must not bypass stock checks.
    for item in select jsonb_build_object('id',i->'id','qty',sum((i->>'qty')::integer))
      from jsonb_array_elements(target->'items') it(i) where coalesce(i->>'stockTracked','true')<>'false' group by i->'id' loop
      qty:=(item->>'qty')::integer;
      select value into product from jsonb_array_elements(products) where value->>'id'=item->>'id';
      if product is null then raise exception 'Produto do pedido não encontrado no estoque.'; end if;
      if delta<0 and (product->>'stock')::integer<qty then raise exception 'Estoque insuficiente para %.',product->>'name'; end if;
      products:=(select jsonb_agg(case when value->>'id'=item->>'id' then jsonb_set(value,'{stock}',to_jsonb((value->>'stock')::integer+delta*qty)) else value end order by ord)
        from jsonb_array_elements(products) with ordinality as x(value,ord));
      movements:=jsonb_build_array(jsonb_build_object('id',floor(extract(epoch from clock_timestamp())*1000000),
        'product',product->>'name','qty',delta*qty,'order_id',p_order_id,'reason',
        case when delta<0 then 'Saída do pedido #' else 'Retorno por cancelamento do pedido #' end||p_order_id,
        'date',to_char(now() at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI:SS'),'by',actor.name))||movements;
      units:=units+qty;
    end loop;
  elsif p_action='cancel' then
    select coalesce(sum((value->>'qty')::integer),0) into units from jsonb_array_elements(target->'items') where coalesce(value->>'stockTracked','true')<>'false';
  end if;
  update public.app_state set data=jsonb_set(jsonb_set(jsonb_set(s.data,'{products}',products),'{movements}',movements),'{orders}',
    (select jsonb_agg(case when value->>'id'=p_order_id::text then revised else value end order by ord)
      from jsonb_array_elements(s.data->'orders') with ordinality as x(value,ord))),version=version+1,updated_at=now() where id=1;
  return jsonb_build_object('id',p_order_id,'units',units,'stockReturned',p_action='cancel');
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
          or prior->'installments' is distinct from latest->'installments' or prior->'payment' is distinct from latest->'payment' then raise exception 'O pagamento escolhido deve ser preservado no pedido.'; end if;
        fee:=round(base*(prior->>'paymentRate')::numeric/100,2); total:=round(base,2)+fee;
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

CREATE OR REPLACE FUNCTION private.confirm_pickup_notice(p_order_id bigint,p_message text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public,private AS $$
declare s public.app_state%rowtype; target jsonb; revised jsonb; actor public.profiles%rowtype;
begin
 select * into actor from public.profiles where user_id=auth.uid();
 if actor.role is null or actor.role not in ('master','admin') then raise exception 'Acesso restrito à equipe da loja.'; end if;
 if p_message is null or length(btrim(p_message)) not between 10 and 2000 then raise exception 'Confira a mensagem enviada ao cliente.'; end if;
 select * into s from public.app_state where id=1 for update;
 select value into target from jsonb_array_elements(s.data->'orders') where value->>'id'=p_order_id::text;
 if target is null or target->>'delivery' is distinct from 'Retirada' or target->>'status' not in ('pending','ready') then raise exception 'Pedido de retirada não disponível.'; end if;
 if nullif(target->>'pickupReadyAt','') is null then raise exception 'Marque o pedido como pronto antes de avisar o cliente.'; end if;
 if private.normalize_registration_phone(target->>'phone') is null then raise exception 'Confira o telefone do cliente.'; end if;
 revised:=target||jsonb_build_object('pickupNotifiedAt',now(),'pickupNotifiedBy',auth.uid(),'pickupNoticeMessage',btrim(p_message));
 update public.app_state set data=jsonb_set(s.data,'{orders}',(select jsonb_agg(case when value->>'id'=p_order_id::text then revised else value end order by ord) from jsonb_array_elements(s.data->'orders') with ordinality x(value,ord))),version=version+1,updated_at=now() where id=1;
 return jsonb_build_object('id',p_order_id,'version',s.version+1);
end; $$;
CREATE OR REPLACE FUNCTION public.confirm_pickup_notice(p_order_id bigint,p_message text) RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path=pg_catalog,public,private AS $$select private.confirm_pickup_notice(p_order_id,p_message)$$;
REVOKE ALL ON FUNCTION private.confirm_pickup_notice(bigint,text),public.confirm_pickup_notice(bigint,text) FROM public,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.confirm_pickup_notice(bigint,text),public.confirm_pickup_notice(bigint,text) TO authenticated;

NOTIFY pgrst,'reload schema';
