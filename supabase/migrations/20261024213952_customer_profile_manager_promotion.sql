-- Customer access changes are authorized using trusted profiles and a live session.
-- The existing customer-admin Edge function consumes this authority before Auth operations.
create or replace function private.customer_admin_authority()
returns jsonb language plpgsql stable security definer
set search_path = pg_catalog, public, private as $$
declare profile public.profiles%rowtype;
begin
  if auth.uid() is null or not exists (
    select 1 from auth.sessions where user_id=auth.uid()
      and id::text=auth.jwt()->>'session_id') then
    raise exception 'Sessão expirada. Entre novamente.';
  end if;
  select * into profile from public.profiles where user_id=auth.uid();
  if (profile.role='master' and private.is_master())
    or (profile.role='admin' and profile.position='Gerente') then
    return jsonb_build_object('promote',true,'delete',true);
  end if;
  raise exception 'Seu perfil não pode gerenciar clientes.';
end;
$$;

create or replace function private.promote_customer(p_user_id uuid, p_position text)
returns void language plpgsql security definer
set search_path = pg_catalog, public, private as $$
declare authority jsonb;
begin
  authority := private.customer_admin_authority();
  if not coalesce((authority->>'promote')::boolean,false) then
    raise exception 'Somente gerentes e a conta principal podem adicionar clientes à equipe.';
  end if;
  if p_position is null or p_position not in ('Gerente','Vendedor','Outro','Entregador') then
    raise exception 'Cargo inválido.';
  end if;
  update public.profiles
    set role=case when p_position='Entregador' then 'driver' else 'admin' end,
        position=p_position
    where user_id=p_user_id and role='customer'
      and not exists (select 1 from private.master_account where user_id=p_user_id);
  if not found then raise exception 'Cliente não encontrado.'; end if;
end;
$$;
revoke all on function private.customer_admin_authority() from public, anon;
revoke all on function private.promote_customer(uuid,text) from public, anon;
grant execute on function private.customer_admin_authority() to authenticated;
grant execute on function private.promote_customer(uuid,text) to authenticated;
