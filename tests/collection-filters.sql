begin;
-- Test actual trigger paths in an isolated transaction. No live orders are modified.
create temporary table qa_collection_projection(data jsonb);
create trigger qa_publish after insert or update on qa_collection_projection for each row execute function private.publish_catalog();
do $test$
declare model jsonb; projected jsonb;
begin
 if has_function_privilege('anon','private.completed_product_sales(jsonb)','execute') or has_function_privilege('authenticated','private.completed_product_sales(jsonb)','execute') then raise exception 'Helper exposto';end if;
 model:='{"products":[{"id":1,"active":true,"stock":100,"cost":500}],"orders":[{"status":"delivered","paid":true,"customer":"PRIVADO","items":[{"id":1,"qty":3,"cost":500}]},{"status":"pending","paid":false,"items":[{"id":1,"qty":2}]},{"status":"cancelled","paid":true,"items":[{"id":1,"qty":9}]},{"status":"delivered","paid":false,"items":[{"id":1,"qty":7}]}]}'::jsonb;
 insert into qa_collection_projection values(model);
 select data into projected from public.shop_public where id=1;
 if projected->'productSales' is distinct from '{"1":3}'::jsonb or projected->'products'->0->>'stock'<>'98' then raise exception 'Vendas ou reservas incorretas';end if;
 if projected ? 'orders' or projected->'products'->0 ? 'cost' or projected::text like '%PRIVADO%' then raise exception 'Dados privados publicados';end if;
 update qa_collection_projection set data=data||'{"storefront":{"sections":[]}}';
 if (select data->'productSales' from public.shop_public where id=1) is distinct from '{"1":3}'::jsonb then raise exception 'Edição de metadados perdeu totais';end if;
 update qa_collection_projection set data=jsonb_set(data,'{orders,0,status}','"cancelled"');
 if (select data->'productSales' from public.shop_public where id=1) is distinct from '{}'::jsonb then raise exception 'Cancelamento manteve venda';end if;
 update qa_collection_projection set data=model;
 update qa_collection_projection set data=jsonb_set(data,'{orders}',(data->'orders')-0);
 if (select data->'productSales' from public.shop_public where id=1) is distinct from '{}'::jsonb then raise exception 'Exclusão manteve venda';end if;
end;
$test$;

rollback;
