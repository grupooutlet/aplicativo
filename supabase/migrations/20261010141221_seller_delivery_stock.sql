-- Sellers read a projection, never the full cost-bearing operational document.
create function private.is_seller() returns boolean language sql stable security definer
set search_path=pg_catalog,public as $$
  select exists(select 1 from public.profiles where user_id=(select auth.uid()) and role='admin' and position='Vendedor')
$$;
revoke all on function private.is_seller() from public,anon,authenticated;
grant execute on function private.is_seller() to authenticated;
alter policy "Staff reads operational state" on public.app_state
  using ((select private.is_admin()) and not (select private.is_seller()));
alter policy "Staff updates operational state" on public.app_state
  using ((select private.is_admin()) and not (select private.is_seller()))
  with check ((select private.is_admin()) and not (select private.is_seller()));
create policy "Sellers cannot upload product photos" on storage.objects as restrictive for insert to authenticated
  with check (bucket_id<>'product-photos' or not (select private.is_seller()));
create policy "Sellers cannot update product photos" on storage.objects as restrictive for update to authenticated
  using (bucket_id<>'product-photos' or not (select private.is_seller()))
  with check (bucket_id<>'product-photos' or not (select private.is_seller()));
create policy "Sellers cannot delete product photos" on storage.objects as restrictive for delete to authenticated
  using (bucket_id<>'product-photos' or not (select private.is_seller()));

create function private.sales_state() returns jsonb language plpgsql stable security definer
set search_path=pg_catalog,public,private as $$
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
    'collections',s.data->'collections','pages',s.data->'pages','storefront',s.data->'storefront',
    'settings',(s.data->'settings')-'goal');
  return jsonb_build_object('data',projection,'version',s.version);
end;
$$;
create function public.sales_state() returns jsonb language sql security invoker
set search_path=pg_catalog,public,private as $$ select private.sales_state() $$;
revoke all on function private.sales_state(),public.sales_state() from public,anon,authenticated;
grant execute on function private.sales_state(),public.sales_state() to authenticated;

-- Explicit seller edits preserve cost, seller attribution, prices and workflow fields.
create function private.sales_order(p_order jsonb,p_order_id bigint default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
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
  if p_order->>'delivery' not in ('Entrega','Retirada') or p_order->>'paymentTiming' not in ('Antecipado','Na entrega','Na retirada')
    or jsonb_typeof(p_order->'items') is distinct from 'array' or jsonb_array_length(p_order->'items') not between 1 and 20 then raise exception 'Confira o pedido.'; end if;
  if p_order->>'delivery'='Entrega' and (nullif(p_order->>'deliveryDate','') is null
    or (p_order->>'deliveryDate')::date<(now() at time zone 'America/Sao_Paulo')::date) then raise exception 'Selecione uma data válida.'; end if;
  select value into shipping from jsonb_array_elements(s.data->'settings'->'shippingOptions')
    where value->>'id'=p_order->>'shippingOptionId' and value->>'delivery'=p_order->>'delivery' and value->>'active'='true';
  if shipping is null then raise exception 'Selecione um frete disponível.'; end if;
  for requested in select value from jsonb_array_elements(p_order->'items') loop
    qty:=(requested->>'qty')::integer;
    if qty not between 1 and 20 then raise exception 'Quantidade inválida.'; end if;
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
$$;
create function public.sales_order(p_order jsonb,p_order_id bigint default null) returns jsonb language sql security invoker
set search_path=pg_catalog,public,private as $$ select private.sales_order(p_order,p_order_id) $$;
revoke all on function private.sales_order(jsonb,bigint),public.sales_order(jsonb,bigint) from public,anon,authenticated;
grant execute on function private.sales_order(jsonb,bigint),public.sales_order(jsonb,bigint) to authenticated;

-- Atomic workflow operations lock the state, validate the stage and change stock once.
create function private.order_action(p_order_id bigint,p_action text,p_receipt text default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
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
    (nullif(target->>'driver_id','') is not null and target->>'driver_id'<>auth.uid()::text) or
    (p_action in ('payment','finish') and target->>'driver_id' is distinct from auth.uid()::text)) then raise exception 'Entrega não disponível para este entregador.'; end if;
  products:=s.data->'products'; movements:=coalesce(s.data->'movements','[]'); revised:=target;
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
    revised:=revised||jsonb_build_object('status','delivered','deliveredAt',now());
  else
    if target->>'status' in ('transit','delivered') then delta:=1; end if;
    revised:=revised||jsonb_build_object('status','cancelled','cancelledAt',now(),'stockDebited',false,'stockReturnedAt',now());
  end if;
  if delta<>0 then
    -- Group identical product IDs: multiple variations must not bypass stock checks.
    for item in select jsonb_build_object('id',i->'id','qty',sum((i->>'qty')::integer))
      from jsonb_array_elements(target->'items') it(i) group by i->'id' loop
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
    select coalesce(sum((value->>'qty')::integer),0) into units from jsonb_array_elements(target->'items');
  end if;
  update public.app_state set data=jsonb_set(jsonb_set(jsonb_set(s.data,'{products}',products),'{movements}',movements),'{orders}',
    (select jsonb_agg(case when value->>'id'=p_order_id::text then revised else value end order by ord)
      from jsonb_array_elements(s.data->'orders') with ordinality as x(value,ord))),version=version+1,updated_at=now() where id=1;
  return jsonb_build_object('id',p_order_id,'units',units,'stockReturned',p_action='cancel');
end;
$$;
create function public.order_action(p_order_id bigint,p_action text,p_receipt text default null) returns jsonb language sql security invoker
set search_path=pg_catalog,public,private as $$ select private.order_action(p_order_id,p_action,p_receipt) $$;
revoke all on function private.order_action(bigint,text,text),public.order_action(bigint,text,text) from public,anon,authenticated;
grant execute on function private.order_action(bigint,text,text),public.order_action(bigint,text,text) to authenticated;

create function private.release_delivery_day(p_date date) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare ids bigint[]; selected_id bigint; released integer:=0; skipped jsonb:='[]'; detail text;
begin
  if not (private.is_admin() or exists(select 1 from public.profiles where user_id=auth.uid() and role='driver')) then raise exception 'Acesso restrito à equipe.'; end if;
  if p_date is null then raise exception 'Selecione o dia da entrega.'; end if;
  -- Retain the same state lock throughout the batch. Each failed order rolls back independently.
  perform 1 from public.app_state where id=1 for update;
  select array_agg((o->>'id')::bigint order by (o->>'id')::bigint) into ids
    from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') ord(o)
    where s.id=1 and o->>'delivery'='Entrega' and o->>'deliveryDate'=p_date::text and o->>'status' in ('pending','ready');
  foreach selected_id in array coalesce(ids,'{}'::bigint[]) loop
    begin perform private.order_action(selected_id,'release'); released:=released+1;
    exception when others then get stacked diagnostics detail=message_text;
      skipped:=skipped||jsonb_build_array(jsonb_build_object('id',selected_id,'reason',detail));
    end;
  end loop;
  return jsonb_build_object('released',released,'skipped',skipped);
end;
$$;
create function public.release_delivery_day(p_date date) returns jsonb language sql security invoker
set search_path=pg_catalog,public,private as $$ select private.release_delivery_day(p_date) $$;
revoke all on function private.release_delivery_day(date),public.release_delivery_day(date) from public,anon,authenticated;
grant execute on function private.release_delivery_day(date),public.release_delivery_day(date) to authenticated;
