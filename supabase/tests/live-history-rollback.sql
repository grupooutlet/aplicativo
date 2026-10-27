begin;
set local statement_timeout='40s';
do $qa$
declare owner uuid; seller uuid:=gen_random_uuid(); browser_a uuid:=gen_random_uuid(); browser_b uuid:=gen_random_uuid(); session_a uuid:=gen_random_uuid(); session_b uuid:=gen_random_uuid(); session_c uuid:=gen_random_uuid();
 today date:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date; data jsonb; snapshot jsonb; denied boolean; old_since timestamptz;
begin
 select user_id into owner from public.profiles where role='master' limit 1;
 if owner is null then raise exception 'QA requires master';end if;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);
 -- Isolate fixtures entirely inside this transaction; all rows return on rollback.
 execute 'set local role anon';
 if not public.record_store_audience(session_c,browser_a,'Rio de Janeiro','RJ','BR',null,null,'store',false,false) then raise exception 'QA public measurement inaccessible';end if;
 denied:=false;begin perform public.store_visit_statistics(today,today);exception when others then denied:=true;end;if not denied then raise exception 'QA anonymous read accepted';end if;
 execute 'reset role';
 delete from private.store_visit_history;delete from private.store_live_visits;
 select history_started_at into old_since from private.store_audience_settings;
 update private.store_audience_settings set history_started_at=(today-3)::timestamp at time zone 'America/Sao_Paulo';
 insert into private.store_visit_history(visit_id,visitor_id,started_at,updated_at) values
 (gen_random_uuid(),browser_a,(today-1)::timestamp at time zone 'America/Sao_Paulo',clock_timestamp()),
 (gen_random_uuid(),browser_a,today::timestamp at time zone 'America/Sao_Paulo',clock_timestamp()),
 (gen_random_uuid(),browser_a,(today::timestamp+interval '1 minute') at time zone 'America/Sao_Paulo',clock_timestamp()),
 (gen_random_uuid(),browser_b,(today::timestamp+interval '2 minutes') at time zone 'America/Sao_Paulo',clock_timestamp());
 data:=public.store_visit_statistics(today-1,today);
 if (data->>'visits')::int<>4 or (data->>'visitors')::int<>2 then raise exception 'QA visits/unique browsers incorrect: %',data;end if;
 if (select sum((value->>'visitors')::int) from jsonb_array_elements(data->'daily'))<>3 then raise exception 'QA daily uniqueness boundaries incorrect';end if;
 if (select (value->>'visits')::int from jsonb_array_elements(data->'overview') where value->>'key'='today')<>3 then raise exception 'QA today boundary incorrect';end if;
 if (select (value->>'visitors')::int from jsonb_array_elements(data->'overview') where value->>'key'='today')<>2 then raise exception 'QA today people incorrect';end if;
 denied:=false;begin perform public.store_visit_statistics(today-90,today);exception when others then denied:=true;end;if not denied then raise exception 'QA accepted more than retention';end if;
 denied:=false;begin perform public.store_visit_statistics(today+1,today+1);exception when others then denied:=true;end;if not denied then raise exception 'QA accepted future';end if;
 denied:=false;begin perform public.store_visit_statistics(today,today-1);exception when others then denied:=true;end;if not denied then raise exception 'QA accepted inverted range';end if;
 if not public.record_store_audience(session_a,browser_b,'Rio de Janeiro','RJ','BR',-22.9,-43.2,'product',false,false) then raise exception 'QA record failed';end if;
 if not public.record_store_audience(session_a,browser_b,'Rio de Janeiro','RJ','BR',-22.9,-43.2,'cart',true,false) then raise exception 'QA heartbeat failed';end if;
 if (select count(*) from private.store_visit_history where visit_id=session_a)<>1 then raise exception 'QA heartbeat duplicated session';end if;
 if public.record_store_audience(session_a,browser_a,'Rio de Janeiro','RJ','BR',-22.9,-43.2,'store',false,false) then raise exception 'QA reassigned visitor';end if;
 if not public.record_store_audience(session_b,browser_b,'Rio de Janeiro','RJ','BR',-22.9,-43.2,'product',false,false) then raise exception 'QA second session failed';end if;
 snapshot:=public.store_live_snapshot();if (snapshot->>'active')::int<>1 then raise exception 'QA same browser duplicated in live view';end if;
 data:=public.store_visit_statistics(today,today);if (data->>'visits')::int<>5 or (data->>'visitors')::int<>2 then raise exception 'QA repeat visits missing';end if;
 if not public.record_store_audience(session_a,browser_b,'','','XX',null,null,'store',false,true) then raise exception 'QA forget failed';end if;
 if exists(select 1 from private.store_visit_history where visitor_id=browser_b) or exists(select 1 from private.store_live_visits where visit_id in (session_a,session_b)) then raise exception 'QA forget did not remove browser history';end if;
 if public.record_store_audience(session_c,browser_b,'Rio de Janeiro','RJ','BR',null,null,'store',false,false) then raise exception 'QA late heartbeat recreated revoked visitor';end if;
 insert into private.store_visit_history(visit_id,visitor_id,started_at,updated_at) values(gen_random_uuid(),browser_a,clock_timestamp()-interval '91 days',clock_timestamp());
 perform private.purge_live_visits();if exists(select 1 from private.store_visit_history where started_at<clock_timestamp()-interval '90 days') then raise exception 'QA retention failed';end if;
 insert into auth.users(id,email,raw_user_meta_data) values(seller,'qa-live-'||seller||'@example.invalid','{"name":"Vendedor QA","phone":"+5521999998899"}');
 update public.profiles set role='admin',position='Vendedor' where user_id=seller;
 perform set_config('request.jwt.claim.sub',seller::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true);
 execute 'set local role authenticated';
 denied:=false;begin perform public.store_visit_statistics(today,today);exception when others then denied:=true;end;if not denied then raise exception 'QA seller read stats';end if;
 denied:=false;begin perform count(*) from private.store_visit_history;exception when others then denied:=true;end;if not denied then raise exception 'QA raw history exposed';end if;
 execute 'reset role';
 perform set_config('request.jwt.claim.sub',owner::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner,'role','authenticated')::text,true);
 execute 'set local role authenticated';data:=public.store_visit_statistics(today,today);execute 'reset role';
 if (data->>'visitors')::int<>1 then raise exception 'QA manager read failed after revocation';end if;
 if has_function_privilege('anon','public.store_visit_statistics(date,date)','execute') then raise exception 'QA anonymous stats exposed';end if;
end $qa$;
rollback;
select 'History counts distinct browsers across days, Brasília boundaries, session heartbeat deduplication, repeated sessions, live deduplication, revocation and late heartbeat protection, retention, bounded dates, manager access and private RLS verified; rolled back.' result;
