-- Serialize the byte-for-byte copy with payments submitted during deployment.
set local lock_timeout='3s';
select id from public.app_state where id=1 for update;
-- Proofs are private documents, loaded individually instead of copied with every order write.
create table private.order_payment_receipts (
  order_id bigint primary key check(order_id>0),
  image text not null check(left(image,23)='data:image/jpeg;base64,' and length(image) between 100 and 2400000),
  created_at timestamptz not null default clock_timestamp()
);
alter table private.order_payment_receipts enable row level security;
alter table private.order_payment_receipts force row level security;
revoke all on private.order_payment_receipts from public,anon,authenticated;

create or replace function private.valid_payment_photo(p_photo text)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,private as $$
begin
  if p_photo like 'private-receipt:%' then
    return exists(select 1 from private.order_payment_receipts where 'private-receipt:'||order_id::text=p_photo);
  end if;
  return p_photo is not null and left(p_photo,23)='data:image/jpeg;base64,' and length(p_photo) between 100 and 2400000
    and encode(substring(decode(substring(p_photo from 24),'base64') from 1 for 3),'hex')='ffd8ff';
exception when others then return false;
end;
$$;

create function private.store_private_payment_receipts()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare latest jsonb; original_image text; proof text; revised jsonb:='{}'; order_key bigint;
begin
  if new.data->'orders' is not distinct from old.data->'orders' then return new;end if;
  for latest in select d.latest from private.order_delta(old.data->'orders',new.data->'orders') d where d.latest is not null loop
    proof:=latest->>'receipt';
    if proof is null then continue;end if;
    order_key:=(latest->>'id')::bigint;
    if left(proof,23)='data:image/jpeg;base64,' then
      if not private.valid_payment_photo(proof) then raise exception 'Anexe uma foto válida do comprovante.';end if;
      insert into private.order_payment_receipts(order_id,image) values(order_key,proof)
        on conflict(order_id) do nothing;
      select image into original_image from private.order_payment_receipts where order_id=order_key;
      if original_image is distinct from proof then raise exception 'O comprovante confirmado deve ser preservado.';end if;
      revised:=revised||jsonb_build_object(order_key::text,latest||jsonb_build_object('receipt','private-receipt:'||order_key::text));
    elsif proof like 'private-receipt:%' and (
      proof is distinct from 'private-receipt:'||order_key::text or not private.valid_payment_photo(proof)
    ) then raise exception 'Comprovante não encontrado para este pedido.';
    end if;
  end loop;
  if revised<>'{}'::jsonb then
    new.data:=jsonb_set(new.data,'{orders}',(
      select jsonb_agg(coalesce(revised->(value->>'id'),value) order by ord)
      from jsonb_array_elements(new.data->'orders') with ordinality as x(value,ord)
    ));
  end if;
  return new;
end;
$$;
revoke all on function private.store_private_payment_receipts() from public,anon,authenticated;
create trigger store_private_payment_receipts before update of data on public.app_state
for each row execute function private.store_private_payment_receipts();

create function private.payment_receipt(p_order_id bigint)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
declare actor public.profiles%rowtype; target jsonb; image text;
begin
  select * into actor from public.profiles where user_id=auth.uid();
  if actor.role is null or actor.role not in ('master','admin','driver')
    or not exists(select 1 from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id') then
    raise exception 'Acesso restrito à equipe.';
  end if;
  select value into target from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') where s.id=1 and value->>'id'=p_order_id::text;
  if target is null or (actor.role='driver' and (target->>'delivery' is distinct from 'Entrega'
    or (nullif(target->>'driver_id','') is not null and target->>'driver_id'<>auth.uid()::text))) then
    raise exception 'Pedido não disponível para este perfil.';
  end if;
  select r.image into image from private.order_payment_receipts r where r.order_id=p_order_id;
  if image is null and left(target->>'receipt',23)='data:image/jpeg;base64,' then image:=target->>'receipt';end if;
  return jsonb_build_object('image',image);
end;
$$;
revoke all on function private.payment_receipt(bigint) from public,anon,authenticated;
grant execute on function private.payment_receipt(bigint) to authenticated;
create function public.payment_receipt(p_order_id bigint)
returns jsonb language sql security invoker set search_path=pg_catalog,private as $$select private.payment_receipt(p_order_id)$$;
revoke all on function public.payment_receipt(bigint) from public,anon,authenticated;
grant execute on function public.payment_receipt(bigint) to authenticated;

-- Copy every existing proof byte-for-byte before replacing its inline representation.
insert into private.order_payment_receipts(order_id,image)
select (o->>'id')::bigint,o->>'receipt'
from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') o
where s.id=1 and left(o->>'receipt',23)='data:image/jpeg;base64,' and private.valid_payment_photo(o->>'receipt');

update public.app_state set data=jsonb_set(data,'{orders}',(
  select jsonb_agg(case when exists(select 1 from private.order_payment_receipts r where r.order_id=(o->>'id')::bigint)
    then o||jsonb_build_object('receipt','private-receipt:'||(o->>'id')) else o end order by ord)
  from jsonb_array_elements(data->'orders') with ordinality as x(o,ord)
)),version=version+1,updated_at=now() where id=1;
