-- Store the negotiated delivery charge in the order and its justification in a private ledger.
create table private.order_freight_adjustments (
  order_id bigint primary key check (order_id > 0),
  shipping_name text not null,
  original_price numeric(12,2) not null check (original_price >= 0),
  final_price numeric(12,2) not null check (final_price >= 0),
  reason text not null check (length(btrim(reason)) between 3 and 1000),
  actor_id uuid not null,
  actor_name text not null,
  created_at timestamptz not null default clock_timestamp()
);
alter table private.order_freight_adjustments enable row level security;
alter table private.order_freight_adjustments force row level security;
revoke all on private.order_freight_adjustments from public, anon, authenticated;
create trigger immutable_order_freight_adjustments
before update or delete on private.order_freight_adjustments
for each row execute function private.keep_order_price_audit();

do $migration$
declare
  definition text := replace(pg_get_functiondef('private.create_staff_order(jsonb,uuid)'::regprocedure), chr(13), '');
  declarations text := '  actor public.profiles%rowtype;';
  shipping_check text := '  perform private.assert_regional_shipping(s.data->''settings'',p_order);';
  saved_freight text := '''freight'',shipping->''price''';
  order_write text := '  update public.app_state set data=jsonb_set(s.data,''{orders}'',jsonb_build_array(revised)||(s.data->''orders''))';
begin
  if strpos(definition, declarations)=0 or strpos(definition, shipping_check)=0
    or strpos(definition, saved_freight)=0 or strpos(definition, order_write)=0 then
    raise exception 'A função de criação do pedido mudou. Revise a migração.';
  end if;
  definition := replace(definition, declarations,
    E'  freight_original numeric; freight_amount numeric; freight_change jsonb; freight_reason text;\n' || declarations);
  definition := replace(definition, shipping_check, shipping_check || $freight$
  freight_original := (shipping->>'price')::numeric;
  freight_amount := freight_original;
  freight_change := nullif(p_order->'freightOverride','null'::jsonb);
  if freight_change is not null then
    if p_order->>'delivery' <> 'Entrega' or jsonb_typeof(freight_change) is distinct from 'object'
      or jsonb_typeof(freight_change->'price') is distinct from 'number'
      or jsonb_typeof(freight_change->'expectedPrice') is distinct from 'number'
      or jsonb_typeof(freight_change->'reason') is distinct from 'string' then
      raise exception 'Confira a personalização do frete.';
    end if;
    freight_amount := (freight_change->>'price')::numeric;
    freight_reason := btrim(freight_change->>'reason', E' \t\r\n');
    if freight_amount < 0 or freight_amount > 1000000 or freight_amount <> round(freight_amount,2)
      or length(freight_reason) not between 3 and 1000 then
      raise exception 'Informe um frete válido e o motivo da alteração (3 a 1.000 caracteres).';
    end if;
    if (freight_change->>'expectedPrice')::numeric is distinct from freight_original then
      raise exception 'O frete tabelado mudou. Atualize a cotação e confirme o valor novamente.';
    end if;
  end if;$freight$);
  definition := replace(definition, saved_freight, '''freight'',freight_amount');
  definition := replace(definition, order_write, $audit$  if freight_amount is distinct from freight_original then
    insert into private.order_freight_adjustments(order_id,shipping_name,original_price,final_price,reason,actor_id,actor_name)
    values(new_id,shipping->>'name',freight_original,freight_amount,freight_reason,actor.user_id,actor.name);
  end if;
$audit$ || order_write);
  execute definition;
end;
$migration$;

create or replace function private.order_price_notes(p_order_id bigint)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public,private as $$
begin
  if not private.is_admin() then raise exception 'Registros internos disponíveis somente à equipe.'; end if;
  if not exists(select 1 from public.app_state s cross join lateral jsonb_array_elements(s.data->'orders') o where s.id=1 and o->>'id'=p_order_id::text) then
    raise exception 'Pedido não encontrado.';
  end if;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'id',id,'productName',product_name,'originalPrice',original_price,'unitPrice',unit_price,
    'reason',reason,'actorName',actor_name,'createdAt',created_at
  ) order by id) from private.order_price_adjustments where order_id=p_order_id),'[]'::jsonb)
  || coalesce((select jsonb_build_array(jsonb_build_object(
    'kind','freight','shippingName',shipping_name,'originalPrice',original_price,'unitPrice',final_price,
    'reason',reason,'actorName',actor_name,'createdAt',created_at
  )) from private.order_freight_adjustments where order_id=p_order_id),'[]'::jsonb);
end;
$$;
