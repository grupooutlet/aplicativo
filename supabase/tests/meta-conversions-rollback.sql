begin;
set local statement_timeout='30s';
do $qa$
declare o jsonb; ctx jsonb; row private.meta_event_outbox%rowtype; actor uuid; request jsonb; response jsonb; key text; claim jsonb; payload jsonb; s public.app_state%rowtype; before_count integer;
begin
 -- Synthetic context only, rolled back. No network or Meta sales are produced.
 o:='{"id":999999901,"channel":"Loja online","email":" QA@EXAMPLE.INVALID ","phone":"21999998888","paid":false,"status":"pending","total":330,"freight":100,"paymentFee":30,"items":[{"id":1,"qty":2,"price":100,"cost":1}]}'::jsonb;
 ctx:=jsonb_build_object('id',gen_random_uuid(),'consent',true,'consentVersion','meta-2026-10','userAgent','QA');
 perform set_config('request.jwt.claim.sub','',true);
 perform private.register_meta_order(o,'{}');
 if exists(select 1 from private.meta_order_attribution where order_id=999999901) then raise exception 'Accepted invalid consent';end if;
 perform private.register_meta_order(o,ctx);perform private.register_meta_order(o,ctx);
 select * into row from private.meta_event_outbox where order_id=999999901;
 if row.event_name is distinct from 'OrderPending' or (row.payload->>'value')::numeric<>330 or row.payload::text like '%cost%' then raise exception 'Pending values/privacy';end if;
 if (select count(*) from private.meta_event_outbox where order_id=999999901)<>1 then raise exception 'Pending duplicate';end if;
 if (select user_data->'em'->>0 from private.meta_order_attribution where order_id=999999901)<>encode(extensions.digest('qa@example.invalid','sha256'),'hex') then raise exception 'Email hash';end if;
 if (select user_data->'ph'->>0 from private.meta_order_attribution where order_id=999999901)<>encode(extensions.digest('5521999998888','sha256'),'hex') then raise exception 'Phone hash';end if;
 perform private.meta_enqueue(o||'{"paid":true}','Purchase');perform private.meta_enqueue(o||'{"paid":true}','Purchase');
 if (select count(*) from private.meta_event_outbox where order_id=999999901 and event_name='Purchase')<>1 then raise exception 'Purchase duplicate';end if;
 if has_function_privilege('anon','public.meta_claim_events(text)','execute') or has_function_privilege('authenticated','public.meta_worker_config(text)','execute') then raise exception 'Worker exposed';end if;
 if has_table_privilege('anon','private.meta_order_attribution','select') or has_table_privilege('authenticated','private.meta_event_outbox','select') then raise exception 'Attribution exposed';end if;
 key:=(select decrypted_secret from vault.decrypted_secrets where name='forte_meta_worker_key');
 begin perform public.meta_claim_events('wrong');raise exception 'Worker accepts invalid key';exception when others then if sqlerrm<>'Unauthorized' then raise;end if;end;
 claim:=public.meta_claim_events(key);
 if jsonb_array_length(claim)<2 then raise exception 'Queue claim';end if;
 if public.meta_claim_events(key)<>'[]'::jsonb then raise exception 'Worker concurrent duplicate';end if;
 perform public.meta_finish_event(key,row.id,(select lease from private.meta_event_outbox where id=row.id),false,'network','');
 if (select state from private.meta_event_outbox where id=row.id)<>'pending' then raise exception 'No retry';end if;
 perform private.revoke_meta_marketing(array[(ctx->>'id')::uuid]);
 if exists(select 1 from private.meta_event_outbox where order_id=999999901 and state in ('pending','sending')) then raise exception 'Revocation failed';end if;
 if (select user_data from private.meta_order_attribution where order_id=999999901)<>'{}'::jsonb then raise exception 'Revoked identity retained';end if;
 -- Real checkout code path, using a current active product with pickup and no identity association.
 select * into s from public.app_state where id=1 for update;
 select jsonb_build_object('firstName','Teste','lastName','Integração','email','meta-qa@example.invalid','phone','21999998888','cpf','12345678901','address',s.data->'settings'->>'address','delivery','Retirada','paymentTiming','Antecipado','paymentMethodId','pay-pix','installments',1,
 'shippingOptionId',(select value->>'id' from jsonb_array_elements(s.data->'settings'->'shippingOptions') where value->>'delivery'='Retirada' and value->>'active'='true' limit 1),
 'expectedTotal',coalesce((p->>'promoPrice')::numeric,(p->>'price')::numeric),'items',jsonb_build_array(jsonb_build_object('id',p->'id','qty',1,'options','{}'::jsonb)),
 'meta',jsonb_build_object('id',gen_random_uuid(),'consent',true,'consentVersion','meta-2026-10','userAgent','QA')) into request
 from jsonb_array_elements(s.data->'products') p where p->>'active'='true' and (p->>'stock')::integer>0 and coalesce(jsonb_array_length(p->'variations'),0)=0 limit 1;
 if request is null then raise exception 'QA requires active product without variants';end if;
 response:=private.place_order(request);
 if not exists(select 1 from private.meta_event_outbox where order_id=(response->>'id')::bigint and event_name='OrderPending') then raise exception 'Checkout did not register attribution';end if;
 if exists(select 1 from private.meta_event_outbox where order_id=(response->>'id')::bigint and event_name='Purchase') then raise exception 'Unpaid checkout counted purchase';end if;
 if exists(select 1 from public.shop_public where data::text like '%meta_order_attribution%' or data::text like '%meta-qa@example.invalid%') then raise exception 'Private attribution in public catalog';end if;
 select user_id into actor from public.profiles where role='master' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 -- Proof uses existing test photo URL convention, never a real payment.
 perform private.order_action((response->>'id')::bigint,'payment','data:image/jpeg;base64,'||encode(decode('ffd8ff','hex')||decode(repeat('AA',80),'hex'),'base64'));
 if (select count(*) from private.meta_event_outbox where order_id=(response->>'id')::bigint and event_name='Purchase')<>1 then raise exception 'Payment did not queue purchase';end if;
 perform private.order_action((response->>'id')::bigint,'release',null);
 if (select count(*) from private.meta_event_outbox where order_id=(response->>'id')::bigint and event_name='OrderDelivered')<>1 then raise exception 'Delivery event missing';end if;
 if (select count(*) from private.meta_event_outbox where order_id=(response->>'id')::bigint and event_name='Purchase')<>1 then raise exception 'Delivery double counted purchase';end if;
 claim:=public.meta_claim_events(key);
 select * into row from private.meta_event_outbox where order_id=(response->>'id')::bigint and event_name='Purchase';
 payload:=public.meta_event_payload(key,row.id,row.lease);
 if payload is null or payload->>'event_name'<>'Purchase' or payload->>'action_source'<>'website' or payload::text like '%meta-qa@example.invalid%' or payload::text like '%cpf%' or payload::text like '%receipt%' or payload::text like '%cost%' then raise exception 'Invalid CAPI purchase payload';end if;
 if (payload->'custom_data'->>'value')::numeric<>(response->'order'->>'total')::numeric then raise exception 'CAPI total mismatch';end if;
 perform public.meta_finish_event(key,row.id,row.lease,true,'','qa');
 perform public.meta_finish_event(key,row.id,row.lease,true,'','qa');
 if (select state from private.meta_event_outbox where id=row.id)<>'sent' then raise exception 'Acknowledgment failed';end if;
 perform private.order_action((response->>'id')::bigint,'cancel',null);
 if not exists(select 1 from private.meta_event_outbox where order_id=(response->>'id')::bigint and event_name='OrderCancelled') then raise exception 'Cancellation missing';end if;
 if (select state from private.meta_event_outbox where id=row.id)<>'sent' then raise exception 'Cancellation changed sent purchase ledger';end if;
 if (select user_data from private.meta_order_attribution where order_id=(response->>'id')::bigint)='{}'::jsonb then raise exception 'Premature identity deletion';end if;
 -- A staff profile cannot attach marketing identifiers even if a client forges consent.
 perform private.register_meta_order(o||'{"id":999999902}',ctx||jsonb_build_object('id',gen_random_uuid()));
 if exists(select 1 from private.meta_order_attribution where order_id=999999902) then raise exception 'Staff attribution accepted';end if;
end $qa$;
rollback;
select 'Meta consent, privacy, totals, hash normalization, idempotence, leases, permissions, revocation and real checkout/payment path verified; rolled back' result;
