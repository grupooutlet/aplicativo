begin;
set local statement_timeout='40s';
do $qa$
declare owner uuid; seller uuid:=gen_random_uuid(); driver uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid();
 product jsonb; original jsonb; target jsonb; denied boolean; initial_stock int; stock_now int; history_before bigint;
 pickup_id bigint:=900000001; delivery_id bigint:=900000002; photo text:='data:image/jpeg;base64,'||encode(decode('ffd8ff','hex')||decode(repeat('AA',80),'hex'),'base64');
begin
 select user_id into owner from public.profiles where role='master' limit 1;
 if owner is null then raise exception 'QA requires a master profile'; end if;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);
 insert into auth.users(id,email,raw_user_meta_data) values
 (seller,'qa-pickup-seller-'||seller||'@example.invalid','{"name":"Vendedor QA","phone":"+5521999998899"}'),
 (driver,'qa-pickup-driver-'||driver||'@example.invalid','{"name":"Entregador QA","phone":"+5521999998877"}'),
 (customer,'qa-pickup-customer-'||customer||'@example.invalid','{"name":"Cliente QA","phone":"+5521999998866"}');
 update public.profiles set role='admin',position='Vendedor' where user_id=seller;
 update public.profiles set role='driver',position='Entregador' where user_id=driver;
 select data into original from public.app_state where id=1 for update;
 select value into product from jsonb_array_elements(original->'products') where value->>'active'='true' and (value->>'stock')::int>2 limit 1;
 initial_stock:=(product->>'stock')::int;
 if initial_stock is null then raise exception 'QA requires stocked product'; end if;
 if exists(select 1 from jsonb_array_elements(original->'orders') where value->>'id' in (pickup_id::text,delivery_id::text)) then raise exception 'QA ID collision'; end if;
 target:=jsonb_build_object('id',pickup_id,'customer','Cliente QA','phone','+55 (21) 99999-8899','delivery','Retirada',
 'date',current_date,'createdAt',now(),'payment','Pix','paymentTiming','Na retirada','status','pending','paid',false,'freight',0,
 'items',jsonb_build_array(jsonb_build_object('id',product->'id','qty',1,'price',product->'price','cost',product->'cost','name',product->'name')));
 update public.app_state set data=jsonb_set(data,'{orders}',(data->'orders')||jsonb_build_array(target,target||jsonb_build_object('id',delivery_id,'delivery','Entrega','paymentTiming','Na entrega','deliveryDate',current_date,'freightPending',false))) where id=1;
 select count(*) into history_before from private.change_history;
 perform set_config('request.jwt.claim.sub',seller::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true);
 denied:=false;begin perform public.order_action(pickup_id,'payment',photo);exception when others then denied:=true;end;if not denied then raise exception 'QA paid before preparation';end if;
 denied:=false;begin perform public.confirm_pickup_notice(pickup_id,'Seu pedido está pronto.');exception when others then denied:=true;end;if not denied then raise exception 'QA notice before preparation';end if;
 denied:=false;begin perform public.order_action(delivery_id,'pickup_ready');exception when others then denied:=true;end;if not denied then raise exception 'QA accepted pickup action for delivery';end if;
 perform public.order_action(pickup_id,'pickup_ready');
 denied:=false;begin perform public.order_action(pickup_id,'pickup_ready');exception when others then denied:=true;end;if not denied then raise exception 'QA duplicate preparation';end if;
 denied:=false;begin perform public.order_action(pickup_id,'payment',photo);exception when others then denied:=true;end;if not denied then raise exception 'QA paid before notice';end if;
 select (value->>'stock')::int into stock_now from public.app_state s cross join lateral jsonb_array_elements(s.data->'products') where value->>'id'=product->>'id';
 if stock_now<>initial_stock then raise exception 'QA stock changed at preparation';end if;
 denied:=false;begin perform public.confirm_pickup_notice(pickup_id,'x');exception when others then denied:=true;end;if not denied then raise exception 'QA invalid message';end if;
 perform public.confirm_pickup_notice(pickup_id,'Olá! Seu pedido QA está pronto para retirada na loja.');
 select value into target from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') where value->>'id'=pickup_id::text;
 if target->>'pickupNotifiedBy'<>seller::text or target->>'pickupReadyBy'<>seller::text or target->>'pickupNotifiedAt' is null then raise exception 'QA missing attribution';end if;
 denied:=false;begin perform public.order_action(pickup_id,'release');exception when others then denied:=true;end;if not denied then raise exception 'QA released unpaid pickup';end if;
 denied:=false;begin perform public.order_action(pickup_id,'payment','bad photo');exception when others then denied:=true;end;if not denied then raise exception 'QA invalid proof';end if;
 perform public.order_action(pickup_id,'payment',photo);
 select (value->>'stock')::int into stock_now from public.app_state s cross join lateral jsonb_array_elements(s.data->'products') where value->>'id'=product->>'id';
 if stock_now<>initial_stock then raise exception 'QA stock changed at payment';end if;
 perform public.order_action(pickup_id,'release');
 select (value->>'stock')::int into stock_now from public.app_state s cross join lateral jsonb_array_elements(s.data->'products') where value->>'id'=product->>'id';
 if stock_now<>initial_stock-1 then raise exception 'QA pickup stock debit incorrect';end if;
 denied:=false;begin perform public.order_action(pickup_id,'release');exception when others then denied:=true;end;if not denied then raise exception 'QA duplicate pickup';end if;
 select value into target from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') where value->>'id'=pickup_id::text;
 if target->>'status'<>'delivered' or target->>'deliveredAt' is null or not (target->>'stockDebited')::boolean then raise exception 'QA pickup not completed';end if;
 if not exists(select 1 from private.change_history where transaction_id=txid_current() and changes::text like '%pickupReadyAt%' and changes::text like '%pickupNotifiedAt%') then raise exception 'QA missing audit';end if;
 -- Delivery guards continue to require route release before COD payment.
 denied:=false;begin perform public.order_action(delivery_id,'payment',photo);exception when others then denied:=true;end;if not denied then raise exception 'QA delivery skipped release';end if;
 perform public.order_action(delivery_id,'release');perform public.order_action(delivery_id,'payment',photo);perform public.order_action(delivery_id,'finish');
 perform set_config('request.jwt.claim.sub',driver::text,true);
 denied:=false;begin perform public.confirm_pickup_notice(pickup_id,'Aviso não autorizado para retirada.');exception when others then denied:=true;end;if not denied then raise exception 'QA driver access';end if;
 perform set_config('request.jwt.claim.sub',customer::text,true);
 denied:=false;begin perform public.order_action(pickup_id,'pickup_ready');exception when others then denied:=true;end;if not denied then raise exception 'QA customer access';end if;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 perform public.order_action(pickup_id,'cancel');perform public.order_action(delivery_id,'cancel');
 select (value->>'stock')::int into stock_now from public.app_state s cross join lateral jsonb_array_elements(s.data->'products') where value->>'id'=product->>'id';
 if stock_now<>initial_stock then raise exception 'QA stock restoration incorrect';end if;
 if has_function_privilege('anon','public.confirm_pickup_notice(bigint,text)','execute') then raise exception 'QA anonymous access';end if;
end $qa$;
rollback;
select 'Pickup stages, seller access, customer/driver denial, proof, stock exactly once, audit and delivery regression passed; transaction rolled back.' result;
