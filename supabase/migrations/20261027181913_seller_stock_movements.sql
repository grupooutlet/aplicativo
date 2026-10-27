-- Narrow, atomic manual adjustments. Sellers never submit or receive product costs.
create function private.move_stock(p_product_id bigint,p_type text,p_quantity integer,p_reason text,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare actor public.profiles%rowtype; state public.app_state%rowtype; product jsonb; prior jsonb; movement jsonb;
 physical bigint; reserved_qty bigint; revised_stock bigint; delta integer; movement_id bigint;
begin
 select * into actor from public.profiles where user_id=auth.uid();
 if actor.role is null or not (actor.role='master' or (actor.role='admin' and actor.position in ('Gerente','Vendedor','Outro'))) then raise exception 'Seu perfil não pode movimentar o estoque.';end if;
 if p_product_id is null or p_request_id is null or p_type is null or p_type not in ('in','out') or p_quantity is null or p_quantity not between 1 and 1000000 then raise exception 'Informe uma movimentação e uma quantidade inteira válidas.';end if;
 if p_reason is null or length(btrim(p_reason)) not between 2 and 300 then raise exception 'Informe um motivo com 2 a 300 caracteres.';end if;
 delta:=case when p_type='out' then -p_quantity else p_quantity end;
 select * into state from public.app_state where id=1 for update;
 if not found then raise exception 'Estoque não disponível.';end if;
 select value into product from jsonb_array_elements(state.data->'products') where value->>'id'=p_product_id::text;
 if product is null then raise exception 'Produto não encontrado.';end if;
 physical:=coalesce((product->>'stock')::bigint,0);
 select coalesce(sum((item->>'qty')::bigint),0) into reserved_qty from jsonb_array_elements(coalesce(state.data->'orders','[]')) o
 cross join lateral jsonb_array_elements(coalesce(o->'items','[]')) item
 where o->>'status' in ('pending','ready') and item->>'id'=p_product_id::text and coalesce(item->>'stockTracked','true')<>'false';
 select value into prior from jsonb_array_elements(coalesce(state.data->'movements','[]')) where value->>'requestId'=p_request_id::text;
 if prior is not null then
  if prior->>'actorId' is distinct from auth.uid()::text or prior->>'productId' is distinct from p_product_id::text or (prior->>'qty')::integer<>delta or prior->>'reason' is distinct from btrim(p_reason) then raise exception 'Esta solicitação já foi usada. Abra uma nova movimentação.';end if;
  return jsonb_build_object('id',prior->'id','productId',p_product_id,'stock',physical,'reserved',reserved_qty,'available',physical-reserved_qty,'version',state.version,'duplicate',true);
 end if;
 if p_type='out' and p_quantity>greatest(physical-reserved_qty,0) then raise exception 'Saída maior que o estoque disponível. As unidades reservadas por pedidos estão protegidas.';end if;
 revised_stock:=physical+delta;
 if revised_stock not between 0 and 2147483647 then raise exception 'O saldo final do estoque está fora do limite permitido.';end if;
 movement_id:=floor(extract(epoch from clock_timestamp())*1000000)::bigint;
 movement:=jsonb_build_object('id',movement_id,'productId',p_product_id,'product',product->>'name','qty',delta,'reason',btrim(p_reason),
 'date',to_char(clock_timestamp() at time zone 'America/Sao_Paulo','DD/MM/YYYY HH24:MI:SS'),'createdAt',clock_timestamp(),'by',coalesce(nullif(actor.name,''),'Equipe'),'actorId',auth.uid(),'requestId',p_request_id,'source','manual');
 update public.app_state set data=jsonb_set(jsonb_set(state.data,'{products}',(select jsonb_agg(case when value->>'id'=p_product_id::text then jsonb_set(value,'{stock}',to_jsonb(revised_stock)) else value end order by ord) from jsonb_array_elements(state.data->'products') with ordinality x(value,ord))),'{movements}',jsonb_build_array(movement)||coalesce(state.data->'movements','[]')),version=version+1,updated_at=now() where id=1;
 return jsonb_build_object('id',movement_id,'productId',p_product_id,'stock',revised_stock,'reserved',reserved_qty,'available',revised_stock-reserved_qty,'version',state.version+1,'duplicate',false);
end $$;
create function public.move_stock(p_product_id bigint,p_type text,p_quantity integer,p_reason text,p_request_id uuid) returns jsonb
language sql security invoker set search_path=pg_catalog,private as $$select private.move_stock(p_product_id,p_type,p_quantity,p_reason,p_request_id)$$;
revoke all on function private.move_stock(bigint,text,integer,text,uuid),public.move_stock(bigint,text,integer,text,uuid) from public,anon,authenticated;
grant execute on function private.move_stock(bigint,text,integer,text,uuid),public.move_stock(bigint,text,integer,text,uuid) to authenticated;
notify pgrst,'reload schema';
