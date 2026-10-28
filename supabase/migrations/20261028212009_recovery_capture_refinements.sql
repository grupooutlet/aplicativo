create or replace function private.capture_checkout_recovery(p_id uuid,p_secret uuid,p_data jsonb,p_sequence bigint,p_client_hash text) returns boolean
language plpgsql security definer set search_path=pg_catalog,private,public as $$
declare prior private.checkout_recovery%rowtype; phone_value text; source jsonb; line jsonb; product jsonb; clean_items jsonb:='[]';
 options jsonb; option_row jsonb; option_value text; quantity integer; price numeric; total numeric:=0; moment timestamptz:=clock_timestamp();
 consent_value boolean; first_value text; last_value text; email_value text; phase_value text;
begin
 if p_id is null or p_secret is null or p_client_hash!~'^[a-f0-9]{64}$' or p_sequence is null or p_sequence<1 or p_sequence>1000000
  or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>16000 then return false;end if;
 if p_data->>'cancel'='true' then
  select * into prior from private.checkout_recovery where id=p_id for update;
  if prior.id is null then return true;end if;
  if prior.secret_hash<>encode(sha256(convert_to(p_secret::text,'UTF8')),'hex') then return false;end if;
  if prior.status in ('open','contacted','waiting') then
   update private.checkout_recovery set status='closed',consent=false,updated_at=moment,revision=revision+1,
    events=events||jsonb_build_array(jsonb_build_object('action','cart_cleared','at',moment,'by','Cliente')) where id=p_id;
  end if;
  return true;
 end if;
 phone_value:=private.normalize_registration_phone(p_data->>'phone');
 if coalesce(phone_value,'')='' then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(phone_value,81630));
 if jsonb_typeof(p_data->'items')<>'array' or jsonb_array_length(p_data->'items') not between 1 and 30 then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_id::text,81629));
 select * into prior from private.checkout_recovery where id=p_id for update;
 if prior.id is not null then
  if prior.secret_hash<>encode(sha256(convert_to(p_secret::text,'UTF8')),'hex') then return false;end if;
  if prior.status in ('converted','closed','optout') or p_sequence<=prior.sequence then return true;end if;
  -- Revocation is never delayed by the normal write throttle.
  if prior.last_seen>moment-interval '10 seconds' and prior.consent=(p_data->>'consent'='true') then return false;end if;
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
  price:=coalesce(nullif(product->>'price','')::numeric,0);
  if coalesce(nullif(product->>'promoPrice','')::numeric,0)>0 and (product->>'promoPrice')::numeric<price then price:=(product->>'promoPrice')::numeric;end if;
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

create or replace function private.close_converted_checkouts() returns trigger language plpgsql security definer set search_path=pg_catalog,private,public as $$
declare order_row jsonb; phone_value text; moment timestamptz:=clock_timestamp();
begin
 if new.data->'orders' is not distinct from old.data->'orders' then return new;end if;
 for order_row in select value from jsonb_array_elements(coalesce(new.data->'orders','[]')) o(value)
  where not exists(select 1 from jsonb_array_elements(coalesce(old.data->'orders','[]')) previous where previous->>'id'=o.value->>'id') loop
  phone_value:=private.normalize_registration_phone(order_row->>'phone');
  if coalesce(phone_value,'')='' or order_row->>'status'='cancelled' then continue;end if;
  perform pg_advisory_xact_lock(hashtextextended(phone_value,81630));
  update private.checkout_recovery set status='converted',order_id=(order_row->>'id')::bigint,converted_at=moment,updated_at=moment,revision=revision+1,
   events=(select coalesce(jsonb_agg(value order by ord),'[]') from jsonb_array_elements(events||jsonb_build_array(jsonb_build_object('action','converted','at',moment,'by','Pedido criado','orderId',order_row->'id'))) with ordinality e(value,ord) where ord>greatest(0,jsonb_array_length(events)+1-30))
  where phone=phone_value and status in ('open','contacted','waiting') and created_at>moment-interval '30 days';
 end loop;
 return new;
end $$;

create or replace function private.list_checkout_recovery(p_query text default '',p_status text default 'pending',p_days integer default 30,p_page integer default 1) returns jsonb
language plpgsql security definer set search_path=pg_catalog,private,public as $$
declare result jsonb; since timestamptz; page_value integer:=greatest(1,least(coalesce(p_page,1),1000));
begin
 if not (private.is_manager() or private.is_seller()) then raise exception 'Acesso restrito à equipe de vendas e gestão.' using errcode='42501';end if;
 perform private.purge_checkout_recovery();
 since:=((clock_timestamp() at time zone 'America/Sao_Paulo')::date-(case when p_days in (1,7,30) then p_days else 30 end-1))::timestamp at time zone 'America/Sao_Paulo';
 with ranked as (select r.*,row_number() over(partition by phone order by last_seen desc,created_at desc,id) rank from private.checkout_recovery r where created_at>=since),
 rows as (select (private.checkout_recovery_row(r)-'events'-'notes'-'recovery_token') data from private.checkout_recovery r join ranked using(id) where ranked.rank=1),
 matched as (select data from rows where (coalesce(p_query,'')='' or translate(lower(concat_ws(' ',data->>'first_name',data->>'last_name',data->>'email',data->>'phone',data->>'locality',data->'items')),'áàãâéêíóôõúüç','aaaaeeiooouuc') like '%'||translate(lower(left(p_query,120)),'áàãâéêíóôõúüç','aaaaeeiooouuc')||'%'
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
