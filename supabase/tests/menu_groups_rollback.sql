-- Run against a populated Grupo Outlet database. Every mutation is rolled back.
begin;
do $qa$
declare actor uuid; before_data jsonb; nav jsonb; published jsonb; rejected boolean:=false;
begin
 select user_id into actor from public.profiles where role='master' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 select data into before_data from public.app_state where id=1;
 nav:=jsonb_build_object('menus',jsonb_build_array(jsonb_build_object('id','qa-group-menu','name','QA','active',true,'items',jsonb_build_array(
  jsonb_build_object('id','qa-group','label','Sala de estar','type','group','target','','newTab',false,'children',jsonb_build_array(
   jsonb_build_object('id','qa-child','label','Sofás','type','collection','target','Sofás','children','[]'::jsonb,'newTab',false)))))),
  'locations',jsonb_build_object('header','qa-group-menu','footerAbout','','footerHelp',''));
 perform public.save_navigation(nav,before_data->'navigation');
 if (select data-'navigation' from public.app_state where id=1) is distinct from before_data-'navigation' then raise exception 'Other business data changed'; end if;
 select data->'navigation' into published from public.shop_public where id=1;
 if published is distinct from nav then raise exception 'Public menu missing group'; end if;
 begin perform private.validate_navigation(jsonb_set(nav,'{menus,0,items,0,newTab}','true')); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Group with newTab accepted'; end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
 rejected:=false;
 begin perform public.save_navigation(nav,nav); exception when others then rejected:=true; end;
 if not rejected then raise exception 'Unauthorized menu edit accepted'; end if;
 if has_function_privilege('anon','public.save_navigation(jsonb,jsonb)','execute') then raise exception 'Anonymous menu mutation allowed'; end if;
end $qa$;
select 'PASS: groups published; unrelated data unchanged; invalid groups and unauthorized writes denied. All QA writes rolled back.' as result;
rollback;
