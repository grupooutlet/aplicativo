-- Support non-link collection groups without widening navigation edit permissions.
-- Small, versioned collection edits and an independent navigation document.
-- Authorization remains in the private manager functions and existing app_state RLS.
create or replace function private.validate_navigation(p_navigation jsonb) returns void
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
    or coalesce(item->>'type','') not in ('group','home','catalog','collection','product','page','account','cart','checkout','admin','external')
    or jsonb_typeof(item->'children') is distinct from 'array'
    or jsonb_typeof(item->'newTab') is distinct from 'boolean' then raise exception 'Confira o título e o destino de cada link.'; end if;
   if item->>'type'='group' and (coalesce(item->>'target','')<>'' or (item->>'newTab')::boolean) then raise exception 'Um grupo deve conter subcoleções, sem link próprio.'; end if;
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

