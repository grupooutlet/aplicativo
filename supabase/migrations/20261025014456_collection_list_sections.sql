-- Maintain collection navigation when a collection is renamed or removed.
create function private.remap_collection_list_sections(p_sections jsonb,p_previous text,p_name text default null)
returns jsonb language sql immutable set search_path=pg_catalog as $$
 select coalesce(jsonb_agg(case when section->>'type'='collection-list' then jsonb_set(section,'{items}',
   (select coalesce(jsonb_agg(case when item->>'category'=p_previous then item||jsonb_build_object('category',p_name) else item end order by item_position),'[]'::jsonb)
    from jsonb_array_elements(coalesce(section->'items','[]'::jsonb)) with ordinality entries(item,item_position)
    where item->>'category' is distinct from p_previous or p_name is not null)) else section end order by section_position),'[]'::jsonb)
 from jsonb_array_elements(coalesce(p_sections,'[]'::jsonb)) with ordinality sections(section,section_position)
$$;
revoke all on function private.remap_collection_list_sections(jsonb,text,text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.save_storefront(p_storefront jsonb, p_expected jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare s public.app_state%rowtype; section jsonb; item jsonb; property text;
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
      or coalesce(section->>'type','') not in ('banner','collection','collection-list','image','video','text','benefits')
      or jsonb_typeof(section->'enabled') is distinct from 'boolean'
      or (section?'showText' and jsonb_typeof(section->'showText') is distinct from 'boolean') then raise exception 'Confira as seções da loja.'; end if;

    if section->>'type'='collection-list' then
      if jsonb_typeof(section->'items') is distinct from 'array' or jsonb_array_length(section->'items')>40 then raise exception 'A lista aceita até 40 coleções.';end if;
      foreach property in array array['showHeading','showTitles','showArrows','showCounts','mobileCarousel'] loop
        if section?property and jsonb_typeof(section->property) is distinct from 'boolean' then raise exception 'Confira a apresentação da lista de coleções.';end if;
      end loop;
      foreach property in array array['background','textColor','cardBackground','cardTextColor'] loop
        if section?property and coalesce(section->>property,'') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Escolha uma cor válida para a lista de coleções.';end if;
      end loop;
      if (section?'shape' and coalesce(section->>'shape','') not in ('square','round','landscape','portrait'))
        or (section?'imageFit' and coalesce(section->>'imageFit','') not in ('cover','contain'))
        or (section?'titleAlign' and coalesce(section->>'titleAlign','') not in ('left','center'))
        or (section?'headingSize' and coalesce(section->>'headingSize','') not in ('small','medium','large'))
        or (section?'columns' and coalesce(section->>'columns','') !~ '^[2-6]$')
        or (section?'mobileColumns' and coalesce(section->>'mobileColumns','') !~ '^[12]$')
        or (section?'padding' and coalesce(section->>'padding','') !~ '^([0-9]|[1-8][0-9]|9[0-6])$')
        or length(coalesce(section->>'title',''))>200 then raise exception 'Confira as opções da lista de coleções.';end if;
      for item in select value from jsonb_array_elements(section->'items') loop
        if jsonb_typeof(item) is distinct from 'object' or coalesce(item->>'id','') !~ '^[A-Za-z0-9_-]{1,90}$'
          or length(coalesce(item->>'category','')) not between 1 and 100
          or length(coalesce(item->>'title',''))>120 or length(coalesce(item->>'imageAlt',''))>200
          or (coalesce(item->>'image','')<>'' and item->>'image' !~ '^https?://[^[:space:]]+$' and item->>'image' !~ '^data:image/(png|jpeg|webp);base64,[a-zA-Z0-9+/=]+$')
          or exists(select 1 from jsonb_object_keys(item) k where k not in ('id','category','title','image','imageAlt')) then raise exception 'Confira as coleções e imagens da lista.';end if;
      end loop;
      if exists(select 1 from jsonb_array_elements(section->'items') group by value->>'id' having count(*)>1)
        or exists(select 1 from jsonb_array_elements(section->'items') group by value->>'category' having count(*)>1) then raise exception 'Cada coleção deve aparecer uma vez nesta lista.';end if;
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(p_storefront->'sections'))<>
    (select count(distinct value->>'id') from jsonb_array_elements(p_storefront->'sections')) then raise exception 'As seções precisam de identificadores diferentes.'; end if;
  select * into s from public.app_state where id=1 for update;
  if s.data->'storefront' is distinct from p_expected then raise exception 'A loja foi alterada em outra sessão. Cancele o rascunho e revise a versão atual antes de salvar.'; end if;
  if exists(select 1 from jsonb_array_elements(p_storefront->'sections') section_row cross join lateral jsonb_array_elements(case when section_row->>'type'='collection-list' then section_row->'items' else '[]'::jsonb end) entry where not (s.data->'collections' ? (entry->>'category'))) then raise exception 'Uma coleção desta lista foi removida. Revise as coleções antes de salvar.';end if;
  update public.app_state set data=jsonb_set(s.data,'{storefront}',p_storefront),version=version+1,updated_at=now() where id=1;
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
  revised:=jsonb_set(revised,'{storefront,sections}',private.remap_collection_list_sections(revised->'storefront'->'sections',old_name,name));
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
