-- Keep the privileged implementation outside the exposed API schema.
create or replace function private.promote_customer(p_user_id uuid, p_position text)
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
revoke all on function private.promote_customer(uuid,text) from public, anon, authenticated;
grant execute on function private.promote_customer(uuid,text) to authenticated;

create or replace function public.promote_customer(p_user_id uuid, p_position text)
returns void language sql security invoker
set search_path = pg_catalog, public, private as $$
  select private.promote_customer(p_user_id,p_position)
$$;
revoke all on function public.promote_customer(uuid,text) from public, anon, authenticated;
grant execute on function public.promote_customer(uuid,text) to authenticated;
