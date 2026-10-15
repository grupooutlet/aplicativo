create or replace function private.apply_catalog_import(p_batch text) returns jsonb
language plpgsql security invoker set search_path=pg_catalog,public,private as $$
declare batch private.catalog_import_batches%rowtype; state_row public.app_state%rowtype; row_item record;
  original jsonb; products jsonb; collections jsonb; attributes jsonb; attribute jsonb; value_item jsonb; existing_attribute jsonb;
  item jsonb; imported jsonb:='[]'; mapping jsonb:='[]'; next_id integer; attribute_index integer;
  active_count integer:=0; draft_count integer:=0; duplicate_count integer:=0; import_result jsonb;
begin
  select * into batch from private.catalog_import_batches where id=p_batch for update;
  if not found then raise exception 'Import batch not found.'; end if;
  if batch.status='applied' then return batch.result; end if;
  if batch.source_url<>'https://www.forteoutlet.com.br/' then raise exception 'Unexpected catalog source.'; end if;
  if (select count(*) from private.catalog_import_items where batch_id=p_batch)<>batch.expected_count then raise exception 'Catalog coverage mismatch.'; end if;
  select * into state_row from public.app_state where id=1 for update;
  original:=state_row.data;
  if md5((original->'products')::text)<>batch.expected_products_hash then raise exception 'Products changed since duplicate review. Rebuild the import plan.'; end if;
  if exists(select 1 from jsonb_array_elements(original->'products') p where p->'importInfo'->>'batchId'=p_batch) then raise exception 'Batch products already present without an audit record.'; end if;
  next_id:=greatest(coalesce((original->>'nextProductId')::integer,1),coalesce((select max((p->>'id')::integer)+1 from jsonb_array_elements(original->'products') p),1));
  products:=original->'products'; collections:=coalesce(original->'collections','[]'); attributes:=coalesce(original->'attributeCatalog','[]');
  for row_item in select * from private.catalog_import_items where batch_id=p_batch order by ordinal loop
    item:=row_item.payload;
    if jsonb_typeof(item->'active') is distinct from 'boolean' or length(btrim(coalesce(item->>'name','')))=0
      or coalesce((item->>'price')::numeric,0)<=0 or coalesce((item->>'stock')::integer,-1)<0
      or jsonb_typeof(item->'images') is distinct from 'array' or jsonb_typeof(item->'variations') is distinct from 'array'
      or item->'importInfo'->>'batchId' is distinct from p_batch or (item->'importInfo'->>'sourceId')::bigint is distinct from row_item.source_product_id then raise exception 'Invalid catalog item %.',row_item.source_product_id; end if;
    if exists(select 1 from jsonb_array_elements_text(item->'images') photo where photo not like 'https://rwxqytomiorsrxpgtjin.supabase.co/storage/v1/object/public/product-photos/products/import-forte-20261015/%') then raise exception 'Image is not hosted in Grupo Outlet.'; end if;
    if (item->>'active')::boolean and jsonb_array_length(item->'images')=0 then raise exception 'Product without photos must remain a draft.'; end if;
    item:=item||jsonb_build_object('id',next_id,'sku','GO-'||lpad(next_id::text,5,'0'),'cost',0);
    if exists(select 1 from jsonb_array_elements(products) p where p->>'sku'=item->>'sku') then raise exception 'Generated SKU conflict.'; end if;
    imported:=imported||jsonb_build_array(item);
    mapping:=mapping||jsonb_build_array(jsonb_build_object('sourceId',row_item.source_product_id,'id',next_id,'sku',item->>'sku','active',item->'active'));
    next_id:=next_id+1;
    if (item->>'active')::boolean then active_count:=active_count+1; else draft_count:=draft_count+1; end if;
    if item->'importInfo'->'reasons' ? 'duplicate' then duplicate_count:=duplicate_count+1; end if;
    if not exists(select 1 from jsonb_array_elements_text(collections) c where lower(c)=lower(item->>'category')) then collections:=collections||jsonb_build_array(item->>'category'); end if;
    for attribute in select value from jsonb_array_elements(item->'variations') loop
      select ord::integer-1,value into attribute_index,existing_attribute from jsonb_array_elements(attributes) with ordinality a(value,ord) where lower(value->>'name')=lower(attribute->>'name') limit 1;
      if attribute_index is null then attributes:=attributes||jsonb_build_array(attribute);
      else
        for value_item in select value from jsonb_array_elements(attribute->'values') loop
          if not exists(select 1 from jsonb_array_elements_text(existing_attribute->'values') v where lower(v)=lower(value_item#>>'{}')) then existing_attribute:=jsonb_set(existing_attribute,'{values}',(existing_attribute->'values')||jsonb_build_array(value_item)); end if;
        end loop;
        attributes:=jsonb_set(attributes,array[attribute_index::text],existing_attribute);
      end if;
    end loop;
  end loop;
  update private.catalog_import_batches set before_products=original->'products',before_collections=original->'collections',before_attributes=original->'attributeCatalog',before_next_product_id=original->'nextProductId' where id=p_batch;
  update public.app_state set data=jsonb_set(jsonb_set(jsonb_set(jsonb_set(original,'{products}',products||imported),'{collections}',collections),'{attributeCatalog}',attributes),'{nextProductId}',to_jsonb(next_id)),version=version+1,updated_at=now() where id=1;
  if (select data-'products'-'collections'-'attributeCatalog'-'nextProductId' from public.app_state where id=1) is distinct from original-'products'-'collections'-'attributeCatalog'-'nextProductId' then raise exception 'Import changed operational data.'; end if;
  if (select count(*) from jsonb_array_elements((select data->'products' from public.app_state where id=1)) p where p->'importInfo'->>'batchId'=p_batch)<>batch.expected_count then raise exception 'Imported product count mismatch.'; end if;
  import_result:=jsonb_build_object('batchId',p_batch,'imported',batch.expected_count,'active',active_count,'drafts',draft_count,'duplicateDrafts',duplicate_count,'existing',jsonb_array_length(products),'total',jsonb_array_length(products)+batch.expected_count,'mapping',mapping);
  update private.catalog_import_batches set status='applied',applied_at=now(),result=import_result where id=p_batch;
  return import_result;
end;
$$;
revoke all on function private.apply_catalog_import(text) from public,anon,authenticated,service_role;

