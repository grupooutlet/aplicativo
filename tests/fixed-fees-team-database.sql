-- All fixtures and writes are rolled back. No business order is placed or changed.
begin;
create temporary table qa_payment_state(data jsonb);
create trigger qa_quote_guard before update on qa_payment_state for each row execute function private.guard_order_steps();
do $qa$
declare methods jsonb; quote jsonb; legacy jsonb; changed jsonb; denied boolean; before_orders jsonb;
 manager uuid:='ee010000-0000-4000-8000-000000000001'; seller uuid:='ee010000-0000-4000-8000-000000000002'; target uuid:='ee010000-0000-4000-8000-000000000003';
 manager_session uuid:='ee020000-0000-4000-8000-000000000001'; seller_session uuid:='ee020000-0000-4000-8000-000000000002'; target_session uuid:='ee020000-0000-4000-8000-000000000003';
begin
 methods:='[{"id":"c","kind":"credit","active":true,"title":"Crédito","installments":[{"count":1,"rate":0},{"count":3,"rate":200,"feeType":"fixed"},{"count":10,"rate":10}]},{"id":"p","kind":"pix","active":true,"title":"Pix","installments":[{"count":1,"rate":0}]}]';
 quote:=private.payment_quote(methods,'c',3,1300);
 assert (quote->>'total')::numeric=1500 and (quote->>'paymentFee')::numeric=200 and (quote->>'installmentAmount')::numeric=500;
 assert quote->>'paymentFeeType'='fixed' and (quote->>'paymentRate')::numeric=0;
 legacy:=private.payment_quote(methods,'c',10,1300);
 assert (legacy->>'total')::numeric=1430 and (legacy->>'paymentFee')::numeric=130 and legacy->>'paymentFeeType'='percent';
 assert (private.payment_quote(methods,'p',1,1300)->>'total')::numeric=1300;
 denied:=false;begin perform private.payment_quote(methods,'p',3,1300);exception when others then denied:=true;end;assert denied;
 denied:=false;begin perform private.payment_quote(jsonb_set(methods,'{0,installments,1,feeType}','"invalid"'),'c',3,1300);exception when others then denied:=true;end;assert denied;
 quote:=private.payment_quote(jsonb_set(methods,'{0,installments,1,rate}','0.01'),'c',3,100);
 assert (quote->>'total')::numeric=100.01 and (quote->>'installmentAmount')::numeric=33.33 and (quote->>'lastInstallmentAmount')::numeric=33.35;
 -- Exercise the real order trigger on a temporary table, including historical rates and freight recalculation.
 insert into qa_payment_state values(jsonb_build_object('settings',jsonb_build_object('paymentMethods',methods),'orders','[]'::jsonb));
 update qa_payment_state set data=jsonb_set(data,'{orders}',jsonb_build_array('{"id":1,"status":"pending","items":[{"price":1000,"qty":1}],"freight":300,"paymentMethodId":"c","installments":3}'::jsonb));
 select data#>'{orders,0}' into quote from qa_payment_state;
 assert (quote->>'total')::numeric=1500;
 update qa_payment_state set data=jsonb_set(data,'{settings,paymentMethods,0,installments,1,rate}','999');
 update qa_payment_state set data=jsonb_set(data,'{orders,0,freight}','500');
 select data#>'{orders,0}' into quote from qa_payment_state;
 assert (quote->>'total')::numeric=1700 and (quote->>'paymentFee')::numeric=200;
 denied:=false;begin update qa_payment_state set data=jsonb_set(data,'{orders,0,paymentFeeValue}','1');exception when others then denied:=true;end;assert denied;
 legacy:=legacy-'paymentFeeType'-'paymentFeeValue';
 insert into qa_payment_state values(jsonb_build_object('settings',jsonb_build_object('paymentMethods',methods),'orders',jsonb_build_array(legacy||'{"id":2,"status":"pending","items":[{"price":1000,"qty":1}],"freight":300}'::jsonb)));
 update qa_payment_state set data=jsonb_set(data,'{orders,0,freight}','500') where data#>>'{orders,0,id}'='2';
 select data#>'{orders,0}' into quote from qa_payment_state where data#>>'{orders,0,id}'='2';
 assert (quote->>'total')::numeric=1650 and (quote->>'paymentFee')::numeric=150;
 -- Validate the published payment configuration, restoring automatically at rollback.
 select data->'orders' into before_orders from public.app_state where id=1;
 select data#>'{settings,paymentMethods}' into methods from public.app_state where id=1;
 select jsonb_agg(case when value->>'kind'='credit' then jsonb_set(value,'{installments}','[{"count":3,"rate":200,"feeType":"fixed"}]') else value end) into changed from jsonb_array_elements(methods);
 update public.app_state set data=jsonb_set(data,'{settings,paymentMethods}',changed),version=version+1 where id=1;
 assert (select data->'orders' from public.app_state where id=1)=before_orders;
 denied:=false;begin update public.app_state set data=jsonb_set(data,'{settings,paymentMethods}',(select jsonb_agg(case when value->>'kind'='credit' then jsonb_set(value,'{installments}','[{"count":3,"rate":200,"feeType":"percent"}]') else value end) from jsonb_array_elements(changed))),version=version+1 where id=1;exception when others then denied:=true;end;assert denied;
 denied:=false;begin update public.app_state set data=jsonb_set(data,'{settings,paymentMethods}',(select jsonb_agg(case when value->>'kind'='pix' then jsonb_set(value,'{installments}','[{"count":1,"rate":200,"feeType":"fixed"}]') else value end) from jsonb_array_elements(changed))),version=version+1 where id=1;exception when others then denied:=true;end;assert denied;
 -- Isolated accounts: role checks use database profiles and a live session, never user metadata.
 insert into auth.users(id,email,raw_user_meta_data) values
 (manager,'team-qa-manager@example.invalid','{"name":"QA Manager","phone":"21987654321"}'),
 (seller,'team-qa-seller@example.invalid','{"name":"QA Seller","phone":"21987654321"}'),
 (target,'team-qa-target@example.invalid','{"name":"QA Target","phone":"21987654321"}');
 update public.profiles set role='admin',position=case when user_id=manager then 'Gerente' else 'Vendedor' end where user_id in(manager,seller,target);
 insert into auth.sessions(id,user_id) values(manager_session,manager),(seller_session,seller),(target_session,target);
 perform set_config('request.jwt.claim.sub',seller::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'session_id',seller_session,'user_metadata',jsonb_build_object('role','master'))::text,true);
 denied:=false;begin perform public.remove_team_member(target);exception when others then denied:=true;end;assert denied;
 perform set_config('request.jwt.claim.sub',manager::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'session_id',manager_session)::text,true);
 denied:=false;begin perform public.remove_team_member(manager);exception when others then denied:=true;end;assert denied;
 denied:=false;begin perform public.remove_team_member((select user_id from private.master_account where singleton=1));exception when others then denied:=true;end;assert denied;
 -- Discard only fixture setup's same-transaction audit aggregation, to assert the real caller stamp.
 delete from private.change_history where transaction_id=txid_current();
 perform public.remove_team_member(target);
 assert exists(select 1 from public.profiles where user_id=target and role='customer' and position is null);
 assert exists(select 1 from auth.users where id=target);
 assert not exists(select 1 from auth.sessions where user_id=target);
 assert exists(select 1 from private.change_history where actor_id=manager and changes::text like '%'||target::text||'%' and changes::text like '%customer%');
 assert (select data->'orders' from public.app_state where id=1)=before_orders;
 denied:=false;begin perform public.remove_team_member(target);exception when others then denied:=true;end;assert denied;
 perform set_config('request.jwt.claim.sub',target::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',target,'session_id',target_session)::text,true);
 assert not private.is_seller() and not private.is_admin();
 denied:=false;begin perform public.remove_team_member(seller);exception when others then denied:=true;end;assert denied;
 perform set_config('request.jwt.claim.sub',manager::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'session_id',manager_session)::text,true);
 update public.profiles set role='admin',position='Gerente' where user_id=target;
 perform public.remove_team_member(target);
 assert (select role from public.profiles where user_id=target)='customer';
 update public.profiles set role='driver',position='Entregador' where user_id=target;
 perform public.remove_team_member(target);
 assert (select role from public.profiles where user_id=target)='customer';
 insert into auth.sessions(id,user_id) values('ee020000-0000-4000-8000-000000000004',(select user_id from private.master_account where singleton=1));
 perform set_config('request.jwt.claim.sub',(select user_id::text from private.master_account where singleton=1),true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id from private.master_account where singleton=1),'session_id','ee020000-0000-4000-8000-000000000004')::text,true);
 perform public.remove_team_member(seller);
 assert (select role from public.profiles where user_id=seller)='customer';
 assert not has_function_privilege('anon','public.remove_team_member(uuid)','execute');
 assert has_function_privilege('authenticated','public.remove_team_member(uuid)','execute');
end $qa$;
rollback;
