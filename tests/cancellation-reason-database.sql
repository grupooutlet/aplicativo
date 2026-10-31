begin; do $qa$ declare s jsonb; o jsonb; qa_order_id bigint; denied boolean; begin
perform set_config('request.jwt.claim.sub',(select user_id::text from private.master_account where singleton=1),true);
select data into s from public.app_state where id=1; select value into o from jsonb_array_elements(s->'orders') limit 1; qa_order_id:=(o->>'id')::bigint;
update public.app_state set data=jsonb_set(data,'{orders}',(select jsonb_agg(case when value->>'id'=qa_order_id::text then value||'{"status":"pending","notes":"Observação anterior QA"}'::jsonb else value end) from jsonb_array_elements(data->'orders'))),version=version+1 where public.app_state.id=1;
denied:=false;begin perform public.order_action(qa_order_id,'cancel',null);exception when others then denied:=true;end;assert denied;
denied:=false;begin perform public.order_action(qa_order_id,'cancel','Outro motivo: x');exception when others then denied:=true;end;assert denied;
perform public.order_action(qa_order_id,'cancel','Outro motivo: Cliente solicitou outro modelo');
select value into o from public.app_state a,jsonb_array_elements(a.data->'orders') where a.id=1 and value->>'id'=qa_order_id::text;
assert o->>'status'='cancelled';assert o->>'notes' like 'Observação anterior QA%';assert o->>'notes' like '%Motivo: Outro motivo: Cliente solicitou outro modelo%';assert o->>'cancellationReason'='Outro motivo: Cliente solicitou outro modelo';
end $qa$; rollback;
