create or replace function private.audit_change_area(p_change jsonb) returns text language sql immutable set search_path=pg_catalog as $$
 select case when p_change->>'source'<>'state' then p_change->>'source'
 when p_change->'path'->>0='settings' and p_change->'path'->>1 in ('shippingOptions','paymentMethods') then p_change->'path'->>1
 when p_change->'path'->>0='collectionSettings' then 'collections'
 else p_change->'path'->>0 end
$$;
