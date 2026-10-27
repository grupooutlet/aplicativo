-- Theme page blocks, safe colors and collection reference integrity. No business data changes.
create or replace function private.validate_theme_config(p_storefront jsonb,p_state jsonb) returns void language plpgsql immutable set search_path=pg_catalog,private as $$
declare section jsonb; item jsonb; property text; page record; all_sections jsonb;
begin
  if jsonb_typeof(p_storefront) is distinct from 'object' or octet_length(p_storefront::text)>25165824
    or jsonb_typeof(p_storefront->'sections') is distinct from 'array'
    or jsonb_array_length(p_storefront->'sections') not between 1 and 80
    or jsonb_typeof(p_storefront->'announcement') is distinct from 'object'
    or (p_storefront?'pageSettings' and jsonb_typeof(p_storefront->'pageSettings') is distinct from 'object') then
    raise exception 'Confira as configurações da loja. O limite total de imagens e textos é de 24 MB.';
  end if;
  if exists(select 1 from jsonb_object_keys(p_storefront) k where k not in ('sections','announcement','pageSettings')) then raise exception 'Configuração da loja inválida.'; end if;
  all_sections:=p_storefront->'sections';
  for page in select key,value from jsonb_each(coalesce(p_storefront->'pageSettings','{}')) loop
    if jsonb_typeof(page.value) is distinct from 'object' then raise exception 'Confira as configurações das páginas.';end if;
    if page.value?'sections' then
      if jsonb_typeof(page.value->'sections') is distinct from 'array' or jsonb_array_length(page.value->'sections')>20 then raise exception 'Cada página aceita até 20 seções adicionais.';end if;
      all_sections:=all_sections||(page.value->'sections');
    end if;
  end loop;
  if jsonb_array_length(all_sections)>400 then raise exception 'O tema aceita até 400 seções no total.';end if;
  for property in select key from jsonb_each(coalesce(p_storefront#>'{pageSettings,global}','{}')) loop
    if property ~ '^(header|footer)(Background|Text|Icon)$' and coalesce(p_storefront#>>array['pageSettings','global',property],'') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Escolha uma cor hexadecimal válida.';end if;
  end loop;
  foreach property in array array['whatsappEnabled','whatsappMessages'] loop
    if (p_storefront#>'{pageSettings,global}')?property and jsonb_typeof(p_storefront#>array['pageSettings','global',property]) is distinct from 'boolean' then raise exception 'Confira as opções de WhatsApp.';end if;
  end loop;
  if (p_storefront#>'{pageSettings,global}')?'whatsappInterval' and coalesce(p_storefront#>>'{pageSettings,global,whatsappInterval}','') not in ('60','90','180') then raise exception 'Escolha um intervalo válido para o WhatsApp.';end if;
  for section in select value from jsonb_array_elements(all_sections) loop
    if jsonb_typeof(section) is distinct from 'object' or coalesce(section->>'id','') !~ '^[A-Za-z0-9_-]{1,90}$'
      or coalesce(section->>'type','') not in ('banner','collection','recommendations','collection-list','image','video','text','benefits')
      or jsonb_typeof(section->'enabled') is distinct from 'boolean'
      or (section?'showText' and jsonb_typeof(section->'showText') is distinct from 'boolean') then raise exception 'Confira as seções da loja.'; end if;

    foreach property in array array['background','textColor','iconColor','productButtonColor','viewAllColor'] loop
      if section?property and coalesce(section->>property,'') !~ '^#[0-9a-fA-F]{6}$' then raise exception 'Escolha uma cor hexadecimal válida para a seção.';end if;
    end loop;
    if section?'position' and coalesce(section->>'position','') not in ('before','after') then raise exception 'Escolha a posição da seção.';end if;
    if section?'showViewAll' and jsonb_typeof(section->'showViewAll') is distinct from 'boolean' then raise exception 'Confira o botão Ver todos.';end if;
    if section->>'type' in ('collection','recommendations') and section?'limit' and (coalesce(section->>'limit','') !~ '^([1-9]|1[0-9]|2[0-4])$') then raise exception 'Use entre 1 e 24 produtos por seção.';end if;
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
  if (select count(*) from jsonb_array_elements(all_sections))<>
    (select count(distinct value->>'id') from jsonb_array_elements(all_sections)) then raise exception 'As seções precisam de identificadores diferentes.'; end if;
  if exists(select 1 from jsonb_array_elements(all_sections) section_row cross join lateral jsonb_array_elements(case when section_row->>'type'='collection-list' then section_row->'items' else '[]'::jsonb end) entry where not (p_state->'collections' ? (entry->>'category'))) then raise exception 'Uma coleção desta lista foi removida. Revise as coleções antes de salvar.';end if;

end $$;

revoke all on function private.validate_theme_config(jsonb,jsonb) from public,anon,authenticated;

-- Both publication paths share the same validation and preserve optimistic concurrency.
create or replace function private.save_storefront(p_storefront jsonb,p_expected jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare s public.app_state%rowtype;
begin
 if not private.can_edit_site() then raise exception 'Somente a equipe autorizada pode publicar a loja.';end if;
 select * into s from public.app_state where id=1 for update;
 if s.data->'storefront' is distinct from p_expected then raise exception 'A loja foi alterada em outra sessão. Cancele o rascunho e revise a versão atual antes de salvar.';end if;
 perform private.validate_theme_config(p_storefront,s.data);
 update public.app_state set data=jsonb_set(s.data,'{storefront}',p_storefront),version=version+1,updated_at=now() where id=1;
end $$;

-- Keep collection references valid in every page and draft when a collection is renamed/deleted.
create function private.remap_theme_sections(p_config jsonb,p_previous text,p_name text) returns jsonb
language plpgsql immutable set search_path=pg_catalog,private as $$
declare revised jsonb:=p_config; result jsonb; section jsonb; page record;
begin
 if p_config is null then return null;end if;
 result:='[]';
 for section in select value from jsonb_array_elements(coalesce(p_config->'sections','[]')) loop
  if section->>'type'='collection' and section->>'category'=p_previous then
   section:=section||jsonb_build_object('category',coalesce(p_name,'Todos'));
   if p_name is null then section:=section||'{"enabled":false}'::jsonb;end if;
  elsif section->>'type'='collection-list' then
   section:=jsonb_set(section,'{items}',(select coalesce(jsonb_agg(case when value->>'category'=p_previous then value||jsonb_build_object('category',p_name) else value end order by ord),'[]') from jsonb_array_elements(coalesce(section->'items','[]')) with ordinality e(value,ord) where p_name is not null or value->>'category'<>p_previous));
  end if;
  result:=result||jsonb_build_array(section);
 end loop;
 revised:=jsonb_set(revised,'{sections}',result);
 for page in select key,value from jsonb_each(coalesce(p_config->'pageSettings','{}')) where value?'sections' loop
  revised:=jsonb_set(revised,array['pageSettings',page.key,'sections'],private.remap_theme_sections(jsonb_build_object('sections',page.value->'sections'),p_previous,p_name)->'sections');
 end loop;
 return revised;
end $$;
revoke all on function private.remap_theme_sections(jsonb,text,text) from public,anon,authenticated;

create function private.normalize_theme_collection_sections() returns trigger
language plpgsql security definer set search_path=pg_catalog,private as $$
declare old_name text; new_name text; idx bigint; themes jsonb;
begin
 if old.data->'collections' is not distinct from new.data->'collections' then return new;end if;
 for old_name,idx in select value,ord from jsonb_array_elements_text(old.data->'collections') with ordinality e(value,ord) where not (new.data->'collections'?value) loop
  new_name:=null;
  if jsonb_array_length(old.data->'collections')=jsonb_array_length(new.data->'collections') then
   new_name:=new.data->'collections'->>(idx::integer-1);
   if old.data->'collections'?new_name then new_name:=null;end if;
  end if;
  new.data:=jsonb_set(new.data,'{storefront}',private.remap_theme_sections(new.data->'storefront',old_name,new_name));
  if new.data?'storeThemes' then
   select coalesce(jsonb_agg(value||jsonb_build_object('config',private.remap_theme_sections(value->'config',old_name,new_name)) order by ord),'[]') into themes from jsonb_array_elements(new.data->'storeThemes') with ordinality e(value,ord);
   new.data:=jsonb_set(new.data,'{storeThemes}',themes);
  end if;
 end loop;
 return new;
end $$;
revoke all on function private.normalize_theme_collection_sections() from public,anon,authenticated;
create trigger normalize_theme_collection_sections before update of data on public.app_state for each row execute function private.normalize_theme_collection_sections();
