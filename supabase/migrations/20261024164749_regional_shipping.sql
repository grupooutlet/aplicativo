-- Delivery settings are saved independently of the product catalog.
create or replace function private.shipping_key(p_value text)
returns text language sql immutable set search_path=pg_catalog as $$
  select coalesce(string_agg(case word when 'jd' then 'jardim' when 'jard' then 'jardim'
    when 'pq' then 'parque' when 'vl' then 'vila' when 'sta' then 'santa'
    when 'sto' then 'santo' when 'eng' then 'engenheiro' when 'conj' then 'conjunto' else word end,' ' order by ord),'')
  from regexp_split_to_table(trim(regexp_replace(lower(translate(coalesce(p_value,''),
    'áàâãäéèêëíìîïóòôõöúùûüçñÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑ',
    'aaaaaeeeeiiiiooooouuuucnAAAAAEEEEIIIIOOOOOUUUUCN')),'[^a-z0-9]+',' ','g')),'\s+') with ordinality as x(word,ord)
$$;

create or replace function private.regional_shipping_match(p_options jsonb,p_address jsonb)
returns jsonb language sql immutable set search_path=pg_catalog,private as $$
  with candidates as (
    select o,case when jsonb_array_length(o->'region'->'neighborhoods')=0 then 1 else 2 end as priority
    from jsonb_array_elements(p_options) x(o)
    where o->>'delivery'='Entrega'
      and private.shipping_key(p_address->>'city')<>'' and private.shipping_key(p_address->>'state')<>''
      and private.shipping_key(p_address->>'neighborhood')<>''
      and private.shipping_key(o->'region'->>'city')=private.shipping_key(p_address->>'city')
      and private.shipping_key(o->'region'->>'state')=private.shipping_key(p_address->>'state')
      and (jsonb_array_length(o->'region'->'neighborhoods')=0 or exists (
        select 1 from jsonb_array_elements_text(o->'region'->'neighborhoods') n
        where private.shipping_key(n)=private.shipping_key(p_address->>'neighborhood')))
  ), chosen as (select o from candidates where priority=(select max(priority) from candidates))
  select case when count(*)=1 and bool_and(o->>'active'='true') then jsonb_agg(o)->0 end from chosen
$$;

create or replace function private.validate_regional_shipping(p_options jsonb)
returns void language plpgsql immutable set search_path=pg_catalog,private as $$
declare o jsonb; n text; k text; keys text[]:='{}'; ids text[]:='{}';
begin
  if jsonb_typeof(p_options) is distinct from 'array' then raise exception 'Fretes inválidos.'; end if;
  if jsonb_array_length(p_options)>500 then raise exception 'Cadastre até 500 opções de frete.'; end if;
  for o in select value from jsonb_array_elements(p_options) loop
    if jsonb_typeof(o) is distinct from 'object' or length(coalesce(o->>'id','')) not between 1 and 100
      or o->>'id'=any(ids) or length(trim(coalesce(o->>'name',''))) not between 1 and 120
      or jsonb_typeof(o->'price') is distinct from 'number'
      or (o->>'price') !~ '^[0-9]{1,6}([.][0-9]{1,2})?$'
      or (o->>'price')::numeric>100000 or jsonb_typeof(o->'active') is distinct from 'boolean'
      or coalesce(o->>'delivery','') not in ('Entrega','Retirada') then raise exception 'Confira o nome e o preço do frete.'; end if;
    ids:=array_append(ids,o->>'id');
    if o->>'delivery'='Retirada' then
      if (o->>'price')::numeric<>0 then raise exception 'A retirada na loja deve ser gratuita.'; end if;
      continue;
    end if;
    if jsonb_typeof(o->'region') is distinct from 'object'
      or length(trim(coalesce(o->'region'->>'city',''))) not between 1 and 100
      or coalesce(o->'region'->>'state','') !~ '^[A-Z]{2}$'
      or jsonb_typeof(o->'region'->'neighborhoods') is distinct from 'array' then raise exception 'Confira a cidade, a UF e os bairros.'; end if;
    if jsonb_array_length(o->'region'->'neighborhoods')>50 or length(coalesce(o->>'note',''))>240
      or (o ? 'confirmationRequired' and jsonb_typeof(o->'confirmationRequired')<>'boolean')
      or (o->>'confirmationRequired'='true' and nullif(trim(o->>'note'),'') is null) then raise exception 'Confira a cobertura da região.'; end if;
    for n in select value from jsonb_array_elements_text(case when jsonb_array_length(o->'region'->'neighborhoods')=0 then '["*"]'::jsonb else o->'region'->'neighborhoods' end) loop
      if length(n) not between 1 and 120 or (n<>'*' and private.shipping_key(n)='') then raise exception 'Nome de localidade inválido.'; end if;
      k:=private.shipping_key(o->'region'->>'state')||'|'||private.shipping_key(o->'region'->>'city')||'|'||case when n='*' then '*' else private.shipping_key(n) end;
      if k=any(keys) then raise exception 'Esta cidade ou localidade já tem uma tarifa cadastrada.'; end if;
      keys:=array_append(keys,k);
    end loop;
  end loop;
end;
$$;

create or replace function private.assert_regional_shipping(p_settings jsonb,p_request jsonb)
returns void language plpgsql immutable set search_path=pg_catalog,private as $$
declare a jsonb:=p_request->'addressParts'; matched jsonb; k text;
begin
  if p_settings->>'shippingMode' is distinct from 'regional' or p_request->>'delivery' is distinct from 'Entrega' then return; end if;
  if jsonb_typeof(a) is distinct from 'object' then raise exception 'Confira o endereço de entrega.'; end if;
  foreach k in array array['city','state','neighborhood','street','number'] loop
    if length(trim(coalesce(a->>k,''))) not between 1 and 120 then raise exception 'Preencha o endereço de entrega completo.'; end if;
  end loop;
  if a->>'state' !~ '^[A-Za-z]{2}$' or regexp_replace(coalesce(a->>'cep',''),'[^0-9]','','g') !~ '^[0-9]{8}$'
    or length(coalesce(a->>'complement',''))>120 then raise exception 'Confira o CEP e a UF.'; end if;
  matched:=private.regional_shipping_match(p_settings->'shippingOptions',a);
  if matched is null then raise exception 'Endereço fora da cobertura de entrega. Consulte o atendimento da loja.'; end if;
  if matched->>'id' is distinct from p_request->>'shippingOptionId' then raise exception 'O frete mudou. Atualize o checkout e confira o endereço.'; end if;
  if matched->>'confirmationRequired'='true' and coalesce(p_request->>'shippingRestrictionConfirmed','false')<>'true' then
    raise exception 'Confirme que o endereço está dentro da área de entrega indicada.';
  end if;
end;
$$;

create or replace function private.guard_shipping_options()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
begin
  if old.data->'settings'->'shippingOptions' is distinct from new.data->'settings'->'shippingOptions'
    or old.data->'settings'->'shippingMode' is distinct from new.data->'settings'->'shippingMode' then
    if auth.uid() is not null and not private.is_manager() then raise exception 'Somente a conta principal ou gerente pode configurar os fretes.'; end if;
    if old.data->'settings'->>'shippingMode'='regional' and new.data->'settings'->>'shippingMode' is distinct from 'regional' then raise exception 'A entrega deve continuar configurada por região.'; end if;
    if new.data->'settings'->>'shippingMode'='regional' then perform private.validate_regional_shipping(new.data->'settings'->'shippingOptions'); end if;
  end if;
  return new;
end;
$$;

create or replace function private.save_shipping_settings(p_options jsonb,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare s public.app_state%rowtype; current_settings jsonb; updated_version bigint;
begin
  if not private.is_manager() then raise exception 'Acesso restrito à conta principal e gerentes.'; end if;
  perform private.validate_regional_shipping(p_options);
  select * into s from public.app_state where id=1 for update;
  current_settings:=jsonb_build_object('mode',s.data->'settings'->'shippingMode','options',s.data->'settings'->'shippingOptions');
  if current_settings is distinct from p_expected then raise exception 'Os fretes foram alterados por outra pessoa. Atualize a página antes de salvar.'; end if;
  update public.app_state set data=jsonb_set(s.data,'{settings}',(s.data->'settings')||jsonb_build_object('shippingMode','regional','shippingOptions',p_options)),version=version+1,updated_at=now() where id=1 returning version into updated_version;
  return jsonb_build_object('version',updated_version);
end;
$$;
create or replace function public.save_shipping_settings(p_options jsonb,p_expected jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog,private as $$
  select private.save_shipping_settings(p_options,p_expected)
$$;
revoke all on function private.shipping_key(text), private.regional_shipping_match(jsonb,jsonb), private.validate_regional_shipping(jsonb), private.assert_regional_shipping(jsonb,jsonb), private.save_shipping_settings(jsonb,jsonb), public.save_shipping_settings(jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.save_shipping_settings(jsonb,jsonb), public.save_shipping_settings(jsonb,jsonb) to authenticated;
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
    'freight', freight, 'freightPending', false,
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
      'freight', freight, 'freightPending', false,
      'shippingOptionId', selected->>'id', 'shippingOptionName', selected->>'name',
      'createdAt', revised->'createdAt','addressParts',revised->'addressParts','shippingRegion',selected->'region'));
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
  select coalesce(sum((value->>'price')::numeric*(value->>'qty')::integer),0)+(shipping->>'price')::numeric into price from jsonb_array_elements(items);
  quote:=private.payment_quote(s.data->'settings'->'paymentMethods',p_order->>'paymentMethodId',(p_order->>'installments')::integer,price);
  select greatest(1000,coalesce(max((value->>'id')::bigint),0))+1 into new_id from jsonb_array_elements(s.data->'orders');
  revised:=jsonb_build_object('id',new_id,'customer',trim(p_order->>'customer'),'email',p_order->'email',
    'phone',p_order->'phone','cpf',p_order->'cpf','address',p_order->'address','addressParts',p_order->'addressParts',
    'notes',coalesce(p_order->>'notes',''),'delivery',p_order->'delivery','deliveryDate',p_order->'deliveryDate',
    'shippingOptionId',shipping->'id','shippingOptionName',shipping->'name','freight',shipping->'price','freightPending',false,
    'date',to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD'),'createdAt',now(),'items',items,
    'status','pending','paid',false,'receipt',null,'channel','Loja física',
    'seller',(select name from public.profiles where user_id=auth.uid()),'seller_id',auth.uid(),
    'paymentTiming',p_order->'paymentTiming')||quote;
  update public.app_state set data=jsonb_set(s.data,'{orders}',jsonb_build_array(revised)||(s.data->'orders')),version=version+1,updated_at=now() where id=1;
  return jsonb_build_object('id',new_id);
end;
$function$;

CREATE OR REPLACE FUNCTION private.schedule_delivery(p_order_id bigint, p_date date, p_shipping_option_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
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
    perform private.assert_regional_shipping(state_row.data->'settings',target||jsonb_build_object('shippingOptionId',p_shipping_option_id));
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
$function$;

