-- Consented, pseudonymous sessions; never customer IDs, IPs or fingerprints.
create table private.store_visit_history(
 visit_id uuid primary key,
 visitor_id uuid not null,
 started_at timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp()
);
create index store_visit_history_started_idx on private.store_visit_history(started_at,visitor_id);
create index store_visit_history_visitor_idx on private.store_visit_history(visitor_id);
alter table private.store_visit_history enable row level security;
revoke all on private.store_visit_history from public,anon,authenticated;
create policy "History is accessed only through bounded functions" on private.store_visit_history for all to anon,authenticated using(false) with check(false);
-- A revoked identifier blocks late heartbeats from other tabs from recreating history.
create table private.store_audience_revocations(visitor_id uuid primary key,expires_at timestamptz not null);
create index store_audience_revocations_expiry_idx on private.store_audience_revocations(expires_at);
alter table private.store_audience_revocations enable row level security;
revoke all on private.store_audience_revocations from public,anon,authenticated;
create policy "Revocations are private" on private.store_audience_revocations for all to anon,authenticated using(false) with check(false);
create table private.store_audience_settings(
 id boolean primary key default true check(id),
 history_started_at timestamptz not null default clock_timestamp()
);
insert into private.store_audience_settings default values;
alter table private.store_audience_settings enable row level security;
revoke all on private.store_audience_settings from public,anon,authenticated;
create policy "Audience settings are private" on private.store_audience_settings for all to anon,authenticated using(false) with check(false);

create or replace function private.purge_live_visits() returns void language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 delete from private.store_live_visits where last_seen<clock_timestamp()-interval '30 minutes';
 delete from private.store_visit_history where started_at<clock_timestamp()-interval '90 days';
 delete from private.store_audience_revocations where expires_at<clock_timestamp();
end $$;

create function private.record_store_audience(p_visit uuid,p_visitor uuid,p_city text,p_region text,p_country text,p_latitude numeric,p_longitude numeric,p_phase text,p_has_cart boolean,p_forget boolean)
returns boolean language plpgsql security definer set search_path=pg_catalog,private as $$
declare accepted boolean; prior_visitor uuid; started timestamptz;
begin
 if p_visit is null or p_visitor is null then return false;end if;
 perform pg_advisory_xact_lock(746621);
 if p_forget is true then
  insert into private.store_audience_revocations(visitor_id,expires_at) values(p_visitor,clock_timestamp()+interval '90 days') on conflict(visitor_id) do update set expires_at=excluded.expires_at;
  delete from private.store_live_visits where visit_id in (select visit_id from private.store_visit_history where visitor_id=p_visitor);
  delete from private.store_live_visits where visit_id=p_visit;
  delete from private.store_visit_history where visitor_id=p_visitor;
  return true;
 end if;
 if exists(select 1 from private.store_audience_revocations where visitor_id=p_visitor and expires_at>clock_timestamp()) then return false;end if;
 select visitor_id into prior_visitor from private.store_visit_history where visit_id=p_visit;
 if prior_visitor is not null and prior_visitor<>p_visitor then return false;end if;
 accepted:=private.record_store_visit(p_visit,p_city,p_region,p_country,p_latitude,p_longitude,p_phase,p_has_cart,false);
 if not accepted then return false;end if;
 select created_at into started from private.store_live_visits where visit_id=p_visit;
 insert into private.store_visit_history(visit_id,visitor_id,started_at,updated_at) values(p_visit,p_visitor,started,clock_timestamp())
 on conflict(visit_id) do update set updated_at=excluded.updated_at;
 return true;
end $$;
create function public.record_store_audience(p_visit uuid,p_visitor uuid,p_city text,p_region text,p_country text,p_latitude numeric,p_longitude numeric,p_phase text,p_has_cart boolean,p_forget boolean)
returns boolean language sql security invoker set search_path=pg_catalog,private as $$select private.record_store_audience(p_visit,p_visitor,p_city,p_region,p_country,p_latitude,p_longitude,p_phase,p_has_cart,p_forget)$$;
revoke all on function private.record_store_audience(uuid,uuid,text,text,text,numeric,numeric,text,boolean,boolean),public.record_store_audience(uuid,uuid,text,text,text,numeric,numeric,text,boolean,boolean) from public,anon,authenticated;
grant execute on function private.record_store_audience(uuid,uuid,text,text,text,numeric,numeric,text,boolean,boolean),public.record_store_audience(uuid,uuid,text,text,text,numeric,numeric,text,boolean,boolean) to anon,authenticated;

create function private.store_visit_statistics(p_start date default null,p_end date default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private,public as $$
declare today date:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date; first_day date; last_day date; since timestamptz;
 result jsonb; days jsonb; overview jsonb;
begin
 if not private.is_manager() then raise exception 'O histórico de visitas é reservado à conta principal e aos gerentes.';end if;
 first_day:=coalesce(p_start,today);last_day:=coalesce(p_end,today);
 if first_day>last_day or last_day>today or first_day<today-89 then raise exception 'Escolha um período dentro dos últimos 90 dias, sem datas futuras.';end if;
 perform private.purge_live_visits();
 select history_started_at into since from private.store_audience_settings where id;
 select jsonb_build_object('visits',count(*),'visitors',count(distinct visitor_id)) into result
 from private.store_visit_history where started_at >= (first_day::timestamp at time zone 'America/Sao_Paulo') and started_at < ((last_day+1)::timestamp at time zone 'America/Sao_Paulo');
 select coalesce(jsonb_agg(jsonb_build_object('day',d.day,'visits',coalesce(h.visits,0),'visitors',coalesce(h.visitors,0),'available',d.day >= (since at time zone 'America/Sao_Paulo')::date) order by d.day),'[]') into days
 from (select first_day+i as day from generate_series(0,last_day-first_day) i) d left join (
  select (started_at at time zone 'America/Sao_Paulo')::date as day,count(*) visits,count(distinct visitor_id) visitors
  from private.store_visit_history where started_at >= (first_day::timestamp at time zone 'America/Sao_Paulo') and started_at < ((last_day+1)::timestamp at time zone 'America/Sao_Paulo') group by 1
 ) h using(day);
 select jsonb_agg(jsonb_build_object('key',p.key,'start',p.start_day,'end',today,'visits',(select count(*) from private.store_visit_history where started_at >= (p.start_day::timestamp at time zone 'America/Sao_Paulo')),'visitors',(select count(distinct visitor_id) from private.store_visit_history where started_at >= (p.start_day::timestamp at time zone 'America/Sao_Paulo'))) order by p.ord) into overview
 from (values('today',today,1),('week',date_trunc('week',today::timestamp)::date,2),('month',date_trunc('month',today::timestamp)::date,3)) p(key,start_day,ord);
 return result||jsonb_build_object('start',first_day,'end',last_day,'daily',days,'overview',overview,'historyStartedAt',since,'retentionDays',90,'timeZone','America/Sao_Paulo','observedAt',clock_timestamp());
end $$;
create function public.store_visit_statistics(p_start date default null,p_end date default null) returns jsonb
language sql security invoker set search_path=pg_catalog,private as $$select private.store_visit_statistics(p_start,p_end)$$;
revoke all on function private.store_visit_statistics(date,date),public.store_visit_statistics(date,date) from public,anon,authenticated;
grant execute on function private.store_visit_statistics(date,date),public.store_visit_statistics(date,date) to authenticated;

-- Update only the audience paragraphs previously supplied by this application.
update public.app_state set data=jsonb_set(data,'{pages}',(select jsonb_agg(case when value->>'policyKey' in ('privacy','cookies') then jsonb_set(value,'{content}',to_jsonb(replace(replace(coalesce(value->>'content',''),
 'Um identificador aleatório é criado para esta aba; ele não é vinculado ao cadastro ou pedido.',
 'Identificadores aleatórios deste navegador e da sessão permitem distinguir visitas de visitantes únicos, sem vínculo com cadastro ou pedido.'),
 'Os registros são apagados após 30 minutos sem atividade, com limpeza automática periódica de até 5 minutos. A equipe autorizada vê apenas contagens agregadas; visitantes ativos representam os últimos 2 minutos. Visitas da equipe e prévias de temas são excluídas.',
 'Os sinais ao vivo são apagados após 30 minutos sem atividade. O histórico de sessões e o identificador aleatório do navegador são mantidos por até 90 dias para contagens por período. Ao revogar a medição, solicitamos a exclusão do histórico associado a esse navegador; se a conexão falhar, a solicitação é repetida no próximo acesso. A equipe autorizada vê contagens agregadas; visitantes ativos representam os últimos 2 minutos. Visitas da equipe e prévias de temas são excluídas. Limpar o armazenamento ou usar outro navegador pode fazer a mesma pessoa ser contada novamente.'))) else value end order by ord) from jsonb_array_elements(data->'pages') with ordinality e(value,ord))),version=version+1,updated_at=now() where id=1;
create or replace function private.store_live_snapshot() returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public as $$
declare now_time timestamptz:=clock_timestamp(); result jsonb; orders jsonb; today date:=(clock_timestamp() at time zone 'America/Sao_Paulo')::date;
begin
 if not private.is_manager() then raise exception 'O Live View é reservado à conta principal e aos gerentes.';end if;
 perform private.purge_live_visits();
 select data->'orders' into orders from public.app_state where id=1;
 select jsonb_build_object('observedAt',now_time,'activeWindowSeconds',120,'retentionMinutes',30,
  'active',count(distinct coalesce(h.visitor_id,v.visit_id)) filter(where last_seen>=now_time-interval '120 seconds'),
  'activeCarts',count(distinct coalesce(h.visitor_id,v.visit_id)) filter(where last_seen>=now_time-interval '120 seconds' and has_cart and phase not in ('checkout','order')),
  'checkout',count(distinct coalesce(h.visitor_id,v.visit_id)) filter(where last_seen>=now_time-interval '120 seconds' and phase='checkout'),
  'productViews',count(distinct coalesce(h.visitor_id,v.visit_id)) filter(where last_seen>=now_time-interval '120 seconds' and phase='product'),
  'sessions',count(*),'locations',(select coalesce(jsonb_agg(row),'[]') from (
    select city,region,country,count(distinct coalesce(h.visitor_id,v.visit_id)) visitors,avg(latitude) latitude,avg(longitude) longitude from private.store_live_visits v left join private.store_visit_history h using(visit_id)
    where last_seen>=now_time-interval '120 seconds' group by city,region,country order by count(distinct coalesce(h.visitor_id,v.visit_id)) desc,city limit 100
  ) row)) into result from private.store_live_visits v left join private.store_visit_history h using(visit_id);
 return result||jsonb_build_object(
  'ordersToday',(select count(*) from jsonb_array_elements(coalesce(orders,'[]')) o where o->>'status'<>'cancelled' and private.live_order_day(o)=today),
  'revenueToday',(select coalesce(sum((select coalesce(sum((item->>'price')::numeric*(item->>'qty')::numeric),0) from jsonb_array_elements(o->'items') item)),0)
    from jsonb_array_elements(coalesce(orders,'[]')) o where o->>'paid'='true' and private.live_order_day(o)=today
      and (case when o->>'paymentTiming'='Na entrega' then o->>'status'='delivered' else o->>'status' in ('transit','delivered') end)));
end $$;
notify pgrst,'reload schema';
