-- Integration checks run entirely in a transaction; no QA accounts/orders remain.
begin;
do $$
declare seller uuid:=gen_random_uuid(); driver uuid:=gen_random_uuid(); owner uuid;
  product jsonb; shipping jsonb; method jsonb; request jsonb; options jsonb; response jsonb;
  first_id bigint; second_id bigint; advance_id bigint; bulk_id bigint; initial_stock integer; stock_now integer;
  projection jsonb; row_count integer; denied boolean; photo text:='data:image/jpeg;base64,/9j/'||repeat('A',120);
begin
  select user_id into owner from public.profiles where role='master';
  insert into auth.users(id,email,raw_user_meta_data) values
    (seller,'qa-seller-'||seller||'@example.invalid','{"name":"Vendedor QA"}'),
    (driver,'qa-driver-'||driver||'@example.invalid','{"name":"Entregador QA"}');
  update public.profiles set role='admin',position='Vendedor' where user_id=seller;
  update public.profiles set role='driver',position='Entregador' where user_id=driver;
  select p into product from public.app_state s cross join lateral jsonb_array_elements(s.data->'products') x(p)
    where s.id=1 and p->>'active'='true' and (p->>'stock')::integer>=5 limit 1;
  if product is null then raise exception 'QA requires a stocked active product.'; end if;
  initial_stock:=(product->>'stock')::integer;
  select coalesce(jsonb_object_agg(value->>'name',value->'values'->>0),'{}') into options
    from jsonb_array_elements(coalesce(product->'variations','[]'));
  select value into shipping from public.app_state s cross join lateral jsonb_array_elements(s.data->'settings'->'shippingOptions')
    where s.id=1 and value->>'active'='true' and value->>'delivery'='Entrega' limit 1;
  select value into method from public.app_state s cross join lateral jsonb_array_elements(s.data->'settings'->'paymentMethods')
    where s.id=1 and value->>'active'='true' and value->>'kind'='pix' limit 1;
  request:=jsonb_build_object('customer','Cliente QA','phone','+55 (21) 99999-8899','address','Rua de Teste, 10',
    'delivery','Entrega','deliveryDate',(now() at time zone 'America/Sao_Paulo')::date,
    'shippingOptionId',shipping->'id','paymentMethodId',method->'id','installments',1,'paymentTiming','Na entrega',
    'items',jsonb_build_array(jsonb_build_object('id',product->'id','qty',2,'options',options,'price',1,'cost',1)));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select count(*) into row_count from public.app_state;
  if row_count<>0 then raise exception 'Seller can read private state.'; end if;
  update public.app_state set data=jsonb_set(data,'{products,0,cost}','0') where id=1;
  get diagnostics row_count=row_count;
  if row_count<>0 then raise exception 'Seller can change products.'; end if;
  projection:=public.sales_state();
  if exists(select 1 from jsonb_array_elements(projection->'data'->'products') where value?'cost') then raise exception 'Seller projection leaks cost.'; end if;
  denied:=false;
  begin perform public.sales_order(jsonb_set(request,'{items,0,qty}','null')); exception when others then denied:=true; end;
  if not denied then raise exception 'Accepted an empty quantity.'; end if;
  denied:=false;
  begin perform public.sales_order(request-'paymentTiming'); exception when others then denied:=true; end;
  if not denied then raise exception 'Accepted a missing payment timing.'; end if;
  if initial_stock>=21 then
    response:=public.sales_order(jsonb_set(request,'{items,0,qty}','21')); bulk_id:=(response->>'id')::bigint;
    perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);
    perform public.delete_order(bulk_id);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true);
  end if;
  response:=public.sales_order(request); first_id:=(response->>'id')::bigint;
  response:=public.sales_order(jsonb_set(request,'{items,0,qty}','1')); second_id:=(response->>'id')::bigint;
  response:=public.sales_order(request||jsonb_build_object('paymentTiming','Antecipado','items',jsonb_set(request->'items','{0,qty}','1'))); advance_id:=(response->>'id')::bigint;
  projection:=public.sales_state();
  if jsonb_array_length(projection->'data'->'orders')<3 then raise exception 'Seller cannot see all orders.'; end if;
  if exists(select 1 from jsonb_array_elements(projection->'data'->'orders') o cross join lateral jsonb_array_elements(o->'items') i where i?'cost') then raise exception 'Seller projection leaks order costs.'; end if;
  denied:=false;
  begin perform public.delete_order(first_id); exception when others then denied:=true; end;
  if not denied then raise exception 'Seller deleted an order.'; end if;
  denied:=false;
  begin perform public.order_action(first_id,'cancel'); exception when others then denied:=true; end;
  if not denied then raise exception 'Seller cancelled an order.'; end if;
  execute 'reset role';
  if (select value->'items'->0->'cost' from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') where value->>'id'=first_id::text) is distinct from product->'cost' then raise exception 'Seller overwrote private cost.'; end if;
  update public.app_state set data=jsonb_set(data,'{orders}',(select jsonb_agg(case when value->>'id'=second_id::text
    then value||jsonb_build_object('seller','Outro Vendedor') else value end) from jsonb_array_elements(data->'orders'))) where id=1;
  execute 'set local role authenticated';
  projection:=public.sales_state();
  if not exists(select 1 from jsonb_array_elements(projection->'data'->'orders') where value->>'id'=second_id::text and value->>'seller'='Outro Vendedor') then raise exception 'Seller cannot see other sellers orders.'; end if;
  perform public.sales_order(request||jsonb_build_object('customer','Cliente Editado','seller','Atribuição Falsa'),second_id);
  projection:=public.sales_state();
  if not exists(select 1 from jsonb_array_elements(projection->'data'->'orders') where value->>'id'=second_id::text and value->>'seller'='Outro Vendedor' and value->>'customer'='Cliente Editado') then raise exception 'Seller edit failed or changed attribution.'; end if;
  execute 'reset role';
  -- Driver batch releases two COD orders and reports the unpaid advance order.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',driver,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  response:=public.release_delivery_day((now() at time zone 'America/Sao_Paulo')::date);
  if (response->>'released')::integer<>2 or jsonb_array_length(response->'skipped')<>1 then raise exception 'Batch release result invalid: %',response; end if;
  response:=public.release_delivery_day((now() at time zone 'America/Sao_Paulo')::date);
  if (response->>'released')::integer<>0 then raise exception 'Repeated batch debited stock again.'; end if;
  projection:=public.driver_deliveries();
  if not exists(select 1 from jsonb_array_elements(projection) where value->>'id'=first_id::text and value->>'status'='transit') then raise exception 'Driver cannot see released orders.'; end if;
  denied:=false;
  begin perform public.order_action(first_id,'payment',photo); exception when others then denied:=true; end;
  if not denied then raise exception 'Driver collected another unclaimed delivery.'; end if;
  execute 'reset role';
  select (value->>'stock')::integer into stock_now from public.app_state s cross join lateral jsonb_array_elements(s.data->'products') where value->>'id'=product->>'id';
  if stock_now<>initial_stock-3 then raise exception 'Batch stock deduction invalid.'; end if;
  -- Seller completes every stage, including a sale made by another seller.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  denied:=false;
  begin perform public.order_action(first_id,'finish'); exception when others then denied:=true; end;
  if not denied then raise exception 'Finished without payment.'; end if;
  denied:=false;
  begin perform public.order_action(first_id,'payment','invalid'); exception when others then denied:=true; end;
  if not denied then raise exception 'Accepted payment without proof.'; end if;
  perform public.order_action(first_id,'payment',photo);
  perform public.order_action(first_id,'finish');
  perform public.order_action(advance_id,'payment',photo);
  perform public.order_action(advance_id,'release');
  execute 'reset role';
  -- Master cancellation restores delivered stock once; deletion must not add it twice.
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  perform public.order_action(first_id,'cancel');
  denied:=false;
  begin perform public.order_action(first_id,'cancel'); exception when others then denied:=true; end;
  if not denied then raise exception 'Repeated cancellation accepted.'; end if;
  perform public.delete_order(first_id);
  perform public.delete_order(second_id);
  perform public.delete_order(advance_id);
  execute 'reset role';
  select (value->>'stock')::integer into stock_now from public.app_state s cross join lateral jsonb_array_elements(s.data->'products') where value->>'id'=product->>'id';
  if stock_now<>initial_stock then raise exception 'Cancelled/deleted orders did not restore original stock: % vs %',stock_now,initial_stock; end if;
  if exists(select 1 from public.app_state s cross join lateral jsonb_array_elements(s.data->'movements') where value->>'order_id' in (first_id::text,second_id::text,advance_id::text)) then raise exception 'Deleted order movements remain.'; end if;
end;
$$;
select 'Seller RLS, server pricing, driver batches, seller stages and stock restoration passed.' as result;
rollback;
