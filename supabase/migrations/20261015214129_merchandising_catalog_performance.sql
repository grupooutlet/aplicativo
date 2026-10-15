-- Versioned merchandising writes keep live orders and published store design intact.
create or replace function private.save_catalog(p_changes jsonb,p_expected_version bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare s public.app_state%rowtype; revised jsonb; p jsonb; prior jsonb; offer jsonb; memberships jsonb; prior_products jsonb; diff integer; moves jsonb;
begin
 if not private.is_manager() then raise exception 'Somente gerente e conta principal podem editar o catálogo.'; end if;
 if jsonb_typeof(p_changes) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_changes) k where k not in ('products','collections','collectionSettings','orderBumps','attributeCatalog','nextProductId','storefront')) then raise exception 'Alterações de catálogo inválidas.'; end if;
 select * into s from public.app_state where id=1 for update;
 if s.version is distinct from p_expected_version then raise exception 'O catálogo mudou em outra sessão. Atualize a página antes de salvar.'; end if;
 revised:=s.data||p_changes; moves:=coalesce(s.data->'movements','[]');
 if jsonb_typeof(revised->'products') is distinct from 'array' or jsonb_typeof(revised->'collections') is distinct from 'array'
  or jsonb_typeof(coalesce(revised->'collectionSettings','{}'))<>'object' or jsonb_typeof(coalesce(revised->'orderBumps','[]'))<>'array' then raise exception 'Formato de catálogo inválido.'; end if;
 if (select count(*) from jsonb_array_elements(revised->'products'))<>(select count(distinct value->>'id') from jsonb_array_elements(revised->'products'))
  or (select count(*) from jsonb_array_elements(revised->'products'))<>(select count(distinct lower(value->>'sku')) from jsonb_array_elements(revised->'products')) then raise exception 'Código ou SKU repetido.'; end if;
 if exists(select 1 from jsonb_array_elements(s.data->'orders') o cross join lateral jsonb_array_elements(o->'items') i
  where o->>'status' in ('pending','ready','transit') and coalesce(i->>'stockTracked','true')<>'false'
  and not exists(select 1 from jsonb_array_elements(revised->'products') candidate where candidate->>'id'=i->>'id')) then raise exception 'Não exclua produtos de pedidos em andamento. Conclua ou cancele os pedidos primeiro.'; end if;
 if (select count(*) from jsonb_array_elements_text(revised->'collections'))<>(select count(distinct lower(value)) from jsonb_array_elements_text(revised->'collections'))
  or exists(select 1 from jsonb_array_elements_text(revised->'collections') c where length(btrim(c)) not between 1 and 100) then raise exception 'Confira os nomes das coleções.'; end if;
 select coalesce(jsonb_object_agg(value->>'id',value),'{}'::jsonb) into prior_products from jsonb_array_elements(s.data->'products');
 for p in select value from jsonb_array_elements(revised->'products') where value is distinct from prior_products->(value->>'id') loop
  if p->>'id' !~ '^[0-9]+$' or (p->>'id')::bigint not between 1 and 2147483647 or length(btrim(coalesce(p->>'name','')))=0
   or length(btrim(coalesce(p->>'sku',''))) not between 1 and 60 or coalesce((p->>'price')::numeric,0)<=0 or coalesce((p->>'cost')::numeric,-1)<0
   or coalesce(p->>'stock','') !~ '^[0-9]+$' or coalesce(p->>'min','') !~ '^[0-9]+$'
   or jsonb_typeof(p->'active') is distinct from 'boolean' then raise exception 'Confira preço, estoque e identificação do produto.'; end if;
  if coalesce((p->>'promoPrice')::numeric,0)>0 and (p->>'promoPrice')::numeric>=(p->>'price')::numeric then raise exception 'O preço promocional deve ser menor que o preço de venda.'; end if;
  if p->>'active'='true' and coalesce(jsonb_array_length(p->'images'),case when length(coalesce(p->>'image',''))>0 then 1 else 0 end)=0 then raise exception 'Adicione uma foto antes de ativar o produto.'; end if;
  memberships:=case when jsonb_typeof(p->'categories')='array' then p->'categories' when nullif(p->>'category','') is not null then jsonb_build_array(p->>'category') else '[]'::jsonb end;
  if exists(select 1 from jsonb_array_elements_text(memberships) c where not (revised->'collections' ? c)) then raise exception 'Uma coleção selecionada não existe mais.'; end if;
  if (p->>'stock')::integer<(select coalesce(sum((i->>'qty')::integer),0) from jsonb_array_elements(s.data->'orders') o cross join lateral jsonb_array_elements(o->'items') i where o->>'status' in ('pending','ready') and i->>'id'=p->>'id') then raise exception 'O estoque não pode ser menor que as reservas.'; end if;
  prior:=prior_products->(p->>'id');
  diff:=(p->>'stock')::integer-coalesce((prior->>'stock')::integer,(p->>'stock')::integer);
  if diff<>0 then moves:=jsonb_build_array(jsonb_build_object('id',floor(extract(epoch from clock_timestamp())*1000000),'product',p->>'name','qty',diff,'reason','Ajuste na edição do produto','date',to_char(now() at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI:SS'),'by',(select name from public.profiles where user_id=auth.uid())))||moves; end if;
 end loop;
 if (select count(*) from jsonb_array_elements(coalesce(revised->'orderBumps','[]')))<>(select count(distinct value->>'id') from jsonb_array_elements(coalesce(revised->'orderBumps','[]'))) then raise exception 'Oferta repetida.'; end if;
 for offer in select value from jsonb_array_elements(coalesce(revised->'orderBumps','[]')) loop
  if length(coalesce(offer->>'id','')) not between 1 and 80 or length(btrim(coalesce(offer->>'title',''))) not between 2 and 160 or length(coalesce(offer->>'description',''))>2000
   or offer->>'kind' not in ('service','product') or coalesce((offer->>'price')::numeric,0) not between 0.01 and 1000000
   or coalesce((offer->>'cost')::numeric,0)<0 or jsonb_typeof(offer->'active') is distinct from 'boolean'
   or jsonb_typeof(offer->'targetProductIds') is distinct from 'array' then raise exception 'Confira os dados do Order Bump.'; end if;
  if offer->>'kind'='product' and not exists(select 1 from jsonb_array_elements(revised->'products') candidate where candidate->>'id'=offer->>'productId') then raise exception 'Selecione um produto para a oferta.'; end if;
  if exists(select 1 from jsonb_array_elements_text(offer->'targetProductIds') id where not exists(select 1 from jsonb_array_elements(revised->'products') candidate where candidate->>'id'=id)) then raise exception 'Um produto da oferta foi removido.'; end if;
  if offer->>'active'='true' and offer->>'allProducts' is distinct from 'true' and jsonb_array_length(offer->'targetProductIds')=0 then raise exception 'Escolha em quais produtos a oferta deve aparecer.'; end if;
 end loop;
 revised:=jsonb_set(revised,'{movements}',moves);
 update public.app_state set data=revised,version=version+1,updated_at=now() where id=1 returning * into s;
 return jsonb_build_object('version',s.version);
end $$;

CREATE OR REPLACE FUNCTION private.publish_catalog()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  product jsonb;
  public_products jsonb := '[]'::jsonb;
  reserved_qty integer;
begin
  -- Store editing leaves products, stock, prices and operational orders unchanged.
  if tg_op='UPDATE' and old.data->'products' is not distinct from new.data->'products'
    and old.data->'orders' is not distinct from new.data->'orders'
    and old.data->'collections' is not distinct from new.data->'collections'
    and old.data->'collectionSettings' is not distinct from new.data->'collectionSettings'
    and old.data->'orderBumps' is not distinct from new.data->'orderBumps'
    and old.data->'pages' is not distinct from new.data->'pages'
    and old.data->'settings' is not distinct from new.data->'settings' then
    update public.shop_public set data=jsonb_set(data,'{storefront}',coalesce(new.data->'storefront','{}'::jsonb)),updated_at=now() where id=1;
    if found then return new; end if;
  end if;
  with reservations as (
    select (i->>'id')::integer as product_id,sum((i->>'qty')::integer) as quantity
    from jsonb_array_elements(coalesce(new.data->'orders','[]')) o
    cross join lateral jsonb_array_elements(o->'items') i
    where o->>'status' in ('pending','ready')
    group by (i->>'id')::integer
  )
  select coalesce(jsonb_agg((p.value-'cost')||jsonb_build_object('stock',
    greatest(0,(p.value->>'stock')::integer-coalesce(r.quantity,0))) order by p.ord),'[]'::jsonb)
    into public_products
  from jsonb_array_elements(new.data->'products') with ordinality as p(value,ord)
  left join reservations r on r.product_id=(p.value->>'id')::integer
  where coalesce((p.value->>'active')::boolean,false);
  insert into public.shop_public(id, data, updated_at)
  values (1, jsonb_build_object(
    'products', public_products,
    'collections', coalesce(new.data->'collections', '[]'::jsonb),
    'collectionSettings',coalesce(new.data->'collectionSettings','{}'::jsonb),
    'orderBumps',(select coalesce(jsonb_agg(value-'cost'),'[]'::jsonb) from jsonb_array_elements(coalesce(new.data->'orderBumps','[]'::jsonb)) where value->>'active'='true'),
    'pages', coalesce(new.data->'pages', '[]'::jsonb),
    'storefront', coalesce(new.data->'storefront', '{}'::jsonb),
    'settings', (coalesce(new.data->'settings', '{}'::jsonb) - 'goal')),
    now())
  on conflict (id) do update set data = excluded.data, updated_at = excluded.updated_at;
  return new;
end;
$function$;
