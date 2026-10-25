-- Notes are an independent, version-checked update; completed orders stay editable here.
create function private.save_order_notes(p_order_id bigint,p_notes text,p_expected_notes text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare state public.app_state%rowtype; current_order jsonb; revised jsonb; order_index integer; changed_at timestamptz:=clock_timestamp();
begin
 if not (private.is_manager() or private.is_seller()) then raise exception 'Seu perfil não pode editar observações de pedidos.'; end if;
 if p_order_id is null or p_order_id<=0 or p_notes is null or length(p_notes)>5000 or p_expected_notes is null then raise exception 'Confira a observação do pedido. Use até 5.000 caracteres.'; end if;
 select * into state from public.app_state where id=1 for update;
 select value,(ord-1)::integer into current_order,order_index from jsonb_array_elements(state.data->'orders') with ordinality entries(value,ord) where value->>'id'=p_order_id::text;
 if current_order is null then raise exception 'Pedido não encontrado.'; end if;
 if coalesce(current_order->>'notes','') is distinct from p_expected_notes then raise exception 'A observação foi alterada em outra sessão. Atualize o pedido e revise antes de salvar.'; end if;
 if coalesce(current_order->>'notes','')=btrim(p_notes) then return jsonb_build_object('version',state.version); end if;
 revised:=current_order||jsonb_build_object('notes',btrim(p_notes),'notesUpdatedAt',changed_at);
 update public.app_state set data=jsonb_set(state.data,array['orders',order_index::text],revised),version=version+1,updated_at=now() where id=1 returning version into state.version;
 return jsonb_build_object('version',state.version,'order_id',p_order_id,'notesUpdatedAt',changed_at);
end $$;
create function public.save_order_notes(p_order_id bigint,p_notes text,p_expected_notes text)
returns jsonb language sql security invoker set search_path=pg_catalog,private as $$ select private.save_order_notes(p_order_id,p_notes,p_expected_notes) $$;
revoke all on function private.save_order_notes(bigint,text,text),public.save_order_notes(bigint,text,text) from public,anon,authenticated;
grant execute on function private.save_order_notes(bigint,text,text),public.save_order_notes(bigint,text,text) to authenticated;
notify pgrst,'reload schema';
