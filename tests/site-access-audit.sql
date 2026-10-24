-- Integration checks use existing staff roles and always roll back every change.
begin;
do $test$
declare seller uuid; manager uuid; st jsonb; original jsonb; options jsonb; result jsonb; log_id bigint; second_id bigint; offer_id text;
 snapshot jsonb; products jsonb; target jsonb; selected jsonb; methods jsonb; p jsonb; choices jsonb; req jsonb; quote jsonb; order_id bigint; contact_id uuid; old_name text; before_stock integer; physical integer;
begin
 select user_id into seller from public.profiles where role='admin' and position='Vendedor' limit 1;
 select user_id into manager from public.profiles where role='master' limit 1;
 if seller is null or manager is null then raise exception 'Fixtures de equipe ausentes.';end if;
 select data into original from public.app_state where id=1;
 perform set_config('request.jwt.claim.sub',seller::text,true);
 result:=public.sales_state();
 if exists(select 1 from jsonb_array_elements(result->'data'->'products') product_row where product_row ? 'cost') then raise exception 'Custo exposto ao vendedor.';end if;
 if not (result->'data' ? 'navigation') or not (result->'data' ? 'orderBumps') then raise exception 'Configurações ausentes da projeção.';end if;
 if exists(select 1 from jsonb_array_elements(result->'data'->'orderBumps') b where b ? 'cost') then raise exception 'Custo da oferta exposto.';end if;

 -- One region edit is independently reversible after a different region changes.
 select data into st from public.app_state where id=1;options:=st->'settings'->'shippingOptions';
 select value into target from jsonb_array_elements(options) where value->>'delivery'='Entrega' limit 1;
 options:=(select jsonb_agg(case when value->>'id'=target->>'id' then value||jsonb_build_object('price',(value->>'price')::numeric+1) else value end order by ord) from jsonb_array_elements(options) with ordinality x(value,ord));
 perform public.save_shipping_settings(options,jsonb_build_object('mode','regional','options',st->'settings'->'shippingOptions'));
 select id into log_id from private.change_history where transaction_id=txid_current();
 if not exists(select 1 from private.change_history where id=log_id and actor_id=seller and areas @> array['shippingOptions'] and jsonb_array_length(changes)=1) then raise exception 'Autoria ou diffs incorretos.';end if;
 update private.change_history set transaction_id=-id where transaction_id=txid_current(); -- emulate the end of one HTTP transaction
 select data into st from public.app_state where id=1;options:=st->'settings'->'shippingOptions';
 select value into selected from jsonb_array_elements(options) where value->>'delivery'='Entrega' and value->>'id'<>target->>'id' limit 1;
 options:=(select jsonb_agg(case when value->>'id'=selected->>'id' then value||jsonb_build_object('price',(value->>'price')::numeric+2) else value end order by ord) from jsonb_array_elements(options) with ordinality x(value,ord));
 perform public.save_shipping_settings(options,jsonb_build_object('mode','regional','options',st->'settings'->'shippingOptions'));
 update private.change_history set transaction_id=-id where transaction_id=txid_current();
 begin perform public.list_change_history();raise exception 'Histórico exposto ao vendedor';exception when others then if sqlerrm not like 'O histórico é reservado%' then raise;end if;end;
 begin perform public.change_history_detail(log_id);raise exception 'Detalhe exposto ao vendedor';exception when others then if sqlerrm not like 'Acesso restrito%' then raise;end if;end;
 begin perform public.revert_change_history(log_id);raise exception 'Reversão permitida ao vendedor';exception when others then if sqlerrm not like 'Somente a conta principal%' then raise;end if;end;
 perform set_config('request.jwt.claim.sub',manager::text,true);
 perform public.revert_change_history(log_id);
 select data into st from public.app_state where id=1;
 if not exists(select 1 from jsonb_array_elements(st->'settings'->'shippingOptions') r where r->>'id'=target->>'id' and r=target) then raise exception 'A região não foi restaurada.';end if;
 if not exists(select 1 from jsonb_array_elements(st->'settings'->'shippingOptions') r where r->>'id'=selected->>'id' and (r->>'price')::numeric=(selected->>'price')::numeric+2) then raise exception 'Outra região foi sobrescrita.';end if;
 if not exists(select 1 from private.change_history where id=log_id and reverted_at is not null and reverted_by=manager and reversal_id is not null) then raise exception 'Reversão sem rastreio.';end if;
 update private.change_history set transaction_id=-id where transaction_id=txid_current();

 -- Store, payment and page configurations use targeted writes, with role/concurrency checks.
 perform set_config('request.jwt.claim.sub',seller::text,true);
 select jsonb_object_agg(key,value) into snapshot from jsonb_each(st->'settings') where key in ('name','phone','address','addressParts');
 perform public.save_site_section('store',snapshot||jsonb_build_object('name',(snapshot->>'name')||' QA'),snapshot);
 begin perform public.save_site_section('store',snapshot,snapshot);raise exception 'Concorrência ignorada';exception when others then if sqlerrm not like 'Esta configuração mudou%' then raise;end if;end;
 begin perform public.save_site_section('orders','[]','[]');raise exception 'Seção não permitida';exception when others then if sqlerrm not like 'Configuração não permitida%' then raise;end if;end;
 select data into st from public.app_state where id=1;
 methods:=jsonb_set(st->'settings'->'paymentMethods','{0,title}','"Pagamento QA"');
 perform public.save_site_section('paymentMethods',methods,st->'settings'->'paymentMethods');
 perform public.save_site_section('pages',(st->'pages')||jsonb_build_array(jsonb_build_object('id',floor(extract(epoch from clock_timestamp())*1000),'title','Página QA','content','Verificação isolada','active',false)),st->'pages');
 perform public.save_navigation(st->'navigation',st->'navigation');
 perform public.save_storefront(st->'storefront',st->'storefront');
 update private.change_history set transaction_id=-id where transaction_id=txid_current();
 select data into st from public.app_state where id=1;
 perform public.save_collection(null,'QA Auditoria',false,'manual',null,(select version from public.app_state where id=1));
 result:=public.sales_state();products:=result->'data'->'products';
 begin perform public.save_catalog(jsonb_build_object('products',jsonb_set(products,'{0,price}',to_jsonb((products->0->>'price')::numeric+1))),(select version from public.app_state where id=1));raise exception 'Edição de preço permitida';exception when others then if sqlerrm not like 'O vendedor pode alterar apenas%' then raise;end if;end;
 products:=jsonb_set(products,'{0,categories}',coalesce(products->0->'categories','[]')||'"QA Auditoria"'::jsonb);
 perform public.save_catalog(jsonb_build_object('products',products),(select version from public.app_state where id=1));
 if (select data->'products'->0->'cost' from public.app_state where id=1) is distinct from original->'products'->0->'cost' then raise exception 'Custo original alterado.';end if;
 offer_id:='qa-'||gen_random_uuid()::text;
 perform public.save_catalog(jsonb_build_object('orderBumps',jsonb_build_array(jsonb_build_object('id',offer_id,'title','Serviço QA','description','Teste','kind','service','price',10,'cost',999,'active',false,'allProducts',true,'targetProductIds','[]'::jsonb))),(select version from public.app_state where id=1));
 if (select data->'orderBumps'->0->>'cost' from public.app_state where id=1)<>'0' then raise exception 'Custo de oferta controlado pelo vendedor.';end if;
 update private.change_history set transaction_id=-id where transaction_id=txid_current();

 -- A second edit to the same record blocks stale reversal.
 select data into st from public.app_state where id=1;options:=st->'settings'->'shippingOptions';
 options:=(select jsonb_agg(case when value->>'id'=target->>'id' then value||jsonb_build_object('price',(value->>'price')::numeric+3) else value end order by ord) from jsonb_array_elements(options) with ordinality x(value,ord));
 perform public.save_shipping_settings(options,jsonb_build_object('mode','regional','options',st->'settings'->'shippingOptions'));
 select id into second_id from private.change_history where transaction_id=txid_current();update private.change_history set transaction_id=-id where transaction_id=txid_current();
 select data into st from public.app_state where id=1;options:=st->'settings'->'shippingOptions';
 options:=(select jsonb_agg(case when value->>'id'=target->>'id' then value||jsonb_build_object('price',(value->>'price')::numeric+4) else value end order by ord) from jsonb_array_elements(options) with ordinality x(value,ord));
 perform public.save_shipping_settings(options,jsonb_build_object('mode','regional','options',st->'settings'->'shippingOptions'));
 update private.change_history set transaction_id=-id where transaction_id=txid_current();
 perform set_config('request.jwt.claim.sub',manager::text,true);
 begin perform public.revert_change_history(second_id);raise exception 'Reversão sobrescreveu edição recente';exception when others then if sqlerrm not like 'Este registro foi alterado novamente%' then raise;end if;end;

 -- Profile and customer rows can be restored without changing authentication credentials.
 select name into old_name from public.profiles where user_id=seller;
 update public.profiles set name=name||' QA' where user_id=seller;
 select id into log_id from private.change_history where transaction_id=txid_current();update private.change_history set transaction_id=-id where transaction_id=txid_current();
 perform public.revert_change_history(log_id);
 if (select name from public.profiles where user_id=seller)<>old_name then raise exception 'Perfil não restaurado';end if;
 update private.change_history set transaction_id=-id where transaction_id=txid_current();
 select id,name into contact_id,old_name from public.customer_contacts limit 1;
 if contact_id is not null then
  update public.customer_contacts set name=name||' QA' where id=contact_id;
  select id into log_id from private.change_history where transaction_id=txid_current();update private.change_history set transaction_id=-id where transaction_id=txid_current();
  perform public.revert_change_history(log_id);
  if (select name from public.customer_contacts where id=contact_id)<>old_name then raise exception 'Cliente não restaurado';end if;
  update private.change_history set transaction_id=-id where transaction_id=txid_current();
 end if;

 -- Real order workflow: release consumes stock; one reversal restores stock and order together.
 select data into st from public.app_state where id=1;
 select value into p from jsonb_array_elements(st->'products') where value->>'active'='true' and (value->>'stock')::integer>5 limit 1;
 before_stock:=(p->>'stock')::integer;
 select coalesce(jsonb_object_agg(v->>'name',v->'values'->>0),'{}') into choices from jsonb_array_elements(coalesce(p->'variations','[]')) v;
 selected:=private.regional_shipping_match(st->'settings'->'shippingOptions','{"city":"Niterói","state":"RJ","neighborhood":"Piratininga"}');
 select value into methods from jsonb_array_elements(st->'settings'->'paymentMethods') where value->>'kind'='pix' and value->>'active'='true' limit 1;
 quote:=private.payment_quote(st->'settings'->'paymentMethods',methods->>'id',1,(case when coalesce((p->>'promoPrice')::numeric,0)>0 and (p->>'promoPrice')::numeric<(p->>'price')::numeric then (p->>'promoPrice')::numeric else (p->>'price')::numeric end)+(selected->>'price')::numeric);
 req:=jsonb_build_object('firstName','Teste','lastName','Auditoria','email','teste-auditoria@example.invalid','phone','5521999990000','cpf','99988877766','delivery','Entrega','address','Rua de teste, 1 · Piratininga · Niterói / RJ · CEP 24350000','addressParts','{"city":"Niterói","state":"RJ","neighborhood":"Piratininga","street":"Rua de teste","number":"1","cep":"24350000"}'::jsonb,'shippingOptionId',selected->>'id','paymentTiming','Na entrega','paymentMethodId',methods->>'id','installments',1,'expectedTotal',quote->'total','items',jsonb_build_array(jsonb_build_object('id',p->'id','qty',1,'options',choices)));
 result:=public.place_order(req);order_id:=(result->>'id')::bigint;
 update private.change_history set transaction_id=-id where transaction_id=txid_current();
 perform public.schedule_delivery(order_id,(now() at time zone 'America/Sao_Paulo')::date,null);
 update private.change_history set transaction_id=-id where transaction_id=txid_current();
 perform public.order_action(order_id,'release',null);
 select id into log_id from private.change_history where transaction_id=txid_current();
 if not exists(select 1 from private.change_history where id=log_id and areas @> array['orders','products','movements']) then raise exception 'Etapas relacionadas não agrupadas.';end if;
 update private.change_history set transaction_id=-id where transaction_id=txid_current();
 perform public.revert_change_history(log_id);
 select (value->>'stock')::integer into physical from public.app_state s cross join lateral jsonb_array_elements(s.data->'products') where value->>'id'=p->>'id';
 if physical<>before_stock then raise exception 'Estoque não restaurado com o pedido.';end if;
 if exists(select 1 from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') o where o->>'id'=order_id::text and o->>'status'='transit') then raise exception 'Etapa do pedido não restaurada.';end if;
 if has_table_privilege('authenticated','private.change_history','INSERT,UPDATE,DELETE') or has_function_privilege('anon','public.revert_change_history(bigint)','execute') then raise exception 'Permissões excessivas no histórico.';end if;
end;
$test$;
rollback;
select true as site_access_audit_checks_rolled_back;
