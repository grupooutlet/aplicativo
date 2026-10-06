-- Apply after the initial schema and after the owner exists in auth.users.
-- The password is set separately through Supabase Auth and is never stored here.
create table if not exists private.master_account (
  singleton integer primary key check (singleton = 1),
  user_id uuid not null unique references auth.users(id) on delete restrict,
  email text not null
);
revoke all on private.master_account from public, anon, authenticated;

insert into private.master_account (singleton, user_id, email)
select 1, id, lower(email)
from auth.users
where lower(email) = 'grupooutlet.rj@gmail.com'
  and deleted_at is null
on conflict (singleton) do nothing;

do $$
begin
  if not exists (
    select 1 from private.master_account m
    join auth.users u on u.id = m.user_id
    where m.singleton = 1
      and lower(u.email) = 'grupooutlet.rj@gmail.com'
      and u.deleted_at is null
  ) then
    raise exception 'A conta Master precisa existir antes desta migração.';
  end if;
end;
$$;

create or replace function private.is_master()
returns boolean language sql stable security definer
set search_path = pg_catalog, private as $$
  select exists (
    select 1 from private.master_account
    where singleton = 1 and user_id = (select auth.uid())
  )
$$;
revoke all on function private.is_master() from public;
grant execute on function private.is_master() to authenticated;

drop policy if exists "Verified owner reads operational state" on public.app_state;
drop policy if exists "Verified owner updates operational state" on public.app_state;
create policy "Master reads operational state" on public.app_state
  for select to authenticated using ((select private.is_master()));
create policy "Master updates operational state" on public.app_state
  for update to authenticated
  using ((select private.is_master()))
  with check ((select private.is_master()));

create or replace function private.guard_master_account()
returns trigger language plpgsql security definer
set search_path = pg_catalog, private as $$
begin
  if exists (
    select 1 from private.master_account
    where singleton = 1 and user_id = old.id
  ) then
    if tg_op = 'DELETE' then
      raise exception 'A conta Master não pode ser excluída.';
    end if;
    if new.email is distinct from old.email
       or (new.deleted_at is distinct from old.deleted_at and new.deleted_at is not null) then
      raise exception 'A conta Master não pode ser removida ou ter seu e-mail alterado.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function private.guard_master_account() from public;
drop trigger if exists guard_master_account on auth.users;
create trigger guard_master_account
before update of email, deleted_at or delete on auth.users
for each row execute function private.guard_master_account();
