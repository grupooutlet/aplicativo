-- Verify the deployed RPC without keeping fixtures or test orders.
begin;
set local lock_timeout='3s';
do $qa$
declare
  seller uuid := 'ca670000-0000-4000-8000-000000000001';
  manager uuid := 'ca670000-0000-4000-8000-000000000002';
  session_id uuid := 'ca670000-0000-4000-8000-000000000003';
  request_id uuid := 'ca670000-0000-4000-8000-000000000004';
  payload jsonb;
  result jsonb;
  saved jsonb;
  notes jsonb;
  order_id bigint;
  invalid jsonb;
  error_message text;
begin
  insert into auth.users(id,email,raw_user_meta_data) values
    (seller,'staff-multi-seller@example.invalid','{"name":"QA Vendedor","phone":"21987654321"}'),
    (manager,'staff-multi-manager@example.invalid','{"name":"QA Gerente","phone":"21987654321"}');
  update public.profiles set role='admin',position='Vendedor' where user_id=seller;
  update public.profiles set role='admin',position='Gerente' where user_id=manager;
  insert into auth.sessions(id,user_id) values(session_id,manager);
  perform set_config('request.jwt.claim.sub',manager::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',manager,'session_id',session_id)::text,true);

  update public.app_state set data=data || jsonb_build_object(
    'products',(data->'products') || '[
      {"id":900006701,"name":"Sofá QA","sku":"QA-6701","price":1000,"promoPrice":900,"cost":400,"stock":3,"min":1,"active":true,"category":"Sofás","variations":[{"name":"Cor","values":["Bege","Cinza"]}]},
      {"id":900006702,"name":"Mesa QA","sku":"QA-6702","price":600,"cost":300,"stock":3,"min":1,"active":true,"category":"Mesas","variations":[]}
    ]'::jsonb,
    'settings',(data->'settings') || jsonb_build_object(
      'shippingMode','regional',
      'shippingOptions',(data#>'{settings,shippingOptions}') || '[
        {"id":"qa-6700-delivery","name":"Entrega QA","delivery":"Entrega","price":200,"active":true,"confirmationRequired":true,"region":{"city":"Cidade QA","state":"RJ","neighborhoods":["Bairro QA"]},"note":"Somente área QA"},
        {"id":"qa-6700-pickup","name":"Retirada QA","delivery":"Retirada","price":0,"active":true}
      ]'::jsonb,
      'paymentMethods',(select jsonb_agg(case when value->>'kind'='credit' then
        value || '{"active":true,"installments":[{"count":3,"rate":10,"feeType":"percent"}]}'::jsonb
        else value end) from jsonb_array_elements(data#>'{settings,paymentMethods}'))
    )
  ), version=version+1 where id=1;
  payload := jsonb_build_object(
    'customer','Cliente QA','phone','21987654321','address','Rua QA, 42, Bairro QA, Cidade QA / RJ',
    'addressParts','{"street":"Rua QA","number":"42","neighborhood":"Bairro QA","city":"Cidade QA","state":"RJ","cep":"26000-001"}'::jsonb,
    'delivery','Entrega','deliveryDate',(current_date+1)::text,'shippingRestrictionConfirmed',true,
    'shippingOptionId','qa-6700-delivery','paymentTiming','Na entrega','installments',3,'total',3630,
    'paymentMethodId',(select value->>'id' from public.app_state s cross join lateral jsonb_array_elements(s.data#>'{settings,paymentMethods}') where s.id=1 and value->>'kind'='credit'),
    'seller_id',seller,'freightOverride','{"expectedPrice":200,"price":0,"reason":"QA_FRETE_INTERNO"}'::jsonb,
    'items','[
      {"id":900006701,"qty":2,"options":{"Cor":"Bege"}},
      {"id":900006701,"qty":1,"options":{"Cor":"Cinza"},"priceOverride":{"expectedUnitPrice":900,"unitPrice":900,"reason":"Preço de catálogo"}},
      {"id":900006702,"qty":1,"options":{}}
    ]'::jsonb
  );
  foreach invalid in array array[
    jsonb_set(payload,'{freightOverride,expectedPrice}','199'),
    jsonb_set(payload,'{freightOverride,reason}','""'),
    jsonb_set(payload,'{freightOverride,price}','1.234'),
    jsonb_set(payload,'{freightOverride,price}','-1'),
    jsonb_set(payload,'{shippingRestrictionConfirmed}','false'),
    jsonb_set(payload,'{addressParts,neighborhood}','"Sem cobertura"'),
    jsonb_set(jsonb_set(payload,'{delivery}','"Retirada"'),'{shippingOptionId}','"qa-6700-pickup"'),
    jsonb_set(payload,'{items,1,qty}','2')
  ] loop
    error_message:=null;
    begin perform public.create_staff_order(invalid,gen_random_uuid());
    exception when others then error_message:=sqlerrm; end;
    assert error_message ~ '(frete|área|cobertura|Estoque)',coalesce(error_message,'Solicitação inválida foi aceita');
  end loop;

  result := public.create_staff_order(payload,request_id);
  order_id := (result->>'id')::bigint;
  assert public.create_staff_order(payload,request_id)->>'id'=order_id::text;
  select o into saved from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') o where s.id=1 and o->>'id'=order_id::text;
  assert jsonb_array_length(saved->'items')=3;
  assert (saved->>'paymentBase')::numeric=3300 and (saved->>'total')::numeric=3630;
  assert (saved->>'freight')::numeric=0 and saved->>'freightBilling'='external';
  assert saved::text not like '%QA_FRETE_INTERNO%' and not saved ? 'freightOverride';
  notes := public.order_price_notes(order_id);
  assert jsonb_array_length(notes)=1 and notes#>>'{0,kind}'='freight';
  assert (notes#>>'{0,originalPrice}')::numeric=200 and (notes#>>'{0,unitPrice}')::numeric=0;
  assert notes#>>'{0,reason}'='QA_FRETE_INTERNO' and notes#>>'{0,actorName}'='QA Gerente';
  assert not has_table_privilege('authenticated','private.order_freight_adjustments','select,insert,update,delete');
  error_message:=null;
  begin update private.order_freight_adjustments set reason='Removido' where order_freight_adjustments.order_id=(result->>'id')::bigint;
  exception when others then error_message:=sqlerrm; end;
  assert error_message like '%não podem ser editados%';
end;
$qa$;
select 'staff_order_freight_checks_passed' as result;
rollback;
