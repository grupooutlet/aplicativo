-- Only public team identity fields needed by the order picker; no customer/master rows.
create or replace function private.order_responsibles() returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
begin
 if not (private.is_manager() or private.is_seller()) or auth.uid() is null or not exists(select 1 from auth.sessions where user_id=auth.uid() and id::text=auth.jwt()->>'session_id') then raise exception 'Acesso restrito à equipe de vendas.';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('user_id',user_id,'name',name,'role',role,'position',position) order by name),'[]') from public.profiles where role in ('admin','driver') and nullif(btrim(name),'') is not null);
end $$;
revoke all on function private.order_responsibles() from public,anon,authenticated;
grant execute on function private.order_responsibles() to authenticated;
create or replace function public.order_responsibles() returns jsonb language sql security invoker set search_path=pg_catalog,private as $$select private.order_responsibles()$$;
revoke all on function public.order_responsibles() from public,anon,authenticated;
grant execute on function public.order_responsibles() to authenticated;

do $migration$
declare definition text; old_block text:=$old$  if private.is_seller() then responsible:=actor;
  else
    select * into responsible from public.profiles where user_id::text=p_order->>'seller_id' and role='admin' and position='Vendedor';
    if not found then raise exception 'Selecione um perfil de vendedor disponível.'; end if;
  end if;$old$;
begin
 definition:=replace(pg_get_functiondef('private.create_staff_order(jsonb,uuid)'::regprocedure),chr(13),'');
 old_block:=replace(old_block,chr(13),'');
 if position(old_block in definition)=0 then raise exception 'A função de pedidos mudou. Revise antes de aplicar.';end if;
 definition:=replace(definition,old_block,$new$  select * into responsible from public.profiles where user_id::text=coalesce(nullif(p_order->>'seller_id',''),case when private.is_seller() then auth.uid()::text end) and role in ('admin','driver');
  if not found then raise exception 'Selecione um integrante disponível da equipe. A conta principal não pode ser responsável pela venda.';end if;$new$);
 execute definition;
end $migration$;
