// Generates reviewed SQL only. Does not connect to or write to a database.
const fs=require('node:fs'),path=require('node:path');
function prepareInstitutionalSql(identity){
 const templates=JSON.parse(fs.readFileSync(path.join(__dirname,'../content/institutional-pages.json'),'utf8'));
 const literal=value=>"'"+JSON.stringify(value).replaceAll("'","''")+"'::jsonb";
 return [
 'do $publish$',
 'declare actor uuid; state public.app_state%rowtype; expected jsonb; pages jsonb; template jsonb; existing jsonb; prepared jsonb; result jsonb; next_id bigint; page_id bigint;',
 'begin',
 " select user_id into actor from public.profiles where role='master' and lower(email)='grupooutlet.rj@gmail.com';",
 " if actor is null then raise exception 'Conta principal não encontrada.';end if;",
 " perform set_config('request.jwt.claim.sub',actor::text,true);",
 " perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);",
 ' select * into state from public.app_state where id=1 for update;',
 " select coalesce(jsonb_object_agg(e.key,e.value),'{}') into expected from jsonb_each(state.data->'settings') e where e.key in ('name','phone','address','addressParts','legalName','cnpj','email');",
 " perform private.save_site_section('store',expected||"+literal(identity)+',expected);',
 " pages:=coalesce(state.data->'pages','[]');",
 " select coalesce(max((e.value->>'id')::bigint),0)+1 into next_id from jsonb_array_elements(pages) e;",
 ' for template in select value from jsonb_array_elements('+literal(templates)+') loop',
 "  select e.value into existing from jsonb_array_elements(pages) e where e.value->>'policyKey'=template->>'policyKey' or (template->>'policyKey'='about' and e.value->>'title'='Sobre a Forte Outlet') or (template->>'policyKey'='delivery' and e.value->>'title'='Entrega e retirada') limit 1;",
 "  if existing ? 'policyKey' then continue;end if;",
 "  if existing is null then page_id:=next_id;next_id:=next_id+1;else page_id:=(existing->>'id')::bigint;end if;",
 "  prepared:=coalesce(existing,'{}')||template||jsonb_build_object('id',page_id,'active',true,'updatedAt',clock_timestamp());",
 "  if existing is null then pages:=pages||jsonb_build_array(prepared);",
 "  else select jsonb_agg(case when e.value->>'id'=page_id::text then prepared else e.value end order by e.ord) into pages from jsonb_array_elements(pages) with ordinality e(value,ord);end if;",
 ' end loop;',
 " perform private.save_site_section('pages',pages,state.data->'pages');",
 ' select data into result from public.app_state where id=1;',
 " if (result-'settings'-'pages') is distinct from (state.data-'settings'-'pages') then raise exception 'A publicação alterou dados fora do escopo.';end if;",
 " if (select count(*) from jsonb_array_elements(result->'pages') e where e.value ? 'policyKey')<>7 then raise exception 'Confira a publicação das sete páginas.';end if;",
 " if (select data->'settings'->>'cnpj' from public.shop_public where id=1) is distinct from result->'settings'->>'cnpj' then raise exception 'Identificação pública não sincronizada.';end if;",
 'end $publish$;'
 ].join('\n');
}
module.exports={prepareInstitutionalSql};
