begin;
set local statement_timeout='30s';
do $$
declare master_id uuid; before_data jsonb; original jsonb; draft jsonb; after_data jsonb; large_draft jsonb; target jsonb; started_at timestamptz; elapsed interval; denied boolean; first_product jsonb; stock_value integer; reserved_value integer; public_stock integer;
begin
  select user_id into master_id from public.profiles where role='master';
  select data into before_data from public.app_state where id=1;
  original:=before_data->'storefront';
  large_draft:=jsonb_set(original,'{sections}',(original->'sections') ||
    (select jsonb_agg(jsonb_build_object('id','qa-performance-'||g,'type','banner','enabled',false,'image',repeat('A',2097152))) from generate_series(1,10) g));
  perform set_config('request.jwt.claims',jsonb_build_object('sub',master_id,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  started_at:=clock_timestamp();
  perform public.save_storefront(large_draft,original);
  elapsed:=clock_timestamp()-started_at;
  if elapsed>interval '25 seconds' then raise exception 'Large draft exceeded its publication budget: %',elapsed; end if;
  select data into after_data from public.app_state where id=1;
  if after_data-'storefront' is distinct from before_data-'storefront' then raise exception 'Large draft changed operational data.'; end if;
  if (select data->'storefront' from public.shop_public where id=1) is distinct from large_draft then raise exception 'Large draft did not publish.'; end if;
  perform public.save_storefront(original,large_draft);
  -- A product stock change must still rebuild the public catalog, including reservations.
  select value into first_product from jsonb_array_elements(before_data->'products') where (value->>'active')::boolean limit 1;
  stock_value:=(first_product->>'stock')::integer+3;
  update public.app_state set data=jsonb_set(data,'{products}',
    (select jsonb_agg(case when value->>'id'=first_product->>'id' then jsonb_set(value,'{stock}',to_jsonb(stock_value)) else value end order by ord)
      from jsonb_array_elements(data->'products') with ordinality p(value,ord))),version=version+1 where id=1;
  select coalesce(sum((item->>'qty')::integer),0) into reserved_value
    from jsonb_array_elements(before_data->'orders') o cross join lateral jsonb_array_elements(o->'items') item
    where o->>'status' in ('pending','ready') and item->>'id'=first_product->>'id';
  select (value->>'stock')::integer into public_stock from public.shop_public cross join lateral jsonb_array_elements(data->'products') where id=1 and value->>'id'=first_product->>'id';
  if public_stock is distinct from greatest(0,stock_value-reserved_value) then raise exception 'Stock publication failed.'; end if;
  if exists(select 1 from public.shop_public cross join lateral jsonb_array_elements(data->'products') where id=1 and value?'cost') then raise exception 'Product cost was exposed.'; end if;
  -- Order checks still reject payment confirmation without a receipt.
  select value into target from jsonb_array_elements(before_data->'orders') limit 1;
  if target is not null then
    target:=target||jsonb_build_object('id',999999901,'paid',true,'receipt','','delivery','Retirada','status','pending');
    denied:=false;
    begin
      update public.app_state set data=jsonb_set(data,'{orders}',(data->'orders')||jsonb_build_array(target)),version=version+1 where id=1;
    exception when others then
      if sqlerrm not ilike '%comprovante%' then raise; end if;
      denied:=true;
    end;
    if not denied then raise exception 'Order validation was skipped on a changed order.'; end if;
  end if;
  execute 'reset role';
end;
$$;
select 'Large storefront (about 23 MB), data preservation, catalog stock sync, private costs and payment receipt validation passed; all QA changes rolled back.' as result;
rollback;
