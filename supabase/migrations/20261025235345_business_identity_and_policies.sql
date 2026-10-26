-- Public business identity is edited through the existing bounded, audited RPC.
create function private.valid_store_cnpj(p_value text) returns boolean language plpgsql immutable
set search_path=pg_catalog as $$
declare value text:=regexp_replace(upper(coalesce(p_value,'')),'[./[:space:]-]','','g'); base text; total integer; weight integer; digit integer; n integer; k integer;
begin
 if value !~ '^[A-Z0-9]{12}[0-9]{2}$' or value ~ '^(.)\1{13}$' then return false;end if;
 for n in 12..13 loop
  base:=left(value,n);total:=0;weight:=2;
  for k in reverse n..1 loop total:=total+(ascii(substr(base,k,1))-48)*weight;weight:=case when weight=9 then 2 else weight+1 end;end loop;
  digit:=case when total%11<2 then 0 else 11-total%11 end;
  if substr(value,n+1,1)<>digit::text then return false;end if;
 end loop;
 return true;
end $$;
revoke all on function private.valid_store_cnpj(text) from public,anon,authenticated;

create or replace function private.save_site_section(p_section text,p_value jsonb,p_expected jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare s public.app_state%rowtype; previous jsonb; revised jsonb; page jsonb;
begin
 if not private.can_edit_site() then raise exception 'Acesso restrito à equipe autorizada a configurar a loja.'; end if;
 select * into s from public.app_state where id=1 for update;
 if p_section='paymentMethods' then previous:=s.data->'settings'->'paymentMethods';
 elsif p_section='pages' then previous:=s.data->'pages';
 elsif p_section='store' then select coalesce(jsonb_object_agg(key,value),'{}') into previous from jsonb_each(s.data->'settings') where key in ('name','phone','address','addressParts','legalName','cnpj','email');
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
  if jsonb_typeof(p_value) is distinct from 'object' or exists(select 1 from jsonb_object_keys(p_value) k where k not in ('name','phone','address','addressParts','legalName','cnpj','email'))
   or exists(select 1 from jsonb_each(p_value) entry where entry.key<>'addressParts' and jsonb_typeof(entry.value) is distinct from 'string')
   or length(trim(coalesce(p_value->>'name',''))) not between 1 and 120
   or length(coalesce(p_value->>'legalName',''))>160 or length(coalesce(p_value->>'email',''))>254
   or (coalesce(p_value->>'email','')<>'' and p_value->>'email' !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
   or (coalesce(p_value->>'cnpj','')<>'' and not private.valid_store_cnpj(p_value->>'cnpj')) or length(coalesce(p_value->>'address',''))>500
   or (coalesce(p_value->>'phone','')<>'' and private.normalize_registration_phone(p_value->>'phone') is null)
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

notify pgrst,'reload schema';
