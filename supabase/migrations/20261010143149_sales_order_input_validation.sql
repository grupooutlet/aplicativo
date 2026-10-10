create or replace function private.sales_order(p_order jsonb,p_order_id bigint default null) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare s public.app_state%rowtype; target jsonb; revised jsonb; items jsonb:='[]';
  requested jsonb; product jsonb; variation jsonb; options jsonb; summary text;
  qty integer; reserved_qty integer; chosen integer; price numeric; shipping jsonb; quote jsonb; new_id bigint;
begin
  if not private.is_seller() then raise exception 'Acesso restrito aos vendedores.'; end if;
  if length(trim(coalesce(p_order->>'customer',''))) not between 2 and 120
    or regexp_replace(coalesce(p_order->>'phone',''),'[^0-9]','','g') !~ '^(55)?[0-9]{10,11}$'
    or length(coalesce(p_order->>'address','')) not between 5 and 400
    or length(coalesce(p_order->>'notes',''))>2000 then raise exception 'Confira os dados do cliente.'; end if;
  select * into s from public.app_state where id=1 for update;
  if p_order_id is not null then
    select value into target from jsonb_array_elements(s.data->'orders') where value->>'id'=p_order_id::text;
    if target is null or target->>'status' not in ('pending','ready') then raise exception 'O pedido não pode ser editado.'; end if;
    if target->>'delivery'='Entrega' and (nullif(p_order->>'deliveryDate','') is null
      or ((p_order->>'deliveryDate')::date<(now() at time zone 'America/Sao_Paulo')::date
        and p_order->>'deliveryDate' is distinct from target->>'deliveryDate')) then raise exception 'Confira a data da entrega.'; end if;
    revised:=target||jsonb_build_object('firstName',p_order->'firstName','lastName',p_order->'lastName',
      'customer',trim(p_order->>'customer'),'phone',p_order->'phone','address',p_order->'address',
      'addressParts',p_order->'addressParts','notes',p_order->'notes','deliveryDate',p_order->'deliveryDate');
    update public.app_state set data=jsonb_set(s.data,'{orders}',
      (select jsonb_agg(case when value->>'id'=p_order_id::text then revised else value end order by ord)
        from jsonb_array_elements(s.data->'orders') with ordinality as x(value,ord))),version=version+1,updated_at=now() where id=1;
    return jsonb_build_object('id',p_order_id);
  end if;
  if coalesce(p_order->>'delivery','') not in ('Entrega','Retirada') or coalesce(p_order->>'paymentTiming','') not in ('Antecipado','Na entrega','Na retirada')
    or jsonb_typeof(p_order->'items') is distinct from 'array' or jsonb_array_length(p_order->'items') not between 1 and 20 then raise exception 'Confira o pedido.'; end if;
  if p_order->>'delivery'='Entrega' and (nullif(p_order->>'deliveryDate','') is null
    or (p_order->>'deliveryDate')::date<(now() at time zone 'America/Sao_Paulo')::date) then raise exception 'Selecione uma data válida.'; end if;
  select value into shipping from jsonb_array_elements(s.data->'settings'->'shippingOptions')
    where value->>'id'=p_order->>'shippingOptionId' and value->>'delivery'=p_order->>'delivery' and value->>'active'='true';
  if shipping is null then raise exception 'Selecione um frete disponível.'; end if;
  for requested in select value from jsonb_array_elements(p_order->'items') loop
    qty:=(requested->>'qty')::integer;
    if qty is null or qty not between 1 and 99 then raise exception 'Quantidade inválida.'; end if;
    select value into product from jsonb_array_elements(s.data->'products') where value->>'id'=requested->>'id' and value->>'active'='true';
    if product is null then raise exception 'Produto indisponível.'; end if;
    options:=coalesce(requested->'options','{}'); summary:='';
    if jsonb_typeof(options)<>'object' then raise exception 'Variações inválidas.'; end if;
    for variation in select value from jsonb_array_elements(coalesce(product->'variations','[]')) loop
      if not exists(select 1 from jsonb_array_elements_text(variation->'values') where value=options->>(variation->>'name')) then raise exception 'Selecione as variações.'; end if;
      summary:=summary||' · '||(variation->>'name')||': '||(options->>(variation->>'name'));
    end loop;
    if (select count(*) from jsonb_object_keys(options))<>jsonb_array_length(coalesce(product->'variations','[]')) then raise exception 'Variações inválidas.'; end if;
    select coalesce(sum((i->>'qty')::integer),0) into reserved_qty from jsonb_array_elements(s.data->'orders') ord(o)
      cross join lateral jsonb_array_elements(o->'items') it(i) where o->>'status' in ('pending','ready') and i->>'id'=product->>'id';
    select coalesce(sum((value->>'qty')::integer),0) into chosen from jsonb_array_elements(items) where value->>'id'=product->>'id';
    if qty+chosen>(product->>'stock')::integer-reserved_qty then raise exception 'Estoque insuficiente para %.',product->>'name'; end if;
    price:=(product->>'price')::numeric;
    if coalesce((product->>'promoPrice')::numeric,0)>0 and (product->>'promoPrice')::numeric<price then price:=(product->>'promoPrice')::numeric; end if;
    items:=items||jsonb_build_array(jsonb_build_object('id',product->'id','name',(product->>'name')||summary,'options',options,'qty',qty,'price',price,'cost',product->'cost'));
  end loop;
  select coalesce(sum((value->>'price')::numeric*(value->>'qty')::integer),0)+(shipping->>'price')::numeric into price from jsonb_array_elements(items);
  quote:=private.payment_quote(s.data->'settings'->'paymentMethods',p_order->>'paymentMethodId',(p_order->>'installments')::integer,price);
  select greatest(1000,coalesce(max((value->>'id')::bigint),0))+1 into new_id from jsonb_array_elements(s.data->'orders');
  revised:=jsonb_build_object('id',new_id,'customer',trim(p_order->>'customer'),'email',p_order->'email',
    'phone',p_order->'phone','cpf',p_order->'cpf','address',p_order->'address','addressParts',p_order->'addressParts',
    'notes',coalesce(p_order->>'notes',''),'delivery',p_order->'delivery','deliveryDate',p_order->'deliveryDate',
    'shippingOptionId',shipping->'id','shippingOptionName',shipping->'name','freight',shipping->'price','freightPending',false,
    'date',to_char(now() at time zone 'America/Sao_Paulo','YYYY-MM-DD'),'createdAt',now(),'items',items,
    'status','pending','paid',false,'receipt',null,'channel','Loja física',
    'seller',(select name from public.profiles where user_id=auth.uid()),'seller_id',auth.uid(),
    'paymentTiming',p_order->'paymentTiming')||quote;
  update public.app_state set data=jsonb_set(s.data,'{orders}',jsonb_build_array(revised)||(s.data->'orders')),version=version+1,updated_at=now() where id=1;
  return jsonb_build_object('id',new_id);
end;
$$;
