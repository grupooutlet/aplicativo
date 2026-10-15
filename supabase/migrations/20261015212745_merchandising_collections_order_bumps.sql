
-- Versioned merchandising writes keep live orders and published store design intact.
create function private.save_catalog(p_changes jsonb,p_expected_version bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare s public.app_state%rowtype; revised jsonb; p jsonb; prior jsonb; offer jsonb; name text; memberships jsonb; diff integer; moves jsonb;
begin
 if not private.is_manager() then raise exception 'Somente gerente e conta principal podem editar o catálogo.'; end if;
 if jsonb_typeof(p_changes) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_changes) k where k not in ('products','collections','collectionSettings','orderBumps','attributeCatalog','nextProductId','storefront')) then raise exception 'Alterações de catálogo inválidas.'; end if;
 select * into s from public.app_state where id=1 for update;
 if s.version is distinct from p_expected_version then raise exception 'O catálogo mudou em outra sessão. Atualize a página antes de salvar.'; end if;
 revised:=s.data||p_changes; moves:=coalesce(s.data->'movements','[]');
 if jsonb_typeof(revised->'products') is distinct from 'array' or jsonb_typeof(revised->'collections') is distinct from 'array'
  or jsonb_typeof(coalesce(revised->'collectionSettings','{}'))<>'object' or jsonb_typeof(coalesce(revised->'orderBumps','[]'))<>'array' then raise exception 'Formato de catálogo inválido.'; end if;
 if (select count(*) from jsonb_array_elements(revised->'products'))<>(select count(distinct value->>'id') from jsonb_array_elements(revised->'products'))
  or (select count(*) from jsonb_array_elements(revised->'products'))<>(select count(distinct lower(value->>'sku')) from jsonb_array_elements(revised->'products')) then raise exception 'Código ou SKU repetido.'; end if;
 if exists(select 1 from jsonb_array_elements(s.data->'orders') o cross join lateral jsonb_array_elements(o->'items') i
  where o->>'status' in ('pending','ready','transit') and coalesce(i->>'stockTracked','true')<>'false'
  and not exists(select 1 from jsonb_array_elements(revised->'products') p where p->>'id'=i->>'id')) then raise exception 'Não exclua produtos de pedidos em andamento. Conclua ou cancele os pedidos primeiro.'; end if;
 if (select count(*) from jsonb_array_elements_text(revised->'collections'))<>(select count(distinct lower(value)) from jsonb_array_elements_text(revised->'collections'))
  or exists(select 1 from jsonb_array_elements_text(revised->'collections') c where length(btrim(c)) not between 1 and 100) then raise exception 'Confira os nomes das coleções.'; end if;
 for p in select value from jsonb_array_elements(revised->'products') loop
  if p->>'id' !~ '^[0-9]+$' or (p->>'id')::bigint not between 1 and 2147483647 or length(btrim(coalesce(p->>'name','')))=0
   or length(btrim(coalesce(p->>'sku',''))) not between 1 and 60 or coalesce((p->>'price')::numeric,0)<=0 or coalesce((p->>'cost')::numeric,-1)<0
   or coalesce(p->>'stock','') !~ '^[0-9]+$' or coalesce(p->>'min','') !~ '^[0-9]+$'
   or jsonb_typeof(p->'active') is distinct from 'boolean' then raise exception 'Confira preço, estoque e identificação do produto.'; end if;
  if coalesce((p->>'promoPrice')::numeric,0)>0 and (p->>'promoPrice')::numeric>=(p->>'price')::numeric then raise exception 'O preço promocional deve ser menor que o preço de venda.'; end if;
  if p->>'active'='true' and coalesce(jsonb_array_length(p->'images'),case when length(coalesce(p->>'image',''))>0 then 1 else 0 end)=0 then raise exception 'Adicione uma foto antes de ativar o produto.'; end if;
  memberships:=case when jsonb_typeof(p->'categories')='array' then p->'categories' when nullif(p->>'category','') is not null then jsonb_build_array(p->>'category') else '[]'::jsonb end;
  if exists(select 1 from jsonb_array_elements_text(memberships) c where not (revised->'collections' ? c)) then raise exception 'Uma coleção selecionada não existe mais.'; end if;
  if (p->>'stock')::integer<(select coalesce(sum((i->>'qty')::integer),0) from jsonb_array_elements(s.data->'orders') o cross join lateral jsonb_array_elements(o->'items') i where o->>'status' in ('pending','ready') and i->>'id'=p->>'id') then raise exception 'O estoque não pode ser menor que as reservas.'; end if;
  select value into prior from jsonb_array_elements(s.data->'products') where value->>'id'=p->>'id';
  diff:=(p->>'stock')::integer-coalesce((prior->>'stock')::integer,(p->>'stock')::integer);
  if diff<>0 then moves:=jsonb_build_array(jsonb_build_object('id',floor(extract(epoch from clock_timestamp())*1000000),'product',p->>'name','qty',diff,'reason','Ajuste na edição do produto','date',to_char(now() at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI:SS'),'by',(select name from public.profiles where user_id=auth.uid())))||moves; end if;
 end loop;
 if (select count(*) from jsonb_array_elements(coalesce(revised->'orderBumps','[]')))<>(select count(distinct value->>'id') from jsonb_array_elements(coalesce(revised->'orderBumps','[]'))) then raise exception 'Oferta repetida.'; end if;
 for offer in select value from jsonb_array_elements(coalesce(revised->'orderBumps','[]')) loop
  if length(coalesce(offer->>'id','')) not between 1 and 80 or length(btrim(coalesce(offer->>'title',''))) not between 2 and 160 or length(coalesce(offer->>'description',''))>2000
   or offer->>'kind' not in ('service','product') or coalesce((offer->>'price')::numeric,0) not between 0.01 and 1000000
   or coalesce((offer->>'cost')::numeric,0)<0 or jsonb_typeof(offer->'active') is distinct from 'boolean'
   or jsonb_typeof(offer->'targetProductIds') is distinct from 'array' then raise exception 'Confira os dados do Order Bump.'; end if;
  if offer->>'kind'='product' and not exists(select 1 from jsonb_array_elements(revised->'products') p where p->>'id'=offer->>'productId') then raise exception 'Selecione um produto para a oferta.'; end if;
  if exists(select 1 from jsonb_array_elements_text(offer->'targetProductIds') id where not exists(select 1 from jsonb_array_elements(revised->'products') p where p->>'id'=id)) then raise exception 'Um produto da oferta foi removido.'; end if;
  if offer->>'active'='true' and offer->>'allProducts' is distinct from 'true' and jsonb_array_length(offer->'targetProductIds')=0 then raise exception 'Escolha em quais produtos a oferta deve aparecer.'; end if;
 end loop;
 revised:=jsonb_set(revised,'{movements}',moves);
 update public.app_state set data=revised,version=version+1,updated_at=now() where id=1 returning * into s;
 return jsonb_build_object('version',s.version);
end $$;
create function public.save_catalog(p_changes jsonb,p_expected_version bigint) returns jsonb language sql security invoker
set search_path=pg_catalog,public,private as $$select private.save_catalog(p_changes,p_expected_version)$$;
revoke all on function private.save_catalog(jsonb,bigint),public.save_catalog(jsonb,bigint) from public,anon,authenticated;
grant execute on function private.save_catalog(jsonb,bigint),public.save_catalog(jsonb,bigint) to authenticated;

-- Recalculate offers from the locked server document; never accept a checkout price.
create function private.checkout_bump_items(p_data jsonb,p_request jsonb) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare requested jsonb; offer jsonb; product jsonb; items jsonb:='[]'; options jsonb; variation jsonb; summary text; reserved_qty integer; selected_qty integer;
begin
 if jsonb_typeof(coalesce(p_request->'orderBumps','[]'))<>'array' or jsonb_array_length(coalesce(p_request->'orderBumps','[]'))>20 then raise exception 'Ofertas inválidas.'; end if;
 if (select count(*) from jsonb_array_elements(coalesce(p_request->'orderBumps','[]')))<>(select count(distinct value->>'offerId') from jsonb_array_elements(coalesce(p_request->'orderBumps','[]'))) then raise exception 'Oferta repetida.'; end if;
 for requested in select value from jsonb_array_elements(coalesce(p_request->'orderBumps','[]')) loop
  select value into offer from jsonb_array_elements(coalesce(p_data->'orderBumps','[]')) where value->>'id'=requested->>'offerId' and value->>'active'='true';
  if offer is null or coalesce((offer->>'price')::numeric,0)<=0 then raise exception 'Esta oferta não está mais disponível. Atualize o checkout.'; end if;
  if offer->>'allProducts' is distinct from 'true' and not exists(select 1 from jsonb_array_elements(p_request->'items') i where offer->'targetProductIds' @> jsonb_build_array((i->>'id')::integer)) then raise exception 'Esta oferta não se aplica aos produtos do pedido.'; end if;
  options:=coalesce(requested->'options','{}');summary:='';
  if jsonb_typeof(options)<>'object' then raise exception 'Opções da oferta inválidas.'; end if;
  if offer->>'kind'='product' then
   select value into product from jsonb_array_elements(p_data->'products') where value->>'id'=offer->>'productId' and value->>'active'='true';
   if product is null then raise exception 'O produto da oferta não está disponível.'; end if;
   for variation in select value from jsonb_array_elements(coalesce(product->'variations','[]')) loop
    if not exists(select 1 from jsonb_array_elements_text(variation->'values') v where v=options->>(variation->>'name')) then raise exception 'Selecione as variações da oferta.'; end if;
    summary:=summary||' · '||(variation->>'name')||': '||(options->>(variation->>'name'));
   end loop;
   if (select count(*) from jsonb_object_keys(options))<>jsonb_array_length(coalesce(product->'variations','[]')) then raise exception 'Opções da oferta inválidas.'; end if;
   select coalesce(sum((i->>'qty')::integer),0) into reserved_qty from jsonb_array_elements(p_data->'orders') o cross join lateral jsonb_array_elements(o->'items') i where o->>'status' in ('pending','ready') and i->>'id'=product->>'id';
   select count(*) into selected_qty from jsonb_array_elements(items) i where i->>'id'=product->>'id';
   if (product->>'stock')::integer-reserved_qty-selected_qty<1 then raise exception 'O estoque da oferta esgotou.'; end if;
  elsif offer->>'kind'='service' then
   product:=null;if options<>'{}'::jsonb then raise exception 'Este serviço não possui variações.'; end if;
  else raise exception 'Tipo de oferta inválido.'; end if;
  items:=items||jsonb_build_array(jsonb_build_object('id',case when product is null then 0 else (product->>'id')::integer end,
   'name',(offer->>'title')||summary,'qty',1,'options',options,'price',(offer->>'price')::numeric,
   'cost',case when product is null then coalesce((offer->>'cost')::numeric,0) else (product->>'cost')::numeric end,
   'orderBumpId',offer->>'id','stockTracked',product is not null));
 end loop;
 return items;
end $$;
revoke all on function private.checkout_bump_items(jsonb,jsonb) from public,anon,authenticated;

-- Operational calls may change stock, but merchandising visibility belongs to managers.
create function private.guard_merchandising_access() returns trigger language plpgsql security invoker
set search_path=pg_catalog,public,private as $$
begin
 if auth.uid() is not null and not private.is_manager() and
  (old.data->'orderBumps' is distinct from new.data->'orderBumps' or old.data->'collectionSettings' is distinct from new.data->'collectionSettings') then
  raise exception 'Somente gerente e conta principal podem configurar coleções e ofertas.';
 end if;
 return new;
end $$;
revoke all on function private.guard_merchandising_access() from public,anon,authenticated;
create trigger guard_merchandising_access before update on public.app_state for each row execute function private.guard_merchandising_access();
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
  quote:=private.payment_quote(state_row.data->'settings'->'paymentMethods',method->>'id',(p_request->>'installments')::integer,base+(target->>'freight')::numeric);
  if p_request->>'expectedTotal' is null or (p_request->>'expectedTotal')::numeric is distinct from (quote->>'total')::numeric then
    raise exception 'Os valores mudaram. Atualize o checkout e confira o total antes de concluir.';
  end if;
  target:=target||quote||jsonb_build_object('firstName',first_name,'lastName',last_name,'date',to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD'));
  update public.app_state set data=jsonb_set(state_row.data,'{orders}',
    (select jsonb_agg(case when value->>'id'=target->>'id' then target else value end order by ord)
      from jsonb_array_elements(state_row.data->'orders') with ordinality as item(value,ord))),version=version+1,updated_at=now() where id=1;
  return jsonb_set(response,'{order}',(response->'order')||quote||jsonb_build_object('firstName',first_name,'lastName',last_name,'customer',first_name||' '||last_name,'date',target->'date','items',(select jsonb_agg(value-'cost') from jsonb_array_elements(target->'items'))));
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
  select * into actor from public.profiles where user_id=auth.uid();
  if actor.role is null or actor.role not in ('master','admin','driver') then raise exception 'Acesso restrito à equipe.'; end if;
  if p_action not in ('release','payment','finish','cancel') or p_action is null then raise exception 'Ação inválida.'; end if;
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
  if p_action='release' then
    if target->>'status' not in ('pending','ready') then raise exception 'Este pedido já saiu para entrega.'; end if;
    if target->>'delivery'='Entrega' and (nullif(target->>'deliveryDate','') is null or coalesce((target->>'freightPending')::boolean,false)) then raise exception 'Conclua o agendamento e o frete antes de liberar.'; end if;
    if (target->>'paymentTiming'='Antecipado' or target->>'delivery'='Retirada') and not coalesce((target->>'paid')::boolean,false) then raise exception 'Confirme o pagamento antes de liberar.'; end if;
    delta:=-1;
    revised:=revised||jsonb_build_object('status',case when target->>'delivery'='Retirada' then 'delivered' else 'transit' end,'releasedAt',now(),'stockDebited',true);
    if target->>'delivery'='Retirada' then revised:=revised||jsonb_build_object('deliveredAt',now()); end if;
  elsif p_action='payment' then
    if coalesce((target->>'paid')::boolean,false) or target->>'status'='delivered' then raise exception 'Pagamento já confirmado.'; end if;
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
    and old.data->'collectionSettings' is not distinct from new.data->'collectionSettings'
    and old.data->'orderBumps' is not distinct from new.data->'orderBumps'
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
    'collectionSettings',coalesce(new.data->'collectionSettings','{}'::jsonb),
    'orderBumps',(select coalesce(jsonb_agg(value-'cost'),'[]'::jsonb) from jsonb_array_elements(coalesce(new.data->'orderBumps','[]'::jsonb)) where value->>'active'='true'),
    'pages', coalesce(new.data->'pages', '[]'::jsonb),
    'storefront', coalesce(new.data->'storefront', '{}'::jsonb),
    'settings', (coalesce(new.data->'settings', '{}'::jsonb) - 'goal')),
    now())
  on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.sales_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare s public.app_state%rowtype; projection jsonb;
begin
  if not private.is_seller() then raise exception 'Acesso restrito aos vendedores.'; end if;
  select * into s from public.app_state where id=1;
  projection:=jsonb_build_object(
    'products',(select coalesce(jsonb_agg(value-'cost'),'[]'::jsonb) from jsonb_array_elements(s.data->'products')),
    'orders',(select coalesce(jsonb_agg((o-'guest_token'-'guestToken'-'cost'-'profit')||jsonb_build_object('items',
      (select coalesce(jsonb_agg(value-'cost'),'[]'::jsonb) from jsonb_array_elements(o->'items')))),'[]'::jsonb)
      from jsonb_array_elements(s.data->'orders') ord(o)),
    'movements',coalesce(s.data->'movements','[]'::jsonb),'team','[]'::jsonb,
    'collectionSettings',coalesce(s.data->'collectionSettings','{}'),
    'collections',s.data->'collections','pages',s.data->'pages','storefront',s.data->'storefront',
    'settings',(s.data->'settings')-'goal');
  return jsonb_build_object('data',projection,'version',s.version);
end;
$function$;

-- Refresh the public projection without changing catalog or operational data.
update public.app_state set data=jsonb_set(jsonb_set(data,'{collectionSettings}',coalesce(data->'collectionSettings','{}'::jsonb)),'{orderBumps}',coalesce(data->'orderBumps','[]'::jsonb)),version=version+1,updated_at=now() where id=1;

