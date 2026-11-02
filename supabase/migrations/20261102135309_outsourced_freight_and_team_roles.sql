-- Freight is a separate receivable belonging to the third-party driver.
create or replace function private.order_store_base(p_order jsonb) returns numeric
language sql immutable set search_path=pg_catalog as $$
 select round(coalesce(sum((i->>'price')::numeric*(i->>'qty')::numeric),0)+
 case when p_order->>'freightBilling'='external' then 0 else coalesce((p_order->>'freight')::numeric,0) end,2)
 from jsonb_array_elements(coalesce(p_order->'items','[]')) i
$$;
revoke all on function private.order_store_base(jsonb) from public,anon,authenticated;


CREATE OR REPLACE FUNCTION private.create_staff_order(p_order jsonb, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare s public.app_state%rowtype; target jsonb; revised jsonb; items jsonb:='[]';
  requested jsonb; product jsonb; variation jsonb; options jsonb; summary text;
  qty integer; reserved_qty integer; chosen integer; price numeric; shipping jsonb; quote jsonb; new_id bigint; adjustment jsonb; audit_rows jsonb:='[]'; catalog_price numeric; custom_price numeric; why text;
  actor public.profiles%rowtype; responsible public.profiles%rowtype; previous_request private.staff_order_requests%rowtype; fingerprint text;
begin
  if not (private.is_manager() or private.is_seller()) then raise exception 'Seu perfil não pode criar pedidos.'; end if;
  if auth.uid() is null or not exists(select 1 from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id') then raise exception 'Sessão expirada. Entre novamente.'; end if;
  select * into actor from public.profiles where user_id=auth.uid();
  fingerprint:=md5((p_order-'id'-'createdAt'-'date')::text);
  if length(trim(coalesce(p_order->>'customer',''))) not between 2 and 120
    or regexp_replace(coalesce(p_order->>'phone',''),'[^0-9]','','g') !~ '^(55)?[0-9]{10,11}$'
    or length(coalesce(p_order->>'address','')) not between 5 and 400
    or length(coalesce(p_order->>'notes',''))>2000 then raise exception 'Confira os dados do cliente.'; end if;
  select * into s from public.app_state where id=1 for update;
  if not found then raise exception 'Loja indisponível.'; end if;
  if p_request_id is not null then
    select * into previous_request from private.staff_order_requests where request_id=p_request_id;
    if found then
      if previous_request.actor_id<>auth.uid() or previous_request.fingerprint<>fingerprint then raise exception 'Este envio já foi usado. Atualize os pedidos antes de tentar novamente.'; end if;
      if not exists(select 1 from jsonb_array_elements(s.data->'orders') o where o->>'id'=previous_request.order_id::text) then raise exception 'Este pedido já foi removido.'; end if;
      return jsonb_build_object('id',previous_request.order_id,'duplicate',true);
    end if;
  end if;
  if private.is_seller() then responsible:=actor;
  else
    select * into responsible from public.profiles where user_id::text=p_order->>'seller_id' and role='admin' and position='Vendedor';
    if not found then raise exception 'Selecione um perfil de vendedor disponível.'; end if;
  end if;
  if coalesce(p_order->>'delivery','') not in ('Entrega','Retirada') or coalesce(p_order->>'paymentTiming','') not in ('Antecipado','Na entrega','Na retirada')
    or jsonb_typeof(p_order->'items') is distinct from 'array' or jsonb_array_length(p_order->'items') not between 1 and 20 then raise exception 'Confira o pedido.'; end if;
  if p_order->>'delivery'='Entrega' and (nullif(p_order->>'deliveryDate','') is null
    or (p_order->>'deliveryDate')::date<(now() at time zone 'America/Sao_Paulo')::date) then raise exception 'Selecione uma data válida.'; end if;
  select value into shipping from jsonb_array_elements(s.data->'settings'->'shippingOptions')
    where value->>'id'=p_order->>'shippingOptionId' and value->>'delivery'=p_order->>'delivery' and value->>'active'='true';
  if shipping is null then raise exception 'Selecione um frete disponível.'; end if;
  perform private.assert_regional_shipping(s.data->'settings',p_order);
  for requested in select value from jsonb_array_elements(p_order->'items') loop
    qty:=(requested->>'qty')::integer;
    if qty is null or qty not between 1 and 99 then raise exception 'Quantidade inválida.'; end if;
    select value into product from jsonb_array_elements(s.data->'products') where value->>'id'=requested->>'id' and value->>'active'='true';
    if product is null then raise exception 'Produto indisponível.'; end if;
    options:=coalesce(requested->'options','{}'); summary:='';
    if jsonb_typeof(options)<>'object' then raise exception 'Variações inválidas.'; end if;
    for variation in select value from jsonb_array_elements(coalesce(product->'variations','[]')) loop
      if not exists(select 1 from jsonb_array_elements_text(variation->'values') where value=options->>(variation->>'name')) then raise exception 'Selecione as variações.'; end if;
      summary:=summary||' · '||(variation->>'name')||': '||(options->>(variation->>'name'));
    end loop;
    if (select count(*) from jsonb_object_keys(options))<>jsonb_array_length(coalesce(product->'variations','[]')) then raise exception 'Variações inválidas.'; end if;
    select coalesce(sum((i->>'qty')::integer),0) into reserved_qty from jsonb_array_elements(s.data->'orders') ord(o)
      cross join lateral jsonb_array_elements(o->'items') it(i) where o->>'status' in ('pending','ready') and i->>'id'=product->>'id';
    select coalesce(sum((value->>'qty')::integer),0) into chosen from jsonb_array_elements(items) where value->>'id'=product->>'id';
    if qty+chosen>(product->>'stock')::integer-reserved_qty then raise exception 'Estoque insuficiente para %.',product->>'name'; end if;
    price:=(product->>'price')::numeric;
    if coalesce((product->>'promoPrice')::numeric,0)>0 and (product->>'promoPrice')::numeric<price then price:=(product->>'promoPrice')::numeric; end if;
    catalog_price:=price;
    if requested ? 'priceOverride' and requested->'priceOverride'<>'null'::jsonb then
      adjustment:=requested->'priceOverride';
      if jsonb_typeof(adjustment) is distinct from 'object' or jsonb_typeof(adjustment->'unitPrice') is distinct from 'number'
        or jsonb_typeof(adjustment->'expectedUnitPrice') is distinct from 'number' then raise exception 'Confira o preço personalizado.'; end if;
      custom_price:=(adjustment->>'unitPrice')::numeric;why:=btrim(coalesce(adjustment->>'reason',''));
      if custom_price<0.01 or custom_price>1000000 or custom_price<>round(custom_price,2) or length(why) not between 3 and 1000 then raise exception 'Informe um preço válido e o motivo da alteração (3 a 1.000 caracteres).'; end if;
      if (adjustment->>'expectedUnitPrice')::numeric is distinct from catalog_price then raise exception 'O preço do catálogo mudou. Atualize o produto e confirme a personalização novamente.'; end if;
      if custom_price<>catalog_price then
        audit_rows:=audit_rows||jsonb_build_array(jsonb_build_object('itemIndex',jsonb_array_length(items),'productId',product->'id','productName',(product->>'name')||summary,'options',options,'originalPrice',catalog_price,'unitPrice',custom_price,'reason',why));
      end if;
      price:=custom_price;
    end if;
    items:=items||jsonb_build_array(jsonb_build_object('id',product->'id','name',(product->>'name')||summary,'options',options,'qty',qty,'price',price,'cost',product->'cost'));
  end loop;
  select coalesce(sum((value->>'price')::numeric*(value->>'qty')::integer),0) into price from jsonb_array_elements(items);
  quote:=private.payment_quote(s.data->'settings'->'paymentMethods',p_order->>'paymentMethodId',(p_order->>'installments')::integer,price);
  if p_order ? 'total' and (p_order->>'total')::numeric is distinct from (quote->>'total')::numeric then raise exception 'Os valores mudaram. Confira o total do pedido antes de confirmar.'; end if;
  select greatest(1000,coalesce(max((value->>'id')::bigint),0))+1 into new_id from jsonb_array_elements(s.data->'orders');
  new_id:=greatest(new_id,nextval('public.online_order_number'));
  perform setval('public.online_order_number',new_id,true);
  revised:=jsonb_build_object('id',new_id,'customer',trim(p_order->>'customer'),'email',p_order->'email',
    'phone',p_order->'phone','cpf',p_order->'cpf','address',p_order->'address','addressParts',p_order->'addressParts',
    'notes',coalesce(p_order->>'notes',''),'delivery',p_order->'delivery','deliveryDate',p_order->'deliveryDate',
    'shippingOptionId',shipping->'id','shippingOptionName',shipping->'name','freight',shipping->'price','freightPending',false,'freightBilling',case when p_order->>'delivery'='Entrega' then 'external' else 'none' end,
    'date',to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD'),'createdAt',now(),'items',items,
    'status','pending','paid',false,'receipt',null,'channel','Loja física',
    'seller',responsible.name,'seller_id',responsible.user_id,
    'paymentTiming',p_order->'paymentTiming')||quote;
  for adjustment in select value from jsonb_array_elements(audit_rows) loop
    insert into private.order_price_adjustments(order_id,item_index,product_id,product_name,options,original_price,unit_price,reason,actor_id,actor_name)
    values(new_id,(adjustment->>'itemIndex')::integer,(adjustment->>'productId')::bigint,adjustment->>'productName',adjustment->'options',(adjustment->>'originalPrice')::numeric,(adjustment->>'unitPrice')::numeric,adjustment->>'reason',actor.user_id,actor.name);
  end loop;
  update public.app_state set data=jsonb_set(s.data,'{orders}',jsonb_build_array(revised)||(s.data->'orders')),version=version+1,updated_at=now() where id=1;
  if p_request_id is not null then insert into private.staff_order_requests(request_id,actor_id,order_id,fingerprint) values(p_request_id,auth.uid(),new_id,fingerprint);end if;
  return jsonb_build_object('id',new_id);
end;
$function$;


CREATE OR REPLACE FUNCTION private.sales_order(p_order jsonb, p_order_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare s public.app_state%rowtype; target jsonb; revised jsonb; items jsonb:='[]';
  requested jsonb; product jsonb; variation jsonb; options jsonb; summary text;
  qty integer; reserved_qty integer; chosen integer; price numeric; shipping jsonb; quote jsonb; new_id bigint;
begin
  if not private.is_seller() then raise exception 'Acesso restrito aos vendedores.'; end if;
  if length(trim(coalesce(p_order->>'customer',''))) not between 2 and 120
    or regexp_replace(coalesce(p_order->>'phone',''),'[^0-9]','','g') !~ '^(55)?[0-9]{10,11}$'
    or length(coalesce(p_order->>'address','')) not between 5 and 400
    or length(coalesce(p_order->>'notes',''))>2000 then raise exception 'Confira os dados do cliente.'; end if;
  select * into s from public.app_state where id=1 for update;
  if p_order_id is not null then
    select value into target from jsonb_array_elements(s.data->'orders') where value->>'id'=p_order_id::text;
    if target is null or target->>'status' not in ('pending','ready') then raise exception 'O pedido não pode ser editado.'; end if;
    if target->>'delivery'='Entrega' and (nullif(p_order->>'deliveryDate','') is null
      or ((p_order->>'deliveryDate')::date<(now() at time zone 'America/Sao_Paulo')::date
        and p_order->>'deliveryDate' is distinct from target->>'deliveryDate')) then raise exception 'Confira a data da entrega.'; end if;
    revised:=target||jsonb_build_object('firstName',p_order->'firstName','lastName',p_order->'lastName',
      'customer',trim(p_order->>'customer'),'phone',p_order->'phone','address',p_order->'address',
      'addressParts',p_order->'addressParts','notes',p_order->'notes','deliveryDate',p_order->'deliveryDate');
    update public.app_state set data=jsonb_set(s.data,'{orders}',
      (select jsonb_agg(case when value->>'id'=p_order_id::text then revised else value end order by ord)
        from jsonb_array_elements(s.data->'orders') with ordinality as x(value,ord))),version=version+1,updated_at=now() where id=1;
    return jsonb_build_object('id',p_order_id);
  end if;
  if coalesce(p_order->>'delivery','') not in ('Entrega','Retirada') or coalesce(p_order->>'paymentTiming','') not in ('Antecipado','Na entrega','Na retirada')
    or jsonb_typeof(p_order->'items') is distinct from 'array' or jsonb_array_length(p_order->'items') not between 1 and 20 then raise exception 'Confira o pedido.'; end if;
  if p_order->>'delivery'='Entrega' and (nullif(p_order->>'deliveryDate','') is null
    or (p_order->>'deliveryDate')::date<(now() at time zone 'America/Sao_Paulo')::date) then raise exception 'Selecione uma data válida.'; end if;
  select value into shipping from jsonb_array_elements(s.data->'settings'->'shippingOptions')
    where value->>'id'=p_order->>'shippingOptionId' and value->>'delivery'=p_order->>'delivery' and value->>'active'='true';
  if shipping is null then raise exception 'Selecione um frete disponível.'; end if;
  perform private.assert_regional_shipping(s.data->'settings',p_order);
  for requested in select value from jsonb_array_elements(p_order->'items') loop
    qty:=(requested->>'qty')::integer;
    if qty is null or qty not between 1 and 99 then raise exception 'Quantidade inválida.'; end if;
    select value into product from jsonb_array_elements(s.data->'products') where value->>'id'=requested->>'id' and value->>'active'='true';
    if product is null then raise exception 'Produto indisponível.'; end if;
    options:=coalesce(requested->'options','{}'); summary:='';
    if jsonb_typeof(options)<>'object' then raise exception 'Variações inválidas.'; end if;
    for variation in select value from jsonb_array_elements(coalesce(product->'variations','[]')) loop
      if not exists(select 1 from jsonb_array_elements_text(variation->'values') where value=options->>(variation->>'name')) then raise exception 'Selecione as variações.'; end if;
      summary:=summary||' · '||(variation->>'name')||': '||(options->>(variation->>'name'));
    end loop;
    if (select count(*) from jsonb_object_keys(options))<>jsonb_array_length(coalesce(product->'variations','[]')) then raise exception 'Variações inválidas.'; end if;
    select coalesce(sum((i->>'qty')::integer),0) into reserved_qty from jsonb_array_elements(s.data->'orders') ord(o)
      cross join lateral jsonb_array_elements(o->'items') it(i) where o->>'status' in ('pending','ready') and i->>'id'=product->>'id';
    select coalesce(sum((value->>'qty')::integer),0) into chosen from jsonb_array_elements(items) where value->>'id'=product->>'id';
    if qty+chosen>(product->>'stock')::integer-reserved_qty then raise exception 'Estoque insuficiente para %.',product->>'name'; end if;
    price:=(product->>'price')::numeric;
    if coalesce((product->>'promoPrice')::numeric,0)>0 and (product->>'promoPrice')::numeric<price then price:=(product->>'promoPrice')::numeric; end if;
    items:=items||jsonb_build_array(jsonb_build_object('id',product->'id','name',(product->>'name')||summary,'options',options,'qty',qty,'price',price,'cost',product->'cost'));
  end loop;
  select coalesce(sum((value->>'price')::numeric*(value->>'qty')::integer),0) into price from jsonb_array_elements(items);
  quote:=private.payment_quote(s.data->'settings'->'paymentMethods',p_order->>'paymentMethodId',(p_order->>'installments')::integer,price);
  select greatest(1000,coalesce(max((value->>'id')::bigint),0))+1 into new_id from jsonb_array_elements(s.data->'orders');
  revised:=jsonb_build_object('id',new_id,'customer',trim(p_order->>'customer'),'email',p_order->'email',
    'phone',p_order->'phone','cpf',p_order->'cpf','address',p_order->'address','addressParts',p_order->'addressParts',
    'notes',coalesce(p_order->>'notes',''),'delivery',p_order->'delivery','deliveryDate',p_order->'deliveryDate',
    'shippingOptionId',shipping->'id','shippingOptionName',shipping->'name','freight',shipping->'price','freightPending',false,'freightBilling',case when p_order->>'delivery'='Entrega' then 'external' else 'none' end,
    'date',to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD'),'createdAt',now(),'items',items,
    'status','pending','paid',false,'receipt',null,'channel','Loja física',
    'seller',(select name from public.profiles where user_id=auth.uid()),'seller_id',auth.uid(),
    'paymentTiming',p_order->'paymentTiming')||quote;
  update public.app_state set data=jsonb_set(s.data,'{orders}',jsonb_build_array(revised)||(s.data->'orders')),version=version+1,updated_at=now() where id=1;
  return jsonb_build_object('id',new_id);
end;
$function$;


CREATE OR REPLACE FUNCTION private.place_order_with_shipping(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
  perform private.assert_regional_shipping(state_row.data->'settings',p_request);
  if state_row.data->'settings'->>'shippingMode'='regional' and p_request->>'delivery'='Entrega' then
    p_request:=jsonb_set(p_request,'{address}',to_jsonb(
      (p_request->'addressParts'->>'street')||', '||(p_request->'addressParts'->>'number')||
      case when nullif(p_request->'addressParts'->>'complement','') is not null then ' · '||(p_request->'addressParts'->>'complement') else '' end||
      ' · '||(p_request->'addressParts'->>'neighborhood')||' · '||(p_request->'addressParts'->>'city')||' / '||upper(p_request->'addressParts'->>'state')||
      ' · CEP '||(p_request->'addressParts'->>'cep')));
  end if;
  response := private.place_order_core(p_request);
  order_id := (response->>'id')::bigint;
  select * into state_row from public.app_state where id = 1 for update;
  select value into choice from jsonb_array_elements(state_row.data->'orders')
    where value->>'id'=order_id::text;
  if choice is null then raise exception 'Não foi possível concluir o pedido.'; end if;
  revised := choice || jsonb_build_object(
    'freight', freight, 'freightPending', false,'freightBilling',case when p_request->>'delivery'='Entrega' then 'external' else 'none' end,
    'shippingOptionId', selected->>'id', 'shippingOptionName', selected->>'name',
    'createdAt', now(), 'addressParts', p_request->'addressParts', 'shippingRestrictionConfirmed',p_request->'shippingRestrictionConfirmed', 'shippingRegion',selected->'region');
  update public.app_state
  set data=jsonb_set(state_row.data,'{orders}',
    (select jsonb_agg(case when item.value->>'id'=order_id::text
      then revised else item.value end order by item.ord)
     from jsonb_array_elements(state_row.data->'orders') with ordinality as item(value,ord))),
    version=version+1, updated_at=now()
  where id=1;
  return jsonb_set(response, '{order}',
    (response->'order') || jsonb_build_object(
      'freight', freight, 'freightPending', false,'freightBilling',case when p_request->>'delivery'='Entrega' then 'external' else 'none' end,
      'shippingOptionId', selected->>'id', 'shippingOptionName', selected->>'name',
      'createdAt', revised->'createdAt','addressParts',revised->'addressParts','shippingRegion',selected->'region'));
end;
$function$;


CREATE OR REPLACE FUNCTION private.place_order(p_request jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
  target:=jsonb_set(target,'{items}',(target->'items')||private.checkout_bump_items(state_row.data,p_request));
  select sum((value->>'price')::numeric*(value->>'qty')::numeric) into base from jsonb_array_elements(target->'items');
  quote:=private.payment_quote(state_row.data->'settings'->'paymentMethods',method->>'id',(p_request->>'installments')::integer,base);
  if p_request->>'expectedTotal' is null or (p_request->>'expectedTotal')::numeric is distinct from (quote->>'total')::numeric then
    raise exception 'Os valores mudaram. Atualize o checkout e confira o total antes de concluir.';
  end if;
  target:=target||quote||jsonb_build_object('freightBilling',case when p_request->>'delivery'='Entrega' then 'external' else 'none' end,'firstName',first_name,'lastName',last_name,'date',to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD'));
  update public.app_state set data=jsonb_set(state_row.data,'{orders}',
    (select jsonb_agg(case when value->>'id'=target->>'id' then target else value end order by ord)
      from jsonb_array_elements(state_row.data->'orders') with ordinality as item(value,ord))),version=version+1,updated_at=now() where id=1;
  perform private.register_meta_order(target,p_request->'meta');
  return jsonb_set(response,'{order}',(response->'order')||quote||jsonb_build_object('freightBilling',case when p_request->>'delivery'='Entrega' then 'external' else 'none' end,'firstName',first_name,'lastName',last_name,'customer',first_name||' '||last_name,'date',target->'date','items',(select jsonb_agg(value-'cost') from jsonb_array_elements(target->'items'))));
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
    'freightBilling',o->'freightBilling','freightPending',o->'freightPending','freightPaidAt',o->'freightPaidAt','freightPaymentMethod',o->'freightPaymentMethod','total',o->'total','createdAt',o->'createdAt','payment',o->'payment','paid',o->'paid','freight',o->'freight','shippingOptionName',o->'shippingOptionName',
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
$function$;


CREATE OR REPLACE FUNCTION private.meta_enqueue(p_order jsonb, p_event text, p_time timestamp with time zone DEFAULT now())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare ctx private.meta_order_attribution%rowtype; items jsonb; amount numeric;
begin
 select * into ctx from private.meta_order_attribution where order_id=(p_order->>'id')::bigint and revoked_at is null and created_at>now()-interval '90 days';
 if ctx.order_id is null or p_order->>'channel'<>'Loja online' then return;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','quantity',(value->>'qty')::integer,'item_price',(value->>'price')::numeric)),'[]'::jsonb)
 into items from jsonb_array_elements(p_order->'items');
 select coalesce((p_order->>'total')::numeric,private.order_store_base(p_order)+coalesce((p_order->>'paymentFee')::numeric,0)) into amount from jsonb_array_elements(p_order->'items');
 insert into private.meta_event_outbox(id,order_id,event_name,event_time,payload)
 values('fo:'||ctx.attribution_id||':'||p_event,ctx.order_id,p_event,p_time,jsonb_build_object(
 'content_type','product','content_ids',(select jsonb_agg(value->'id') from jsonb_array_elements(items)),
 'contents',items,'num_items',(select sum((value->>'quantity')::integer) from jsonb_array_elements(items)),
 'currency','BRL','value',round(amount,2),'order_id',p_order->>'id',
 'payment_status',case when p_order->>'paid'='true' then 'paid' else 'pending' end)) on conflict(id) do nothing;
end $function$

;


-- Only unpaid active deliveries switch to the new billing model.
-- Keep the agreed amount of every paid, completed or cancelled legacy order.
alter table public.app_state disable trigger guard_order_steps;
with revised as (
 select a.id,jsonb_agg(case when o->>'delivery'='Entrega' and coalesce(o->>'paid','false')<>'true'
 and o->>'status' not in ('cancelled','delivered') then
 o||jsonb_build_object('freightBilling','external','paymentBase',b.base,'paymentFee',f.fee,'total',b.base+f.fee,
 'installmentAmount',floor((b.base+f.fee)*100/greatest(1,coalesce((o->>'installments')::integer,1)))/100,
 'lastInstallmentAmount',b.base+f.fee-(floor((b.base+f.fee)*100/greatest(1,coalesce((o->>'installments')::integer,1)))/100)*(greatest(1,coalesce((o->>'installments')::integer,1))-1)) else o end order by ord) as orders
 from public.app_state a cross join lateral jsonb_array_elements(a.data->'orders') with ordinality q(o,ord)
 cross join lateral (select coalesce(sum((i->>'price')::numeric*(i->>'qty')::numeric),0) as base from jsonb_array_elements(o->'items') i) b
 cross join lateral (select case when o->>'paymentFeeType'='fixed' then coalesce((o->>'paymentFeeValue')::numeric,0)
 else round(b.base*coalesce((o->>'paymentFeeValue')::numeric,(o->>'paymentRate')::numeric,0)/100,2) end as fee) f
 where a.id=1 group by a.id
) update public.app_state a set data=jsonb_set(a.data,'{orders}',r.orders),version=version+1,updated_at=now() from revised r where a.id=r.id and a.data->'orders' is distinct from r.orders;
alter table public.app_state enable trigger guard_order_steps;

create or replace function private.change_team_role(p_user_id uuid,p_position text,p_expected_position text)
returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare target public.profiles%rowtype;
begin
 if p_user_id is null or p_user_id=auth.uid() then raise exception 'Você não pode alterar sua própria função.';end if;
 perform pg_advisory_xact_lock(60727340);
 perform private.customer_admin_authority();
 if p_position is null or p_position not in ('Gerente','Vendedor','Entregador','Estoque','Outro') then raise exception 'Função inválida.';end if;
 select * into target from public.profiles where user_id=p_user_id for update;
 if not found then raise exception 'Integrante não encontrado. Atualize a equipe.';end if;
 if target.role='master' or exists(select 1 from private.master_account where user_id=p_user_id) then raise exception 'A conta principal está protegida.';end if;
 if target.role not in ('admin','driver') then raise exception 'Este perfil não faz parte da equipe.';end if;
 if target.position is distinct from p_expected_position then raise exception 'A função foi alterada por outra pessoa. Atualize a equipe.';end if;
 if target.position=p_position then raise exception 'Selecione uma função diferente da atual.';end if;
 update public.profiles set role=case when p_position='Entregador' then 'driver' else 'admin' end,position=p_position where user_id=p_user_id;
 delete from auth.sessions where user_id=p_user_id;
end;
$$;
revoke all on function private.change_team_role(uuid,text,text) from public,anon,authenticated;
grant execute on function private.change_team_role(uuid,text,text) to authenticated;
create or replace function public.change_team_role(p_user_id uuid,p_position text,p_expected_position text)
returns void language sql security invoker set search_path=pg_catalog,private as $$
 select private.change_team_role(p_user_id,p_position,p_expected_position)
$$;
revoke all on function public.change_team_role(uuid,text,text) from public,anon,authenticated;
grant execute on function public.change_team_role(uuid,text,text) to authenticated;
