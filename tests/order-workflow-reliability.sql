begin;
set local lock_timeout='3s';
do $qa$
declare manager uuid:=gen_random_uuid(); seller uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid();
  manager_session uuid:=gen_random_uuid();seller_session uuid:=gen_random_uuid();customer_session uuid:=gen_random_uuid();
  request_id uuid:=gen_random_uuid(); payload jsonb; reply jsonb; target jsonb; proof text:='data:image/jpeg;base64,/9j/'||repeat('A',120);
  order_id bigint; denied boolean; product_stock integer; audit_count bigint;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
   (manager,'reliability-manager-'||manager::text||'@example.invalid','{"name":"QA Gerente","phone":"21987654321"}'),
   (seller,'reliability-seller-'||seller::text||'@example.invalid','{"name":"QA Vendedor","phone":"21987654321"}'),
   (customer,'reliability-customer-'||customer::text||'@example.invalid','{"name":"QA Cliente","phone":"21987654321"}');
  update public.profiles set role='admin',position='Gerente' where user_id=manager;
  update public.profiles set role='admin',position='Vendedor' where user_id=seller;
  insert into auth.sessions(id,user_id) values(manager_session,manager),(seller_session,seller),(customer_session,customer);
  perform set_config('request.jwt.claim.sub',manager::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'session_id',manager_session)::text,true);
  update public.app_state set data=jsonb_set(jsonb_set(data,'{products}',data->'products'||'[
    {"id":900006711,"name":"Produto QA confiabilidade","sku":"QA-6711","price":100,"cost":50,"stock":10,"min":1,"active":true,"category":"Sofás","variations":[]}
  ]'::jsonb),'{settings,shippingOptions}',data#>'{settings,shippingOptions}'||'[
    {"id":"qa-reliability-delivery","name":"Entrega QA confiabilidade","delivery":"Entrega","price":200,"active":true,"region":{"city":"Cidade QA Confiabilidade","state":"RJ","neighborhoods":[]}}
  ]'::jsonb),version=version+1 where id=1;
  payload:=jsonb_build_object('customer','Cliente QA','phone','21987654321','notes','Teste transacional',
    'delivery','Entrega','deliveryDate',(current_date+1)::text,'shippingOptionId','qa-reliability-delivery',
    'address','Rua QA, 42 · Centro · Cidade QA Confiabilidade / RJ',
    'addressParts','{"street":"Rua QA","number":"42","neighborhood":"Centro","city":"Cidade QA Confiabilidade","state":"RJ","cep":"26000-001"}'::jsonb,
    'paymentTiming','Antecipado','seller_id',seller,
    'paymentMethodId',(select value->>'id' from public.app_state s cross join lateral jsonb_array_elements(s.data#>'{settings,paymentMethods}') where s.id=1 and value->>'kind'='pix' and value->>'active'='true'),
    'installments',1,'items','[{"id":900006711,"qty":2,"options":{}}]'::jsonb);
  reply:=public.create_staff_order(payload,request_id);order_id:=(reply->>'id')::bigint;
  assert public.create_staff_order(payload,request_id)->>'id'=order_id::text;
  assert public.staff_order_request_status(request_id)->>'id'=order_id::text;
  denied:=false;begin perform public.order_action(order_id,'payment','not an image');exception when others then denied:=true;end;assert denied;
  perform public.order_action(order_id,'payment',proof);
  select o into target from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') o where s.id=1 and o->>'id'=order_id::text;
  assert target->>'paid'='true' and target->>'receipt'='private-receipt:'||order_id::text;
  assert public.payment_receipt(order_id)->>'image'=proof;
  assert public.order_action(order_id,'payment',proof)->>'duplicate'='true';
  perform public.order_action(order_id,'release');
  assert public.order_action(order_id,'release')->>'duplicate'='true';
  select (p->>'stock')::integer into product_stock from public.app_state s cross join lateral jsonb_array_elements(s.data->'products') p where s.id=1 and p->>'id'='900006711';
  assert product_stock=8,'A saída repetida debitou o estoque duas vezes';
  perform public.order_action(order_id,'finish','pix');
  assert public.order_action(order_id,'finish','pix')->>'duplicate'='true';
  select o into target from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') o where s.id=1 and o->>'id'=order_id::text;
  assert target->>'status'='delivered' and target->>'freightPaymentMethod'='pix';
  perform set_config('request.jwt.claim.sub',seller::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'session_id',seller_session)::text,true);
  assert public.staff_order_request_status(request_id)->'id'='null'::jsonb;
  assert public.payment_receipt(order_id)->>'image'=proof;
  perform set_config('request.jwt.claim.sub',customer::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',customer,'session_id',customer_session)::text,true);
  denied:=false;begin perform public.payment_receipt(order_id);exception when others then denied:=true;end;assert denied;
  denied:=false;begin perform public.staff_order_request_status(request_id);exception when others then denied:=true;end;assert denied;
  perform set_config('request.jwt.claim.sub',manager::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'session_id',manager_session)::text,true);
  perform public.order_action(order_id,'cancel','Outro motivo: Teste transacional de cancelamento');
  assert public.order_action(order_id,'cancel','Outro motivo: Teste transacional de cancelamento')->>'duplicate'='true';
  select (p->>'stock')::integer into product_stock from public.app_state s cross join lateral jsonb_array_elements(s.data->'products') p where s.id=1 and p->>'id'='900006711';
  assert product_stock=10,'Cancelamento repetido devolveu estoque duas vezes';
  perform public.delete_order(order_id);
  assert (public.staff_order_request_status(request_id)->>'removed')::boolean;
  denied:=false;begin perform public.payment_receipt(order_id);exception when others then denied:=true;end;assert denied;
  assert not has_table_privilege('authenticated','private.order_payment_receipts','select,insert,update,delete');
  assert not has_function_privilege('anon','public.payment_receipt(bigint)','execute');
end;
$qa$;
select 'workflow_reliability_passed' as result;
rollback;
