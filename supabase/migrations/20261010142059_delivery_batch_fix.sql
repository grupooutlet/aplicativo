create or replace function private.release_delivery_day(p_date date) returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare ids bigint[]; selected_id bigint; released integer:=0; skipped jsonb:='[]'; detail text;
begin
  if not (private.is_admin() or exists(select 1 from public.profiles where user_id=auth.uid() and role='driver')) then raise exception 'Acesso restrito à equipe.'; end if;
  if p_date is null then raise exception 'Selecione o dia da entrega.'; end if;
  -- Retain the same state lock throughout the batch. Each failed order rolls back independently.
  perform 1 from public.app_state where id=1 for update;
  select array_agg((o->>'id')::bigint order by (o->>'id')::bigint) into ids
    from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') ord(o)
    where s.id=1 and o->>'delivery'='Entrega' and o->>'deliveryDate'=p_date::text and o->>'status' in ('pending','ready');
  foreach selected_id in array coalesce(ids,'{}'::bigint[]) loop
    begin perform private.order_action(selected_id,'release'); released:=released+1;
    exception when others then get stacked diagnostics detail=message_text;
      skipped:=skipped||jsonb_build_array(jsonb_build_object('id',selected_id,'reason',detail));
    end;
  end loop;
  return jsonb_build_object('released',released,'skipped',skipped);
end;
$$;
