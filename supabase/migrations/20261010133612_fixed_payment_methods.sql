create or replace function private.payment_quote(p_methods jsonb,p_id text,p_count integer,p_base numeric)
returns jsonb language plpgsql immutable
set search_path=pg_catalog as $$
declare method jsonb; option jsonb; rate numeric; fee numeric; total numeric; each numeric;
begin
  select value into method from jsonb_array_elements(p_methods)
    where value->>'id'=p_id and value->>'active'='true';
  select value into option from jsonb_array_elements(coalesce(method->'installments','[]'::jsonb))
    where (value->>'count')::integer=p_count;
  if method is null or option is null or p_count not between 1 and 24 or p_base is null or p_base<0
    or coalesce(method->>'kind','') not in ('pix','credit','debit','cash') or (method->>'kind'<>'credit' and p_count<>1) then
    raise exception 'Selecione um pagamento e parcelamento disponíveis.';
  end if;
  rate:=(option->>'rate')::numeric;
  if rate is null or rate<0 or rate>100 or (method->>'kind'<>'credit' and rate<>0) then raise exception 'Taxa inválida.'; end if;
  fee:=round(p_base*rate/100,2); total:=round(p_base,2)+fee;
  each:=floor(total*100/p_count)/100;
  return jsonb_build_object('payment',method->>'title','paymentMethodId',p_id,
    'paymentKind',method->>'kind','paymentRate',rate,'paymentFee',fee,'paymentBase',round(p_base,2),
    'installments',p_count,'installmentAmount',each,'lastInstallmentAmount',total-each*(p_count-1),'total',total);
end;
$$;
revoke all on function private.payment_quote(jsonb,text,integer,numeric) from public,anon,authenticated;

create or replace function private.guard_payment_methods()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private as $$
declare method jsonb; option jsonb;
begin
  if old.data->'settings'->'paymentMethods' is not distinct from new.data->'settings'->'paymentMethods' then return new; end if;
  if auth.uid() is not null and not private.is_manager() then raise exception 'Somente principal e gerente configuram pagamentos.'; end if;
  if jsonb_typeof(new.data->'settings'->'paymentMethods') is distinct from 'array' then raise exception 'Pagamentos inválidos.'; end if;
  if jsonb_array_length(new.data->'settings'->'paymentMethods')<>4 or exists(select 1 from jsonb_array_elements(new.data->'settings'->'paymentMethods') group by value->>'kind' having count(*)>1) or exists(select 1 from jsonb_array_elements(new.data->'settings'->'paymentMethods') group by value->>'id' having count(*)>1) then raise exception 'Pagamento repetido.'; end if;
  for method in select value from jsonb_array_elements(new.data->'settings'->'paymentMethods') loop
    if length(coalesce(method->>'id','')) not between 1 and 80 or length(trim(coalesce(method->>'title',''))) not between 1 and 60
      or coalesce(method->>'kind','') not in ('pix','credit','debit','cash')
      or jsonb_typeof(method->'active') is distinct from 'boolean'
      or jsonb_typeof(method->'installments') is distinct from 'array'
      or jsonb_array_length(method->'installments') not between 1 and 24 or (method->>'kind'<>'credit' and jsonb_array_length(method->'installments')<>1) then raise exception 'Confira os dados do pagamento.'; end if;
    if exists(select 1 from jsonb_array_elements(method->'installments') group by value->>'count' having count(*)>1) then raise exception 'Parcelamento repetido.'; end if;
    for option in select value from jsonb_array_elements(method->'installments') loop
      if coalesce(option->>'count','') !~ '^[0-9]+$' or (option->>'count')::integer not between 1 and 24
        or (method->>'kind'<>'credit' and (option->>'count')::integer<>1)
        or coalesce(option->>'rate','') !~ '^[0-9]{1,3}([.][0-9]{1,2})?$' or (option->>'rate')::numeric>100 or (method->>'kind'<>'credit' and (option->>'rate')::numeric<>0) then raise exception 'Parcelas ou taxas inválidas.'; end if;
    end loop;
  end loop;
  return new;
end;
$$;
revoke all on function private.guard_payment_methods() from public,anon,authenticated;



