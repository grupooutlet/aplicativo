-- Full business transactions with isolated users/products. All rows are rolled back.
begin;
do $qa$
declare manager uuid:='ef010000-0000-4000-8000-000000000001'; seller uuid:='ef010000-0000-4000-8000-000000000002'; customer uuid:='ef010000-0000-4000-8000-000000000003';
 manager_session uuid:='ef020000-0000-4000-8000-000000000001'; seller_session uuid:='ef020000-0000-4000-8000-000000000002';
 request uuid:='ef030000-0000-4000-8000-000000000001'; guest uuid:='ef040000-0000-4000-8000-000000000001';
 payload jsonb; response jsonb; target jsonb; notes jsonb; methods jsonb; current_order_id bigint; baseline_id bigint; initial_count integer; denied boolean; original_orders jsonb;
begin
 insert into auth.users(id,email,raw_user_meta_data) values
 (manager,'price-qa-manager@example.invalid','{"name":"QA Gerente","phone":"21987654321"}'),
 (seller,'price-qa-seller@example.invalid','{"name":"QA Vendedor","phone":"21987654321"}'),
 (customer,'price-qa-customer@example.invalid','{"name":"QA Cliente","phone":"21987654321"}');
 update public.profiles set role='admin',position=case when user_id=manager then 'Gerente' else 'Vendedor' end where user_id in(manager,seller);
 insert into auth.sessions(id,user_id) values(manager_session,manager),(seller_session,seller);
 perform set_config('request.jwt.claim.sub',manager::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'session_id',manager_session)::text,true);
 select data->'orders',jsonb_array_length(data->'orders'),data#>'{settings,paymentMethods}' into original_orders,initial_count,methods from public.app_state where id=1;
 update public.app_state set data=jsonb_set(jsonb_set(jsonb_set(data,'{products}',(data->'products')||'[{"id":900000001,"name":"Produto QA personalizado","sku":"QA-PRIVATE","price":1000,"promoPrice":900,"cost":400,"stock":100,"min":1,"active":true,"category":"Sofás","variations":[{"name":"Cor","values":["Bege"]}]}]'),'{settings,shippingOptions}',(data#>'{settings,shippingOptions}')||'[{"id":"qa-price-pickup","name":"Retirada QA","delivery":"Retirada","price":0,"active":true}]'),'{settings,paymentMethods}',(select jsonb_agg(case when value->>'kind'='credit' then jsonb_set(value,'{installments}','[{"count":3,"rate":200,"feeType":"fixed"}]') else value end) from jsonb_array_elements(methods))),version=version+1 where id=1;
 payload:=jsonb_build_object('customer','Cliente QA','phone','21987654321','address','Local QA de retirada','notes','Orientação visível ao cliente.','delivery','Retirada','paymentTiming','Na retirada','shippingOptionId','qa-price-pickup','paymentMethodId',(select m->>'id' from public.app_state a cross join lateral jsonb_array_elements(a.data#>'{settings,paymentMethods}') m where a.id=1 and m->>'kind'='credit'),'installments',3,'seller_id',seller,'total',1700,'items','[{"id":900000001,"qty":2,"price":750,"options":{"Cor":"Bege"},"priceOverride":{"unitPrice":750,"expectedUnitPrice":900,"reason":"NEGOCIACAO_QA_PRIVADA","actorName":"Pessoa forjada"}}]'::jsonb);
 perform set_config('request.jwt.claim.sub',seller::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'session_id',seller_session)::text,true);
 response:=public.create_staff_order(payload,request);current_order_id:=(response->>'id')::bigint;
 select o into target from public.app_state a cross join lateral jsonb_array_elements(a.data->'orders') o where a.id=1 and o->>'id'=current_order_id::text;
 assert target->>'seller_id'=seller::text and target->>'seller'='QA Vendedor';
 assert (target#>>'{items,0,price}')::numeric=750 and (target->>'paymentFee')::numeric=200 and (target->>'total')::numeric=1700;
 assert (target->>'installmentAmount')::numeric=566.66 and (target->>'lastInstallmentAmount')::numeric=566.68;
 assert target->>'notes'='Orientação visível ao cliente.' and target::text not like '%NEGOCIACAO_QA_PRIVADA%' and target::text not like '%priceOverride%' and target::text not like '%originalPrice%';
 assert (select p->>'promoPrice' from public.app_state a cross join lateral jsonb_array_elements(a.data->'products') p where a.id=1 and p->>'id'='900000001')='900';
 notes:=public.order_price_notes(current_order_id);
 assert jsonb_array_length(notes)=1 and notes#>>'{0,reason}'='NEGOCIACAO_QA_PRIVADA' and notes#>>'{0,actorName}'='QA Vendedor' and notes#>>'{0,createdAt}' is not null;
 assert (notes#>>'{0,originalPrice}')::numeric=900 and (notes#>>'{0,unitPrice}')::numeric=750;
 assert (public.create_staff_order(payload,request)->>'id')::bigint=current_order_id;
 assert (select jsonb_array_length(data->'orders') from public.app_state where id=1)=initial_count+1;
 denied:=false;begin perform public.create_staff_order(jsonb_set(payload,'{items,0,qty}','3'),request);exception when others then denied:=true;end;assert denied;
 denied:=false;begin perform public.create_staff_order(jsonb_set(payload,'{items,0,priceOverride,reason}','"x"'),gen_random_uuid());exception when others then denied:=true;end;assert denied;
 denied:=false;begin perform public.create_staff_order(jsonb_set(payload,'{items,0,priceOverride,unitPrice}','0'),gen_random_uuid());exception when others then denied:=true;end;assert denied;
 denied:=false;begin perform public.create_staff_order(jsonb_set(payload,'{items,0,priceOverride,unitPrice}','1.234'),gen_random_uuid());exception when others then denied:=true;end;assert denied;
 denied:=false;begin perform public.create_staff_order(jsonb_set(payload,'{items,0,priceOverride,expectedUnitPrice}','899'),gen_random_uuid());exception when others then denied:=true;end;assert denied;
 denied:=false;begin perform public.create_staff_order(jsonb_set(payload,'{total}','1'),gen_random_uuid());exception when others then denied:=true;end;assert denied;
 -- Audit rows are immutable even to normal privileged business operations.
 denied:=false;begin update private.order_price_adjustments set reason='Motivo alterado' where order_id=current_order_id;exception when others then denied:=true;end;assert denied;
 denied:=false;begin delete from private.order_price_adjustments where order_id=current_order_id;exception when others then denied:=true;end;assert denied;
 perform public.save_order_notes(current_order_id,'Nova orientação pública.','Orientação visível ao cliente.');
 assert public.order_price_notes(current_order_id)=notes;
 -- Switch to manager for the raw-state protection and public projection checks.
 perform set_config('request.jwt.claim.sub',manager::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'session_id',manager_session)::text,true);
 denied:=false;begin update public.app_state set data=jsonb_set(data,'{orders}',(select jsonb_agg(case when value->>'id'=current_order_id::text then jsonb_set(value,'{items,0,price}','1') else value end) from jsonb_array_elements(data->'orders'))),version=version+1 where id=1;exception when others then denied:=true;end;assert denied;
 update public.app_state set data=jsonb_set(data,'{orders}',(select jsonb_agg(case when value->>'id'=current_order_id::text then value||jsonb_build_object('user_id',customer,'guestToken',guest) else value end) from jsonb_array_elements(data->'orders'))),version=version+1 where id=1;
 target:=private.guest_order(current_order_id,guest);
 assert target::text not like '%NEGOCIACAO_QA_PRIVADA%' and target::text not like '%priceOverride%' and target::text not like '%actorName%' and (target#>>'{items,0,price}')::numeric=750;
 perform set_config('request.jwt.claim.sub',customer::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',customer)::text,true);
 target:=private.my_orders();assert jsonb_array_length(target)=1 and target::text not like '%NEGOCIACAO_QA_PRIVADA%' and target::text not like '%originalPrice%';
 denied:=false;begin perform public.order_price_notes(current_order_id);exception when others then denied:=true;end;assert denied;
 denied:=false;begin perform public.create_staff_order(payload,gen_random_uuid());exception when others then denied:=true;end;assert denied;
 -- Managers preserve the selected vendor; canonical prices also use this same endpoint.
 perform set_config('request.jwt.claim.sub',manager::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'session_id',manager_session)::text,true);
 response:=public.create_staff_order(jsonb_set(payload#-'{items,0,priceOverride}','{total}','2000'),gen_random_uuid());baseline_id:=(response->>'id')::bigint;
 select o into target from public.app_state a cross join lateral jsonb_array_elements(a.data->'orders') o where a.id=1 and o->>'id'=baseline_id::text;
 assert (target#>>'{items,0,price}')::numeric=900 and target->>'seller_id'=seller::text and (target->>'total')::numeric=2000;
 assert public.order_price_notes(baseline_id)='[]'::jsonb;
 -- New percentage settings must not change the agreed fixed fee of an existing order.
 update public.app_state set data=jsonb_set(data,'{settings,paymentMethods}',(select jsonb_agg(case when value->>'kind'='credit' then jsonb_set(value,'{installments}','[{"count":3,"rate":10,"feeType":"percent"}]') else value end) from jsonb_array_elements(data#>'{settings,paymentMethods}'))),version=version+1 where id=1;
 perform public.save_order_notes(current_order_id,'Última orientação.','Nova orientação pública.');
 select o into target from public.app_state a cross join lateral jsonb_array_elements(a.data->'orders') o where a.id=1 and o->>'id'=current_order_id::text;
 assert (target->>'total')::numeric=1700 and (target->>'paymentFee')::numeric=200 and public.order_price_notes(current_order_id)=notes;
 assert not has_function_privilege('anon','public.order_price_notes(bigint)','execute');
 assert not has_function_privilege('anon','public.create_staff_order(jsonb,uuid)','execute');
 assert not has_table_privilege('authenticated','private.order_price_adjustments','select,update,delete');
 assert not has_table_privilege('authenticated','private.staff_order_requests','select,insert');
 assert exists(select 1 from public.app_state where id=1 and data->'orders' @> original_orders);
end $qa$;
rollback;
