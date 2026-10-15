begin;
insert into private.catalog_import_batches(id,source_url,expected_count,expected_products_hash,manifest_sha256)
select 'qa-catalog-import','https://www.forteoutlet.com.br/',2,md5((data->'products')::text),'qa-only' from public.app_state where id=1;
do $qa$
declare before_data jsonb; before_version bigint; first_result jsonb; second_result jsonb; message text;
begin
 select data,version into before_data,before_version from public.app_state where id=1;
 begin perform private.apply_catalog_import('qa-catalog-import'); raise exception 'QA expected coverage rejection'; exception when others then get stacked diagnostics message=message_text; if message<>'Catalog coverage mismatch.' then raise; end if; end;
 update private.catalog_import_batches set expected_count=1,expected_products_hash='stale' where id='qa-catalog-import';
 insert into private.catalog_import_items values('qa-catalog-import',1,0,'{"name":"QA draft","price":100,"stock":0,"cost":999,"active":true,"images":[],"variations":[],"category":"QA","importInfo":{"batchId":"qa-catalog-import","sourceId":1,"reasons":["missing_photos"]}}');
 begin perform private.apply_catalog_import('qa-catalog-import'); raise exception 'QA expected stale rejection'; exception when others then get stacked diagnostics message=message_text; if message<>'Products changed since duplicate review. Rebuild the import plan.' then raise; end if; end;
 update private.catalog_import_batches set expected_products_hash=md5((before_data->'products')::text) where id='qa-catalog-import';
 begin perform private.apply_catalog_import('qa-catalog-import'); raise exception 'QA expected photo rejection'; exception when others then get stacked diagnostics message=message_text; if message<>'Product without photos must remain a draft.' then raise; end if; end;
 update private.catalog_import_items set payload=jsonb_set(payload,'{active}','false') where batch_id='qa-catalog-import';
 first_result:=private.apply_catalog_import('qa-catalog-import'); second_result:=private.apply_catalog_import('qa-catalog-import');
 if first_result<>second_result then raise exception 'QA idempotence failed'; end if;
 if (select version from public.app_state where id=1)<>before_version+1 then raise exception 'QA version failed'; end if;
 if (select jsonb_array_length(data->'products') from public.app_state where id=1)<>jsonb_array_length(before_data->'products')+1 then raise exception 'QA count failed'; end if;
 if (select data-'products'-'collections'-'attributeCatalog'-'nextProductId' from public.app_state where id=1)<>before_data-'products'-'collections'-'attributeCatalog'-'nextProductId' then raise exception 'QA operational data changed'; end if;
 if exists(select 1 from public.shop_public s cross join lateral jsonb_array_elements(s.data->'products') p where p->'importInfo'->>'batchId'='qa-catalog-import') then raise exception 'QA draft published'; end if;
 if exists(select 1 from public.app_state s cross join lateral jsonb_array_elements(s.data->'products') p where p->'importInfo'->>'batchId'='qa-catalog-import' and p->>'cost'<>'0') then raise exception 'QA invented cost'; end if;
end $qa$;
select 'Coverage, stale snapshot, photo draft protection, idempotence, operational isolation, draft privacy and zero unknown cost: passed' as qa_result;
rollback;
