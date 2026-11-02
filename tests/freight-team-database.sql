-- Isolated business transactions; run with BEGIN/ROLLBACK, never COMMIT.
do $qa$
declare manager uuid:='fa110000-0000-4000-8000-000000000001';seller uuid:='fa110000-0000-4000-8000-000000000002';driver uuid:='fa110000-0000-4000-8000-000000000003';
 ms uuid:='fa120000-0000-4000-8000-000000000001';ss uuid:='fa120000-0000-4000-8000-000000000002';ds uuid:='fa120000-0000-4000-8000-000000000003';
 payload jsonb;result jsonb;target jsonb;shipping jsonb;address jsonb;method_id text;order_id bigint;denied boolean;proof text;
begin
 insert into auth.users(id,email,raw_user_meta_data) values
 (manager,'freight-qa-manager@example.invalid','{"name":"QA Gerente","phone":"21987654321"}'),
 (seller,'freight-qa-seller@example.invalid','{"name":"QA Vendedor","phone":"21987654321"}'),
 (driver,'freight-qa-driver@example.invalid','{"name":"QA Entregador","phone":"21987654321"}');
 update public.profiles set role=case when user_id=driver then 'driver' else 'admin' end,
 position=case when user_id=manager then 'Gerente' when user_id=seller then 'Vendedor' else 'Entregador' end where user_id in(manager,seller,driver);
 insert into auth.sessions(id,user_id) values(ms,manager),(ss,seller),(ds,driver);
 perform set_config('request.jwt.claim.sub',manager::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'session_id',ms)::text,true);
 update public.app_state set data=jsonb_set(jsonb_set(data,'{products}',(data->'products')||'[{"id":99011001,"name":"Sofá QA frete separado","price":1000,"cost":400,"stock":100,"active":true,"category":"Sofás","variations":[]}]'),'{settings,paymentMethods}',(select jsonb_agg(case when m->>'kind'='credit' then m||'{"active":true,"installments":[{"count":3,"rate":10,"feeType":"percent"},{"count":2,"rate":200,"feeType":"fixed"}]}'::jsonb else m end) from jsonb_array_elements(data#>'{settings,paymentMethods}') m)),version=version+1 where id=1;
 select x into shipping from public.app_state a cross join lateral jsonb_array_elements(a.data#>'{settings,shippingOptions}') x where a.id=1 and x->>'delivery'='Entrega' and x->>'active'='true' and coalesce(jsonb_array_length(x#>'{region,neighborhoods}'),0)=0 limit 1;
 assert shipping is not null;
 address:=jsonb_build_object('street','Rua QA','number','10','city',shipping#>>'{region,city}','state',shipping#>>'{region,state}','neighborhood','Bairro QA sem tarifa específica','cep','26000000');
 select m->>'id' into method_id from public.app_state a cross join lateral jsonb_array_elements(a.data#>'{settings,paymentMethods}') m where a.id=1 and m->>'kind'='credit';
 payload:=jsonb_build_object('customer','Cliente QA','phone','21987654321','address','Rua QA, 10, endereço de teste','addressParts',address,'notes','Instrução pública','delivery','Entrega','deliveryDate',to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD'),'paymentTiming','Antecipado','shippingOptionId',shipping->'id','paymentMethodId',method_id,'installments',3,'seller_id',seller,'total',1100,'items','[{"id":99011001,"qty":1,"options":{}}]'::jsonb);
 result:=public.create_staff_order(payload,gen_random_uuid());order_id:=(result->>'id')::bigint;
 select o into target from public.app_state a cross join lateral jsonb_array_elements(a.data->'orders') o where a.id=1 and o->>'id'=order_id::text;
 assert target->>'freightBilling'='external' and (target->>'freight')::numeric=(shipping->>'price')::numeric;
 assert (target->>'paymentBase')::numeric=1000 and (target->>'paymentFee')::numeric=100 and (target->>'total')::numeric=1100;
 assert (target->>'installmentAmount')::numeric=366.66 and (target->>'lastInstallmentAmount')::numeric=366.68;
 assert private.order_store_base(target)=1000;
 proof:='data:image/jpeg;base64,'||encode(decode('ffd8ff','hex')||decode(repeat('AA',80),'hex'),'base64');
 perform public.order_action(order_id,'payment',proof);
 perform public.order_action(order_id,'release',null);
 denied:=false;begin perform public.order_action(order_id,'finish',null);exception when others then denied:=true;end;assert denied;
 denied:=false;begin perform public.order_action(order_id,'finish','credit');exception when others then denied:=true;end;assert denied;
 perform public.order_action(order_id,'finish','pix');
 select o into target from public.app_state a cross join lateral jsonb_array_elements(a.data->'orders') o where a.id=1 and o->>'id'=order_id::text;
 assert target->>'status'='delivered' and target->>'freightPaymentMethod'='pix' and target->>'freightPaidAt' is not null;
 assert (target->>'total')::numeric=1100 and (target->>'freight')::numeric=(shipping->>'price')::numeric;
 -- A forged request trying to charge card fees on freight must fail atomically.
 denied:=false;begin perform public.create_staff_order(payload||jsonb_build_object('total',1100+(shipping->>'price')::numeric*1.1),gen_random_uuid());exception when others then denied:=true;end;assert denied;
 -- Fixed card fees are still charged once and never apply to the courier amount.
 result:=public.create_staff_order(payload||'{"installments":2,"total":1200}',gen_random_uuid());
 assert (select (o->>'total')::numeric from public.app_state a cross join lateral jsonb_array_elements(a.data->'orders') o where a.id=1 and o->>'id'=result->>'id')=1200;
 -- Checkout uses the same separate billing and includes no private cost fields.
 result:=public.place_order(jsonb_build_object('firstName','Cliente','lastName','Teste','customer','Cliente Teste','phone','21987654321','email','freight-checkout@example.invalid','cpf','11122233344','address','Rua QA, 10, endereço de teste','addressParts',address,'delivery','Entrega','paymentMethodId',method_id,'installments',3,'paymentTiming','Antecipado','shippingOptionId',shipping->'id','items','[{"id":99011001,"qty":1,"options":{}}]'::jsonb,'expectedTotal',1100));
 assert result#>>'{order,freightBilling}'='external' and (result#>>'{order,total}')::numeric=1100;
 assert result#>'{order,items,0,cost}' is null;
 -- Driver projections carry only logistics and the separated money.
 perform set_config('request.jwt.claim.sub',driver::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',driver,'session_id',ds)::text,true);
 select o into target from jsonb_array_elements(public.driver_deliveries()) o where o->>'id'=order_id::text;
 assert target->>'freightBilling'='external' and (target->>'total')::numeric=1100 and target::text not like '%"cost"%';
 -- Team permissions reject seller, self, invalid role and concurrent stale edits.
 perform set_config('request.jwt.claim.sub',seller::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'session_id',ss)::text,true);
 denied:=false;begin perform public.change_team_role(driver,'Gerente','Entregador');exception when others then denied:=true;end;assert denied;
 perform set_config('request.jwt.claim.sub',manager::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'session_id',ms)::text,true);
 denied:=false;begin perform public.change_team_role(manager,'Vendedor','Gerente');exception when others then denied:=true;end;assert denied;
 denied:=false;begin perform public.change_team_role(driver,'master','Entregador');exception when others then denied:=true;end;assert denied;
 denied:=false;begin perform public.change_team_role(driver,'Vendedor','Gerente');exception when others then denied:=true;end;assert denied;
 perform public.change_team_role(driver,'Vendedor','Entregador');
 assert exists(select 1 from public.profiles where user_id=driver and role='admin' and position='Vendedor');
 assert not exists(select 1 from auth.sessions where user_id=driver);
 perform public.change_team_role(driver,'Entregador','Vendedor');
 assert exists(select 1 from public.profiles where user_id=driver and role='driver' and position='Entregador');
 assert (select count(*) from public.app_state a cross join lateral jsonb_array_elements(a.data->'orders') o where a.id=1 and o->>'id'=order_id::text)=1;
end;
$qa$;
