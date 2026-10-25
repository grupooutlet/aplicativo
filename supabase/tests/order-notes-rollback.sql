begin;
set local statement_timeout='30s';
-- Reversible verification of permission checks, conflict handling and immutable order data.
do $qa$
declare actor uuid; customer uuid; seller uuid; state public.app_state%rowtype; original jsonb; revised jsonb;
 order_id bigint; expected text; message text; history_before bigint; version_after bigint;
begin
 select user_id into actor from public.profiles where role='master' limit 1;
 if actor is null then raise exception 'QA requires a master profile'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 select * into state from public.app_state where id=1 for update;
 original:=state.data;
 select (value->>'id')::bigint,coalesce(value->>'notes','') into order_id,expected from jsonb_array_elements(state.data->'orders') limit 1;
 if order_id is null then raise exception 'QA requires an existing order'; end if;
 select count(*) into history_before from private.change_history;
 perform private.save_order_notes(order_id,E'QA observação\nSegunda linha',expected);
 select data,version into revised,version_after from public.app_state where id=1;
 if revised->'products' is distinct from original->'products' then raise exception 'QA changed products'; end if;
 if (select count(*) from private.change_history)<=history_before then raise exception 'QA audit not recorded'; end if;
 if exists(select 1 from jsonb_array_elements(original->'orders') old_order where
  (select (new_order-'notes'-'notesUpdatedAt') from jsonb_array_elements(revised->'orders') new_order where new_order->>'id'=old_order->>'id') is distinct from (old_order-'notes'-'notesUpdatedAt')) then raise exception 'QA modified other order fields'; end if;
 perform private.save_order_notes(order_id,E'QA observação\nSegunda linha',E'QA observação\nSegunda linha');
 if (select version from public.app_state where id=1)<>version_after then raise exception 'QA no-op incremented version'; end if;
 begin
  perform private.save_order_notes(order_id,'stale',expected);raise exception 'QA accepted stale notes';
 exception when others then get stacked diagnostics message=message_text;if message not like 'A observação foi alterada%' then raise;end if;end;
 begin
  perform private.save_order_notes(order_id,repeat('x',5001),E'QA observação\nSegunda linha');raise exception 'QA accepted oversized notes';
 exception when others then get stacked diagnostics message=message_text;if message not like 'Confira a observação%' then raise;end if;end;
 select user_id into seller from public.profiles where role='admin' and position='Vendedor' limit 1;
 if seller is not null then
  perform set_config('request.jwt.claim.sub',seller::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true);
  perform private.save_order_notes(order_id,'QA vendedor',E'QA observação\nSegunda linha');
 end if;
 select user_id into customer from public.profiles where role='customer' limit 1;
 if customer is not null then
  perform set_config('request.jwt.claim.sub',customer::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',customer,'role','authenticated')::text,true);
  begin perform private.save_order_notes(order_id,'unauthorized','');raise exception 'QA customer access accepted';
  exception when others then get stacked diagnostics message=message_text;if message not like 'Seu perfil não pode%' then raise;end if;end;
 end if;
 if has_function_privilege('anon','public.save_order_notes(bigint,text,text)','execute') then raise exception 'QA anonymous execution granted'; end if;
end $qa$;

rollback;
select 'notes, audit, conflicts, length, roles and preserved fields verified; rolled back' result;
