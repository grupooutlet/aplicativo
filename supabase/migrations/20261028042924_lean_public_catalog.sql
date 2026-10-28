-- Keep import review metadata private; no operational data is modified.
CREATE OR REPLACE FUNCTION private.publish_catalog()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare public_products jsonb; metadata jsonb; product_sales jsonb;
begin
 if tg_op='UPDATE' and old.data->'orders' is not distinct from new.data->'orders' then
  select data->'productSales' into product_sales from public.shop_public where id=1;
 end if;
 if product_sales is null then product_sales:=private.completed_product_sales(new.data->'orders');end if;
 metadata:=jsonb_build_object('collections',coalesce(new.data->'collections','[]'::jsonb),'collectionSettings',coalesce(new.data->'collectionSettings','{}'::jsonb),
  'navigation',coalesce(new.data->'navigation','{}'::jsonb),'orderBumps',(select coalesce(jsonb_agg(value-'cost'),'[]'::jsonb) from jsonb_array_elements(coalesce(new.data->'orderBumps','[]'::jsonb)) where value->>'active'='true'),
  'pages',coalesce(new.data->'pages','[]'::jsonb),'storefront',coalesce(new.data->'storefront','{}'::jsonb),'settings',coalesce(new.data->'settings','{}'::jsonb)-'goal','productSales',product_sales);
 if tg_op='UPDATE' and old.data->'products' is not distinct from new.data->'products' and old.data->'orders' is not distinct from new.data->'orders' then
  update public.shop_public set data=data||metadata,updated_at=now() where id=1;
  if found then return new;end if;
 end if;
 with reservations as (
  select (i->>'id')::integer product_id,sum((i->>'qty')::integer) quantity from jsonb_array_elements(coalesce(new.data->'orders','[]'::jsonb)) o
  cross join lateral jsonb_array_elements(o->'items') i where o->>'status' in ('pending','ready') group by (i->>'id')::integer
 ) select coalesce(jsonb_agg((p.value-'cost'-'importInfo'-'sourceVariants')||jsonb_build_object('stock',greatest(0,(p.value->>'stock')::integer-coalesce(r.quantity,0))) order by p.ord),'[]'::jsonb)
 into public_products from jsonb_array_elements(new.data->'products') with ordinality p(value,ord) left join reservations r on r.product_id=(p.value->>'id')::integer where coalesce((p.value->>'active')::boolean,false);
 insert into public.shop_public(id,data,updated_at) values(1,metadata||jsonb_build_object('products',public_products),now())
 on conflict(id) do update set data=excluded.data,updated_at=excluded.updated_at;
 return new;
end $function$
;
update public.shop_public set data=jsonb_set(data,'{products}',(select coalesce(jsonb_agg(value-'importInfo'-'sourceVariants'),'[]'::jsonb) from jsonb_array_elements(data->'products'))) where id=1;
