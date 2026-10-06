-- Grupo Outlet: customer accounts, staff roles, and product image storage.
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  name text not null default '',
  role text not null default 'customer' check (role in ('customer','admin','master')),
  position text check (position in ('Gerente','Vendedor','Outro')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;

create or replace function private.is_admin()
returns boolean language sql stable security definer
set search_path = pg_catalog, private, public as $$
  select private.is_master() or exists (
    select 1 from public.profiles
    where user_id = (select auth.uid()) and role = 'admin'
  )
$$;
revoke all on function private.is_admin() from public;
grant execute on function private.is_admin() to authenticated;

create policy "Users see own profile and admins see profiles" on public.profiles
  for select to authenticated
  using (user_id = (select auth.uid()) or (select private.is_admin()));

create or replace function private.create_profile()
returns trigger language plpgsql security definer
set search_path = pg_catalog, public as $$
begin
  insert into public.profiles(user_id,email,name,role)
  values (new.id, lower(new.email), left(trim(coalesce(new.raw_user_meta_data->>'name','')),120), 'customer')
  on conflict (user_id) do nothing;
  return new;
end;
$$;
revoke all on function private.create_profile() from public;
drop trigger if exists create_profile_after_signup on auth.users;
create trigger create_profile_after_signup after insert on auth.users
for each row execute function private.create_profile();

insert into public.profiles(user_id,email,name,role)
select m.user_id,m.email,'Grupo Outlet','master' from private.master_account m
on conflict (user_id) do update set role='master', email=excluded.email, name=excluded.name;

drop policy if exists "Master reads operational state" on public.app_state;
drop policy if exists "Master updates operational state" on public.app_state;
create policy "Staff reads operational state" on public.app_state
  for select to authenticated using ((select private.is_admin()));
create policy "Staff updates operational state" on public.app_state
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

create or replace function public.promote_customer(p_user_id uuid, p_position text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, private as $$
begin
  if not private.is_master() then raise exception 'Somente a conta principal pode alterar permissões.'; end if;
  if p_position not in ('Gerente','Vendedor','Outro') then raise exception 'Cargo inválido.'; end if;
  update public.profiles set role='admin', position=p_position
  where user_id=p_user_id and role='customer';
  if not found then raise exception 'Cliente não encontrado.'; end if;
end;
$$;
revoke all on function public.promote_customer(uuid,text) from public;
grant execute on function public.promote_customer(uuid,text) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('product-photos','product-photos',true,7340032,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true,file_size_limit=excluded.file_size_limit,
  allowed_mime_types=excluded.allowed_mime_types;
create policy "Staff uploads product photos" on storage.objects
  for insert to authenticated with check (bucket_id='product-photos' and (select private.is_admin()));
create policy "Staff removes product photos" on storage.objects
  for delete to authenticated using (bucket_id='product-photos' and (select private.is_admin()));

-- Email addresses are not verified in this store, so order access is tied to the user ID.
create or replace function private.my_orders()
returns jsonb language sql stable security definer
set search_path = pg_catalog, public as $$
  select coalesce(jsonb_agg(
    jsonb_set(ord.value - 'receipt', '{items}',
      (select coalesce(jsonb_agg(item.value - 'cost'), '[]'::jsonb)
       from jsonb_array_elements(ord.value->'items') as item))
    order by (ord.value->>'id')::bigint desc), '[]'::jsonb)
  from public.app_state as state
  cross join lateral jsonb_array_elements(state.data->'orders') as ord
  where state.id=1 and auth.uid() is not null
    and ord.value->>'user_id' = auth.uid()::text
    and not coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
$$;
