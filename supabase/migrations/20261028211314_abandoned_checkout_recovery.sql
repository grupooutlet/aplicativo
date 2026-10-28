-- Identified checkout attempts are operational data, never orders or public catalog data.
create table private.checkout_recovery (
 id uuid primary key,
 secret_hash text not null,
 recovery_token uuid not null unique default gen_random_uuid(),
 phone text not null,
 first_name text not null default '', last_name text not null default '', email text not null default '',
 items jsonb not null default '[]', subtotal numeric(12,2) not null default 0,
 delivery text not null default '', locality text not null default '', phase text not null default 'contact',
 consent boolean not null default false, consent_at timestamptz, consent_version text,
 status text not null default 'open' check(status in ('open','contacted','waiting','closed','optout','converted')),
 created_at timestamptz not null default clock_timestamp(), last_seen timestamptz not null default clock_timestamp(),
 updated_at timestamptz not null default clock_timestamp(), sequence bigint not null default 0, revision bigint not null default 1,
 client_hash text not null, assigned_to uuid, assigned_name text,
 last_contact_at timestamptz, contact_count integer not null default 0,
 order_id bigint, converted_at timestamptz, notes text not null default '', events jsonb not null default '[]'
);
create index checkout_recovery_phone_idx on private.checkout_recovery(phone,last_seen desc);
create index checkout_recovery_created_idx on private.checkout_recovery(created_at desc);
create index checkout_recovery_client_idx on private.checkout_recovery(client_hash,created_at desc);
create index checkout_recovery_assigned_idx on private.checkout_recovery(assigned_to) where assigned_to is not null;
create table private.checkout_contact_blocks(phone_hash text primary key,expires_at timestamptz not null);
alter table private.checkout_recovery enable row level security;
alter table private.checkout_contact_blocks enable row level security;
revoke all on private.checkout_recovery,private.checkout_contact_blocks from public,anon,authenticated;
create policy "Checkout attempts are accessed through bounded functions" on private.checkout_recovery for all to anon,authenticated using(false) with check(false);
create policy "Contact blocks are private" on private.checkout_contact_blocks for all to anon,authenticated using(false) with check(false);

create function private.purge_checkout_recovery() returns void language plpgsql security definer set search_path=pg_catalog,private as $$
begin
 delete from private.checkout_recovery where created_at<clock_timestamp()-interval '30 days';
 delete from private.checkout_contact_blocks where expires_at<clock_timestamp();
end $$;
revoke all on function private.purge_checkout_recovery() from public,anon,authenticated;

create function private.capture_checkout_recovery(p_id uuid,p_secret uuid,p_data jsonb,p_sequence bigint,p_client_hash text) returns boolean
language plpgsql security definer set search_path=pg_catalog,private,public as $$
declare prior private.checkout_recovery%rowtype; phone_value text; source jsonb; line jsonb; product jsonb; clean_items jsonb:='[]';
 options jsonb; option_row jsonb; option_value text; quantity integer; price numeric; total numeric:=0; moment timestamptz:=clock_timestamp();
 consent_value boolean; first_value text; last_value text; email_value text; phase_value text;
begin
 if p_id is null or p_secret is null or p_client_hash!~'^[a-f0-9]{64}$' or p_sequence is null or p_sequence<1 or p_sequence>1000000
  or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16000 then return false;end if;
 phone_value:=private.normalize_registration_phone(p_data->>'phone');
 if coalesce(phone_value,'')='' then return false;end if;
 if jsonb_typeof(p_data->'items')<>'array' or jsonb_array_length(p_data->'items') not between 1 and 30 then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,81629));
 select * into prior from private.checkout_recovery where id=p_id for update;
 if prior.id is not null then
  if prior.secret_hash<>encode(sha256(convert_to(p_secret::text,'UTF8')),'hex') then return false;end if;
  if prior.status in ('converted','closed','optout') or p_sequence<=prior.sequence then return true;end if;
  -- Revocation is never delayed by the normal write throttle.
  if prior.last_seen>moment-interval '10 seconds' and not (prior.consent and p_data->>'consent'='false') then return true;end if;
 else
  -- A delayed first write after a completed checkout must never create a new reminder.
  if exists(select 1 from public.app_state s,jsonb_array_elements(coalesce(s.data->'orders','[]')) o
   where s.id=1 and private.normalize_registration_phone(o->>'phone')=phone_value and o->>'status'<>'cancelled'
   and coalesce(o->>'createdAt','')~'^[0-9]{4}-[0-9]{2}-[0-9]{2}T' and (o->>'createdAt')::timestamptz>moment-interval '30 minutes') then return true;end if;
  -- Serialize the small creation budget, not every update. Hash comes only from the server.
  perform pg_advisory_xact_lock(816291);
  if (select count(*) from private.checkout_recovery where client_hash=p_client_hash and created_at>moment-interval '1 hour')>=20
   or (select count(*) from private.checkout_recovery where created_at>moment-interval '1 hour')>=1000
   or (select count(*) from private.checkout_recovery where phone=phone_value and created_at>moment-interval '1 day')>=5 then return false;end if;
 end if;
 select data into source from public.shop_public where id=1;
 for line in select value from jsonb_array_elements(p_data->'items') loop
  if line->>'id'!~'^[0-9]{1,12}$' or line->>'qty'!~'^[0-9]{1,2}$' then return false;end if;
  quantity:=(line->>'qty')::integer;if quantity not between 1 and 20 then return false;end if;
  select value into product from jsonb_array_elements(source->'products') where value->>'id'=line->>'id' and value->>'active'='true';
  if product is null then continue;end if;
  options:='{}';
  for option_row in select value from jsonb_array_elements(coalesce(product->'variations','[]')) loop
   option_value:=line->'options'->>(option_row->>'name');
   if option_value is not null and (option_row->'values') ? option_value then options:=options||jsonb_build_object(option_row->>'name',option_value);end if;
  end loop;
  price:=coalesce(nullif(product->>'promoPrice','')::numeric,nullif(product->>'price','')::numeric,0);
  if price<0 or price>9999999 then return false;end if;
  clean_items:=clean_items||jsonb_build_array(jsonb_build_object('id',(product->>'id')::bigint,'name',left(product->>'name',300),'image',product->>'image','qty',quantity,'price',price,'options',options));
  total:=total+price*quantity;
 end loop;
 if jsonb_array_length(clean_items)=0 then return false;end if;
 first_value:=left(trim(regexp_replace(coalesce(p_data->>'firstName',''),'[[:space:]]+',' ','g')),60);
 last_value:=left(trim(regexp_replace(coalesce(p_data->>'lastName',''),'[[:space:]]+',' ','g')),60);
 if first_value!~'^[[:alpha:]][[:alpha:] .’''-]*$' then first_value:='';end if;
 if last_value!~'^[[:alpha:]][[:alpha:] .’''-]*$' then last_value:='';end if;
 email_value:=lower(left(trim(coalesce(p_data->>'email','')),254));
 if email_value!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then email_value:='';end if;
 consent_value:=p_data->>'consent'='true' and not exists(select 1 from private.checkout_contact_blocks where phone_hash=encode(sha256(convert_to(phone_value,'UTF8')),'hex') and expires_at>moment);
 phase_value:=case when p_data->>'phase' in ('contact','delivery','payment','error') then p_data->>'phase' else 'contact' end;
 insert into private.checkout_recovery(id,secret_hash,phone,first_name,last_name,email,items,subtotal,delivery,locality,phase,consent,consent_at,consent_version,sequence,client_hash)
 values(p_id,encode(sha256(convert_to(p_secret::text,'UTF8')),'hex'),phone_value,first_value,last_value,email_value,clean_items,total,
  case when p_data->>'delivery' in ('Entrega','Retirada') then p_data->>'delivery' else '' end,left(coalesce(p_data->>'locality',''),120),phase_value,
  consent_value,case when consent_value then moment end,case when consent_value then 'checkout-help-v1' end,p_sequence,p_client_hash)
 on conflict(id) do update set phone=excluded.phone,first_name=excluded.first_name,last_name=excluded.last_name,email=excluded.email,items=excluded.items,subtotal=excluded.subtotal,
  delivery=excluded.delivery,locality=excluded.locality,phase=excluded.phase,consent=excluded.consent,
  consent_at=case when excluded.consent then case when private.checkout_recovery.consent and private.checkout_recovery.phone=excluded.phone then private.checkout_recovery.consent_at else moment end end,
  consent_version=excluded.consent_version,sequence=p_sequence,last_seen=moment,updated_at=moment,revision=private.checkout_recovery.revision+1;
 return true;
end $$;
create function public.capture_checkout_recovery(p_id uuid,p_secret uuid,p_data jsonb,p_sequence bigint,p_client_hash text) returns boolean
language sql security invoker set search_path=pg_catalog,private as $$select private.capture_checkout_recovery(p_id,p_secret,p_data,p_sequence,p_client_hash)$$;
revoke all on function private.capture_checkout_recovery(uuid,uuid,jsonb,bigint,text),public.capture_checkout_recovery(uuid,uuid,jsonb,bigint,text) from public,anon,authenticated;
grant execute on function private.capture_checkout_recovery(uuid,uuid,jsonb,bigint,text),public.capture_checkout_recovery(uuid,uuid,jsonb,bigint,text) to service_role;

create function private.checkout_recovery_row(p_row private.checkout_recovery) returns jsonb
language sql stable set search_path=pg_catalog as $$
 select to_jsonb(p_row)-'secret_hash'-'client_hash'-'sequence'||jsonb_build_object('stage',case
 when p_row.status='converted' then 'converted' when p_row.status in ('closed','optout') then p_row.status
 when p_row.last_seen>now()-interval '30 minutes' then 'active' when not p_row.consent then 'unconsented'
 when p_row.status='open' then 'pending' else p_row.status end)
$$;
revoke all on function private.checkout_recovery_row(private.checkout_recovery) from public,anon,authenticated;

create function private.list_checkout_recovery(p_query text default '',p_status text default 'pending',p_days integer default 30,p_page integer default 1) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private,public as $$
declare result jsonb; since timestamptz; page_value integer:=greatest(1,least(coalesce(p_page,1),1000));
begin
 if not (private.is_manager() or private.is_seller()) then raise exception 'Acesso restrito à equipe de vendas e gestão.' using errcode='42501';end if;
 perform private.purge_checkout_recovery();
 since:=((clock_timestamp() at time zone 'America/Sao_Paulo')::date-(case when p_days in (1,7,30) then p_days else 30 end-1))::timestamp at time zone 'America/Sao_Paulo';
 with ranked as (select r.*,row_number() over(partition by phone order by last_seen desc,created_at desc,id) rank from private.checkout_recovery r where created_at>=since),
 rows as (select private.checkout_recovery_row(r) data from private.checkout_recovery r join ranked using(id) where ranked.rank=1),
 matched as (select data from rows where (coalesce(p_query,'')='' or translate(lower(data::text),'áàãâéêíóôõúüç','aaaaeeiooouuc') like '%'||translate(lower(left(p_query,120)),'áàãâéêíóôõúüç','aaaaeeiooouuc')||'%'
  or (length(regexp_replace(p_query,'[^0-9]','','g'))>=4 and data->>'phone' like '%'||regexp_replace(p_query,'[^0-9]','','g')||'%'))),
 filtered as (select data from matched where p_status='all' or p_status='pending' and data->>'stage' in ('pending','contacted','waiting') or data->>'stage'=p_status),
 paged as (select data from filtered order by (data->>'last_seen')::timestamptz desc offset (page_value-1)*30 limit 30)
 select jsonb_build_object('rows',coalesce((select jsonb_agg(data) from paged),'[]'),'total',(select count(*) from filtered),'page',page_value,
  'summary',jsonb_build_object('pending',(select count(*) from rows where data->>'stage' in ('pending','contacted','waiting')),
   'potential',coalesce((select sum((data->>'subtotal')::numeric) from rows where data->>'stage' in ('pending','contacted','waiting')),0),
   'contacted',(select count(*) from rows where (data->>'contact_count')::integer>0),
   'converted',(select count(distinct data->>'order_id') from rows where data->>'stage'='converted')),
  'observedAt',clock_timestamp()) into result;
 return result;
end $$;
create function public.list_checkout_recovery(p_query text default '',p_status text default 'pending',p_days integer default 30,p_page integer default 1) returns jsonb
language sql security invoker set search_path=pg_catalog,private as $$select private.list_checkout_recovery(p_query,p_status,p_days,p_page)$$;

create function private.checkout_recovery_detail(p_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private as $$
declare row private.checkout_recovery%rowtype;
begin
 if not (private.is_manager() or private.is_seller()) then raise exception 'Acesso restrito à equipe de vendas e gestão.' using errcode='42501';end if;
 select * into row from private.checkout_recovery where id=p_id and created_at>clock_timestamp()-interval '30 days';
 if row.id is null then raise exception 'Este checkout não está mais disponível.';end if;
 return private.checkout_recovery_row(row);
end $$;
create function public.checkout_recovery_detail(p_id uuid) returns jsonb language sql security invoker set search_path=pg_catalog,private as $$select private.checkout_recovery_detail(p_id)$$;

create function private.update_checkout_recovery(p_id uuid,p_action text,p_revision bigint,p_notes text default '') returns jsonb
language plpgsql security definer set search_path=pg_catalog,private,public as $$
declare row private.checkout_recovery%rowtype; actor text; moment timestamptz:=clock_timestamp();event jsonb; new_status text;
begin
 if not (private.is_manager() or private.is_seller()) then raise exception 'Acesso restrito à equipe de vendas e gestão.' using errcode='42501';end if;
 select name into actor from public.profiles where user_id=auth.uid();
 select * into row from private.checkout_recovery where id=p_id and created_at>moment-interval '30 days' for update;
 if row.id is null then raise exception 'Este checkout não está mais disponível.';end if;
 if row.revision<>p_revision then raise exception 'Este atendimento foi atualizado. Reabra os detalhes para conferir.' using errcode='40001';end if;
 if p_action not in ('claim','opened','contacted','waiting','close','reopen','optout','note') then raise exception 'Ação inválida.';end if;
 if length(p_notes)>2000 then raise exception 'Use até 2.000 caracteres na observação.';end if;
 if p_action in ('opened','contacted','waiting') and (not row.consent or row.last_seen>moment-interval '30 minutes' or row.status in ('converted','closed','optout')
  or exists(select 1 from private.checkout_contact_blocks where phone_hash=encode(sha256(convert_to(row.phone,'UTF8')),'hex') and expires_at>moment)) then
  raise exception 'O checkout está ativo, foi concluído ou não permite contato pelo WhatsApp.';end if;
 if row.status='converted' and p_action not in ('note','optout') then raise exception 'Já existe um pedido. Acompanhe pelo menu Pedidos.';end if;
 if p_action='reopen' and row.status<>'closed' then raise exception 'Somente um atendimento encerrado pode ser reaberto.';end if;
 if p_action='claim' and row.assigned_to is not null and row.assigned_to<>auth.uid() then raise exception 'Este atendimento já está com outra pessoa da equipe.';end if;
 if p_action in ('opened','contacted','waiting') and row.assigned_to is not null and row.assigned_to<>auth.uid() then raise exception 'Este atendimento já está com outra pessoa. Combine o contato com ela.';end if;
 if p_action='contacted' and exists(select 1 from private.checkout_recovery where phone=row.phone and last_contact_at>moment-interval '1 hour') then raise exception 'Já foi registrado um contato na última hora. Evite mensagens repetidas.';end if;
 if p_action='optout' then
  insert into private.checkout_contact_blocks values(encode(sha256(convert_to(row.phone,'UTF8')),'hex'),moment+interval '90 days') on conflict(phone_hash) do update set expires_at=excluded.expires_at;
  update private.checkout_recovery set consent=false,status=case when status='converted' then status else 'optout' end,updated_at=moment,revision=revision+1 where phone=row.phone and id<>row.id;
 end if;
 new_status:=case p_action when 'contacted' then 'contacted' when 'waiting' then 'waiting' when 'close' then 'closed' when 'reopen' then 'open' when 'optout' then case when row.status='converted' then 'converted' else 'optout' end else row.status end;
 event:=jsonb_build_object('action',p_action,'at',moment,'by',coalesce(actor,'Equipe'),'actorId',auth.uid());
 update private.checkout_recovery set status=new_status,notes=case when p_action='note' then coalesce(p_notes,'') else notes end,
  consent=case when p_action='optout' then false else consent end,
  assigned_to=case when p_action in ('claim','opened','contacted') then auth.uid() else assigned_to end,
  assigned_name=case when p_action in ('claim','opened','contacted') then actor else assigned_name end,
  contact_count=contact_count+case when p_action='contacted' then 1 else 0 end,last_contact_at=case when p_action='contacted' then moment else last_contact_at end,
  events=(select coalesce(jsonb_agg(value order by ord),'[]') from jsonb_array_elements(events||jsonb_build_array(event)) with ordinality e(value,ord) where ord>greatest(0,jsonb_array_length(events)+1-30)),
  updated_at=moment,revision=revision+1 where id=p_id returning * into row;
 return private.checkout_recovery_row(row);
end $$;
create function public.update_checkout_recovery(p_id uuid,p_action text,p_revision bigint,p_notes text default '') returns jsonb
language sql security invoker set search_path=pg_catalog,private as $$select private.update_checkout_recovery(p_id,p_action,p_revision,p_notes)$$;
revoke all on function private.list_checkout_recovery(text,text,integer,integer),public.list_checkout_recovery(text,text,integer,integer),private.checkout_recovery_detail(uuid),public.checkout_recovery_detail(uuid),private.update_checkout_recovery(uuid,text,bigint,text),public.update_checkout_recovery(uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function private.list_checkout_recovery(text,text,integer,integer),public.list_checkout_recovery(text,text,integer,integer),private.checkout_recovery_detail(uuid),public.checkout_recovery_detail(uuid),private.update_checkout_recovery(uuid,text,bigint,text),public.update_checkout_recovery(uuid,text,bigint,text) to authenticated;

-- Opaque links expose cart contents only, never contact, address, account or draft secrets.
create function private.resume_checkout_recovery(p_token uuid) returns jsonb language plpgsql security definer set search_path=pg_catalog,private,public as $$
declare row private.checkout_recovery%rowtype; current_products jsonb; result jsonb;
begin
 select * into row from private.checkout_recovery where recovery_token=p_token and created_at>clock_timestamp()-interval '30 days' and status not in ('converted','closed','optout');
 if row.id is null then return null;end if;
 select data->'products' into current_products from public.shop_public where id=1;
 select jsonb_agg(jsonb_build_object('id',item->'id','qty',item->'qty','options',item->'options')) into result
 from jsonb_array_elements(row.items) item where exists(select 1 from jsonb_array_elements(current_products) p where p->>'id'=item->>'id' and p->>'active'='true');
 return jsonb_build_object('items',coalesce(result,'[]'));
end $$;
create function public.resume_checkout_recovery(p_token uuid) returns jsonb language sql security invoker set search_path=pg_catalog,private as $$select private.resume_checkout_recovery(p_token)$$;
revoke all on function private.resume_checkout_recovery(uuid),public.resume_checkout_recovery(uuid) from public,anon,authenticated;
grant execute on function private.resume_checkout_recovery(uuid),public.resume_checkout_recovery(uuid) to anon,authenticated;

-- All genuine new orders suppress reminders atomically, even on another device or paid on delivery.
create function private.close_converted_checkouts() returns trigger language plpgsql security definer set search_path=pg_catalog,private,public as $$
declare order_row jsonb; phone_value text; moment timestamptz:=clock_timestamp();
begin
 if new.data->'orders' is not distinct from old.data->'orders' then return new;end if;
 for order_row in select value from jsonb_array_elements(coalesce(new.data->'orders','[]')) o(value)
  where not exists(select 1 from jsonb_array_elements(coalesce(old.data->'orders','[]')) previous where previous->>'id'=o.value->>'id') loop
  phone_value:=private.normalize_registration_phone(order_row->>'phone');
  if coalesce(phone_value,'')='' or order_row->>'status'='cancelled' then continue;end if;
  update private.checkout_recovery set status='converted',order_id=(order_row->>'id')::bigint,converted_at=moment,updated_at=moment,revision=revision+1,
   events=(select coalesce(jsonb_agg(value order by ord),'[]') from jsonb_array_elements(events||jsonb_build_array(jsonb_build_object('action','converted','at',moment,'by','Pedido criado','orderId',order_row->'id'))) with ordinality e(value,ord) where ord>greatest(0,jsonb_array_length(events)+1-30))
  where phone=phone_value and status in ('open','contacted','waiting') and created_at>moment-interval '30 days';
 end loop;
 return new;
end $$;
revoke all on function private.close_converted_checkouts() from public,anon,authenticated;
create trigger close_converted_checkouts after update of data on public.app_state for each row execute function private.close_converted_checkouts();

create extension if not exists pg_cron with schema pg_catalog;
select cron.schedule('purge-checkout-recovery','23 4 * * *','select private.purge_checkout_recovery()');
