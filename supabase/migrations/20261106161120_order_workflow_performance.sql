-- Compare each order once and validate only rows changed by this transaction.
create function private.order_delta(p_before jsonb,p_after jsonb)
returns table(prior jsonb,latest jsonb,ordinal bigint)
language sql immutable set search_path=pg_catalog as $$
 with before_rows as materialized (
   select value, value->>'id' as id from jsonb_array_elements(coalesce(p_before,'[]'))
 ), after_rows as materialized (
   select value, value->>'id' as id, ord from jsonb_array_elements(coalesce(p_after,'[]')) with ordinality as x(value,ord)
 )
 select b.value,a.value,a.ord from before_rows b full join after_rows a on a.id=b.id
 where b.value is distinct from a.value
$$;
revoke all on function private.order_delta(jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.order_delta(jsonb,jsonb) to authenticated;

CREATE OR REPLACE FUNCTION private.guard_order_steps()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare latest jsonb; prior jsonb; revised jsonb; orders jsonb:='{}'::jsonb; base numeric; fee numeric; total numeric; each numeric; quote jsonb;
begin
  if private.is_history_reversal() then return new; end if;
  if old.data->'orders' is not distinct from new.data->'orders' then return new; end if;
  for prior,latest in select d.prior,d.latest
    from private.order_delta(old.data->'orders',new.data->'orders') d where d.latest is not null loop
    revised:=latest||jsonb_build_object('freightBilling',case
      when prior is null then case when latest->>'delivery'='Entrega' then 'external' else 'none' end
      else coalesce(prior->>'freightBilling','included') end);
    latest:=revised;
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
      base:=private.order_store_base(latest);
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
      if latest->>'freightBilling'='external' and coalesce((latest->>'freight')::numeric,0)>0 then
        if coalesce(latest->>'freightPaymentMethod','') not in ('pix','cash') then raise exception 'Confirme o frete recebido pelo entregador por Pix ou dinheiro.';end if;
        revised:=revised||jsonb_build_object('freightPaidAt',now(),'freightPaidBy',auth.uid());
      end if;
      if latest->>'delivery'='Retirada' and (nullif(prior->>'pickupReadyAt','') is null or nullif(prior->>'pickupNotifiedAt','') is null) then raise exception 'Conclua a preparação e o aviso ao cliente antes da retirada.'; end if;
      if not coalesce((latest->>'paid')::boolean,false) or not private.valid_payment_photo(latest->>'receipt') then raise exception 'Confirme o pagamento com comprovante antes de finalizar.'; end if;
      if latest->>'delivery'='Entrega' and (prior->>'status' is distinct from 'transit' or latest->>'deliveryDate' is null
        or coalesce((latest->>'freightPending')::boolean,false)) then raise exception 'Conclua o agendamento e a saída antes de finalizar a entrega.'; end if;
      revised:=revised||jsonb_build_object('deliveredAt',now());
      if latest->>'delivery'='Retirada' then revised:=revised||jsonb_build_object('releasedAt',now()); end if;
    end if;
    orders:=orders||jsonb_build_object(latest->>'id',revised);
  end loop;
  if orders<>'{}'::jsonb then
    new.data:=jsonb_set(new.data,'{orders}',(
      select jsonb_agg(coalesce(orders->(value->>'id'),value) order by ord)
      from jsonb_array_elements(new.data->'orders') with ordinality as x(value,ord)
    ));
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_order_price_adjustments()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare latest jsonb; prior jsonb; item jsonb; product jsonb; decision private.order_price_adjustments%rowtype; current_price numeric; idx integer;
begin
 if old.data->'orders' is not distinct from new.data->'orders' then return new;end if;
 for prior,latest in select d.prior,d.latest from private.order_delta(old.data->'orders',new.data->'orders') d where d.latest is not null loop
  for decision in select * from private.order_price_adjustments where order_id=(latest->>'id')::bigint loop
   item:=latest->'items'->decision.item_index;
   if item is null or item->>'id' is distinct from decision.product_id::text or coalesce(item->'options','{}') is distinct from decision.options
    or (item->>'price')::numeric is distinct from decision.unit_price then raise exception 'O preço personalizado registrado deve ser preservado no pedido.';end if;
   if prior is null and decision.transaction_id<>txid_current() and not private.is_history_reversal() then raise exception 'Este número de pedido já possui histórico protegido.';end if;
  end loop;
  if prior is null and latest->>'channel'='Loja física' and not private.is_history_reversal() then
   idx:=0;
   for item in select value from jsonb_array_elements(coalesce(latest->'items','[]')) loop
    if coalesce((item->>'stockTracked')::boolean,true) then
     select value into product from jsonb_array_elements(new.data->'products') where value->>'id'=item->>'id';
     current_price:=case when coalesce((product->>'promoPrice')::numeric,0)>0 and (product->>'promoPrice')::numeric<(product->>'price')::numeric then (product->>'promoPrice')::numeric else (product->>'price')::numeric end;
     if product is null or ((item->>'price')::numeric is distinct from current_price and not exists(select 1 from private.order_price_adjustments where order_id=(latest->>'id')::bigint and item_index=idx and unit_price=(item->>'price')::numeric and transaction_id=txid_current())) then raise exception 'Confirme o preço personalizado e o motivo antes de criar o pedido.';end if;
    end if;
    idx:=idx+1;
   end loop;
  end if;
 end loop;
 return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_payment_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare prior jsonb; latest jsonb;
begin
  if private.is_history_reversal() then return new; end if;
  if old.data->'orders' is not distinct from new.data->'orders' then return new; end if;
  for prior,latest in select d.prior,d.latest from private.order_delta(old.data->'orders',new.data->'orders') d where d.latest is not null loop
    if not coalesce((latest->>'paid')::boolean,false) then continue; end if;

    if not coalesce((prior->>'paid')::boolean,false)
       and (left(coalesce(latest->>'receipt',''),23) <> 'data:image/jpeg;base64,'
         or length(latest->>'receipt') > 2400000) then
      raise exception 'Anexe uma foto do comprovante antes de confirmar o pagamento.';
    end if;
  end loop;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_delivery_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare latest jsonb; prior jsonb; day_text text;
begin
  if private.is_history_reversal() then return new; end if;
  if old.data->'orders' is not distinct from new.data->'orders' then return new; end if;
  for prior,latest in select d.prior,d.latest from private.order_delta(old.data->'orders',new.data->'orders') d where d.latest is not null loop
    if latest->>'delivery'<>'Entrega' then continue; end if;

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
$function$;

CREATE OR REPLACE FUNCTION private.meta_order_changes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare o jsonb; prev jsonb;
begin
 if old.data->'orders' is not distinct from new.data->'orders' then return new;end if;
 for prev,o in select d.prior,d.latest from private.order_delta(old.data->'orders',new.data->'orders') d where d.latest is not null loop
  if prev is null then continue;end if; -- Attribution is registered atomically after the final checkout quote.
  if o->>'status'='cancelled' and prev->>'status'<>'cancelled' then
   update private.meta_event_outbox set state='cancelled',payload='{}' where order_id=(o->>'id')::bigint and state in ('pending','sending');
   perform private.meta_enqueue(o,'OrderCancelled');
  elsif o->>'status'<>'cancelled' then
   if o->>'paid'='true' and prev->>'paid' is distinct from 'true' then perform private.meta_enqueue(o,'Purchase');end if;
   if o->>'status'='delivered' and prev->>'status'<>'delivered' then perform private.meta_enqueue(o,'OrderDelivered');end if;
  end if;
 end loop;
 -- Deleted orders cannot leave advertising jobs waiting; the sent ledger is retained against duplicates.
 update private.meta_event_outbox q set state='cancelled',payload='{}' where q.state in ('pending','sending')
 and not exists(select 1 from jsonb_array_elements(coalesce(new.data->'orders','[]')) remaining_order where remaining_order->>'id'=q.order_id::text);
 return new;
end $function$;

CREATE OR REPLACE FUNCTION private.close_converted_checkouts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private', 'public'
AS $function$
declare order_row jsonb; phone_value text; moment timestamptz:=clock_timestamp();
begin
 if new.data->'orders' is not distinct from old.data->'orders' then return new;end if;
 for order_row in select d.latest from private.order_delta(old.data->'orders',new.data->'orders') d where d.latest is not null and d.prior is null loop
  phone_value:=private.normalize_registration_phone(order_row->>'phone');
  if coalesce(phone_value,'')='' or order_row->>'status'='cancelled' then continue;end if;
  perform pg_advisory_xact_lock(hashtextextended(phone_value,81630));
  update private.checkout_recovery set status='converted',order_id=(order_row->>'id')::bigint,converted_at=moment,updated_at=moment,revision=revision+1,
   events=(select coalesce(jsonb_agg(value order by ord),'[]') from jsonb_array_elements(events||jsonb_build_array(jsonb_build_object('action','converted','at',moment,'by','Pedido criado','orderId',order_row->'id'))) with ordinality e(value,ord) where ord>greatest(0,jsonb_array_length(events)+1-30))
  where phone=phone_value and status in ('open','contacted','waiting') and created_at>moment-interval '30 days';
 end loop;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION private.audit_array_changes(p_before jsonb, p_after jsonb, p_path text[])
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 with before_rows as materialized (select value,ord from jsonb_array_elements(coalesce(p_before,'[]')) with ordinality b(value,ord)),
 after_rows as materialized (select value,ord from jsonb_array_elements(coalesce(p_after,'[]')) with ordinality a(value,ord)),
 joined as (select b.value b,a.value a,b.ord bo,a.ord ao from before_rows b full join after_rows a on b.value->>'id'=a.value->>'id')
 select coalesce(jsonb_agg(jsonb_build_object('source','state','kind','entity','path',to_jsonb(p_path),'entityId',coalesce(a->>'id',b->>'id'),
   'before',b,'after',a,'beforeExists',b is not null,'afterExists',a is not null,'beforeIndex',coalesce(bo-1,0),'afterIndex',coalesce(ao-1,0)) order by coalesce(ao,bo)),'[]')
 from joined where b is distinct from a
$function$;

CREATE OR REPLACE FUNCTION private.audit_state_changes(p_before jsonb, p_after jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare changes jsonb:='[]'; k text; sub text; b jsonb; a jsonb; path text[]; has_ids boolean;
begin
 for k in select key from (select jsonb_object_keys(p_before) key union select jsonb_object_keys(p_after)) keys loop
  if p_before->k is not distinct from p_after->k then continue; end if;
  if k in ('settings','collectionSettings') then
   for sub in select key from (select jsonb_object_keys(coalesce(p_before->k,'{}')) key union select jsonb_object_keys(coalesce(p_after->k,'{}'))) keys loop
    b:=p_before->k->sub;a:=p_after->k->sub;if b is not distinct from a then continue; end if;path:=array[k,sub];
    if k='settings' and sub in ('shippingOptions','paymentMethods') and jsonb_typeof(coalesce(b,'[]'))='array' and jsonb_typeof(coalesce(a,'[]'))='array' then
     changes:=changes||private.audit_array_changes(b,a,path);
    else changes:=changes||jsonb_build_array(jsonb_build_object('source','state','kind','value','path',to_jsonb(path),'before',b,'after',a,'beforeExists',b is not null,'afterExists',a is not null));end if;
   end loop;
  else
   b:=p_before->k;a:=p_after->k;path:=array[k];has_ids:=false;
   if k in ('products','orders','movements','pages','orderBumps','attributeCatalog','storeThemes') and jsonb_typeof(coalesce(b,'[]'))='array' and jsonb_typeof(coalesce(a,'[]'))='array' then
    select not exists(select 1 from (
      select value from jsonb_array_elements(coalesce(b,'[]'))
      union all select value from jsonb_array_elements(coalesce(a,'[]'))
    ) x where jsonb_typeof(value)<>'object' or value->>'id' is null) into has_ids;
   end if;
   if has_ids then changes:=changes||private.audit_array_changes(b,a,path);
   else changes:=changes||jsonb_build_array(jsonb_build_object('source','state','kind','value','path',to_jsonb(path),'before',b,'after',a,'beforeExists',b is not null,'afterExists',a is not null));end if;
  end if;
 end loop;
 return changes;
end $function$;

CREATE OR REPLACE FUNCTION private.sync_active_store_theme()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare themes jsonb; theme jsonb; theme_key text;
begin
 if old.data->'storeThemes' is not distinct from new.data->'storeThemes'
   and old.data->'activeThemeId' is not distinct from new.data->'activeThemeId'
   and old.data->'storefront' is not distinct from new.data->'storefront' then return new;end if;
 if old.data ? 'storeThemes' and not(new.data ? 'storeThemes') then
  if coalesce(current_setting('app.history_reversal',true),'')<>'' then raise exception 'A biblioteca inicial de temas deve ser preservada. Reverta uma alteração posterior.';end if;
  new.data:=new.data||jsonb_build_object('storeThemes',old.data->'storeThemes','activeThemeId',old.data->'activeThemeId');
 end if;
 if not(new.data ? 'storeThemes') then return new;end if;
 theme_key:=new.data->>'activeThemeId';
 select value into theme from jsonb_array_elements(new.data->'storeThemes') where value->>'id'=theme_key;
 if theme is null then raise exception 'O tema publicado deve ser preservado.';end if;
 if theme->'config' is distinct from new.data->'storefront' then
  select jsonb_agg(case when e.value->>'id'=theme_key then e.value||jsonb_build_object('config',new.data->'storefront','updatedAt',clock_timestamp()) else e.value end order by e.ord) into themes from jsonb_array_elements(new.data->'storeThemes') with ordinality e(value,ord);
  new.data:=jsonb_set(new.data,'{storeThemes}',themes);
 end if;
 return new;
end $function$;

create or replace function private.guard_order_removal()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
 if old.data->'orders' is not distinct from new.data->'orders' then return new;end if;
 if auth.uid() is not null and not private.is_manager() and exists(
   select 1 from private.order_delta(old.data->'orders',new.data->'orders') d where d.latest is null
 ) then raise exception 'Somente a conta principal ou gerente pode excluir pedidos.';end if;
 return new;
end;
$$;
CREATE OR REPLACE FUNCTION private.order_action(p_order_id bigint, p_action text, p_receipt text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare s public.app_state%rowtype; target jsonb; revised jsonb; products jsonb; movements jsonb; item jsonb;
  actor public.profiles%rowtype; product jsonb; qty integer; units integer:=0; delta integer:=0;
begin
  if p_action='cancel' and not (p_receipt in ('Produto sem estoque','Cliente desistiu da compra') or (left(p_receipt,14)='Outro motivo: ' and length(trim(substr(p_receipt,15))) between 3 and 1000)) then raise exception 'Selecione o motivo do cancelamento e descreva quando escolher Outro motivo.'; end if;
  if p_action='cancel' and p_receipt is null then raise exception 'Informe o motivo do cancelamento.'; end if;
  select * into actor from public.profiles where user_id=auth.uid();
  if actor.role is null or actor.role not in ('master','admin','driver') then raise exception 'Acesso restrito à equipe.'; end if;
  if p_action not in ('release','payment','finish','cancel','pickup_ready') or p_action is null then raise exception 'Ação inválida.'; end if;
  if p_action='cancel' and not (actor.role='master' or (actor.role='admin' and actor.position in ('Gerente','Vendedor'))) then raise exception 'Somente a conta principal, gerente ou vendedor pode cancelar pedidos.'; end if;
  select * into s from public.app_state where id=1 for update;
  select value into target from jsonb_array_elements(s.data->'orders') where value->>'id'=p_order_id::text;
  if target is null then raise exception 'Pedido não encontrado.'; end if;

  if actor.role='driver' and (target->>'delivery'<>'Entrega' or
    (nullif(target->>'driver_id','') is not null and target->>'driver_id'<>auth.uid()::text)) then raise exception 'Entrega não disponível para este entregador.'; end if;
  if (p_action='payment' and coalesce((target->>'paid')::boolean,false) and target->>'status'<>'cancelled')
    or (p_action='release' and target->>'status' in ('transit','delivered'))
    or (p_action='finish' and target->>'status'='delivered')
    or (p_action='cancel' and target->>'status'='cancelled')
    or (p_action='pickup_ready' and target->>'delivery'='Retirada' and nullif(target->>'pickupReadyAt','') is not null) then
    return jsonb_build_object('id',p_order_id,'duplicate',true,'units',0,'stockReturned',p_action='cancel');
  end if;
  if target->>'status'='cancelled' then raise exception 'Este pedido já foi cancelado.';end if;
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
    if target->>'freightBilling'='external' and coalesce((target->>'freight')::numeric,0)>0 then
      if p_receipt is null or p_receipt not in ('pix','cash') then raise exception 'Confirme o frete pago ao entregador por Pix ou dinheiro.';end if;
      revised:=revised||jsonb_build_object('freightPaidAt',now(),'freightPaidBy',auth.uid(),'freightPaymentMethod',p_receipt);
    end if;
    if target->>'status'<>'transit' or not coalesce((target->>'paid')::boolean,false) or not private.valid_payment_photo(target->>'receipt') then raise exception 'Conclua a saída e o pagamento com comprovante antes de finalizar.'; end if;
    revised:=revised||jsonb_build_object('status','delivered','deliveredAt',now(),'deliveryConfirmedBy',auth.uid());
  else
    if target->>'status' in ('transit','delivered') then delta:=1; end if;
    revised:=revised||jsonb_build_object('status','cancelled','cancelledAt',now(),'cancellationReason',p_receipt,'cancelledBy',auth.uid(),'notes',concat_ws(E'\n\n',nullif(target->>'notes',''),'Cancelamento em '||to_char(now() at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI')||' por '||coalesce(actor.name,'Equipe')||E'\nMotivo: '||p_receipt),'stockDebited',false,'stockReturnedAt',now());
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
$function$
;
create function private.staff_order_request_status(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
declare recorded private.staff_order_requests%rowtype;
begin
 if auth.uid() is null or not(private.is_manager() or private.is_seller())
   or not exists(select 1 from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id') then
   raise exception 'Acesso restrito à equipe de vendas.';
 end if;
 select * into recorded from private.staff_order_requests where request_id=p_request_id and actor_id=auth.uid();
 if not found then return jsonb_build_object('id',null);end if;
 return jsonb_build_object('id',recorded.order_id,'removed',not exists(
   select 1 from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') o
   where s.id=1 and o->>'id'=recorded.order_id::text
 ));
end;
$$;
revoke all on function private.staff_order_request_status(uuid) from public,anon,authenticated;
grant execute on function private.staff_order_request_status(uuid) to authenticated;
create function public.staff_order_request_status(p_request_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog,private as $$select private.staff_order_request_status(p_request_id)$$;
revoke all on function public.staff_order_request_status(uuid) from public,anon,authenticated;
grant execute on function public.staff_order_request_status(uuid) to authenticated;
-- A repeated deletion after a lost response must acknowledge the completed action.
do $retry$
declare definition text:=pg_get_functiondef('private.delete_order(bigint)'::regprocedure);
begin
 if strpos(definition,'if target is null then raise exception ''Pedido não encontrado.''; end if;')=0 then
   raise exception 'A função de excluir pedidos mudou. Revise a migração.';
 end if;
 execute replace(definition,'if target is null then raise exception ''Pedido não encontrado.''; end if;',
   'if target is null then return; end if;');
end;
$retry$;
