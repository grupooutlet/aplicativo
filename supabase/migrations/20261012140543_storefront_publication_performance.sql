-- Skip order checks when orders did not change; the existing checks still run on every order mutation.
CREATE OR REPLACE FUNCTION private.guard_order_removal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if old.data->'orders' is not distinct from new.data->'orders' then return new; end if;
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
$function$
;

CREATE OR REPLACE FUNCTION private.guard_payment_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare prior jsonb; latest jsonb;
begin
  if old.data->'orders' is not distinct from new.data->'orders' then return new; end if;
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
$function$
;

CREATE OR REPLACE FUNCTION private.guard_delivery_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare latest jsonb; prior jsonb; day_text text;
begin
  if old.data->'orders' is not distinct from new.data->'orders' then return new; end if;
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
$function$
;

CREATE OR REPLACE FUNCTION private.guard_order_steps()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare latest jsonb; prior jsonb; revised jsonb; orders jsonb:='[]'::jsonb; base numeric; fee numeric; total numeric; each numeric; quote jsonb;
begin
  if old.data->'orders' is not distinct from new.data->'orders' then return new; end if;
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
$function$
;

CREATE OR REPLACE FUNCTION private.publish_catalog()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  product jsonb;
  public_products jsonb := '[]'::jsonb;
  reserved_qty integer;
begin
  -- Store editing leaves products, stock, prices and operational orders unchanged.
  if tg_op='UPDATE' and old.data->'products' is not distinct from new.data->'products'
    and old.data->'orders' is not distinct from new.data->'orders'
    and old.data->'collections' is not distinct from new.data->'collections'
    and old.data->'pages' is not distinct from new.data->'pages'
    and old.data->'settings' is not distinct from new.data->'settings' then
    update public.shop_public set data=jsonb_set(data,'{storefront}',coalesce(new.data->'storefront','{}'::jsonb)),updated_at=now() where id=1;
    if found then return new; end if;
  end if;
  for product in select value from jsonb_array_elements(new.data->'products') loop
    if not coalesce((product->>'active')::boolean, false) then continue; end if;
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
$function$
;

-- Allow the bounded storefront document (24 MB maximum) to finish publication through REST.
-- This does not change the timeouts or permissions of other API operations.
alter function public.save_storefront(jsonb,jsonb) set statement_timeout='30s';
notify pgrst, 'reload schema';
