-- Exercise the existing catalog transaction and audit projection; retain no fixture changes.
begin;
set local statement_timeout='30s';
do $qa$
declare
 s public.app_state%rowtype; actor uuid; ids integer[]; revised jsonb; original jsonb;
 p jsonb; current_product jsonb; history_before bigint; message text;
begin
 select user_id into actor from public.profiles where role='master' limit 1;
 if actor is null then raise exception 'QA requires an existing master profile'; end if;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 select * into s from public.app_state where id=1 for update;
 original:=s.data;
 select array_agg(id) into ids from (
  select (value->>'id')::integer id from jsonb_array_elements(s.data->'products')
  where value->>'active'='true' and jsonb_array_length(coalesce(value->'variations','[]'::jsonb))<5
  limit 2
 ) eligible;
 if coalesce(array_length(ids,1),0)<>2 then raise exception 'QA requires two eligible products'; end if;
 select count(*) into history_before from private.change_history;
 select jsonb_agg(case when (value->>'id')::integer=any(ids) then
  value||jsonb_build_object('price',(value->>'price')::numeric+1,'stock',(value->>'stock')::integer+1,
   'categories',coalesce(value->'categories',jsonb_build_array(value->>'category'))||jsonb_build_array('QA bulk collection'),
   'variations',coalesce(value->'variations','[]'::jsonb)||jsonb_build_array(jsonb_build_object('name','QA bulk attribute','values',jsonb_build_array('1,80 m','2,00 m'))))
  else value end order by ord) into revised
 from jsonb_array_elements(s.data->'products') with ordinality entries(value,ord);
 perform private.save_catalog(jsonb_build_object('products',revised,
  'collections',(s.data->'collections')||jsonb_build_array('QA bulk collection'),
  'attributeCatalog',coalesce(s.data->'attributeCatalog','[]'::jsonb)||jsonb_build_array(jsonb_build_object('name','QA bulk attribute','values',jsonb_build_array('1,80 m','2,00 m')))),s.version);
 select * into s from public.app_state where id=1;
 if s.data->'orders' is distinct from original->'orders' then raise exception 'QA modified historical orders'; end if;
 if (select count(*) from private.change_history)<=history_before then raise exception 'QA audit missing'; end if;
 for p in select value from jsonb_array_elements(original->'products') loop
  select value into current_product from jsonb_array_elements(s.data->'products') where value->>'id'=p->>'id';
  if (p->>'id')::integer=any(ids) then
   if (current_product->>'price')::numeric<>(p->>'price')::numeric+1
    or (current_product->>'stock')::integer<>(p->>'stock')::integer+1
    or current_product->'images' is distinct from p->'images'
    or current_product->'description' is distinct from p->'description'
    or not(current_product->'categories' ? 'QA bulk collection') then raise exception 'QA changed product mismatch'; end if;
  elsif current_product is distinct from p then raise exception 'QA modified an unselected product'; end if;
 end loop;
 if exists(select 1 from public.shop_public pub cross join lateral jsonb_array_elements(pub.data->'products') product
  where (product->>'id')::integer=any(ids) and (product ? 'cost' or not(product->'categories' ? 'QA bulk collection')
   or not exists(select 1 from jsonb_array_elements(product->'variations') a where a->>'name'='QA bulk attribute'))) then raise exception 'QA public catalog projection mismatch'; end if;
 begin
  perform private.save_catalog('{}'::jsonb,s.version-1);
  raise exception 'QA stale version accepted';
 exception when others then
  get stacked diagnostics message=message_text;
  if message not like 'O catálogo mudou%' then raise; end if;
 end;
end $qa$;
rollback;
select 'bulk save, unchanged orders/products, public catalog, private costs, audit and conflict rejection verified; rolled back' result;
