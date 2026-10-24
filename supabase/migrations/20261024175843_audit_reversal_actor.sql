create or replace function private.revert_change_history(p_id bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare h private.change_history%rowtype; s public.app_state%rowtype; revised jsonb; c jsonb; current_value jsonb; exists_now boolean; path text[]; reason text; key text; cols text; setters text; restored_row jsonb; reversal_actor_name text; old_marker text; result_id bigint;
begin
 if not private.is_manager() then raise exception 'Somente a conta principal e gerentes podem reverter alterações.';end if;
 select * into s from public.app_state where id=1 for update;
 select * into h from private.change_history where id=p_id for update;
 if not found or not private.history_visible(h.changes) then raise exception 'Alteração não encontrada.';end if;
 if h.reverted_at is not null then raise exception 'Esta alteração já foi revertida.';end if;
 reason:=private.history_revert_reason(h.changes);if reason is not null then raise exception '%',reason;end if;
 revised:=s.data;
 -- Check every affected record before writing any of them.
 for c in select value from jsonb_array_elements(h.changes) loop
  if c->>'source'='state' then
   select array_agg(value order by ord) into path from jsonb_array_elements_text(c->'path') with ordinality x(value,ord);
   if c->>'kind'='entity' then select value into current_value from jsonb_array_elements(coalesce(s.data#>path,'[]')) where value->>'id'=c->>'entityId';
   else current_value:=s.data#>path;end if;
  elsif c->>'source' in ('profiles','customer_contacts') then
   key:=case when c->>'source'='profiles' then 'user_id' else 'id' end;
   execute format('select to_jsonb(t) from public.%I t where %I::text=$1 for update',c->>'source',key) into current_value using c->>'entityId';
   if c->>'source'='profiles' and (c->'before'->>'role'='master' or c->'after'->>'role'='master') and not private.is_master() then raise exception 'Esta alteração pertence à conta principal.';end if;
  else raise exception 'Tipo de alteração não suportado.';end if;
  exists_now:=current_value is not null;
  if exists_now is distinct from (c->>'afterExists')::boolean or (exists_now and current_value is distinct from c->'after') then raise exception 'Este registro foi alterado novamente: %. Revise as alterações mais recentes antes de reverter.',private.audit_change_label(c);end if;
 end loop;
 old_marker:=current_setting('app.history_reversal',true);perform set_config('app.history_reversal',p_id::text,true);
 for c in select value from jsonb_array_elements(h.changes) loop
  if c->>'source'='state' then
   select array_agg(value order by ord) into path from jsonb_array_elements_text(c->'path') with ordinality x(value,ord);
   if c->>'kind'='entity' then revised:=private.audit_restore_entity(revised,c);
   elsif c->>'beforeExists'='true' then revised:=jsonb_set(revised,path,c->'before',true);
   else revised:=revised#-path;end if;
  end if;
 end loop;
 -- Later orders must not be orphaned or left with more reservations than physical stock.
 if exists(select 1 from jsonb_array_elements(coalesce(revised->'orders','[]')) o cross join lateral jsonb_array_elements(o->'items') i
  where o->>'status' in ('pending','ready','transit') and coalesce(i->>'stockTracked','true')<>'false'
    and not exists(select 1 from jsonb_array_elements(revised->'products') p where p->>'id'=i->>'id')) then raise exception 'Há pedidos em andamento usando um produto desta alteração. Resolva esses pedidos antes de reverter.';end if;
 if exists(select 1 from jsonb_array_elements(revised->'products') p where (p->>'stock')::integer<
  (select coalesce(sum((i->>'qty')::integer),0) from jsonb_array_elements(coalesce(revised->'orders','[]')) o cross join lateral jsonb_array_elements(o->'items') i where o->>'status' in ('pending','ready') and i->>'id'=p->>'id')) then raise exception 'A reversão deixaria o estoque abaixo das reservas atuais.';end if;
 for c in select value from jsonb_array_elements(h.changes) where value->>'source'<>'state' loop
   key:=case when c->>'source'='profiles' then 'user_id' else 'id' end;
   if c->>'beforeExists'='false' then execute format('delete from public.%I where %I::text=$1',c->>'source',key) using c->>'entityId';
   else
    restored_row:=c->'before';
    if c->>'source'='profiles' and restored_row->>'role'='master' and not exists(select 1 from private.master_account where user_id::text=c->>'entityId') then raise exception 'A conta principal deve ser preservada.';end if;
    select string_agg(format('%I',attname),',' order by attnum),string_agg(format('%1$I=excluded.%1$I',attname),',' order by attnum) filter(where attname<>key) into cols,setters
      from pg_attribute where attrelid=format('public.%I',c->>'source')::regclass and attnum>0 and not attisdropped;
    execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I,$1) on conflict (%3$I) do update set %4$s',c->>'source',cols,key,setters) using restored_row;
   end if;
 end loop;
 if revised is distinct from s.data then update public.app_state set data=revised,version=version+1,updated_at=now() where id=1;end if;
 select id into result_id from private.change_history where transaction_id=txid_current();
 select name into reversal_actor_name from public.profiles where user_id=auth.uid();
 update private.change_history set reverted_at=clock_timestamp(),reverted_by=auth.uid(),reverted_by_name=reversal_actor_name,reversal_id=result_id where id=p_id;
 perform set_config('app.history_reversal',coalesce(old_marker,''),true);
 return jsonb_build_object('id',p_id,'reversal_id',result_id);
end $$;


