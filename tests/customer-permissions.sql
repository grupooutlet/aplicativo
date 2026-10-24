-- All test promotions and sessions are transaction-local and always rolled back.
begin;
do $test$
declare manager_id uuid; master_id uuid; seller_id uuid; customer_id uuid; actor uuid;
 session_id uuid; authority jsonb; audit_id bigint; original_profiles jsonb;
begin
 select user_id into manager_id from public.profiles where role='admin' and position='Gerente' limit 1;
 select user_id into master_id from public.profiles where role='master' limit 1;
 select user_id into seller_id from public.profiles where role='admin' and position='Vendedor' limit 1;
 select user_id into customer_id from public.profiles where role='customer' limit 1;
 if manager_id is null or master_id is null or seller_id is null or customer_id is null then raise exception 'Fixtures ausentes'; end if;
 select jsonb_agg(to_jsonb(p) order by user_id) into original_profiles from public.profiles p;
 if has_function_privilege('anon','public.promote_customer(uuid,text)','execute')
   or has_function_privilege('anon','private.promote_customer(uuid,text)','execute') then raise exception 'Promoção exposta a anônimos'; end if;

 foreach actor in array array[manager_id,master_id] loop
  session_id:=gen_random_uuid();
  insert into auth.sessions(id,user_id,created_at,updated_at) values(session_id,actor,now(),now());
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',session_id,'role','authenticated')::text,true);
  authority:=public.customer_admin_authority();
  if authority is distinct from '{"promote":true,"delete":true}'::jsonb then raise exception 'Gerência sem autoridade'; end if;
  begin
   perform public.promote_customer(customer_id,'Vendedor');
   if not exists(select 1 from public.profiles where user_id=customer_id and role='admin' and position='Vendedor') then raise exception 'Promoção não aplicada'; end if;
   if not exists(select 1 from private.change_history h cross join lateral jsonb_array_elements(h.changes) c where actor_id=actor and transaction_id=txid_current() and c->>'source'='profiles') then raise exception 'Promoção sem autoria no histórico'; end if;
   raise exception using errcode='ZX001',message='rollback test promotion';
  exception when sqlstate 'ZX001' then null; end;
  begin
   perform public.promote_customer(customer_id,'Entregador');
   if not exists(select 1 from public.profiles where user_id=customer_id and role='driver' and position='Entregador') then raise exception 'Cargo entregador incorreto'; end if;
   raise exception using errcode='ZX001',message='rollback test promotion';
  exception when sqlstate 'ZX001' then null; end;
  begin perform public.promote_customer(master_id,'Vendedor'); raise exception 'Conta principal alterada';
   exception when others then if sqlerrm<>'Cliente não encontrado.' then raise; end if; end;
  begin perform public.promote_customer(customer_id,'Principal'); raise exception 'Cargo principal permitido';
   exception when others then if sqlerrm<>'Cargo inválido.' then raise; end if; end;
  begin perform public.promote_customer(customer_id,null); raise exception 'Cargo nulo permitido';
   exception when others then if sqlerrm<>'Cargo inválido.' then raise; end if; end;
 end loop;

 foreach actor in array array[seller_id,customer_id] loop
  session_id:=gen_random_uuid();
  insert into auth.sessions(id,user_id,created_at,updated_at) values(session_id,actor,now(),now());
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'session_id',session_id,'role','authenticated','user_metadata',jsonb_build_object('role','master','position','Gerente'))::text,true);
  begin perform public.customer_admin_authority();raise exception 'Autoridade indevida';
   exception when others then if sqlerrm<>'Seu perfil não pode gerenciar clientes.' then raise; end if; end;
  begin perform public.promote_customer(customer_id,'Gerente');raise exception 'Promoção indevida';
   exception when others then if sqlerrm<>'Seu perfil não pode gerenciar clientes.' then raise; end if; end;
 end loop;

 perform set_config('request.jwt.claim.sub',manager_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',manager_id,'session_id',gen_random_uuid())::text,true);
 begin perform public.promote_customer(customer_id,'Gerente');raise exception 'Sessão expirada aceita';
  exception when others then if sqlerrm<>'Sessão expirada. Entre novamente.' then raise; end if; end;
 if (select jsonb_agg(to_jsonb(p) order by user_id) from public.profiles p) is distinct from original_profiles then raise exception 'Perfil real alterado pelo teste';end if;
end;
$test$;
rollback;
