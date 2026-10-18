-- Small, versioned collection edits and an independent navigation document.
-- Authorization remains in the private manager functions and existing app_state RLS.
create function private.validate_navigation(p_navigation jsonb) returns void
language plpgsql set search_path=pg_catalog as $$
declare menu jsonb; item jsonb; slot text; total integer;
begin
 if jsonb_typeof(p_navigation) is distinct from 'object' or octet_length(p_navigation::text)>131072
  or jsonb_typeof(p_navigation->'menus') is distinct from 'array'
  or jsonb_array_length(p_navigation->'menus')>40
  or jsonb_typeof(p_navigation->'locations') is distinct from 'object' then raise exception 'Confira os menus da loja.'; end if;
 if exists(select 1 from jsonb_object_keys(p_navigation) k where k not in ('menus','locations'))
  or exists(select 1 from jsonb_object_keys(p_navigation->'locations') k where k not in ('header','footerAbout','footerHelp')) then raise exception 'Posição de menu inválida.'; end if;
 if (select count(*) from jsonb_array_elements(p_navigation->'menus'))<>
  (select count(distinct value->>'id') from jsonb_array_elements(p_navigation->'menus')) then raise exception 'Identificador de menu repetido.'; end if;
 total:=0;
 for menu in select value from jsonb_array_elements(p_navigation->'menus') loop
  if coalesce(menu->>'id','') !~ '^[A-Za-z0-9_-]{1,80}$' or length(btrim(coalesce(menu->>'name',''))) not between 1 and 80
   or jsonb_typeof(menu->'active') is distinct from 'boolean' or jsonb_typeof(menu->'items') is distinct from 'array' then raise exception 'Confira o nome e os itens do menu.'; end if;
  for item in with recursive entries(node,depth) as (
   select value,1 from jsonb_array_elements(menu->'items')
   union all select child.value,entries.depth+1 from entries cross join lateral jsonb_array_elements(coalesce(entries.node->'children','[]'::jsonb)) child where entries.depth<=3
  ) select jsonb_build_object('node',node,'depth',depth) from entries loop
   total:=total+1;
   if total>500 or (item->>'depth')::integer>3 then raise exception 'Use até 500 links e três níveis de menu.'; end if;
   item:=item->'node';
   if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'id','') !~ '^[A-Za-z0-9_-]{1,80}$'
    or length(btrim(coalesce(item->>'label',''))) not between 1 and 100
    or coalesce(item->>'type','') not in ('home','catalog','collection','product','page','account','cart','checkout','admin','external')
    or jsonb_typeof(item->'children') is distinct from 'array'
    or jsonb_typeof(item->'newTab') is distinct from 'boolean' then raise exception 'Confira o título e o destino de cada link.'; end if;
   if item->>'type' in ('collection','product','page') and length(coalesce(item->>'target','')) not between 1 and 100 then raise exception 'Selecione um destino para o link.'; end if;
   if item->>'type' in ('product','page') and item->>'target' !~ '^[1-9][0-9]{0,9}$' then raise exception 'Destino de link inválido.'; end if;
   if item->>'type'='external' and (length(coalesce(item->>'target',''))>2048 or coalesce(item->>'target','') !~ '^https://[^[:space:]]+$') then raise exception 'Use um endereço completo começando por https://.'; end if;
  end loop;
  if (with recursive entries(node) as (
   select value from jsonb_array_elements(menu->'items') union all
   select child.value from entries cross join lateral jsonb_array_elements(entries.node->'children') child
  ) select count(*)<>count(distinct node->>'id') from entries) then raise exception 'Identificador de link repetido no menu.'; end if;
 end loop;
 foreach slot in array array['header','footerAbout','footerHelp'] loop
  if nullif(p_navigation->'locations'->>slot,'') is not null and not exists (
   select 1 from jsonb_array_elements(p_navigation->'menus') m where m->>'id'=p_navigation->'locations'->>slot
  ) then raise exception 'O menu escolhido para esta posição não existe.'; end if;
 end loop;
end $$;
revoke all on function private.validate_navigation(jsonb) from public,anon,authenticated;

create function private.remap_collection_links(p_items jsonb,p_previous text,p_name text) returns jsonb
language sql immutable set search_path=pg_catalog,private as $$
 select coalesce(jsonb_agg((case when value->>'type'='collection' and value->>'target'=p_previous
  then value||jsonb_build_object('target',p_name,'label',case when value->>'label'=p_previous then p_name else value->>'label' end)
  else value end)||jsonb_build_object('children',private.remap_collection_links(value->'children',p_previous,p_name)) order by ord),'[]'::jsonb)
 from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) with ordinality a(value,ord)
$$;
revoke all on function private.remap_collection_links(jsonb,text,text) from public,anon,authenticated;

create function private.save_collection(p_previous text,p_name text,p_active boolean,p_sort text,p_product_ids jsonb,p_expected_version bigint) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare s public.app_state%rowtype; revised jsonb; cfg jsonb; old_name text:=nullif(p_previous,''); name text:=btrim(p_name); renamed boolean;
begin
 if not private.is_manager() then raise exception 'Somente gerente e conta principal podem editar coleções.'; end if;
 if length(coalesce(name,'')) not between 1 and 100 or p_active is null or coalesce(p_sort,'') not in ('manual','price_asc','price_desc','title_asc','title_desc') then raise exception 'Confira o nome e a ordenação da coleção.'; end if;
 if p_product_ids is not null and (jsonb_typeof(p_product_ids) is distinct from 'array' or jsonb_array_length(p_product_ids)>10000) then raise exception 'Ordem de produtos inválida.'; end if;
 if p_product_ids is not null and (exists(select 1 from jsonb_array_elements_text(p_product_ids) id where id !~ '^[1-9][0-9]{0,9}$')
  or (select count(*)<>count(distinct value) from jsonb_array_elements_text(p_product_ids))) then raise exception 'Ordem de produtos inválida.'; end if;
 select * into s from public.app_state where id=1 for update;
 if s.version is distinct from p_expected_version then raise exception 'O catálogo mudou em outra sessão. Atualize a página antes de salvar.'; end if;
 if old_name is not null and not(s.data->'collections' ? old_name) then raise exception 'Esta coleção não existe mais. Atualize a página.'; end if;
 if exists(select 1 from jsonb_array_elements_text(s.data->'collections') c where c is distinct from old_name and lower(c)=lower(name)) then raise exception 'Já existe uma coleção com esse nome.'; end if;
 revised:=s.data; renamed:=old_name is not null and old_name<>name;
 if old_name is null then revised:=jsonb_set(revised,'{collections}',(revised->'collections')||jsonb_build_array(name));
 elsif renamed then
  revised:=jsonb_set(revised,'{collections}',(select jsonb_agg(case when value=old_name then name else value end order by ord) from jsonb_array_elements_text(revised->'collections') with ordinality a(value,ord)));
  revised:=jsonb_set(revised,'{products}',(select jsonb_agg(case when p->>'category'=old_name or p->'categories' ? old_name then
   p||jsonb_build_object('category',case when p->>'category'=old_name then name else coalesce(p->>'category','') end,'categories',
    (select jsonb_agg(case when value=old_name then name else value end order by ord) from jsonb_array_elements_text(case when jsonb_typeof(p->'categories')='array' then p->'categories' else jsonb_build_array(p->>'category') end) with ordinality a(value,ord))) else p end order by position)
   from jsonb_array_elements(revised->'products') with ordinality x(p,position)));
  revised:=jsonb_set(revised,'{storefront,sections}',(select jsonb_agg(case when value->>'type'='collection' and value->>'category'=old_name then value||jsonb_build_object('category',name) else value end order by ord) from jsonb_array_elements(revised->'storefront'->'sections') with ordinality a(value,ord)));
  if revised->'storefront'->'pageSettings' ? ('collection:'||old_name) then
   revised:=jsonb_set(revised,'{storefront,pageSettings}',((revised->'storefront'->'pageSettings')-('collection:'||old_name))||jsonb_build_object('collection:'||name,revised->'storefront'->'pageSettings'->('collection:'||old_name)));
  end if;
  if revised ? 'navigation' then revised:=jsonb_set(revised,'{navigation,menus}',(select jsonb_agg(value||jsonb_build_object('items',private.remap_collection_links(value->'items',old_name,name)) order by ord) from jsonb_array_elements(revised->'navigation'->'menus') with ordinality a(value,ord))); end if;
 end if;
 cfg:=coalesce(revised->'collectionSettings'->old_name,'{}'::jsonb)||jsonb_build_object('active',p_active,'sort',p_sort);
 if p_product_ids is not null then cfg:=cfg||jsonb_build_object('productIds',p_product_ids); end if;
 revised:=jsonb_set(revised,'{collectionSettings}',(coalesce(revised->'collectionSettings','{}'::jsonb)-coalesce(old_name,name))||jsonb_build_object(name,cfg));
 if revised is distinct from s.data then update public.app_state set data=revised,version=version+1,updated_at=now() where id=1 returning * into s; end if;
 return jsonb_build_object('version',s.version);
end $$;
create function public.save_collection(p_previous text,p_name text,p_active boolean,p_sort text,p_product_ids jsonb,p_expected_version bigint) returns jsonb
language sql security invoker set search_path=pg_catalog,public,private as $$select private.save_collection(p_previous,p_name,p_active,p_sort,p_product_ids,p_expected_version)$$;
revoke all on function private.save_collection(text,text,boolean,text,jsonb,bigint),public.save_collection(text,text,boolean,text,jsonb,bigint) from public,anon,authenticated;
grant execute on function private.save_collection(text,text,boolean,text,jsonb,bigint),public.save_collection(text,text,boolean,text,jsonb,bigint) to authenticated;

create function private.save_navigation(p_navigation jsonb,p_expected jsonb) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare s public.app_state%rowtype;
begin
 if not private.is_manager() then raise exception 'Somente gerente e conta principal podem configurar menus.'; end if;
 perform private.validate_navigation(p_navigation);
 select * into s from public.app_state where id=1 for update;
 if s.data->'navigation' is distinct from p_expected then raise exception 'Os menus mudaram em outra sessão. Cancele o rascunho e revise a versão atual.'; end if;
 if s.data->'navigation' is distinct from p_navigation then
  update public.app_state set data=jsonb_set(data,'{navigation}',p_navigation),version=version+1,updated_at=now() where id=1 returning * into s;
 end if;
 return jsonb_build_object('version',s.version);
end $$;
create function public.save_navigation(p_navigation jsonb,p_expected jsonb) returns jsonb language sql security invoker
set search_path=pg_catalog,public,private as $$select private.save_navigation(p_navigation,p_expected)$$;
revoke all on function private.save_navigation(jsonb,jsonb),public.save_navigation(jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.save_navigation(jsonb,jsonb),public.save_navigation(jsonb,jsonb) to authenticated;

create function private.guard_store_navigation() returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare config jsonb;
begin
 if old.data->'navigation' is distinct from new.data->'navigation' then
  if auth.uid() is not null and not private.is_manager() then raise exception 'Somente gerente e conta principal podem configurar menus.'; end if;
  perform private.validate_navigation(new.data->'navigation');
 end if;
 if old.data->'collectionSettings' is distinct from new.data->'collectionSettings' then
  for config in select value from jsonb_each(coalesce(new.data->'collectionSettings','{}'::jsonb)) loop
   if config ? 'sort' and coalesce(config->>'sort','') not in ('manual','price_asc','price_desc','title_asc','title_desc') then raise exception 'Ordenação de coleção inválida.'; end if;
  end loop;
 end if;
 return new;
end $$;
revoke all on function private.guard_store_navigation() from public,anon,authenticated;
create trigger guard_store_navigation before update of data on public.app_state for each row execute function private.guard_store_navigation();

-- Metadata edits reuse the public product projection; product/order edits rebuild stock.
create or replace function private.publish_catalog() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare public_products jsonb; metadata jsonb;
begin
 metadata:=jsonb_build_object('collections',coalesce(new.data->'collections','[]'::jsonb),'collectionSettings',coalesce(new.data->'collectionSettings','{}'::jsonb),
  'navigation',coalesce(new.data->'navigation','{}'::jsonb),'orderBumps',(select coalesce(jsonb_agg(value-'cost'),'[]'::jsonb) from jsonb_array_elements(coalesce(new.data->'orderBumps','[]'::jsonb)) where value->>'active'='true'),
  'pages',coalesce(new.data->'pages','[]'::jsonb),'storefront',coalesce(new.data->'storefront','{}'::jsonb),'settings',coalesce(new.data->'settings','{}'::jsonb)-'goal');
 if tg_op='UPDATE' and old.data->'products' is not distinct from new.data->'products' and old.data->'orders' is not distinct from new.data->'orders' then
  update public.shop_public set data=data||metadata,updated_at=now() where id=1;
  if found then return new; end if;
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

-- Preserve the current storefront navigation as the initial editable menus.
update public.app_state set data=jsonb_set(data,'{navigation}',jsonb_build_object('locations',jsonb_build_object('header','main-menu','footerAbout','footer-about','footerHelp','footer-help'),'menus',jsonb_build_array(
 jsonb_build_object('id','main-menu','name','Menu principal','active',true,'items',jsonb_build_array(jsonb_build_object('id','all-products','label','Todos os móveis','type','catalog','target','','children','[]'::jsonb,'newTab',false))||
  (select coalesce(jsonb_agg(jsonb_build_object('id','collection-'||ord,'label',value,'type','collection','target',value,'children','[]'::jsonb,'newTab',false) order by ord),'[]'::jsonb) from jsonb_array_elements_text(data->'collections') with ordinality c(value,ord))),
 jsonb_build_object('id','footer-about','name','Sobre a loja','active',true,'items',(select coalesce(jsonb_agg(jsonb_build_object('id','page-'||(value->>'id'),'label',value->>'title','type','page','target',value->>'id','children','[]'::jsonb,'newTab',false) order by ord),'[]'::jsonb) from jsonb_array_elements(data->'pages') with ordinality p(value,ord) where value->>'active'='true')),
 jsonb_build_object('id','footer-help','name','Conte com a gente','active',true,'items','[{"id":"my-orders","label":"Acompanhar meus pedidos","type":"account","target":"","children":[],"newTab":false},{"id":"admin-panel","label":"Acessar o sistema da loja","type":"admin","target":"","children":[],"newTab":false}]'::jsonb)
))),version=version+1,updated_at=now() where id=1 and not(data ? 'navigation');
