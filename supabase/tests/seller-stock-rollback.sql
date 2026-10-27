begin;
set local statement_timeout='40s';
do $qa$
declare owner uuid; seller uuid:=gen_random_uuid(); driver uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid();
 product jsonb; original jsonb; before_rpc jsonb; after_rpc jsonb; movement jsonb; result jsonb; projection jsonb;
 product_id bigint; physical bigint; existing_reserved bigint; remaining bigint; test_order bigint:=900000111; entry_request uuid:=gen_random_uuid();
 denied boolean; found_rows int; version_after bigint;
begin
 select user_id into owner from public.profiles where role='master' limit 1;if owner is null then raise exception 'QA requires master';end if;
 perform set_config('request.jwt.claim.sub',owner::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);
 insert into auth.users(id,email,raw_user_meta_data) values
 (seller,'qa-stock-seller-'||seller||'@example.invalid','{"name":"Vendedor Estoque QA","phone":"+5521999998899"}'),
 (driver,'qa-stock-driver-'||driver||'@example.invalid','{"name":"Entregador QA","phone":"+5521999998877"}'),
 (customer,'qa-stock-customer-'||customer||'@example.invalid','{"name":"Cliente QA","phone":"+5521999998866"}');
 update public.profiles set role='admin',position='Vendedor' where user_id=seller;update public.profiles set role='driver',position='Entregador' where user_id=driver;
 select data into original from public.app_state where id=1 for update;
 select p,coalesce(r.qty,0) into product,existing_reserved from jsonb_array_elements(original->'products') p
 left join lateral(select sum((i->>'qty')::bigint) qty from jsonb_array_elements(original->'orders') o cross join lateral jsonb_array_elements(o->'items') i where o->>'status' in ('pending','ready') and i->>'id'=p->>'id' and coalesce(i->>'stockTracked','true')<>'false') r on true
 where (p->>'stock')::bigint-coalesce(r.qty,0)>5 limit 1;
 if product is null then raise exception 'QA needs available stock';end if;product_id:=(product->>'id')::bigint;physical:=(product->>'stock')::bigint;
 if exists(select 1 from jsonb_array_elements(original->'orders') where value->>'id'=test_order::text) then raise exception 'QA order ID collision';end if;
 update public.app_state set data=jsonb_set(data,'{orders}',(data->'orders')||jsonb_build_array(jsonb_build_object('id',test_order,'status','pending','paid',false,'delivery','Retirada','customer','Reserva QA','items',jsonb_build_array(jsonb_build_object('id',product_id,'qty',2,'price',10),jsonb_build_object('id',product_id,'qty',999,'price',1,'stockTracked',false))))) where id=1;
 select data into before_rpc from public.app_state where id=1;
 delete from private.change_history where transaction_id=txid_current();
 perform set_config('request.jwt.claim.sub',seller::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 select count(*) into found_rows from public.app_state;if found_rows<>0 then raise exception 'QA seller read private state';end if;
 update public.app_state set data=jsonb_set(data,'{products,0,cost}','0') where id=1;get diagnostics found_rows=row_count;if found_rows<>0 then raise exception 'QA seller edited private state';end if;
 result:=public.move_stock(product_id,'in',4,'Entrada QA',entry_request);
 if result?'cost' or result?'products' or (result->>'stock')::bigint<>physical+4 or (result->>'reserved')::bigint<>existing_reserved+2 then raise exception 'QA entry or reservation incorrect: %',result;end if;
 result:=public.move_stock(product_id,'out',3,'Saída QA',gen_random_uuid());if (result->>'stock')::bigint<>physical+1 then raise exception 'QA exit incorrect';end if;
 projection:=public.sales_state();if exists(select 1 from jsonb_array_elements(projection->'data'->'products') where value?'cost') then raise exception 'QA seller cost leak';end if;
 execute 'reset role';
 select data,version into after_rpc,version_after from public.app_state where id=1;
 if (after_rpc-'products'-'movements') is distinct from (before_rpc-'products'-'movements') then raise exception 'QA movement changed other business data';end if;
 if exists(select 1 from jsonb_array_elements(before_rpc->'products') p where (select value-'stock' from jsonb_array_elements(after_rpc->'products') where value->>'id'=p->>'id') is distinct from (p-'stock')) then raise exception 'QA movement edited product attributes or costs';end if;
 select value into movement from jsonb_array_elements(after_rpc->'movements') where value->>'requestId'=entry_request::text;
 if movement->>'by'<>'Vendedor Estoque QA' or movement->>'actorId'<>seller::text or movement->>'createdAt' is null then raise exception 'QA missing authoritative actor/time';end if;
 if not exists(select 1 from private.change_history where transaction_id=txid_current() and actor_id=seller and changes::text like '%Entrada QA%') then raise exception 'QA missing actor audit';end if;
 result:=public.move_stock(product_id,'in',4,'Entrada QA',entry_request);if not (result->>'duplicate')::boolean or (result->>'stock')::bigint<>physical+1 or (select version from public.app_state where id=1)<>version_after then raise exception 'QA retry duplicated movement';end if;
 denied:=false;begin perform public.move_stock(product_id,'in',5,'Entrada QA',entry_request);exception when others then denied:=true;end;if not denied then raise exception 'QA accepted changed retry';end if;
 remaining:=physical+1-existing_reserved-2;
 denied:=false;begin perform public.move_stock(product_id,'out',(remaining+1)::integer,'Saída excessiva QA',gen_random_uuid());exception when others then denied:=true;end;if not denied then raise exception 'QA consumed reserved stock';end if;
 result:=public.move_stock(product_id,'out',remaining::integer,'Saída disponível QA',gen_random_uuid());if (result->>'available')::bigint<>0 or (result->>'stock')::bigint<>existing_reserved+2 then raise exception 'QA reserved units lost';end if;
 denied:=false;begin perform public.move_stock(product_id,'out',1,'Outra saída QA',gen_random_uuid());exception when others then denied:=true;end;if not denied then raise exception 'QA negative available stock';end if;
 denied:=false;begin perform public.move_stock(product_id,'in',0,'Quantidade QA',gen_random_uuid());exception when others then denied:=true;end;if not denied then raise exception 'QA zero quantity';end if;
 denied:=false;begin perform public.move_stock(product_id,'adjust',1,'Tipo QA',gen_random_uuid());exception when others then denied:=true;end;if not denied then raise exception 'QA invalid direction';end if;
 denied:=false;begin perform public.move_stock(product_id,'in',1,' ',gen_random_uuid());exception when others then denied:=true;end;if not denied then raise exception 'QA blank reason';end if;
 perform set_config('request.jwt.claim.sub',driver::text,true);denied:=false;begin perform public.move_stock(product_id,'in',1,'Entregador QA',gen_random_uuid());exception when others then denied:=true;end;if not denied then raise exception 'QA driver allowed';end if;
 perform set_config('request.jwt.claim.sub',customer::text,true);denied:=false;begin perform public.move_stock(product_id,'in',1,'Cliente QA',gen_random_uuid());exception when others then denied:=true;end;if not denied then raise exception 'QA customer allowed';end if;
 perform set_config('request.jwt.claim.sub',owner::text,true);result:=public.move_stock(product_id,'in',1,'Principal QA',gen_random_uuid());
 if has_function_privilege('anon','public.move_stock(bigint,text,integer,text,uuid)','execute') then raise exception 'QA anonymous execution allowed';end if;
end $qa$;
rollback;
select 'Seller atomic entries/exits, reservation protection, service exclusion, replay idempotency, payload conflicts, private costs, unchanged business data, actor/time/audit and role boundaries verified; rolled back.' result;
