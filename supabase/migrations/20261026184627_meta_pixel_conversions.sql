-- Optional marketing attribution, isolated from public catalog / financial state.
create table private.meta_order_attribution(
 order_id bigint primary key, attribution_id uuid not null unique,
 user_data jsonb not null, consent_version text not null, order_fingerprint text not null,
 created_at timestamptz not null default now(), revoked_at timestamptz
);
create table private.meta_event_outbox(
 id text primary key, order_id bigint not null references private.meta_order_attribution(order_id) on delete cascade,
 event_name text not null check(event_name in ('OrderPending','Purchase','OrderDelivered','OrderCancelled')),
 event_time timestamptz not null default now(), payload jsonb not null,
 state text not null default 'pending' check(state in ('pending','sending','sent','failed','revoked','cancelled','expired')),
 attempts integer not null default 0, next_attempt timestamptz not null default now(),
 lease uuid, first_attempt timestamptz, sent_at timestamptz, last_code text, trace text
);
create index meta_outbox_pending on private.meta_event_outbox(next_attempt) where state in ('pending','sending');
alter table private.meta_order_attribution enable row level security;
alter table private.meta_event_outbox enable row level security;
revoke all on private.meta_order_attribution,private.meta_event_outbox from public,anon,authenticated;
create policy meta_service_attribution on private.meta_order_attribution to service_role using(true) with check(true);
create policy meta_service_outbox on private.meta_event_outbox to service_role using(true) with check(true);

create function private.meta_enqueue(p_order jsonb,p_event text,p_time timestamptz default now()) returns void
language plpgsql security definer set search_path=pg_catalog,private as $$
declare ctx private.meta_order_attribution%rowtype; items jsonb; amount numeric;
begin
 select * into ctx from private.meta_order_attribution where order_id=(p_order->>'id')::bigint and revoked_at is null and created_at>now()-interval '90 days';
 if ctx.order_id is null or p_order->>'channel'<>'Loja online' then return;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',value->>'id','quantity',(value->>'qty')::integer,'item_price',(value->>'price')::numeric)),'[]'::jsonb)
 into items from jsonb_array_elements(p_order->'items');
 select coalesce((p_order->>'total')::numeric,sum((value->>'qty')::numeric*(value->>'price')::numeric)+coalesce((p_order->>'freight')::numeric,0)+coalesce((p_order->>'paymentFee')::numeric,0)) into amount from jsonb_array_elements(p_order->'items');
 insert into private.meta_event_outbox(id,order_id,event_name,event_time,payload)
 values('fo:'||ctx.attribution_id||':'||p_event,ctx.order_id,p_event,p_time,jsonb_build_object(
 'content_type','product','content_ids',(select jsonb_agg(value->'id') from jsonb_array_elements(items)),
 'contents',items,'num_items',(select sum((value->>'quantity')::integer) from jsonb_array_elements(items)),
 'currency','BRL','value',round(amount,2),'order_id',p_order->>'id',
 'payment_status',case when p_order->>'paid'='true' then 'paid' else 'pending' end)) on conflict(id) do nothing;
end $$;

create function private.register_meta_order(p_order jsonb,p_context jsonb) returns void
language plpgsql security definer set search_path=pg_catalog,private,extensions as $$
declare u jsonb; id uuid; phone text;
begin
 if p_context->>'consent' is distinct from 'true' or p_context->>'consentVersion' is distinct from 'meta-2026-10'
  or p_order->>'channel' is distinct from 'Loja online' or coalesce(p_context->>'id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return;end if;
 id:=(p_context->>'id')::uuid;
 -- Never attribute staff / POS orders to an advertising customer.
 if exists(select 1 from public.profiles where user_id=auth.uid() and role in ('master','admin','driver')) then return;end if;
 phone:=regexp_replace(coalesce(p_order->>'phone',''),'[^0-9]','','g');if length(phone) in (10,11) then phone:='55'||phone;end if;
 u:=jsonb_strip_nulls(jsonb_build_object(
 'em',case when nullif(trim(p_order->>'email'),'') is not null then jsonb_build_array(encode(extensions.digest(lower(trim(p_order->>'email')),'sha256'),'hex')) end,
 'ph',case when length(phone) between 12 and 15 then jsonb_build_array(encode(extensions.digest(phone,'sha256'),'hex')) end,
 'external_id',jsonb_build_array(encode(extensions.digest(coalesce(nullif(p_order->>'customer_id',''),nullif(p_order->>'user_id',''),lower(trim(p_order->>'email'))),'sha256'),'hex')),
 'country',jsonb_build_array(encode(extensions.digest('br','sha256'),'hex')),
 'fbp',case when p_context->>'fbp' ~ '^fb\.[0-9]+\.[0-9]+\.[A-Za-z0-9_-]{1,200}$' then p_context->>'fbp' end,
 'fbc',case when p_context->>'fbc' ~ '^fb\.[0-9]+\.[0-9]+\.[A-Za-z0-9_.-]{1,500}$' then p_context->>'fbc' end,
 'client_user_agent',nullif(left(p_context->>'userAgent',500),'')));
 insert into private.meta_order_attribution(order_id,attribution_id,user_data,consent_version,order_fingerprint)
 values((p_order->>'id')::bigint,id,u,'meta-2026-10',encode(extensions.digest(coalesce(p_order->>'guestToken',p_order->>'createdAt',id::text),'sha256'),'hex'))
 on conflict(order_id) do update set attribution_id=excluded.attribution_id,user_data=excluded.user_data,consent_version=excluded.consent_version,
 order_fingerprint=excluded.order_fingerprint,created_at=now(),revoked_at=null
 where private.meta_order_attribution.order_fingerprint<>excluded.order_fingerprint;
 perform private.meta_enqueue(p_order,'OrderPending');
 if p_order->>'paid'='true' and p_order->>'status'<>'cancelled' then perform private.meta_enqueue(p_order,'Purchase');end if;
exception when unique_violation then
 -- An invalid reused advertising UUID must never reject a legitimate order.
 return;
end $$;

-- Add attribution after the server has validated product prices, freight and fees.
-- Keep the current checkout implementation and all its existing validations intact.
do $patch$ declare definition text;begin
 definition:=pg_get_functiondef('private.place_order(jsonb)'::regprocedure);
 if position('perform private.register_meta_order' in definition)=0 then
  if position('  return jsonb_set(response' in definition)=0 then raise exception 'Checkout signature changed; inspect before applying';end if;
  execute replace(definition,'  return jsonb_set(response',E'  perform private.register_meta_order(target,p_request->''meta'');\n  return jsonb_set(response');
 end if;
end $patch$;

create function private.meta_order_changes() returns trigger language plpgsql security definer
set search_path=pg_catalog,private as $$
declare o jsonb; prev jsonb;
begin
 if old.data->'orders' is not distinct from new.data->'orders' then return new;end if;
 for o in select value from jsonb_array_elements(coalesce(new.data->'orders','[]')) loop
  select value into prev from jsonb_array_elements(coalesce(old.data->'orders','[]')) where value->>'id'=o->>'id';
  if prev is null then continue;end if; -- Attribution is registered atomically after the final checkout quote.
  if o->>'status'='cancelled' and prev->>'status'<>'cancelled' then
   update private.meta_event_outbox set state='cancelled',payload='{}' where order_id=(o->>'id')::bigint and state in ('pending','sending');
   perform private.meta_enqueue(o,'OrderCancelled');
  elsif o->>'status'<>'cancelled' then
   if o->>'paid'='true' and prev->>'paid' is distinct from 'true' then perform private.meta_enqueue(o,'Purchase');end if;
   if o->>'status'='delivered' and prev->>'status'<>'delivered' then perform private.meta_enqueue(o,'OrderDelivered');end if;
  end if;
 end loop;
 -- Deleted orders cannot leave advertising jobs waiting; the sent ledger is retained against duplicates.
 update private.meta_event_outbox q set state='cancelled',payload='{}' where q.state in ('pending','sending')
 and not exists(select 1 from jsonb_array_elements(coalesce(new.data->'orders','[]')) remaining_order where remaining_order->>'id'=q.order_id::text);
 return new;
end $$;
create trigger meta_order_changes after update of data on public.app_state for each row execute function private.meta_order_changes();

create function private.revoke_meta_marketing(p_ids uuid[]) returns void language plpgsql security definer
set search_path=pg_catalog,private as $$
begin
 if cardinality(p_ids)>50 then raise exception 'Limite excedido';end if;
 update private.meta_order_attribution set revoked_at=now(),user_data='{}' where attribution_id=any(p_ids) and revoked_at is null;
 update private.meta_event_outbox set state='revoked',payload='{}' where state in ('pending','sending') and order_id in(select order_id from private.meta_order_attribution where attribution_id=any(p_ids));
end $$;
create function public.revoke_meta_marketing(p_ids uuid[]) returns void language sql security invoker
set search_path=pg_catalog,private as $$select private.revoke_meta_marketing(p_ids)$$;

-- The independent worker secret can only claim this queue. It grants no customer or admin access.
select vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'forte_meta_worker_key')
where not exists(select 1 from vault.secrets where name='forte_meta_worker_key');
create function private.check_meta_worker(p_key text) returns boolean language sql security definer
set search_path=pg_catalog,vault as $$ select exists(select 1 from vault.decrypted_secrets where name='forte_meta_worker_key' and decrypted_secret=p_key) $$;
create function private.meta_worker_config(p_key text) returns jsonb language plpgsql security definer
set search_path=pg_catalog,private,vault as $$begin
 if not private.check_meta_worker(p_key) then raise exception 'Unauthorized';end if;
 return jsonb_build_object('token',(select decrypted_secret from vault.decrypted_secrets where name='forte_meta_capi_token'));
end $$;
create function private.meta_claim_events(p_key text) returns jsonb language plpgsql security definer
set search_path=pg_catalog,private as $$declare result jsonb;begin
 if not private.check_meta_worker(p_key) then raise exception 'Unauthorized';end if;
 update private.meta_event_outbox set state='expired',payload='{}' where state in ('pending','sending') and (event_time<now()-interval '6 days' or first_attempt<now()-interval '36 hours' or attempts>=12);
 with candidates as(select id from private.meta_event_outbox where state in ('pending','sending') and next_attempt<=now() order by next_attempt limit 10 for update skip locked),
 claimed as(update private.meta_event_outbox q set state='sending',attempts=attempts+1,first_attempt=coalesce(first_attempt,now()),next_attempt=now()+interval '5 minutes',lease=gen_random_uuid()
 from candidates c where q.id=c.id returning q.id,q.lease)
 select coalesce(jsonb_agg(claimed),'[]') into result from claimed;
 return result;
end $$;
create function private.meta_event_payload(p_key text,p_id text,p_lease uuid) returns jsonb language plpgsql security definer
set search_path=pg_catalog,private,public as $$declare q private.meta_event_outbox%rowtype; a private.meta_order_attribution%rowtype; o jsonb;begin
 if not private.check_meta_worker(p_key) then raise exception 'Unauthorized';end if;
 select * into q from private.meta_event_outbox where id=p_id and lease=p_lease and state='sending';if q.id is null then return null;end if;
 select * into a from private.meta_order_attribution where order_id=q.order_id and revoked_at is null and created_at>now()-interval '90 days';if a.order_id is null then return null;end if;
 select value into o from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') where s.id=1 and value->>'id'=q.order_id::text;
 if o is null or (q.event_name='Purchase' and (o->>'paid'<>'true' or o->>'status'='cancelled')) then return null;end if;
 return jsonb_build_object('event_name',q.event_name,'event_time',floor(extract(epoch from q.event_time)),
 'event_id',q.id,'action_source','website','event_source_url','https://forteoutlet.com.br/#/loja',
 'user_data',a.user_data,'custom_data',q.payload);
end $$;
create function private.meta_finish_event(p_key text,p_id text,p_lease uuid,p_ok boolean,p_code text,p_trace text) returns void
language plpgsql security definer set search_path=pg_catalog,private as $$begin
 if not private.check_meta_worker(p_key) then raise exception 'Unauthorized';end if;
 update private.meta_event_outbox set state=case when p_ok then 'sent' when p_code in ('190','200','10','100') then 'failed' else 'pending' end,
 sent_at=case when p_ok then now() else null end,last_code=left(p_code,20),trace=left(p_trace,120),
 next_attempt=now()+make_interval(secs=>least(21600,60*power(2,attempts)::integer)),
 payload=case when p_ok then '{}'::jsonb else payload end
 where id=p_id and lease=p_lease and state='sending';
end $$;

create function private.purge_meta_attribution() returns void language plpgsql security definer set search_path=pg_catalog,private as $$begin
 delete from private.meta_order_attribution where created_at<now()-interval '90 days';
end $$;

revoke all on function private.meta_enqueue(jsonb,text,timestamptz),private.register_meta_order(jsonb,jsonb),private.meta_order_changes(),private.check_meta_worker(text),private.purge_meta_attribution() from public,anon,authenticated;
revoke all on function private.revoke_meta_marketing(uuid[]),public.revoke_meta_marketing(uuid[]) from public,anon,authenticated;
grant execute on function private.revoke_meta_marketing(uuid[]),public.revoke_meta_marketing(uuid[]) to anon,authenticated;
create function public.meta_worker_config(p_key text) returns jsonb language sql security invoker set search_path=pg_catalog,private as $$select private.meta_worker_config(p_key)$$;
create function public.meta_claim_events(p_key text) returns jsonb language sql security invoker set search_path=pg_catalog,private as $$select private.meta_claim_events(p_key)$$;
create function public.meta_event_payload(p_key text,p_id text,p_lease uuid) returns jsonb language sql security invoker set search_path=pg_catalog,private as $$select private.meta_event_payload(p_key,p_id,p_lease)$$;
create function public.meta_finish_event(p_key text,p_id text,p_lease uuid,p_ok boolean,p_code text,p_trace text) returns void language sql security invoker set search_path=pg_catalog,private as $$select private.meta_finish_event(p_key,p_id,p_lease,p_ok,p_code,p_trace)$$;
revoke all on function private.meta_worker_config(text),private.meta_claim_events(text),private.meta_event_payload(text,text,uuid),private.meta_finish_event(text,text,uuid,boolean,text,text),public.meta_worker_config(text),public.meta_claim_events(text),public.meta_event_payload(text,text,uuid),public.meta_finish_event(text,text,uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function private.meta_worker_config(text),private.meta_claim_events(text),private.meta_event_payload(text,text,uuid),private.meta_finish_event(text,text,uuid,boolean,text,text),public.meta_worker_config(text),public.meta_claim_events(text),public.meta_event_payload(text,text,uuid),public.meta_finish_event(text,text,uuid,boolean,text,text) to service_role;

create extension if not exists pg_net with schema extensions;
create function private.dispatch_meta_events() returns void language plpgsql security definer
set search_path=pg_catalog,private,vault,net as $$begin
 if not exists(select 1 from private.meta_event_outbox where state in ('pending','sending') and next_attempt<=now()) then return;end if;
 perform net.http_post(url:='https://rwxqytomiorsrxpgtjin.supabase.co/functions/v1/meta-conversions',
 headers:=jsonb_build_object('Content-Type','application/json','x-meta-worker-key',(select decrypted_secret from vault.decrypted_secrets where name='forte_meta_worker_key')),body:='{}',timeout_milliseconds:=30000);
end $$;
revoke all on function private.dispatch_meta_events() from public,anon,authenticated;
select cron.schedule('forte-meta-conversions','* * * * *','select private.dispatch_meta_events()');
select cron.schedule('purge-forte-meta-attribution','17 4 * * *','select private.purge_meta_attribution()');
-- Add a distinct advertising disclosure, preserving all existing custom policy content.
update public.app_state set data=jsonb_set(data,'{pages}',(select jsonb_agg(case when value->>'policyKey' in ('privacy','cookies') and position('## Publicidade e conversões da Meta' in coalesce(value->>'content',''))=0 then jsonb_set(value,'{content}',to_jsonb(coalesce(value->>'content','')||E'\n\n## Publicidade e conversões da Meta\nA publicidade é opcional e tem consentimento separado da medição de visitas. Somente se você permitir, utilizamos o Pixel da Meta (2999298787072098) e a API de Conversões para registrar visualizações, pesquisas, produtos no carrinho, início do checkout, escolha de pagamento, cadastro, contato e situação dos pedidos. Pedidos pendentes são eventos próprios; a compra (Purchase) só é informada após a confirmação real do pagamento. Entregas e cancelamentos são informados separadamente.\nA Meta pode receber identificadores de navegador e anúncios (_fbp, _fbc e fbclid), navegador utilizado, produtos, quantidades, valores em reais e identificação técnica do pedido. Para associar a conversão, o e-mail, telefone e identificador de cliente são normalizados e protegidos com hash SHA-256 antes do envio. Hash não torna esses dados anônimos. Não enviamos CPF, endereço completo, comprovantes, senhas ou informações do cartão.\nOs identificadores de atribuição são mantidos no servidor por até 90 dias, com limpeza diária. Cookies da Meta podem permanecer por até 90 dias. Você pode recusar ou revogar em Preferências de privacidade, no rodapé. A recusa não afeta sua compra. A revogação interrompe o pixel neste navegador e cancela futuros envios dos pedidos associados a ele; dados já recebidos pela Meta seguem os controles e prazos da plataforma. Sinais DNT e Global Privacy Control são respeitados.\nA Meta atua conforme sua Política de Privacidade (https://www.facebook.com/privacy/policy/), que informa processamento, transferências internacionais e controles de publicidade. Para exercer seus direitos sobre dados sob responsabilidade da loja, use {{loja.email}} ou {{loja.whatsapp}}.')) else value end order by ord) from jsonb_array_elements(data->'pages') with ordinality item(value,ord))),version=version+1,updated_at=now() where id=1;
notify pgrst,'reload schema';
