-- Publish only the storefront document under a lock, preserving orders and inventory.
create function private.save_storefront(p_storefront jsonb,p_expected jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare s public.app_state%rowtype; section jsonb;
begin
  if not private.is_manager() then raise exception 'Somente a conta principal ou gerente pode publicar a loja.'; end if;
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
$$;
create function public.save_storefront(p_storefront jsonb,p_expected jsonb) returns void language sql security invoker
set search_path=pg_catalog,public,private as $$ select private.save_storefront(p_storefront,p_expected) $$;
revoke all on function private.save_storefront(jsonb,jsonb),public.save_storefront(jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.save_storefront(jsonb,jsonb),public.save_storefront(jsonb,jsonb) to authenticated;
create function private.guard_storefront_configuration() returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
begin
  if old.data->'storefront' is distinct from new.data->'storefront' and auth.uid() is not null and not private.is_manager() then
    raise exception 'Somente a conta principal ou gerente pode alterar a loja online.';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_storefront_configuration() from public,anon,authenticated;
create trigger guard_storefront_configuration before update of data on public.app_state for each row execute function private.guard_storefront_configuration();
