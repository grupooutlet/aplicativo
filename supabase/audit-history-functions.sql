-- Included in the versioned migration. No snapshots of credentials or auth.users are recorded.
create table private.change_history (
 id bigint generated always as identity primary key,
 transaction_id bigint not null unique,
 created_at timestamptz not null default clock_timestamp(),
 actor_id uuid, actor_name text not null, actor_role text, actor_position text,
 areas text[] not null default '{}', summary text not null default '',
 changes jsonb not null check(jsonb_typeof(changes)='array'),
 reversal_of bigint references private.change_history(id),
 reverted_at timestamptz, reverted_by uuid, reverted_by_name text,
 reversal_id bigint references private.change_history(id)
);
alter table private.change_history enable row level security;
revoke all on private.change_history from public,anon,authenticated;
create policy "Management reads change history" on private.change_history for select to authenticated using ((select private.is_manager()));
create index change_history_areas_idx on private.change_history using gin(areas);
create index change_history_actor_idx on private.change_history(actor_id,id desc);

create function private.audit_array_changes(p_before jsonb,p_after jsonb,p_path text[])
returns jsonb language sql immutable set search_path=pg_catalog as $$
 with before_rows as (select value,ord from jsonb_array_elements(coalesce(p_before,'[]')) with ordinality b(value,ord)),
 after_rows as (select value,ord from jsonb_array_elements(coalesce(p_after,'[]')) with ordinality a(value,ord)),
 joined as (select b.value b,a.value a,b.ord bo,a.ord ao from before_rows b full join after_rows a on b.value->>'id'=a.value->>'id')
 select coalesce(jsonb_agg(jsonb_build_object('source','state','kind','entity','path',to_jsonb(p_path),'entityId',coalesce(a->>'id',b->>'id'),
   'before',b,'after',a,'beforeExists',b is not null,'afterExists',a is not null,'beforeIndex',coalesce(bo-1,0),'afterIndex',coalesce(ao-1,0)) order by coalesce(ao,bo)),'[]')
 from joined where b is distinct from a
$$;

create function private.audit_state_changes(p_before jsonb,p_after jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog,private as $$
declare changes jsonb:='[]'; k text; sub text; b jsonb; a jsonb; path text[]; has_ids boolean;
begin
 for k in select key from (select jsonb_object_keys(p_before) key union select jsonb_object_keys(p_after)) keys loop
  if p_before->k is not distinct from p_after->k then continue; end if;
  if k in ('settings','collectionSettings') then
   for sub in select key from (select jsonb_object_keys(coalesce(p_before->k,'{}')) key union select jsonb_object_keys(coalesce(p_after->k,'{}'))) keys loop
    b:=p_before->k->sub;a:=p_after->k->sub;if b is not distinct from a then continue; end if;path:=array[k,sub];
    if k='settings' and sub in ('shippingOptions','paymentMethods') and jsonb_typeof(coalesce(b,'[]'))='array' and jsonb_typeof(coalesce(a,'[]'))='array' then
     changes:=changes||private.audit_array_changes(b,a,path);
    else changes:=changes||jsonb_build_array(jsonb_build_object('source','state','kind','value','path',to_jsonb(path),'before',b,'after',a,'beforeExists',b is not null,'afterExists',a is not null));end if;
   end loop;
  else
   b:=p_before->k;a:=p_after->k;path:=array[k];has_ids:=false;
   if k in ('products','orders','movements','pages','orderBumps','attributeCatalog') and jsonb_typeof(coalesce(b,'[]'))='array' and jsonb_typeof(coalesce(a,'[]'))='array' then
    select not exists(select 1 from jsonb_array_elements(coalesce(b,'[]')||coalesce(a,'[]')) v where jsonb_typeof(v)<>'object' or v->>'id' is null) into has_ids;
   end if;
   if has_ids then changes:=changes||private.audit_array_changes(b,a,path);
   else changes:=changes||jsonb_build_array(jsonb_build_object('source','state','kind','value','path',to_jsonb(path),'before',b,'after',a,'beforeExists',b is not null,'afterExists',a is not null));end if;
  end if;
 end loop;
 return changes;
end $$;

create function private.merge_audit_changes(p_previous jsonb,p_latest jsonb)
returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare result jsonb:=p_previous; c jsonb; prior jsonb; idx integer;
begin
 for c in select value from jsonb_array_elements(p_latest) loop
  select value,ord-1 into prior,idx from jsonb_array_elements(result) with ordinality x(value,ord)
   where value->>'source'=c->>'source' and value->'path' is not distinct from c->'path' and value->>'entityId' is not distinct from c->>'entityId';
  if found then
   c:=c||jsonb_build_object('before',prior->'before','beforeExists',prior->'beforeExists','beforeIndex',prior->'beforeIndex');
   result:=jsonb_set(result,array[idx::text],c);
  else result:=result||jsonb_build_array(c);end if;
 end loop;
 return (select coalesce(jsonb_agg(value order by ord),'[]') from jsonb_array_elements(result) with ordinality x(value,ord)
   where value->'before' is distinct from value->'after' or value->'beforeExists' is distinct from value->'afterExists');
end $$;

create function private.audit_change_area(p_change jsonb) returns text language sql immutable set search_path=pg_catalog as $$
 select case when p_change->>'source'<>'state' then p_change->>'source'
 when p_change->'path'->>0='settings' and p_change->'path'->>1 in ('shippingOptions','paymentMethods') then p_change->'path'->>1
 when p_change->'path'->>0='collectionSettings' then 'collections'
 else p_change->'path'->>0 end
$$;
create function private.audit_change_label(p_change jsonb) returns text language sql immutable set search_path=pg_catalog as $$
 select case when p_change->>'source'='profiles' then 'Perfil · '||coalesce(p_change->'after'->>'name',p_change->'before'->>'name','Conta')
 when p_change->>'source'='customer_contacts' then 'Cliente · '||coalesce(p_change->'after'->>'name',p_change->'before'->>'name','Cadastro')
 when p_change->'path'->>0='orders' then 'Pedido #'||coalesce(p_change->>'entityId','')
 when p_change->'path'->>0='movements' then 'Estoque · '||coalesce(p_change->'after'->>'product',p_change->'before'->>'product','Movimentação')
 when p_change->>'kind'='entity' then coalesce(p_change->'after'->>'title',p_change->'after'->>'name',p_change->'before'->>'title',p_change->'before'->>'name','Registro')
 when p_change->'path'->>0='collectionSettings' then 'Coleção · '||(p_change->'path'->>1)
 else case p_change->'path'->>0 when 'storefront' then 'Layout da loja' when 'navigation' then 'Menus da loja' when 'collections' then 'Lista de coleções'
 when 'settings' then case p_change->'path'->>1 when 'name' then 'Nome da loja' when 'phone' then 'WhatsApp da loja' when 'address' then 'Endereço da loja' when 'addressParts' then 'Endereço da loja' when 'goal' then 'Meta da loja' else 'Configurações da loja' end
 when 'attributeCatalog' then 'Variações dos produtos' else 'Configuração da loja' end end
$$;

create function private.record_change_history(p_changes jsonb)
returns void language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare who public.profiles%rowtype; event_id bigint; merged jsonb; first_change jsonb; action text; reversal text;
begin
 if jsonb_array_length(p_changes)=0 then return; end if;
 select * into who from public.profiles where user_id=auth.uid();
 reversal:=current_setting('app.history_reversal',true);
 insert into private.change_history(transaction_id,actor_id,actor_name,actor_role,actor_position,changes,reversal_of)
 values(txid_current(),auth.uid(),coalesce(nullif(who.name,''),'Sistema / loja online'),coalesce(who.role,'system'),who.position,p_changes,
   case when private.is_manager() and reversal ~ '^[0-9]+$' then reversal::bigint end)
 on conflict(transaction_id) do update set changes=private.merge_audit_changes(private.change_history.changes,excluded.changes)
 returning id,changes into event_id,merged;
 if jsonb_array_length(merged)=0 then update private.change_history set areas='{}',summary='Sem alterações' where id=event_id;return;end if;
 first_change:=merged->0;
 action:=case when reversal ~ '^[0-9]+$' then 'Reverteu: ' when first_change->>'beforeExists'='false' then 'Criou: ' when first_change->>'afterExists'='false' then 'Excluiu: ' else 'Alterou: ' end;
 update private.change_history set areas=(select array_agg(distinct private.audit_change_area(c)) from jsonb_array_elements(merged) c),
 summary=action||private.audit_change_label(first_change)||case when jsonb_array_length(merged)>1 then ' e mais '||(jsonb_array_length(merged)-1)||' registro(s)' else '' end where id=event_id;
end $$;

create function private.capture_state_history() returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
begin perform private.record_change_history(private.audit_state_changes(case when tg_op='INSERT' then '{}'::jsonb else old.data end,new.data));return new;end $$;
create trigger record_state_history after insert or update of data on public.app_state for each row execute function private.capture_state_history();
create function private.capture_profile_history() returns trigger language plpgsql security definer set search_path=pg_catalog,private as $$
declare b jsonb; a jsonb; key text;
begin
 b:=case when tg_op='INSERT' then null else to_jsonb(old) end;a:=case when tg_op='DELETE' then null else to_jsonb(new) end;
 if b is not distinct from a then if tg_op='DELETE' then return old;else return new;end if;end if;
 key:=case when tg_table_name='profiles' then 'user_id' else 'id' end;
 perform private.record_change_history(jsonb_build_array(jsonb_build_object('source',tg_table_name,'kind','row','entityId',coalesce(a->>key,b->>key),'before',b,'after',a,'beforeExists',b is not null,'afterExists',a is not null)));
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger record_profile_history after insert or update or delete on public.profiles for each row execute function private.capture_profile_history();
create trigger record_customer_history after insert or update or delete on public.customer_contacts for each row execute function private.capture_profile_history();

create function private.history_visible(p_changes jsonb) returns boolean language sql stable security definer set search_path=pg_catalog,public,private as $$
 select private.is_manager() and (private.is_master() or not exists(select 1 from jsonb_array_elements(p_changes) c where c->>'source'='profiles' and
 (c->'before'->>'role'='master' or c->'after'->>'role'='master' or c->>'entityId'=(select user_id::text from private.master_account where singleton=1))))
$$;
create function private.history_revert_reason(p_changes jsonb) returns text language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
declare c jsonb;
begin
 for c in select value from jsonb_array_elements(p_changes) loop
  if c->>'source'='profiles' then
   if c->>'beforeExists'='false' then return 'A criação de uma conta de acesso não é desfeita pelo histórico. Gerencie esse perfil em Clientes ou Equipe.';end if;
   if not exists(select 1 from auth.users where id::text=c->>'entityId') then return 'A conta de acesso foi removida. Não é possível restaurar suas credenciais pelo histórico.';end if;
  end if;
 end loop;
 return null;
end $$;

create function private.list_change_history(p_before bigint default null,p_area text default null,p_query text default null)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
declare result jsonb; next_id bigint;
begin
 if not private.is_manager() then raise exception 'O histórico é reservado à conta principal e aos gerentes.';end if;
 if length(coalesce(p_query,''))>120 then raise exception 'Busca muito longa.';end if;
 with matches as (select * from private.change_history h where (p_before is null or h.id<p_before)
 and jsonb_array_length(h.changes)>0 and private.history_visible(h.changes)
 and (nullif(p_area,'') is null or h.areas @> array[p_area]) and (nullif(p_query,'') is null or h.actor_name ilike '%'||p_query||'%' or h.summary ilike '%'||p_query||'%') order by h.id desc limit 26),
 page as (select * from matches order by id desc limit 25)
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'created_at',created_at,'actor_name',actor_name,'actor_role',actor_role,'actor_position',actor_position,'summary',summary,'areas',areas,'change_count',jsonb_array_length(changes),'reversal_of',reversal_of,'reverted_at',reverted_at,'reverted_by_name',reverted_by_name) order by id desc),'[]'),
 case when (select count(*) from matches)>25 then min(id) end into result,next_id from page;
 return jsonb_build_object('entries',result,'next_cursor',next_id);
end $$;
create function private.change_history_detail(p_id bigint) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
declare h private.change_history%rowtype; reason text; patches jsonb;
begin
 if not private.is_manager() then raise exception 'Acesso restrito à gestão.';end if;
 select * into h from private.change_history where id=p_id;
 if not found or not private.history_visible(h.changes) then raise exception 'Alteração não encontrada.';end if;
 reason:=private.history_revert_reason(h.changes);
 select coalesce(jsonb_agg(c||jsonb_build_object('label',private.audit_change_label(c)) order by ord),'[]') into patches from jsonb_array_elements(h.changes) with ordinality x(c,ord);
 return jsonb_build_object('id',h.id,'created_at',h.created_at,'actor_name',h.actor_name,'summary',h.summary,'changes',patches,'reverted_at',h.reverted_at,'reverted_by_name',h.reverted_by_name,'can_revert',h.reverted_at is null and reason is null,'revert_reason',reason);
end $$;

create function private.audit_restore_entity(p_data jsonb,p_change jsonb) returns jsonb language plpgsql immutable set search_path=pg_catalog as $$
declare path text[]; current_array jsonb; restored jsonb:='[]'; v jsonb; position integer:=0; inserted boolean:=false;
begin
 select array_agg(value order by ord) into path from jsonb_array_elements_text(p_change->'path') with ordinality x(value,ord);
 current_array:=coalesce(p_data#>path,'[]');
 for v in select value from jsonb_array_elements(current_array) where value->>'id' is distinct from p_change->>'entityId' loop
  if p_change->>'beforeExists'='true' and position=(p_change->>'beforeIndex')::integer then restored:=restored||jsonb_build_array(p_change->'before');inserted:=true;end if;
  restored:=restored||jsonb_build_array(v);position:=position+1;
 end loop;
 if p_change->>'beforeExists'='true' and not inserted then restored:=restored||jsonb_build_array(p_change->'before');end if;
 return jsonb_set(p_data,path,restored,true);
end $$;
create function private.is_history_reversal() returns boolean language sql stable security definer set search_path=pg_catalog,private as $$
 select private.is_manager() and coalesce(current_setting('app.history_reversal',true),'') ~ '^[0-9]+$'
$$;

create function private.revert_change_history(p_id bigint) returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
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

create function public.list_change_history(p_before bigint default null,p_area text default null,p_query text default null) returns jsonb language sql security invoker set search_path=pg_catalog,private as $$ select private.list_change_history(p_before,p_area,p_query) $$;
create function public.change_history_detail(p_id bigint) returns jsonb language sql security invoker set search_path=pg_catalog,private as $$ select private.change_history_detail(p_id) $$;
create function public.revert_change_history(p_id bigint) returns jsonb language sql security invoker set search_path=pg_catalog,private as $$ select private.revert_change_history(p_id) $$;

revoke all on function private.audit_array_changes(jsonb,jsonb,text[]),private.audit_state_changes(jsonb,jsonb),private.merge_audit_changes(jsonb,jsonb),private.audit_change_area(jsonb),private.audit_change_label(jsonb),private.record_change_history(jsonb),private.capture_state_history(),private.capture_profile_history(),private.history_visible(jsonb),private.history_revert_reason(jsonb),private.audit_restore_entity(jsonb,jsonb),private.is_history_reversal(),private.list_change_history(bigint,text,text),private.change_history_detail(bigint),private.revert_change_history(bigint),public.list_change_history(bigint,text,text),public.change_history_detail(bigint),public.revert_change_history(bigint) from public,anon,authenticated;
grant execute on function private.is_history_reversal(),private.list_change_history(bigint,text,text),private.change_history_detail(bigint),private.revert_change_history(bigint),public.list_change_history(bigint,text,text),public.change_history_detail(bigint),public.revert_change_history(bigint) to authenticated;
