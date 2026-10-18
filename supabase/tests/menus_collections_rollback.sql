begin;
do $qa$
declare s public.app_state%rowtype; actor uuid; original jsonb; nav jsonb; result jsonb; problem text;
begin
 select user_id into actor from public.profiles where role='master' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 select * into s from public.app_state where id=1;original:=s.data;
 result:=public.save_collection(s.data->'collections'->>0,'QA coleção renomeada',true,'price_asc',null,s.version);
 select * into s from public.app_state where id=1;
 if not(s.data->'collections' ? 'QA coleção renomeada') or s.data->'collections' ? (original->'collections'->>0) then raise exception 'QA rename failed';end if;
 if s.data->'orders' is distinct from original->'orders' or s.data->'movements' is distinct from original->'movements' or s.data->'settings' is distinct from original->'settings' then raise exception 'QA unrelated business data changed';end if;
 if (select jsonb_agg(value-'category'-'categories' order by ord) from jsonb_array_elements(s.data->'products') with ordinality p(value,ord)) is distinct from
    (select jsonb_agg(value-'category'-'categories' order by ord) from jsonb_array_elements(original->'products') with ordinality p(value,ord)) then raise exception 'QA product details changed';end if;
 if exists(select 1 from jsonb_array_elements(s.data->'products') p where p->>'category'=original->'collections'->>0 or p->'categories' ? (original->'collections'->>0)) then raise exception 'QA old membership remains';end if;
 if (select data->'collectionSettings'->'QA coleção renomeada'->>'sort' from public.shop_public where id=1)<>'price_asc' then raise exception 'QA sort not published';end if;
 if not exists(select 1 from jsonb_array_elements(s.data->'navigation'->'menus'->0->'items') i where i->>'target'='QA coleção renomeada' and i->>'label'='QA coleção renomeada') then raise exception 'QA menu rename failed';end if;
 if exists(select 1 from public.shop_public cross join lateral jsonb_array_elements(data->'products') p where p ? 'cost') then raise exception 'QA cost exposure';end if;
 begin perform public.save_collection('QA coleção renomeada','Nome conflitante',true,'manual',null,(result->>'version')::bigint-1);raise exception 'QA expected stale conflict';exception when others then get stacked diagnostics problem=message_text;if problem not like 'O catálogo mudou%' then raise;end if;end;
 begin perform public.save_collection('QA coleção renomeada','Inválida',true,'untrusted',null,s.version);raise exception 'QA expected sort denial';exception when others then get stacked diagnostics problem=message_text;if problem not like 'Confira o nome%' then raise;end if;end;
 nav:=s.data->'navigation';nav:=jsonb_set(nav,'{menus,0,name}','"Menu QA"');
 result:=public.save_navigation(nav,s.data->'navigation');
 if (select data->'navigation'->'menus'->0->>'name' from public.shop_public where id=1)<>'Menu QA' then raise exception 'QA menu publication failed';end if;
 if (select data->'orders' from public.app_state where id=1) is distinct from original->'orders' then raise exception 'QA menus changed orders';end if;
 begin perform public.save_navigation(nav,original->'navigation');raise exception 'QA expected menu conflict';exception when others then get stacked diagnostics problem=message_text;if problem not like 'Os menus mudaram%' then raise;end if;end;
 begin perform private.validate_navigation(jsonb_set(nav,'{menus,0,items,0,type}','"external"')#-'{menus,0,items,0,target}');raise exception 'QA expected bad URL denial';exception when others then get stacked diagnostics problem=message_text;if problem not like 'Use um endereço%' then raise;end if;end;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
 perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}',true);
 begin perform public.save_navigation(nav,nav);raise exception 'QA expected menu role denial';exception when others then get stacked diagnostics problem=message_text;if problem not like 'Somente gerente%' then raise;end if;end;
 begin perform public.save_collection(null,'Proibida',true,'manual',null,s.version);raise exception 'QA expected collection role denial';exception when others then get stacked diagnostics problem=message_text;if problem not like 'Somente gerente%' then raise;end if;end;
 if has_function_privilege('anon','public.save_navigation(jsonb,jsonb)','EXECUTE') or has_function_privilege('anon','public.save_collection(text,text,boolean,text,jsonb,bigint)','EXECUTE') then raise exception 'QA anonymous write access';end if;
end $qa$;
select 'PASS: rename, memberships, menu references, sorting, publication, unchanged business data, version conflicts, invalid links and manager-only writes; all changes rolled back' as result;
rollback;
