begin;
do $$
declare owner_id uuid; seller_id uuid:=gen_random_uuid(); manager_id uuid:=gen_random_uuid();
  before_state jsonb; original jsonb; draft jsonb; saved jsonb; denied boolean;
begin
  select user_id into owner_id from public.profiles where role='master';
  insert into auth.users(id,email,raw_user_meta_data) values
    (seller_id,'qa-storefront-'||seller_id||'@example.invalid','{"name":"Vendedor QA"}'),
    (manager_id,'qa-storefront-'||manager_id||'@example.invalid','{"name":"Gerente QA"}');
  update public.profiles set role='admin',position='Vendedor' where user_id=seller_id;
  update public.profiles set role='admin',position='Gerente' where user_id=manager_id;
  select data into before_state from public.app_state where id=1;
  original:=before_state->'storefront';
  draft:=jsonb_set(original,'{announcement,text}','"Storefront QA draft"');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',seller_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  denied:=false;
  begin perform public.save_storefront(draft,original); exception when others then denied:=true; end;
  if not denied then raise exception 'Seller published storefront.'; end if;
  execute 'reset role';
  -- A concurrent operational update must survive publication of the draft.
  update public.app_state set data=jsonb_set(data,'{qa_storefront_concurrent}','true'),version=version+1 where id=1;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',manager_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  perform public.save_storefront(draft,original);
  select data into saved from public.app_state where id=1;
  if saved->'storefront' is distinct from draft or saved->'qa_storefront_concurrent' is distinct from 'true'::jsonb then raise exception 'Publication lost the concurrent update.'; end if;
  if saved-'storefront'-'qa_storefront_concurrent' is distinct from before_state-'storefront' then raise exception 'Publication changed orders, products or settings.'; end if;
  if (select data->'storefront' from public.shop_public where id=1) is distinct from draft then raise exception 'Published catalog did not update.'; end if;
  denied:=false;
  begin perform public.save_storefront(original,original); exception when others then denied:=true; end;
  if not denied then raise exception 'Stale draft overwrote a newer storefront.'; end if;
  denied:=false;
  begin perform public.save_storefront(jsonb_set(draft,'{sections}','[]'),draft); exception when others then denied:=true; end;
  if not denied then raise exception 'Invalid storefront accepted.'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  perform public.save_storefront(original,draft);
  execute 'reset role';
  execute 'set local role anon';
  denied:=false;
  begin perform public.save_storefront(draft,original); exception when others then denied:=true; end;
  if not denied then raise exception 'Anonymous user published storefront.'; end if;
  execute 'reset role';
end;
$$;
select 'Storefront publication, staff permissions, concurrent operational preservation, stale-draft protection and public catalog sync passed.' as result;
rollback;
