begin;
do $qa$
declare s public.app_state%rowtype; revised_products jsonb; product jsonb; selected_options jsonb; option jsonb;
 actor uuid; shipping jsonb; method jsonb; quote jsonb; request jsonb; response jsonb; result jsonb; target jsonb;
 original_stock integer; order_id bigint; message text; original_orders jsonb; original_products jsonb; version_before bigint;
begin
 select user_id into actor from public.profiles where role='master' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 select * into s from public.app_state where id=1; original_orders:=s.data->'orders';original_products:=s.data->'products';
 select value into product from jsonb_array_elements(s.data->'products') where value->>'active'='true' and (value->>'stock')::integer>3 limit 1;
 original_stock:=(product->>'stock')::integer;
 revised_products:=(select jsonb_agg(case when value->>'id'=product->>'id' then value||jsonb_build_object('categories',jsonb_build_array('QA catálogo','QA queima'),'category','QA catálogo') else value end order by ord) from jsonb_array_elements(s.data->'products') with ordinality a(value,ord));
 result:=private.save_catalog(jsonb_build_object('products',revised_products,'collections',(s.data->'collections')||'["QA catálogo","QA queima"]'::jsonb,
 'collectionSettings',jsonb_build_object('QA catálogo',jsonb_build_object('active',false,'productIds',jsonb_build_array(product->'id'))),
 'orderBumps',jsonb_build_array(jsonb_build_object('id','qa-service','title','Impermeabilização QA','description','Teste revertido','kind','service','price',33,'cost',7,'active',true,'allProducts',false,'targetProductIds',jsonb_build_array(product->'id')),
 jsonb_build_object('id','qa-product','title','Produto adicional QA','description','','kind','product','productId',product->'id','price',12,'cost',0,'active',true,'allProducts',true,'targetProductIds','[]'::jsonb))),s.version);
 if result->>'version' is null then raise exception 'QA catalog version missing';end if;
 begin perform private.save_catalog('{}',s.version);raise exception 'QA expected stale version rejection';exception when others then get stacked diagnostics message=message_text;if message not like 'O catálogo mudou%' then raise;end if;end;
 select * into s from public.app_state where id=1;
 if s.data->'orders'<>original_orders then raise exception 'QA catalog modified orders';end if;
 if (select data->'orderBumps'->0 ? 'cost' from public.shop_public where id=1) then raise exception 'QA private service cost leaked';end if;
 if (select data->'collectionSettings'->'QA catálogo'->>'active' from public.shop_public where id=1)<>'false' then raise exception 'QA collection visibility missing';end if;
 begin perform private.checkout_bump_items(s.data,'{"items":[{"id":2147483000,"qty":1}],"orderBumps":[{"offerId":"qa-service"}]}');raise exception 'QA expected target restriction';exception when others then get stacked diagnostics message=message_text;if message not like 'Esta oferta não se aplica%' then raise;end if;end;
 selected_options:='{}';for option in select value from jsonb_array_elements(coalesce(product->'variations','[]')) loop selected_options:=selected_options||jsonb_build_object(option->>'name',option->'values'->0);end loop;
 select value into shipping from jsonb_array_elements(s.data->'settings'->'shippingOptions') where value->>'active'='true' and value->>'delivery'='Entrega' limit 1;
 if shipping is null then shipping:='{"id":"qa-shipping","name":"Frete QA","price":0,"active":true,"delivery":"Entrega"}';update public.app_state set data=jsonb_set(data,'{settings,shippingOptions}',(data->'settings'->'shippingOptions')||jsonb_build_array(shipping)),version=version+1 where id=1;end if;
 select value into method from jsonb_array_elements(s.data->'settings'->'paymentMethods') where value->>'active'='true' limit 1;
 quote:=private.payment_quote(s.data->'settings'->'paymentMethods',method->>'id',(method->'installments'->0->>'count')::integer,
 case when coalesce((product->>'promoPrice')::numeric,0)>0 and (product->>'promoPrice')::numeric<(product->>'price')::numeric then (product->>'promoPrice')::numeric else (product->>'price')::numeric end+45+(shipping->>'price')::numeric);
 request:=jsonb_build_object('firstName','Teste','lastName','Catálogo','email','catalog-qa@exemplo.invalid','phone','21999999999','cpf','09999999995','address','Rua de teste, 1 · Bairro teste · Rio de Janeiro / RJ · CEP 20000-000','delivery','Entrega','paymentTiming','Na entrega',
 'paymentMethodId',method->>'id','installments',(method->'installments'->0->>'count')::integer,'shippingOptionId',shipping->>'id','expectedTotal',quote->'total',
 'items',jsonb_build_array(jsonb_build_object('id',product->'id','qty',1,'options',selected_options)),
 'orderBumps',jsonb_build_array(jsonb_build_object('offerId','qa-service','price',0.01),jsonb_build_object('offerId','qa-product','options',selected_options,'price',0.01)));
 response:=private.place_order(request);order_id:=(response->>'id')::bigint;
 if jsonb_array_length(response->'order'->'items')<>3 then raise exception 'QA bumps missing from confirmation';end if;
 if exists(select 1 from jsonb_array_elements(response->'order'->'items') i where i ? 'cost') then raise exception 'QA item cost leaked';end if;
 if (select sum((i->>'price')::numeric) from jsonb_array_elements(response->'order'->'items') i where i ? 'orderBumpId')<>45 then raise exception 'QA client price tampering accepted';end if;
 if (response->'order'->>'total')::numeric<>(quote->>'total')::numeric then raise exception 'QA checkout total mismatch';end if;
 update public.app_state set data=jsonb_set(data,'{orders}',(select jsonb_agg(case when o->>'id'=order_id::text then o||jsonb_build_object('deliveryDate',to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD')) else o end order by ord) from jsonb_array_elements(data->'orders') with ordinality a(o,ord))),version=version+1 where id=1;
 perform private.order_action(order_id,'release');
 if (select (p->>'stock')::integer from public.app_state state cross join lateral jsonb_array_elements(state.data->'products') p where state.id=1 and p->>'id'=product->>'id')<>original_stock-2 then raise exception 'QA service moved stock or physical offer not debited';end if;
 perform private.order_action(order_id,'cancel');
 if (select (p->>'stock')::integer from public.app_state state cross join lateral jsonb_array_elements(state.data->'products') p where state.id=1 and p->>'id'=product->>'id')<>original_stock then raise exception 'QA stock not restored';end if;
 perform private.delete_order(order_id);
 if (select data->'orders' from public.app_state where id=1)<>original_orders then raise exception 'QA historical orders changed';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);
 perform set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000000","role":"authenticated"}',true);
 begin perform private.save_catalog('{}',0);raise exception 'QA expected role denial';exception when others then get stacked diagnostics message=message_text;if message not like 'Somente gerente%' then raise;end if;end;
end $qa$;
select 'PASS: memberships, visibility, version conflict, eligibility, private costs, server prices, totals, confirmations, physical stock, service isolation, cancellation, deletion and manager permissions' qa_result;
rollback;
