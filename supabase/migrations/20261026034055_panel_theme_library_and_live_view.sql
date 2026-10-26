-- Shared validation for published and draft theme configurations.
create function private.validate_theme_config(p_storefront jsonb,p_state jsonb) returns void language plpgsql immutable set search_path=pg_catalog,private as $$
declare section jsonb; item jsonb; property text;
begin
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
  if exists(select 1 from jsonb_array_elements(p_storefront->'sections') section_row cross join lateral jsonb_array_elements(case when section_row->>'type'='collection-list' then section_row->'items' else '[]'::jsonb end) entry where not (p_state->'collections' ? (entry->>'category'))) then raise exception 'Uma coleção desta lista foi removida. Revise as coleções antes de salvar.';end if;

end $$;
revoke all on function private.validate_theme_config(jsonb,jsonb) from public,anon,authenticated;


CREATE OR REPLACE FUNCTION private.audit_state_changes(p_before jsonb, p_after jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO 'pg_catalog', 'private'
AS $function$
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
   if k in ('products','orders','movements','pages','orderBumps','attributeCatalog','storeThemes') and jsonb_typeof(coalesce(b,'[]'))='array' and jsonb_typeof(coalesce(a,'[]'))='array' then
    select not exists(select 1 from jsonb_array_elements(coalesce(b,'[]')||coalesce(a,'[]')) v where jsonb_typeof(v)<>'object' or v->>'id' is null) into has_ids;
   end if;
   if has_ids then changes:=changes||private.audit_array_changes(b,a,path);
   else changes:=changes||jsonb_build_array(jsonb_build_object('source','state','kind','value','path',to_jsonb(path),'before',b,'after',a,'beforeExists',b is not null,'afterExists',a is not null));end if;
  end if;
 end loop;
 return changes;
end $function$;

CREATE OR REPLACE FUNCTION private.audit_change_area(p_change jsonb)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
 select case when p_change->>'source'<>'state' then p_change->>'source'
 when p_change->'path'->>0='settings' and p_change->'path'->>1 in ('shippingOptions','paymentMethods') then p_change->'path'->>1
 when p_change->'path'->>0='collectionSettings' then 'collections'
 when p_change->'path'->>0 in ('storeThemes','activeThemeId') then 'storeThemes'
 else p_change->'path'->>0 end
$function$;

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
    'collections',s.data->'collections','pages',s.data->'pages','storefront',s.data->'storefront','storeThemes',coalesce(s.data->'storeThemes','[]'),'activeThemeId',s.data->'activeThemeId',
    'navigation',s.data->'navigation','orderBumps',(select coalesce(jsonb_agg(value-'cost'),'[]') from jsonb_array_elements(coalesce(s.data->'orderBumps','[]'))),
    'settings',(s.data->'settings')-'goal');
  return jsonb_build_object('data',projection,'version',s.version);
end;
$function$;

-- Theme operations only change layout state; products, customers and orders remain untouched.
do $seed$
declare s public.app_state%rowtype; theme_key text:=gen_random_uuid()::text;
begin
 select * into s from public.app_state where app_state.id=1 for update;
 if not(s.data ? 'storeThemes') then
  update public.app_state set data=s.data||jsonb_build_object('activeThemeId',theme_key,'storeThemes',jsonb_build_array(jsonb_build_object('id',theme_key,'name','Tema principal','config',s.data->'storefront','createdAt',clock_timestamp(),'updatedAt',clock_timestamp()))),version=version+1,updated_at=now() where app_state.id=1;
 end if;
end $seed$;

create function private.sync_active_store_theme() returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare themes jsonb; theme jsonb; theme_key text;
begin
 if old.data ? 'storeThemes' and not(new.data ? 'storeThemes') then
  if coalesce(current_setting('app.history_reversal',true),'')<>'' then raise exception 'A biblioteca inicial de temas deve ser preservada. Reverta uma alteração posterior.';end if;
  new.data:=new.data||jsonb_build_object('storeThemes',old.data->'storeThemes','activeThemeId',old.data->'activeThemeId');
 end if;
 if not(new.data ? 'storeThemes') then return new;end if;
 theme_key:=new.data->>'activeThemeId';
 select value into theme from jsonb_array_elements(new.data->'storeThemes') where value->>'id'=theme_key;
 if theme is null then raise exception 'O tema publicado deve ser preservado.';end if;
 if theme->'config' is distinct from new.data->'storefront' then
  select jsonb_agg(case when e.value->>'id'=theme_key then e.value||jsonb_build_object('config',new.data->'storefront','updatedAt',clock_timestamp()) else e.value end order by e.ord) into themes from jsonb_array_elements(new.data->'storeThemes') with ordinality e(value,ord);
  new.data:=jsonb_set(new.data,'{storeThemes}',themes);
 end if;
 return new;
end $$;
revoke all on function private.sync_active_store_theme() from public,anon,authenticated;
create trigger sync_active_store_theme before update on public.app_state for each row execute function private.sync_active_store_theme();

create function private.manage_store_theme(p_action text,p_id text,p_name text,p_config jsonb,p_expected jsonb,p_expected_live jsonb)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare s public.app_state%rowtype; themes jsonb; theme jsonb; source jsonb; revised jsonb; theme_key text; now_time timestamptz:=clock_timestamp();
begin
 if not private.can_edit_site() then raise exception 'Seu perfil não pode gerenciar os temas da loja.';end if;
 if p_action not in ('create','duplicate','rename','save','publish','delete') or p_action is null then raise exception 'Ação de tema inválida.';end if;
 if p_action in ('create','duplicate','rename') and length(btrim(coalesce(p_name,''))) not between 1 and 80 then raise exception 'Informe um nome de até 80 caracteres.';end if;
 select * into s from public.app_state where app_state.id=1 for update;themes:=s.data->'storeThemes';
 if jsonb_typeof(themes) is distinct from 'array' then raise exception 'Atualize a página para carregar a biblioteca de temas.';end if;
 if p_action='create' then
  if p_id is not null then select value into source from jsonb_array_elements(themes) where value->>'id'=p_id; if source is null then raise exception 'O tema de origem foi removido.';end if;end if;
  theme_key:=gen_random_uuid()::text;
  theme:=jsonb_build_object('id',theme_key,'name',btrim(p_name),'config',coalesce(p_config,source->'config',s.data->'storefront'),'createdAt',now_time,'updatedAt',now_time);
 elsif p_action='duplicate' then
  select value into source from jsonb_array_elements(themes) where value->>'id'=p_id;
  if source is null or source is distinct from p_expected then raise exception 'O tema mudou em outra sessão. Atualize a biblioteca.';end if;
  theme_key:=gen_random_uuid()::text;theme:=source||jsonb_build_object('id',theme_key,'name',btrim(p_name),'createdAt',now_time,'updatedAt',now_time);
 else
  theme_key:=p_id;select value into theme from jsonb_array_elements(themes) where value->>'id'=theme_key;
  if theme is null then raise exception 'Este tema foi removido. Atualize a biblioteca.';end if;
  if p_action='save' then
   if theme->'config' is distinct from p_expected then raise exception 'O tema foi alterado em outra sessão. Cancele o rascunho e revise a versão atual.';end if;
   theme:=theme||jsonb_build_object('config',p_config,'updatedAt',now_time);
  else
   if theme is distinct from p_expected then raise exception 'O tema mudou em outra sessão. Atualize a biblioteca.';end if;
  end if;
  if p_action='rename' then theme:=theme||jsonb_build_object('name',btrim(p_name),'updatedAt',now_time);end if;
  if p_action='delete' and theme_key=s.data->>'activeThemeId' then raise exception 'Publique outro tema antes de excluir o tema atual.';end if;
 end if;
 if p_action in ('create','duplicate','save','publish') then perform private.validate_theme_config(theme->'config',s.data);end if;
 if p_action in ('create','duplicate') then
  if jsonb_array_length(themes)>=20 then raise exception 'A biblioteca aceita até 20 temas. Exclua um rascunho para criar outro.';end if;
  themes:=themes||jsonb_build_array(theme);
 elsif p_action='delete' then select coalesce(jsonb_agg(value),'[]') into themes from jsonb_array_elements(themes) where value->>'id'<>theme_key;
 else select jsonb_agg(case when e.value->>'id'=theme_key then theme else e.value end order by e.ord) into themes from jsonb_array_elements(themes) with ordinality e(value,ord);end if;
 if octet_length(themes::text)>25165824 then raise exception 'A biblioteca atingiu 24 MB. Use o envio de imagens para manter os temas leves.';end if;
 revised:=jsonb_set(s.data,'{storeThemes}',themes);
 if p_action='publish' then
  if s.data->'storefront' is distinct from p_expected_live then raise exception 'O tema publicado mudou. Atualize e confira antes de publicar outro tema.';end if;
  revised:=revised||jsonb_build_object('activeThemeId',theme_key,'storefront',theme->'config');
 elsif p_action='save' and theme_key=s.data->>'activeThemeId' then revised:=jsonb_set(revised,'{storefront}',theme->'config');end if;
 if revised is distinct from s.data then update public.app_state set data=revised,version=version+1,updated_at=now() where app_state.id=1 returning version into s.version;end if;
 return jsonb_build_object('id',theme_key,'version',s.version,'active',theme_key=revised->>'activeThemeId');
end $$;
create function public.manage_store_theme(p_action text,p_id text,p_name text,p_config jsonb,p_expected jsonb,p_expected_live jsonb)
returns jsonb language sql security invoker set search_path=pg_catalog,private as $$ select private.manage_store_theme(p_action,p_id,p_name,p_config,p_expected,p_expected_live) $$;
revoke all on function private.manage_store_theme(text,text,text,jsonb,jsonb,jsonb),public.manage_store_theme(text,text,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function private.manage_store_theme(text,text,text,jsonb,jsonb,jsonb),public.manage_store_theme(text,text,text,jsonb,jsonb,jsonb) to authenticated;

-- Temporary, consented audience signals. No IP, customer ID, email, address or order ID is stored.
create table private.store_live_visits(
 visit_id uuid primary key,
 city text not null check(length(city)<=80),
 region text not null check(length(region)<=80),
 country text not null check(country ~ '^[A-Z]{2}$'),
 latitude numeric(4,1),longitude numeric(4,1),
 phase text not null check(phase in ('store','product','cart','checkout','order')),
 has_cart boolean not null default false,
 created_at timestamptz not null default clock_timestamp(),
 last_seen timestamptz not null default clock_timestamp()
);
alter table private.store_live_visits enable row level security;
revoke all on private.store_live_visits from public,anon,authenticated;
create policy "Live visits are available only through bounded functions" on private.store_live_visits for all to anon,authenticated using(false) with check(false);
create index store_live_visits_seen_idx on private.store_live_visits(last_seen);

create function private.purge_live_visits() returns void language sql security definer set search_path=pg_catalog,private as $$
 delete from private.store_live_visits where last_seen<clock_timestamp()-interval '30 minutes';
$$;
revoke all on function private.purge_live_visits() from public,anon,authenticated;

create function private.record_store_visit(p_visit uuid,p_city text,p_region text,p_country text,p_latitude numeric,p_longitude numeric,p_phase text,p_has_cart boolean,p_forget boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog,private as $$
declare previous private.store_live_visits%rowtype; now_time timestamptz:=clock_timestamp();
begin
 if p_visit is null then return false;end if;
 if p_forget is true then delete from private.store_live_visits where visit_id=p_visit;return true;end if;
 if p_phase is null or p_phase not in ('store','product','cart','checkout','order') or p_city is null or length(p_city)>80 or p_region is null or length(p_region)>80 or coalesce(p_country,'') !~ '^[A-Z]{2}$'
   or p_city ~ '[[:cntrl:]]' or p_region ~ '[[:cntrl:]]'
   or (p_latitude is not null and p_latitude not between -90 and 90) or (p_longitude is not null and p_longitude not between -180 and 180) then return false;end if;
 perform pg_advisory_xact_lock(746621);
 perform private.purge_live_visits();
 select * into previous from private.store_live_visits where visit_id=p_visit;
 if previous.visit_id is not null and previous.last_seen>now_time-interval '20 seconds' then return true;end if;
 if previous.visit_id is null and (select count(*) from private.store_live_visits)>=10000 then return false;end if;
 insert into private.store_live_visits(visit_id,city,region,country,latitude,longitude,phase,has_cart,created_at,last_seen)
 values(p_visit,btrim(p_city),btrim(p_region),p_country,round(p_latitude,1),round(p_longitude,1),p_phase,coalesce(p_has_cart,false),now_time,now_time)
 on conflict(visit_id) do update set city=excluded.city,region=excluded.region,country=excluded.country,latitude=excluded.latitude,longitude=excluded.longitude,phase=excluded.phase,has_cart=excluded.has_cart,last_seen=excluded.last_seen;
 return true;
end $$;
create function public.record_store_visit(p_visit uuid,p_city text,p_region text,p_country text,p_latitude numeric,p_longitude numeric,p_phase text,p_has_cart boolean,p_forget boolean)
returns boolean language sql security invoker set search_path=pg_catalog,private as $$ select private.record_store_visit(p_visit,p_city,p_region,p_country,p_latitude,p_longitude,p_phase,p_has_cart,p_forget) $$;
revoke all on function private.record_store_visit(uuid,text,text,text,numeric,numeric,text,boolean,boolean),public.record_store_visit(uuid,text,text,text,numeric,numeric,text,boolean,boolean) from public,anon,authenticated;
grant execute on function private.record_store_visit(uuid,text,text,text,numeric,numeric,text,boolean,boolean),public.record_store_visit(uuid,text,text,text,numeric,numeric,text,boolean,boolean) to anon,authenticated;

create function private.live_order_day(p_order jsonb) returns date language plpgsql immutable set search_path=pg_catalog as $$
begin
 if coalesce(p_order->>'createdAt',p_order->>'created_at','') ~ '[T ][0-9]{2}:[0-9]{2}' then return (coalesce(p_order->>'createdAt',p_order->>'created_at')::timestamptz at time zone 'America/Sao_Paulo')::date;end if;
 if p_order->>'date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then return (p_order->>'date')::date;end if;
 return null;
exception when invalid_datetime_format or datetime_field_overflow then return null;
end $$;
revoke all on function private.live_order_day(jsonb) from public,anon,authenticated;

create function private.store_live_snapshot() returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public as $$
declare now_time timestamptz:=clock_timestamp(); result jsonb; orders jsonb; today date:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
 if not private.is_manager() then raise exception 'O Live View é reservado à conta principal e aos gerentes.';end if;
 perform private.purge_live_visits();
 select data->'orders' into orders from public.app_state where id=1;
 select jsonb_build_object('observedAt',now_time,'activeWindowSeconds',120,'retentionMinutes',30,
  'active',count(*) filter(where last_seen>=now_time-interval '120 seconds'),
  'activeCarts',count(*) filter(where last_seen>=now_time-interval '120 seconds' and has_cart and phase not in ('checkout','order')),
  'checkout',count(*) filter(where last_seen>=now_time-interval '120 seconds' and phase='checkout'),
  'productViews',count(*) filter(where last_seen>=now_time-interval '120 seconds' and phase='product'),
  'sessions',count(*),'locations',(select coalesce(jsonb_agg(row),'[]') from (
    select city,region,country,count(*) visitors,avg(latitude) latitude,avg(longitude) longitude from private.store_live_visits
    where last_seen>=now_time-interval '120 seconds' group by city,region,country order by count(*) desc,city limit 100
  ) row)) into result from private.store_live_visits;
 return result||jsonb_build_object(
  'ordersToday',(select count(*) from jsonb_array_elements(coalesce(orders,'[]')) o where o->>'status'<>'cancelled' and private.live_order_day(o)=today),
  'revenueToday',(select coalesce(sum((select coalesce(sum((item->>'price')::numeric*(item->>'qty')::numeric),0) from jsonb_array_elements(o->'items') item)),0)
    from jsonb_array_elements(coalesce(orders,'[]')) o where o->>'paid'='true' and private.live_order_day(o)=today
      and (case when o->>'paymentTiming'='Na entrega' then o->>'status'='delivered' else o->>'status' in ('transit','delivered') end)));
end $$;
create function public.store_live_snapshot() returns jsonb language sql security invoker set search_path=pg_catalog,private as $$ select private.store_live_snapshot() $$;
revoke all on function private.store_live_snapshot(),public.store_live_snapshot() from public,anon,authenticated;
grant execute on function private.store_live_snapshot(),public.store_live_snapshot() to authenticated;

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('purge-forte-live-visits','*/5 * * * *','select private.purge_live_visits()');
notify pgrst,'reload schema';

