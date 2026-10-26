begin;
set local statement_timeout='30s';
do $qa$
declare actor uuid; seller uuid; customer uuid; state public.app_state%rowtype; original jsonb; previous jsonb; revised jsonb; value jsonb; message text; history_before bigint;
begin
 if not private.valid_store_cnpj('60.454.727/0001-70') or not private.valid_store_cnpj('12.ABC.345/01DE-35') or private.valid_store_cnpj('60.454.727/0001-71') or private.valid_store_cnpj('00.000.000/0000-00') then raise exception 'QA CNPJ validation';end if;
 select user_id into actor from public.profiles where role='master' limit 1;
 if actor is null then raise exception 'QA requires master';end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 select * into state from public.app_state where id=1 for update;original:=state.data;
 select coalesce(jsonb_object_agg(e.key,e.value),'{}') into previous from jsonb_each(original->'settings') e where e.key in ('name','phone','address','addressParts','legalName','cnpj','email');
 value:=previous||'{"legalName":"Empresa de Teste LTDA","cnpj":"60.454.727/0001-70","email":"qa@example.invalid","phone":"+55 (21) 96846-4050"}'::jsonb;
 select count(*) into history_before from private.change_history;
 perform private.save_site_section('store',value,previous);
 select data into revised from public.app_state where id=1;
 if (revised-'settings') is distinct from (original-'settings') then raise exception 'QA unrelated data changed';end if;
 if ((revised->'settings')-'legalName'-'cnpj'-'email'-'phone') is distinct from ((original->'settings')-'legalName'-'cnpj'-'email'-'phone') then raise exception 'QA unrelated settings changed';end if;
 if (select data->'settings'->>'email' from public.shop_public where id=1)<>'qa@example.invalid' then raise exception 'QA public data not synchronized';end if;
 if (select count(*) from private.change_history)<=history_before then raise exception 'QA audit missing';end if;
 begin perform private.save_site_section('store',value,previous);raise exception 'QA accepted stale settings';
 exception when others then get stacked diagnostics message=message_text;if message not like 'Esta configuração mudou%' then raise;end if;end;
 select jsonb_object_agg(e.key,e.value) into previous from jsonb_each(revised->'settings') e where e.key in ('name','phone','address','addressParts','legalName','cnpj','email');
 begin perform private.save_site_section('store',value||'{"cnpj":"60.454.727/0001-71"}',previous);raise exception 'QA accepted invalid CNPJ';
 exception when others then get stacked diagnostics message=message_text;if message not like 'Confira os dados%' then raise;end if;end;
 begin perform private.save_site_section('store',value||'{"email":"invalid"}',previous);raise exception 'QA accepted invalid email';
 exception when others then get stacked diagnostics message=message_text;if message not like 'Confira os dados%' then raise;end if;end;
 begin perform private.save_site_section('store',value||'{"phone":"5512345678901"}',previous);raise exception 'QA accepted invalid phone';
 exception when others then get stacked diagnostics message=message_text;if message not like 'Confira os dados%' then raise;end if;end;
 begin perform private.save_site_section('store',value||'{"goal":1}',previous);raise exception 'QA accepted unrelated setting';
 exception when others then get stacked diagnostics message=message_text;if message not like 'Confira os dados%' then raise;end if;end;
 select user_id into seller from public.profiles where role='admin' and position='Vendedor' limit 1;
 if seller is not null then
  perform set_config('request.jwt.claim.sub',seller::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true);
  perform private.save_site_section('store',value||'{"legalName":"Empresa Vendedor QA"}',previous);
 end if;
 select user_id into customer from public.profiles where role='customer' limit 1;
 if customer is not null then
  perform set_config('request.jwt.claim.sub',customer::text,true);perform set_config('request.jwt.claims',jsonb_build_object('sub',customer,'role','authenticated')::text,true);
  begin perform private.save_site_section('store',value,previous);raise exception 'QA customer accepted';
  exception when others then get stacked diagnostics message=message_text;if message not like 'Acesso restrito%' then raise;end if;end;
 end if;
 if has_function_privilege('anon','public.save_site_section(text,jsonb,jsonb)','execute') then raise exception 'QA anonymous write granted';end if;
end $qa$;
rollback;
select 'business identity, public synchronization, conflicts, validation, audit and roles verified; rolled back' as result;
