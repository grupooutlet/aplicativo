-- Private, append-only price decisions. Customer order payloads contain only the agreed price.
create table private.order_price_adjustments(
 id bigint generated always as identity primary key,
 order_id bigint not null check(order_id>0),
 item_index integer not null check(item_index>=0),
 product_id bigint not null,
 product_name text not null,
 options jsonb not null,
 original_price numeric(12,2) not null check(original_price>=0),
 unit_price numeric(12,2) not null check(unit_price>0),
 reason text not null check(length(btrim(reason)) between 3 and 1000),
 actor_id uuid not null,
 actor_name text not null,
 created_at timestamptz not null default clock_timestamp(),
 transaction_id bigint not null default txid_current(),
 unique(order_id,item_index)
);
alter table private.order_price_adjustments enable row level security;
alter table private.order_price_adjustments force row level security;
revoke all on private.order_price_adjustments from public,anon,authenticated;
revoke all on sequence private.order_price_adjustments_id_seq from public,anon,authenticated;
create table private.staff_order_requests(
 request_id uuid primary key,actor_id uuid not null,order_id bigint not null unique,
 fingerprint text not null,created_at timestamptz not null default clock_timestamp()
);
alter table private.staff_order_requests enable row level security;
alter table private.staff_order_requests force row level security;
revoke all on private.staff_order_requests from public,anon,authenticated;
create function private.keep_order_price_audit()
returns trigger language plpgsql set search_path=pg_catalog as $$
begin raise exception 'Registros de alteração de preço não podem ser editados ou removidos.';end;
$$;
revoke all on function private.keep_order_price_audit() from public,anon,authenticated;
create trigger immutable_order_price_adjustments before update or delete on private.order_price_adjustments
for each row execute function private.keep_order_price_audit();

create function private.guard_order_price_adjustments()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare latest jsonb; prior jsonb; item jsonb; product jsonb; decision private.order_price_adjustments%rowtype; current_price numeric; idx integer;
begin
 if old.data->'orders' is not distinct from new.data->'orders' then return new;end if;
 for latest in select value from jsonb_array_elements(coalesce(new.data->'orders','[]')) loop
  select value into prior from jsonb_array_elements(coalesce(old.data->'orders','[]')) where value->>'id'=latest->>'id';
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
$$;
revoke all on function private.guard_order_price_adjustments() from public,anon,authenticated;
create trigger guard_order_price_adjustments before update of data on public.app_state for each row execute function private.guard_order_price_adjustments();

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
  select coalesce(sum((value->>'price')::numeric*(value->>'qty')::integer),0)+(shipping->>'price')::numeric into price from jsonb_array_elements(items);
  quote:=private.payment_quote(s.data->'settings'->'paymentMethods',p_order->>'paymentMethodId',(p_order->>'installments')::integer,price);
  if p_order ? 'total' and (p_order->>'total')::numeric is distinct from (quote->>'total')::numeric then raise exception 'Os valores mudaram. Confira o total do pedido antes de confirmar.'; end if;
  select greatest(1000,coalesce(max((value->>'id')::bigint),0))+1 into new_id from jsonb_array_elements(s.data->'orders');
  new_id:=greatest(new_id,nextval('public.online_order_number'));
  perform setval('public.online_order_number',new_id,true);
  revised:=jsonb_build_object('id',new_id,'customer',trim(p_order->>'customer'),'email',p_order->'email',
    'phone',p_order->'phone','cpf',p_order->'cpf','address',p_order->'address','addressParts',p_order->'addressParts',
    'notes',coalesce(p_order->>'notes',''),'delivery',p_order->'delivery','deliveryDate',p_order->'deliveryDate',
    'shippingOptionId',shipping->'id','shippingOptionName',shipping->'name','freight',shipping->'price','freightPending',false,
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

revoke all on function private.create_staff_order(jsonb,uuid) from public,anon,authenticated;
grant execute on function private.create_staff_order(jsonb,uuid) to authenticated;
create function public.create_staff_order(p_order jsonb,p_request_id uuid default null)
returns jsonb language sql security invoker set search_path=pg_catalog,private as $$select private.create_staff_order(p_order,p_request_id)$$;
revoke all on function public.create_staff_order(jsonb,uuid) from public,anon,authenticated;
grant execute on function public.create_staff_order(jsonb,uuid) to authenticated;

create function private.order_price_notes(p_order_id bigint)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
begin
 if not private.is_admin() then raise exception 'Registros internos disponíveis somente à equipe.';end if;
 if not exists(select 1 from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') o where s.id=1 and o->>'id'=p_order_id::text) then raise exception 'Pedido não encontrado.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',id,'productName',product_name,'originalPrice',original_price,'unitPrice',unit_price,'reason',reason,'actorName',actor_name,'createdAt',created_at) order by id) from private.order_price_adjustments where order_id=p_order_id),'[]'::jsonb);
end;
$$;
revoke all on function private.order_price_notes(bigint) from public,anon,authenticated;
grant execute on function private.order_price_notes(bigint) to authenticated;
create function public.order_price_notes(p_order_id bigint)
returns jsonb language sql security invoker set search_path=pg_catalog,private as $$select private.order_price_notes(p_order_id)$$;
revoke all on function public.order_price_notes(bigint) from public,anon,authenticated;
grant execute on function public.order_price_notes(bigint) to authenticated;

