-- Link existing order history to CRM contacts without changing authentication.
do $$
declare
  state_row public.app_state%rowtype;
  item jsonb;
  updated_orders jsonb := '[]'::jsonb;
  contact_id uuid;
  digits text;
  changed boolean := false;
begin
  select * into state_row from public.app_state where id=1 for update;
  if not found then return; end if;
  for item in select value from jsonb_array_elements(coalesce(state_row.data->'orders','[]'::jsonb)) loop
    if item ? 'customer_id' then
      updated_orders := updated_orders || jsonb_build_array(item);
      continue;
    end if;
    digits := regexp_replace(coalesce(item->>'cpf',''),'[^0-9]','','g');
    if length(digits)<>11 then
      updated_orders := updated_orders || jsonb_build_array(item);
      continue;
    end if;
    insert into public.customer_contacts(name,email,phone,phone_digits,cpf,address,address_key)
    values (left(coalesce(item->>'customer','Cliente'),120),lower(coalesce(item->>'email','')),
      coalesce(item->>'phone',''),regexp_replace(coalesce(item->>'phone',''),'[^0-9]','','g'),
      digits,coalesce(item->>'address',''),
      lower(regexp_replace(coalesce(item->>'address',''),'[^[:alnum:]]','','g')))
    on conflict (cpf) do update set updated_at=public.customer_contacts.updated_at
    returning id into contact_id;
    updated_orders := updated_orders || jsonb_build_array(item || jsonb_build_object('customer_id',contact_id::text));
    changed := true;
  end loop;
  if changed then
    update public.app_state set data=jsonb_set(state_row.data,'{orders}',updated_orders),
      version=version+1,updated_at=now() where id=1;
  end if;
end;
$$;
