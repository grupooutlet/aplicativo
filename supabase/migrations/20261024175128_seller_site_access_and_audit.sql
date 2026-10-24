-- Sellers edit storefront configuration through bounded RPCs; operational costs stay private.
create or replace function private.can_edit_site() returns boolean language sql stable security definer
set search_path=pg_catalog,private,public as $$ select private.is_manager() or private.is_seller() $$;
revoke all on function private.can_edit_site() from public,anon,authenticated;
grant execute on function private.can_edit_site() to authenticated;

create or replace function private.seller_catalog_changes(p_changes jsonb,p_state jsonb)
returns jsonb language plpgsql set search_path=pg_catalog,public,private as $$
declare p jsonb; prior jsonb; offer jsonb; products jsonb:='[]'; offers jsonb:='[]';
begin
 if exists(select 1 from jsonb_object_keys(p_changes) k where k not in ('products','collections','collectionSettings','orderBumps','storefront')) then raise exception 'O vendedor pode configurar coleções e ofertas, sem alterar os dados internos do catálogo.'; end if;
 if p_changes ? 'products' then
  if jsonb_typeof(p_changes->'products') is distinct from 'array' or jsonb_array_length(p_changes->'products')<>jsonb_array_length(p_state->'products') then raise exception 'O vendedor não pode criar ou excluir produtos.'; end if;
  if (select count(*) from jsonb_array_elements(p_changes->'products'))<>(select count(distinct value->>'id') from jsonb_array_elements(p_changes->'products')) then raise exception 'Produto repetido.'; end if;
  for p in select value from jsonb_array_elements(p_changes->'products') loop
   select value into prior from jsonb_array_elements(p_state->'products') where value->>'id'=p->>'id';
   if prior is null or (p-'cost'-'category'-'categories') is distinct from (prior-'cost'-'category'-'categories') then raise exception 'O vendedor pode alterar apenas as coleções dos produtos.'; end if;
   products:=products||jsonb_build_array(prior||jsonb_build_object('category',p->'category','categories',p->'categories'));
  end loop;
  p_changes:=jsonb_set(p_changes,'{products}',products);
 end if;
 if p_changes ? 'orderBumps' then
  if jsonb_typeof(p_changes->'orderBumps') is distinct from 'array' then raise exception 'Ofertas inválidas.'; end if;
  for offer in select value from jsonb_array_elements(p_changes->'orderBumps') loop
   select value into prior from jsonb_array_elements(coalesce(p_state->'orderBumps','[]')) where value->>'id'=offer->>'id';
   offers:=offers||jsonb_build_array((offer-'cost')||jsonb_build_object('cost',coalesce(prior->'cost','0'::jsonb)));
  end loop;
  p_changes:=jsonb_set(p_changes,'{orderBumps}',offers);
 end if;
 return p_changes;
end $$;
revoke all on function private.seller_catalog_changes(jsonb,jsonb) from public,anon,authenticated;

create or replace function private.save_site_section(p_section text,p_value jsonb,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare s public.app_state%rowtype; previous jsonb; revised jsonb; page jsonb;
begin
 if not private.can_edit_site() then raise exception 'Acesso restrito à equipe autorizada a configurar a loja.'; end if;
 select * into s from public.app_state where id=1 for update;
 if p_section='paymentMethods' then previous:=s.data->'settings'->'paymentMethods';
 elsif p_section='pages' then previous:=s.data->'pages';
 elsif p_section='store' then select coalesce(jsonb_object_agg(key,value),'{}') into previous from jsonb_each(s.data->'settings') where key in ('name','phone','address','addressParts');
 else raise exception 'Configuração não permitida.'; end if;
 if previous is distinct from p_expected then raise exception 'Esta configuração mudou em outra sessão. Atualize a página antes de salvar.'; end if;
 if p_section='pages' then
  if jsonb_typeof(p_value) is distinct from 'array' or jsonb_array_length(p_value)>500 then raise exception 'Páginas inválidas.'; end if;
  if (select count(*) from jsonb_array_elements(p_value))<>(select count(distinct value->>'id') from jsonb_array_elements(p_value)) then raise exception 'Página repetida.'; end if;
  for page in select value from jsonb_array_elements(p_value) loop
   if coalesce(page->>'id','') !~ '^[1-9][0-9]{0,15}$' or length(trim(coalesce(page->>'title',''))) not between 1 and 160 or length(trim(coalesce(page->>'content',''))) not between 1 and 50000 or jsonb_typeof(page->'active') is distinct from 'boolean' then raise exception 'Confira o título, o conteúdo e a visibilidade da página.'; end if;
  end loop;
  revised:=jsonb_set(s.data,'{pages}',p_value);
 elsif p_section='store' then
  if jsonb_typeof(p_value) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_value) k where k not in ('name','phone','address','addressParts'))
   or length(trim(coalesce(p_value->>'name',''))) not between 1 and 120 or length(coalesce(p_value->>'address',''))>500
   or (coalesce(p_value->>'phone','')<>'' and regexp_replace(p_value->>'phone','[^0-9]','','g') !~ '^55[0-9]{10,11}$')
   or jsonb_typeof(p_value->'addressParts') is distinct from 'object' or octet_length((p_value->'addressParts')::text)>10000 then raise exception 'Confira os dados da loja.'; end if;
  revised:=jsonb_set(s.data,'{settings}',(s.data->'settings')||p_value);
 else revised:=jsonb_set(s.data,'{settings,paymentMethods}',p_value); end if;
 if revised is distinct from s.data then update public.app_state set data=revised,version=version+1,updated_at=now() where id=1 returning * into s; end if;
 return jsonb_build_object('version',s.version);
end $$;
create or replace function public.save_site_section(p_section text,p_value jsonb,p_expected jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog,private as $$ select private.save_site_section(p_section,p_value,p_expected) $$;
revoke all on function private.save_site_section(text,jsonb,jsonb),public.save_site_section(text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.save_site_section(text,jsonb,jsonb),public.save_site_section(text,jsonb,jsonb) to authenticated;

-- Sellers may add new banner assets; replacing/removing historical product files stays restricted.
alter policy "Sellers cannot upload product photos" on storage.objects with check
 (bucket_id<>'product-photos' or not (select private.is_seller()) or starts_with(name,'storefront/'));
CREATE OR REPLACE FUNCTION private.guard_merchandising_access()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
 if auth.uid() is not null and not private.can_edit_site() and
  (old.data->'orderBumps' is distinct from new.data->'orderBumps' or old.data->'collectionSettings' is distinct from new.data->'collectionSettings') then
  raise exception 'Somente a equipe autorizada podem configurar coleções e ofertas.';
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION private.guard_payment_methods()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare method jsonb; option jsonb;
begin
  if old.data->'settings'->'paymentMethods' is not distinct from new.data->'settings'->'paymentMethods' then return new; end if;
  if auth.uid() is not null and not private.can_edit_site() then raise exception 'Somente a equipe autorizada configuram pagamentos.'; end if;
  if jsonb_typeof(new.data->'settings'->'paymentMethods') is distinct from 'array' then raise exception 'Pagamentos inválidos.'; end if;
  if jsonb_array_length(new.data->'settings'->'paymentMethods')<>4 or exists(select 1 from jsonb_array_elements(new.data->'settings'->'paymentMethods') group by value->>'kind' having count(*)>1) or exists(select 1 from jsonb_array_elements(new.data->'settings'->'paymentMethods') group by value->>'id' having count(*)>1) then raise exception 'Pagamento repetido.'; end if;
  for method in select value from jsonb_array_elements(new.data->'settings'->'paymentMethods') loop
    if length(coalesce(method->>'id','')) not between 1 and 80 or length(trim(coalesce(method->>'title',''))) not between 1 and 60
      or coalesce(method->>'kind','') not in ('pix','credit','debit','cash')
      or jsonb_typeof(method->'active') is distinct from 'boolean'
      or jsonb_typeof(method->'installments') is distinct from 'array'
      or jsonb_array_length(method->'installments') not between 1 and 24 or (method->>'kind'<>'credit' and jsonb_array_length(method->'installments')<>1) then raise exception 'Confira os dados do pagamento.'; end if;
    if exists(select 1 from jsonb_array_elements(method->'installments') group by value->>'count' having count(*)>1) then raise exception 'Parcelamento repetido.'; end if;
    for option in select value from jsonb_array_elements(method->'installments') loop
      if coalesce(option->>'count','') !~ '^[0-9]+$' or (option->>'count')::integer not between 1 and 24
        or (method->>'kind'<>'credit' and (option->>'count')::integer<>1)
        or coalesce(option->>'rate','') !~ '^[0-9]{1,3}([.][0-9]{1,2})?$' or (option->>'rate')::numeric>100 or (method->>'kind'<>'credit' and (option->>'rate')::numeric<>0) then raise exception 'Parcelas ou taxas inválidas.'; end if;
    end loop;
  end loop;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_shipping_options()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if old.data->'settings'->'shippingOptions' is distinct from new.data->'settings'->'shippingOptions'
    or old.data->'settings'->'shippingMode' is distinct from new.data->'settings'->'shippingMode' then
    if auth.uid() is not null and not private.can_edit_site() then raise exception 'Somente a equipe autorizada pode configurar os fretes.'; end if;
    if old.data->'settings'->>'shippingMode'='regional' and new.data->'settings'->>'shippingMode' is distinct from 'regional' then raise exception 'A entrega deve continuar configurada por região.'; end if;
    if new.data->'settings'->>'shippingMode'='regional' then perform private.validate_regional_shipping(new.data->'settings'->'shippingOptions'); end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_store_navigation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare config jsonb;
begin
 if old.data->'navigation' is distinct from new.data->'navigation' then
  if auth.uid() is not null and not private.can_edit_site() then raise exception 'Somente a equipe autorizada podem configurar menus.'; end if;
  perform private.validate_navigation(new.data->'navigation');
 end if;
 if old.data->'collectionSettings' is distinct from new.data->'collectionSettings' then
  for config in select value from jsonb_each(coalesce(new.data->'collectionSettings','{}'::jsonb)) loop
   if config ? 'sort' and coalesce(config->>'sort','') not in ('manual','price_asc','price_desc','title_asc','title_desc') then raise exception 'Ordenação de coleção inválida.'; end if;
  end loop;
 end if;
 return new;
end $function$;

CREATE OR REPLACE FUNCTION private.guard_storefront_configuration()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
begin
  if old.data->'storefront' is distinct from new.data->'storefront' and auth.uid() is not null and not private.can_edit_site() then
    raise exception 'Somente a equipe autorizada pode alterar a loja online.';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.save_navigation(p_navigation jsonb, p_expected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare s public.app_state%rowtype;
begin
 if not private.can_edit_site() then raise exception 'Somente a equipe autorizada podem configurar menus.'; end if;
 perform private.validate_navigation(p_navigation);
 select * into s from public.app_state where id=1 for update;
 if s.data->'navigation' is distinct from p_expected then raise exception 'Os menus mudaram em outra sessão. Cancele o rascunho e revise a versão atual.'; end if;
 if s.data->'navigation' is distinct from p_navigation then
  update public.app_state set data=jsonb_set(data,'{navigation}',p_navigation),version=version+1,updated_at=now() where id=1 returning * into s;
 end if;
 return jsonb_build_object('version',s.version);
end $function$;

CREATE OR REPLACE FUNCTION private.save_storefront(p_storefront jsonb, p_expected jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare s public.app_state%rowtype; section jsonb;
begin
  if not private.can_edit_site() then raise exception 'Somente a equipe autorizada pode publicar a loja.'; end if;
  if jsonb_typeof(p_storefront) is distinct from 'object' or octet_length(p_storefront::text)>25165824
    or jsonb_typeof(p_storefront->'sections') is distinct from 'array'
    or jsonb_array_length(p_storefront->'sections') not between 1 and 80
    or jsonb_typeof(p_storefront->'announcement') is distinct from 'object'
    or (p_storefront?'pageSettings' and jsonb_typeof(p_storefront->'pageSettings') is distinct from 'object') then
    raise exception 'Confira as configurações da loja. O limite total de imagens e textos é de 24 MB.';
  end if;
  if exists(select 1 from jsonb_object_keys(p_storefront) k where k not in ('sections','announcement','pageSettings')) then raise exception 'Configuração da loja inválida.'; end if;
  for section in select value from jsonb_array_elements(p_storefront->'sections') loop
    if jsonb_typeof(section) is distinct from 'object' or coalesce(section->>'id','') !~ '^[A-Za-z0-9_-]{1,90}$'
      or coalesce(section->>'type','') not in ('banner','collection','image','video','text','benefits')
      or jsonb_typeof(section->'enabled') is distinct from 'boolean'
      or (section?'showText' and jsonb_typeof(section->'showText') is distinct from 'boolean') then raise exception 'Confira as seções da loja.'; end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_storefront->'sections'))<>
    (select count(distinct value->>'id') from jsonb_array_elements(p_storefront->'sections')) then raise exception 'As seções precisam de identificadores diferentes.'; end if;
  select * into s from public.app_state where id=1 for update;
  if s.data->'storefront' is distinct from p_expected then raise exception 'A loja foi alterada em outra sessão. Cancele o rascunho e revise a versão atual antes de salvar.'; end if;
  update public.app_state set data=jsonb_set(s.data,'{storefront}',p_storefront),version=version+1,updated_at=now() where id=1;
end;
$function$;

CREATE OR REPLACE FUNCTION private.save_shipping_settings(p_options jsonb, p_expected jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare s public.app_state%rowtype; current_settings jsonb; updated_version bigint;
begin
  if not private.can_edit_site() then raise exception 'Acesso restrito à conta principal e gerentes.'; end if;
  perform private.validate_regional_shipping(p_options);
  select * into s from public.app_state where id=1 for update;
  current_settings:=jsonb_build_object('mode',s.data->'settings'->'shippingMode','options',s.data->'settings'->'shippingOptions');
  if current_settings is distinct from p_expected then raise exception 'Os fretes foram alterados por outra pessoa. Atualize a página antes de salvar.'; end if;
  update public.app_state set data=jsonb_set(s.data,'{settings}',(s.data->'settings')||jsonb_build_object('shippingMode','regional','shippingOptions',p_options)),version=version+1,updated_at=now() where id=1 returning version into updated_version;
  return jsonb_build_object('version',updated_version);
end;
$function$;

CREATE OR REPLACE FUNCTION private.save_collection(p_previous text, p_name text, p_active boolean, p_sort text, p_product_ids jsonb, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare s public.app_state%rowtype; revised jsonb; cfg jsonb; old_name text:=nullif(p_previous,''); name text:=btrim(p_name); renamed boolean;
begin
 if not private.can_edit_site() then raise exception 'Somente a equipe autorizada podem editar coleções.'; end if;
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
end $function$;

CREATE OR REPLACE FUNCTION private.save_catalog(p_changes jsonb, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare s public.app_state%rowtype; revised jsonb; p jsonb; prior jsonb; offer jsonb; memberships jsonb; prior_products jsonb; diff integer; moves jsonb;
begin
 if not private.can_edit_site() then raise exception 'Somente gerente e conta principal podem editar o catálogo.'; end if;
 if jsonb_typeof(p_changes) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_changes) k where k not in ('products','collections','collectionSettings','orderBumps','attributeCatalog','nextProductId','storefront')) then raise exception 'Alterações de catálogo inválidas.'; end if;
 select * into s from public.app_state where id=1 for update;
 if private.is_seller() then p_changes:=private.seller_catalog_changes(p_changes,s.data); end if;
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
end $function$;

CREATE OR REPLACE FUNCTION private.sales_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare s public.app_state%rowtype; projection jsonb;
begin
  if not private.is_seller() then raise exception 'Acesso restrito aos vendedores.'; end if;
  select * into s from public.app_state where id=1;
  projection:=jsonb_build_object(
    'products',(select coalesce(jsonb_agg(value-'cost'),'[]'::jsonb) from jsonb_array_elements(s.data->'products')),
    'orders',(select coalesce(jsonb_agg((o-'guest_token'-'guestToken'-'cost'-'profit')||jsonb_build_object('items',
      (select coalesce(jsonb_agg(value-'cost'),'[]'::jsonb) from jsonb_array_elements(o->'items')))),'[]'::jsonb)
      from jsonb_array_elements(s.data->'orders') ord(o)),
    'movements',coalesce(s.data->'movements','[]'::jsonb),'team','[]'::jsonb,
    'collectionSettings',coalesce(s.data->'collectionSettings','{}'),
    'collections',s.data->'collections','pages',s.data->'pages','storefront',s.data->'storefront',
    'navigation',s.data->'navigation','orderBumps',(select coalesce(jsonb_agg(value-'cost'),'[]') from jsonb_array_elements(coalesce(s.data->'orderBumps','[]'))),
    'settings',(s.data->'settings')-'goal');
  return jsonb_build_object('data',projection,'version',s.version);
end;
$function$;
-- Included in the versioned migration. No snapshots of credentials or auth.users are recorded.
create table private.change_history (
 id bigint generated always as identity primary key,
 transaction_id bigint not null unique,
 created_at timestamptz not null default clock_timestamp(),
 actor_id uuid, actor_name text not null, actor_role text, actor_position text,
 areas text[] not null default '{}', summary text not null default '',
 changes jsonb not null check(jsonb_typeof(changes)='array'),
 reversal_of bigint references private.change_history(id),
 reverted_at timestamptz, reverted_by uuid, reverted_by_name text,
 reversal_id bigint references private.change_history(id)
);
alter table private.change_history enable row level security;
revoke all on private.change_history from public,anon,authenticated;
create policy "Management reads change history" on private.change_history for select to authenticated using ((select private.is_manager()));
create index change_history_areas_idx on private.change_history using gin(areas);
create index change_history_actor_idx on private.change_history(actor_id,id desc);

create function private.audit_array_changes(p_before jsonb,p_after jsonb,p_path text[])
returns jsonb language sql immutable set search_path=pg_catalog as $$
 with before_rows as (select value,ord from jsonb_array_elements(coalesce(p_before,'[]')) with ordinality b(value,ord)),
 after_rows as (select value,ord from jsonb_array_elements(coalesce(p_after,'[]')) with ordinality a(value,ord)),
 joined as (select b.value b,a.value a,b.ord bo,a.ord ao from before_rows b full join after_rows a on b.value->>'id'=a.value->>'id')
 select coalesce(jsonb_agg(jsonb_build_object('source','state','kind','entity','path',to_jsonb(p_path),'entityId',coalesce(a->>'id',b->>'id'),
   'before',b,'after',a,'beforeExists',b is not null,'afterExists',a is not null,'beforeIndex',coalesce(bo-1,0),'afterIndex',coalesce(ao-1,0)) order by coalesce(ao,bo)),'[]')
 from joined where b is distinct from a
$$;

create function private.audit_state_changes(p_before jsonb,p_after jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,private as $$
declare changes jsonb:='[]'; k text; sub text; b jsonb; a jsonb; path text[]; has_ids boolean;
begin
 for k in select key from (select jsonb_object_keys(p_before) key union select jsonb_object_keys(p_after)) keys loop
  if p_before->k is not distinct from p_after->k then continue; end if;
  if k in ('settings','collectionSettings') then
   for sub in select key from (select jsonb_object_keys(coalesce(p_before->k,'{}')) key union select jsonb_object_keys(coalesce(p_after->k,'{}'))) keys loop
    b:=p_before->k->sub;a:=p_after->k->sub;if b is not distinct from a then continue; end if;path:=array[k,sub];
    if k='settings' and sub in ('shippingOptions','paymentMethods') and jsonb_typeof(coalesce(b,'[]'))='array' and jsonb_typeof(coalesce(a,'[]'))='array' then
     changes:=changes||private.audit_array_changes(b,a,path);
    else changes:=changes||jsonb_build_array(jsonb_build_object('source','state','kind','value','path',to_jsonb(path),'before',b,'after',a,'beforeExists',b is not null,'afterExists',a is not null));end if;
   end loop;
  else
   b:=p_before->k;a:=p_after->k;path:=array[k];has_ids:=false;
   if k in ('products','orders','movements','pages','orderBumps','attributeCatalog') and jsonb_typeof(coalesce(b,'[]'))='array' and jsonb_typeof(coalesce(a,'[]'))='array' then
    select not exists(select 1 from jsonb_array_elements(coalesce(b,'[]')||coalesce(a,'[]')) v where jsonb_typeof(v)<>'object' or v->>'id' is null) into has_ids;
   end if;
   if has_ids then changes:=changes||private.audit_array_changes(b,a,path);
   else changes:=changes||jsonb_build_array(jsonb_build_object('source','state','kind','value','path',to_jsonb(path),'before',b,'after',a,'beforeExists',b is not null,'afterExists',a is not null));end if;
  end if;
 end loop;
 return changes;
end $$;

create function private.merge_audit_changes(p_previous jsonb,p_latest jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare result jsonb:=p_previous; c jsonb; prior jsonb; idx integer;
begin
 for c in select value from jsonb_array_elements(p_latest) loop
  select value,ord-1 into prior,idx from jsonb_array_elements(result) with ordinality x(value,ord)
   where value->>'source'=c->>'source' and value->'path' is not distinct from c->'path' and value->>'entityId' is not distinct from c->>'entityId';
  if found then
   c:=c||jsonb_build_object('before',prior->'before','beforeExists',prior->'beforeExists','beforeIndex',prior->'beforeIndex');
   result:=jsonb_set(result,array[idx::text],c);
  else result:=result||jsonb_build_array(c);end if;
 end loop;
 return (select coalesce(jsonb_agg(value order by ord),'[]') from jsonb_array_elements(result) with ordinality x(value,ord)
   where value->'before' is distinct from value->'after' or value->'beforeExists' is distinct from value->'afterExists');
end $$;

create function private.audit_change_area(p_change jsonb) returns text language sql immutable set search_path=pg_catalog as $$
 select case when p_change->>'source'<>'state' then p_change->>'source'
 when p_change->'path'->>0='settings' and p_change->'path'->>1 in ('shippingOptions','paymentMethods') then p_change->'path'->>1
 else p_change->'path'->>0 end
$$;
create function private.audit_change_label(p_change jsonb) returns text language sql immutable set search_path=pg_catalog as $$
 select case when p_change->>'source'='profiles' then 'Perfil · '||coalesce(p_change->'after'->>'name',p_change->'before'->>'name','Conta')
 when p_change->>'source'='customer_contacts' then 'Cliente · '||coalesce(p_change->'after'->>'name',p_change->'before'->>'name','Cadastro')
 when p_change->'path'->>0='orders' then 'Pedido #'||coalesce(p_change->>'entityId','')
 when p_change->'path'->>0='movements' then 'Estoque · '||coalesce(p_change->'after'->>'product',p_change->'before'->>'product','Movimentação')
 when p_change->>'kind'='entity' then coalesce(p_change->'after'->>'title',p_change->'after'->>'name',p_change->'before'->>'title',p_change->'before'->>'name','Registro')
 when p_change->'path'->>0='collectionSettings' then 'Coleção · '||(p_change->'path'->>1)
 else case p_change->'path'->>0 when 'storefront' then 'Layout da loja' when 'navigation' then 'Menus da loja' when 'collections' then 'Lista de coleções'
 when 'settings' then case p_change->'path'->>1 when 'name' then 'Nome da loja' when 'phone' then 'WhatsApp da loja' when 'address' then 'Endereço da loja' when 'addressParts' then 'Endereço da loja' when 'goal' then 'Meta da loja' else 'Configurações da loja' end
 when 'attributeCatalog' then 'Variações dos produtos' else 'Configuração da loja' end end
$$;

create function private.record_change_history(p_changes jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare who public.profiles%rowtype; event_id bigint; merged jsonb; first_change jsonb; action text; reversal text;
begin
 if jsonb_array_length(p_changes)=0 then return; end if;
 select * into who from public.profiles where user_id=auth.uid();
 reversal:=current_setting('app.history_reversal',true);
 insert into private.change_history(transaction_id,actor_id,actor_name,actor_role,actor_position,changes,reversal_of)
 values(txid_current(),auth.uid(),coalesce(nullif(who.name,''),'Sistema / loja online'),coalesce(who.role,'system'),who.position,p_changes,
   case when private.is_manager() and reversal ~ '^[0-9]+$' then reversal::bigint end)
 on conflict(transaction_id) do update set changes=private.merge_audit_changes(private.change_history.changes,excluded.changes)
 returning id,changes into event_id,merged;
 if jsonb_array_length(merged)=0 then update private.change_history set areas='{}',summary='Sem alterações' where id=event_id;return;end if;
 first_change:=merged->0;
 action:=case when reversal ~ '^[0-9]+$' then 'Reverteu: ' when first_change->>'beforeExists'='false' then 'Criou: ' when first_change->>'afterExists'='false' then 'Excluiu: ' else 'Alterou: ' end;
 update private.change_history set areas=(select array_agg(distinct private.audit_change_area(c)) from jsonb_array_elements(merged) c),
 summary=action||private.audit_change_label(first_change)||case when jsonb_array_length(merged)>1 then ' e mais '||(jsonb_array_length(merged)-1)||' registro(s)' else '' end where id=event_id;
end $$;

create function private.capture_state_history() returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
begin perform private.record_change_history(private.audit_state_changes(case when tg_op='INSERT' then '{}'::jsonb else old.data end,new.data));return new;end $$;
create trigger record_state_history after insert or update of data on public.app_state for each row execute function private.capture_state_history();
create function private.capture_profile_history() returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
declare b jsonb; a jsonb; key text;
begin
 b:=case when tg_op='INSERT' then null else to_jsonb(old) end;a:=case when tg_op='DELETE' then null else to_jsonb(new) end;
 if b is not distinct from a then if tg_op='DELETE' then return old;else return new;end if;end if;
 key:=case when tg_table_name='profiles' then 'user_id' else 'id' end;
 perform private.record_change_history(jsonb_build_array(jsonb_build_object('source',tg_table_name,'kind','row','entityId',coalesce(a->>key,b->>key),'before',b,'after',a,'beforeExists',b is not null,'afterExists',a is not null)));
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger record_profile_history after insert or update or delete on public.profiles for each row execute function private.capture_profile_history();
create trigger record_customer_history after insert or update or delete on public.customer_contacts for each row execute function private.capture_profile_history();

create function private.history_visible(p_changes jsonb) returns boolean language sql stable security definer set search_path=pg_catalog,public,private as $$
 select private.is_manager() and (private.is_master() or not exists(select 1 from jsonb_array_elements(p_changes) c where c->>'source'='profiles' and
 (c->'before'->>'role'='master' or c->'after'->>'role'='master' or c->>'entityId'=(select user_id::text from private.master_account where singleton=1))))
$$;
create function private.history_revert_reason(p_changes jsonb) returns text language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
declare c jsonb;
begin
 for c in select value from jsonb_array_elements(p_changes) loop
  if c->>'source'='profiles' then
   if c->>'beforeExists'='false' then return 'A criação de uma conta de acesso não é desfeita pelo histórico. Gerencie esse perfil em Clientes ou Equipe.';end if;
   if not exists(select 1 from auth.users where id::text=c->>'entityId') then return 'A conta de acesso foi removida. Não é possível restaurar suas credenciais pelo histórico.';end if;
  end if;
 end loop;
 return null;
end $$;

create function private.list_change_history(p_before bigint default null,p_area text default null,p_query text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
declare result jsonb; next_id bigint;
begin
 if not private.is_manager() then raise exception 'O histórico é reservado à conta principal e aos gerentes.';end if;
 if length(coalesce(p_query,''))>120 then raise exception 'Busca muito longa.';end if;
 with matches as (select * from private.change_history h where (p_before is null or h.id<p_before)
 and jsonb_array_length(h.changes)>0 and private.history_visible(h.changes)
 and (nullif(p_area,'') is null or h.areas @> array[p_area]) and (nullif(p_query,'') is null or h.actor_name ilike '%'||p_query||'%' or h.summary ilike '%'||p_query||'%') order by h.id desc limit 26),
 page as (select * from matches order by id desc limit 25)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,'actor_name',actor_name,'actor_role',actor_role,'actor_position',actor_position,'summary',summary,'areas',areas,'change_count',jsonb_array_length(changes),'reversal_of',reversal_of,'reverted_at',reverted_at,'reverted_by_name',reverted_by_name) order by id desc),'[]'),
 case when (select count(*) from matches)>25 then min(id) end into result,next_id from page;
 return jsonb_build_object('entries',result,'next_cursor',next_id);
end $$;
create function private.change_history_detail(p_id bigint) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
declare h private.change_history%rowtype; reason text; patches jsonb;
begin
 if not private.is_manager() then raise exception 'Acesso restrito à gestão.';end if;
 select * into h from private.change_history where id=p_id;
 if not found or not private.history_visible(h.changes) then raise exception 'Alteração não encontrada.';end if;
 reason:=private.history_revert_reason(h.changes);
 select coalesce(jsonb_agg(c||jsonb_build_object('label',private.audit_change_label(c)) order by ord),'[]') into patches from jsonb_array_elements(h.changes) with ordinality x(c,ord);
 return jsonb_build_object('id',h.id,'created_at',h.created_at,'actor_name',h.actor_name,'summary',h.summary,'changes',patches,'reverted_at',h.reverted_at,'reverted_by_name',h.reverted_by_name,'can_revert',h.reverted_at is null and reason is null,'revert_reason',reason);
end $$;

create function private.audit_restore_entity(p_data jsonb,p_change jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare path text[]; current_array jsonb; restored jsonb:='[]'; v jsonb; position integer:=0; inserted boolean:=false;
begin
 select array_agg(value order by ord) into path from jsonb_array_elements_text(p_change->'path') with ordinality x(value,ord);
 current_array:=coalesce(p_data#>path,'[]');
 for v in select value from jsonb_array_elements(current_array) where value->>'id' is distinct from p_change->>'entityId' loop
  if p_change->>'beforeExists'='true' and position=(p_change->>'beforeIndex')::integer then restored:=restored||jsonb_build_array(p_change->'before');inserted:=true;end if;
  restored:=restored||jsonb_build_array(v);position:=position+1;
 end loop;
 if p_change->>'beforeExists'='true' and not inserted then restored:=restored||jsonb_build_array(p_change->'before');end if;
 return jsonb_set(p_data,path,restored,true);
end $$;
create function private.is_history_reversal() returns boolean language sql stable security definer set search_path=pg_catalog,private as $$
 select private.is_manager() and coalesce(current_setting('app.history_reversal',true),'') ~ '^[0-9]+$'
$$;

create function private.revert_change_history(p_id bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare h private.change_history%rowtype; s public.app_state%rowtype; revised jsonb; c jsonb; current_value jsonb; exists_now boolean; path text[]; reason text; key text; cols text; setters text; restored_row jsonb; actor_name text; old_marker text; result_id bigint;
begin
 if not private.is_manager() then raise exception 'Somente a conta principal e gerentes podem reverter alterações.';end if;
 select * into s from public.app_state where id=1 for update;
 select * into h from private.change_history where id=p_id for update;
 if not found or not private.history_visible(h.changes) then raise exception 'Alteração não encontrada.';end if;
 if h.reverted_at is not null then raise exception 'Esta alteração já foi revertida.';end if;
 reason:=private.history_revert_reason(h.changes);if reason is not null then raise exception '%',reason;end if;
 revised:=s.data;
 -- Check every affected record before writing any of them.
 for c in select value from jsonb_array_elements(h.changes) loop
  if c->>'source'='state' then
   select array_agg(value order by ord) into path from jsonb_array_elements_text(c->'path') with ordinality x(value,ord);
   if c->>'kind'='entity' then select value into current_value from jsonb_array_elements(coalesce(s.data#>path,'[]')) where value->>'id'=c->>'entityId';
   else current_value:=s.data#>path;end if;
  elsif c->>'source' in ('profiles','customer_contacts') then
   key:=case when c->>'source'='profiles' then 'user_id' else 'id' end;
   execute format('select to_jsonb(t) from public.%I t where %I::text=$1 for update',c->>'source',key) into current_value using c->>'entityId';
   if c->>'source'='profiles' and (c->'before'->>'role'='master' or c->'after'->>'role'='master') and not private.is_master() then raise exception 'Esta alteração pertence à conta principal.';end if;
  else raise exception 'Tipo de alteração não suportado.';end if;
  exists_now:=current_value is not null;
  if exists_now is distinct from (c->>'afterExists')::boolean or (exists_now and current_value is distinct from c->'after') then raise exception 'Este registro foi alterado novamente: %. Revise as alterações mais recentes antes de reverter.',private.audit_change_label(c);end if;
 end loop;
 old_marker:=current_setting('app.history_reversal',true);perform set_config('app.history_reversal',p_id::text,true);
 for c in select value from jsonb_array_elements(h.changes) loop
  if c->>'source'='state' then
   select array_agg(value order by ord) into path from jsonb_array_elements_text(c->'path') with ordinality x(value,ord);
   if c->>'kind'='entity' then revised:=private.audit_restore_entity(revised,c);
   elsif c->>'beforeExists'='true' then revised:=jsonb_set(revised,path,c->'before',true);
   else revised:=revised#-path;end if;
  end if;
 end loop;
 -- Later orders must not be orphaned or left with more reservations than physical stock.
 if exists(select 1 from jsonb_array_elements(coalesce(revised->'orders','[]')) o cross join lateral jsonb_array_elements(o->'items') i
  where o->>'status' in ('pending','ready','transit') and coalesce(i->>'stockTracked','true')<>'false'
    and not exists(select 1 from jsonb_array_elements(revised->'products') p where p->>'id'=i->>'id')) then raise exception 'Há pedidos em andamento usando um produto desta alteração. Resolva esses pedidos antes de reverter.';end if;
 if exists(select 1 from jsonb_array_elements(revised->'products') p where (p->>'stock')::integer<
  (select coalesce(sum((i->>'qty')::integer),0) from jsonb_array_elements(coalesce(revised->'orders','[]')) o cross join lateral jsonb_array_elements(o->'items') i where o->>'status' in ('pending','ready') and i->>'id'=p->>'id')) then raise exception 'A reversão deixaria o estoque abaixo das reservas atuais.';end if;
 for c in select value from jsonb_array_elements(h.changes) where value->>'source'<>'state' loop
   key:=case when c->>'source'='profiles' then 'user_id' else 'id' end;
   if c->>'beforeExists'='false' then execute format('delete from public.%I where %I::text=$1',c->>'source',key) using c->>'entityId';
   else
    restored_row:=c->'before';
    if c->>'source'='profiles' and restored_row->>'role'='master' and not exists(select 1 from private.master_account where user_id::text=c->>'entityId') then raise exception 'A conta principal deve ser preservada.';end if;
    select string_agg(format('%I',attname),',' order by attnum),string_agg(format('%1$I=excluded.%1$I',attname),',' order by attnum) filter(where attname<>key) into cols,setters
      from pg_attribute where attrelid=format('public.%I',c->>'source')::regclass and attnum>0 and not attisdropped;
    execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1) on conflict (%3$I) do update set %4$s',c->>'source',cols,key,setters) using restored_row;
   end if;
 end loop;
 if revised is distinct from s.data then update public.app_state set data=revised,version=version+1,updated_at=now() where id=1;end if;
 select id into result_id from private.change_history where transaction_id=txid_current();
 select name into actor_name from public.profiles where user_id=auth.uid();
 update private.change_history set reverted_at=clock_timestamp(),reverted_by=auth.uid(),reverted_by_name=actor_name,reversal_id=result_id where id=p_id;
 perform set_config('app.history_reversal',coalesce(old_marker,''),true);
 return jsonb_build_object('id',p_id,'reversal_id',result_id);
end $$;

create function public.list_change_history(p_before bigint default null,p_area text default null,p_query text default null) returns jsonb language sql security invoker set search_path=pg_catalog,private as $$ select private.list_change_history(p_before,p_area,p_query) $$;
create function public.change_history_detail(p_id bigint) returns jsonb language sql security invoker set search_path=pg_catalog,private as $$ select private.change_history_detail(p_id) $$;
create function public.revert_change_history(p_id bigint) returns jsonb language sql security invoker set search_path=pg_catalog,private as $$ select private.revert_change_history(p_id) $$;

revoke all on function private.audit_array_changes(jsonb,jsonb,text[]),private.audit_state_changes(jsonb,jsonb),private.merge_audit_changes(jsonb,jsonb),private.audit_change_area(jsonb),private.audit_change_label(jsonb),private.record_change_history(jsonb),private.capture_state_history(),private.capture_profile_history(),private.history_visible(jsonb),private.history_revert_reason(jsonb),private.audit_restore_entity(jsonb,jsonb),private.is_history_reversal(),private.list_change_history(bigint,text,text),private.change_history_detail(bigint),private.revert_change_history(bigint),public.list_change_history(bigint,text,text),public.change_history_detail(bigint),public.revert_change_history(bigint) from public,anon,authenticated;
grant execute on function private.is_history_reversal(),private.list_change_history(bigint,text,text),private.change_history_detail(bigint),private.revert_change_history(bigint),public.list_change_history(bigint,text,text),public.change_history_detail(bigint),public.revert_change_history(bigint) to authenticated;
CREATE OR REPLACE FUNCTION private.guard_order_steps()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare latest jsonb; prior jsonb; revised jsonb; orders jsonb:='[]'::jsonb; base numeric; fee numeric; total numeric; each numeric; quote jsonb;
begin
  if private.is_history_reversal() then return new; end if;
  if old.data->'orders' is not distinct from new.data->'orders' then return new; end if;
  for latest in select value from jsonb_array_elements(coalesce(new.data->'orders','[]'::jsonb)) loop
    select value into prior from jsonb_array_elements(coalesce(old.data->'orders','[]'::jsonb)) where value->>'id'=latest->>'id';
    revised:=latest;
    if latest->>'paymentMethodId' is not null then
      select sum((value->>'price')::numeric*(value->>'qty')::numeric) into base from jsonb_array_elements(latest->'items');
      base:=coalesce(base,0)+coalesce((latest->>'freight')::numeric,0);
      if prior->>'paymentMethodId' is null then
        quote:=private.payment_quote(new.data->'settings'->'paymentMethods',latest->>'paymentMethodId',(latest->>'installments')::integer,base);
        revised:=revised||quote;
      else
        if prior->>'paymentMethodId' is distinct from latest->>'paymentMethodId' or prior->'paymentRate' is distinct from latest->'paymentRate'
          or prior->'installments' is distinct from latest->'installments' or prior->'payment' is distinct from latest->'payment' then raise exception 'O pagamento escolhido deve ser preservado no pedido.'; end if;
        fee:=round(base*(prior->>'paymentRate')::numeric/100,2); total:=round(base,2)+fee;
        each:=floor(total*100/(prior->>'installments')::integer)/100;
        revised:=revised||jsonb_build_object('paymentBase',base,'paymentFee',fee,'total',total,'installmentAmount',each,
          'lastInstallmentAmount',total-each*((prior->>'installments')::integer-1));
      end if;
    end if;
    if coalesce((latest->>'paid')::boolean,false) and not coalesce((prior->>'paid')::boolean,false) then
      if not private.valid_payment_photo(latest->>'receipt') then raise exception 'Anexe a foto do comprovante para confirmar o pagamento.'; end if;
      if latest->>'delivery'='Entrega' and (latest->>'deliveryDate' is null or coalesce((latest->>'freightPending')::boolean,false)
        or (latest->>'paymentTiming'<>'Antecipado' and prior->>'status' is distinct from 'transit')) then raise exception 'Conclua agendamento e liberação antes do pagamento na entrega.'; end if;
      revised:=revised||jsonb_build_object('paidAt',now());
    end if;
    if latest->>'status'='transit' and prior->>'status' is distinct from 'transit' then
      if latest->>'paymentTiming'='Antecipado' and not coalesce((latest->>'paid')::boolean,false) then raise exception 'Confirme o pagamento antecipado antes da saída.'; end if;
      revised:=revised||jsonb_build_object('releasedAt',now());
    end if;
    if latest->>'status'='delivered' and prior->>'status' is distinct from 'delivered' then
      if not coalesce((latest->>'paid')::boolean,false) or not private.valid_payment_photo(latest->>'receipt') then raise exception 'Confirme o pagamento com comprovante antes de finalizar.'; end if;
      if latest->>'delivery'='Entrega' and (prior->>'status' is distinct from 'transit' or latest->>'deliveryDate' is null
        or coalesce((latest->>'freightPending')::boolean,false)) then raise exception 'Conclua o agendamento e a saída antes de finalizar a entrega.'; end if;
      revised:=revised||jsonb_build_object('deliveredAt',now());
      if latest->>'delivery'='Retirada' then revised:=revised||jsonb_build_object('releasedAt',now()); end if;
    end if;
    orders:=orders||jsonb_build_array(revised);
  end loop;
  new.data:=jsonb_set(new.data,'{orders}',orders); return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_payment_receipt()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare prior jsonb; latest jsonb;
begin
  if private.is_history_reversal() then return new; end if;
  if old.data->'orders' is not distinct from new.data->'orders' then return new; end if;
  for latest in select value from jsonb_array_elements(coalesce(new.data->'orders','[]'::jsonb))
  loop
    if not coalesce((latest->>'paid')::boolean,false) then continue; end if;
    select value into prior
    from jsonb_array_elements(coalesce(old.data->'orders','[]'::jsonb))
    where value->>'id'=latest->>'id'
    limit 1;
    if not coalesce((prior->>'paid')::boolean,false)
       and (left(coalesce(latest->>'receipt',''),23) <> 'data:image/jpeg;base64,'
         or length(latest->>'receipt') > 2400000) then
      raise exception 'Anexe uma foto do comprovante antes de confirmar o pagamento.';
    end if;
  end loop;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.guard_delivery_schedule()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare latest jsonb; prior jsonb; day_text text;
begin
  if private.is_history_reversal() then return new; end if;
  if old.data->'orders' is not distinct from new.data->'orders' then return new; end if;
  for latest in select value from jsonb_array_elements(coalesce(new.data->'orders','[]'::jsonb)) loop
    if latest->>'delivery'<>'Entrega' then continue; end if;
    select value into prior from jsonb_array_elements(coalesce(old.data->'orders','[]'::jsonb))
      where value->>'id'=latest->>'id' limit 1;
    if (prior is null and latest->>'channel'='Loja física')
       or (latest->>'status'='transit' and prior->>'status' is distinct from 'transit') then
      day_text := latest->>'deliveryDate';
      if day_text is null or day_text !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
        raise exception 'Defina a data da entrega antes de continuar.';
      end if;
      perform day_text::date;
    end if;
    if latest->>'status'='transit' and prior->>'status' is distinct from 'transit'
      and coalesce((latest->>'freightPending')::boolean,false) then
      raise exception 'Defina o frete antes de liberar a entrega.';
    end if;
  end loop;
  return new;
end;
$function$;

