-- Publish only aggregate completed unit sales; order/customer records stay private.
create function private.completed_product_sales(p_orders jsonb)
returns jsonb language sql immutable security invoker set search_path=pg_catalog as $$
 select coalesce(jsonb_object_agg(product_id,quantity),'{}'::jsonb)
 from (
  select item->>'id' product_id,sum((item->>'qty')::bigint) quantity
  from jsonb_array_elements(coalesce(p_orders,'[]'::jsonb)) orders(ord)
  cross join lateral jsonb_array_elements(coalesce(ord->'items','[]'::jsonb)) items(item)
  where ord->>'status'='delivered' and ord->>'paid'='true'
   and item->>'id' ~ '^[0-9]+$' and item->>'qty' ~ '^[1-9][0-9]{0,8}$'
  group by item->>'id'
 ) totals
$$;
revoke all on function private.completed_product_sales(jsonb) from public,anon,authenticated;

create or replace function private.publish_catalog() returns trigger
language plpgsql security definer set search_path=pg_catalog,public as $$
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
 ) select coalesce(jsonb_agg((p.value-'cost')||jsonb_build_object('stock',greatest(0,(p.value->>'stock')::integer-coalesce(r.quantity,0))) order by p.ord),'[]'::jsonb)
 into public_products from jsonb_array_elements(new.data->'products') with ordinality p(value,ord) left join reservations r on r.product_id=(p.value->>'id')::integer where coalesce((p.value->>'active')::boolean,false);
 insert into public.shop_public(id,data,updated_at) values(1,metadata||jsonb_build_object('products',public_products),now())
 on conflict(id) do update set data=excluded.data,updated_at=excluded.updated_at;
 return new;
end $$;

update public.shop_public set data=jsonb_set(data,'{productSales}',
 private.completed_product_sales((select data->'orders' from public.app_state where id=1))),updated_at=now() where id=1;
