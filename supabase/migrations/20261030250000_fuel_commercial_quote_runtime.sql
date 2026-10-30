begin;

alter table public.fuel_order_operations
add column if not exists container_type_id uuid references public.fuel_container_types(id) on delete restrict;

alter table public.fuel_order_commercial_snapshots
add column if not exists generic_price_quote_id uuid references public.price_quotes(id) on delete restrict;

create unique index if not exists fuel_order_commercial_snapshots_generic_quote_unique
on public.fuel_order_commercial_snapshots(generic_price_quote_id)
where generic_price_quote_id is not null;

create or replace function public.initialize_fuel_order_operation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  module_key text;
  requested_product_key text;
  requested_litres numeric(16,3);
  requested_container_mode text;
  supplied_container_count integer;
  requested_container_count integer;
  requested_container_type_key text;
  requested_fulfillment_mode text;
  product_record public.fuel_products%rowtype;
  container_type_record public.fuel_container_types%rowtype;
  offer_record public.fuel_branch_product_offers%rowtype;
begin
  select module.key into module_key
  from public.business_modules module
  where module.id = new.module_id;

  if module_key <> 'fuel' then
    return new;
  end if;

  requested_product_key := new.order_payload ->> 'fuel_product_key';
  requested_litres := nullif(new.order_payload ->> 'requested_litres','')::numeric;
  requested_container_mode := new.order_payload ->> 'container_mode';
  supplied_container_count := nullif(new.order_payload ->> 'container_count','')::integer;
  requested_container_type_key := new.order_payload ->> 'container_type_key';
  requested_fulfillment_mode := coalesce(new.order_payload ->> 'fulfillment_mode','independent_driver');

  if new.branch_id is null then
    raise exception using errcode='23514',message='Fuel orders require a station branch';
  end if;

  if requested_product_key not in ('fuel.pms','fuel.ago','fuel.dpk')
     or requested_litres is null or requested_litres <= 0
     or requested_container_mode not in ('purchase','rental')
     or coalesce(requested_fulfillment_mode,'') not in ('station_managed','independent_driver','skima_managed') then
    raise exception using errcode='22023',message='Fuel order payload must contain a valid product, litres, purchase/rental choice and supported fulfilment mode';
  end if;

  select * into product_record
  from public.fuel_products
  where key=requested_product_key
  for share;

  if not found or product_record.status<>'enabled' then
    raise exception using errcode='55000',message='The selected fuel product is not enabled for new orders';
  end if;

  select * into container_type_record
  from public.fuel_container_types
  where key=requested_container_type_key
    and status='active'
    and requested_product_key=any(supported_product_keys)
  for share;

  if not found then
    raise exception using errcode='23514',message='Choose an active container type compatible with the selected fuel product';
  end if;

  requested_container_count:=ceil(requested_litres/container_type_record.nominal_capacity_litres)::integer;
  if requested_container_count<1
     or (supplied_container_count is not null and supplied_container_count<>requested_container_count) then
    raise exception using errcode='23514',message='Container count must match the quantity and configured container capacity';
  end if;

  select * into offer_record
  from public.fuel_branch_product_offers
  where branch_id=new.branch_id
    and product_key=requested_product_key
    and currency_code=new.currency_code
    and status='active'
    and effective_from<=timezone('utc',now())
    and (effective_until is null or effective_until>timezone('utc',now()))
  for share;

  if not found then
    raise exception using errcode='55000',message='The selected fuel product is not currently offered by this station';
  end if;

  if requested_litres<offer_record.minimum_litres or requested_litres>offer_record.maximum_litres then
    raise exception using errcode='23514',message='Requested litres are outside the station configured minimum and maximum';
  end if;

  if not requested_fulfillment_mode=any(offer_record.fulfillment_modes) then
    raise exception using errcode='23514',message='The selected fulfilment mode is not available for this station and fuel product';
  end if;

  insert into public.fuel_order_operations(
    order_id,service_request_id,product_key,station_branch_id,customer_user_id,
    requested_litres,container_mode,container_count,container_type_id,
    fulfillment_mode,stage_key,metadata
  )
  values(
    new.id,new.service_request_id,requested_product_key,new.branch_id,new.requester_user_id,
    requested_litres,requested_container_mode,requested_container_count,container_type_record.id,
    requested_fulfillment_mode,'awaiting_station_acceptance',
    jsonb_build_object(
      'module_key','fuel',
      'container_type_key',container_type_record.key,
      'container_capacity_litres',container_type_record.nominal_capacity_litres,
      'container_count_calculated_by_server',true,
      'fulfillment_mode',requested_fulfillment_mode
    )
  );

  insert into public.fuel_order_operation_events(
    order_id,service_request_id,product_key,from_stage,to_stage,event_type_key,idempotency_key,metadata
  )
  values(
    new.id,new.service_request_id,requested_product_key,null,'awaiting_station_acceptance',
    'event.fuel.operation.stage_changed',
    'fuel-order-init:'||new.id::text,
    jsonb_build_object('source','platform.fuel_order_engine','container_count',requested_container_count)
  );

  return new;
end;
$$;

create or replace function public.create_fuel_commercial_quote(
  target_order_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.order_records%rowtype;
  request_record public.service_requests%rowtype;
  operation_record public.fuel_order_operations%rowtype;
  offer_record public.fuel_branch_product_offers%rowtype;
  policy_record public.pricing_policies%rowtype;
  currency_record public.currency_definitions%rowtype;
  item_record public.catalog_items%rowtype;
  variant_record public.catalog_item_variants%rowtype;
  snapshot_record public.fuel_order_commercial_snapshots%rowtype;
  generic_quote_id uuid;
  snapshot_id uuid;
  item_count integer;
  line_total numeric(28,8);
  fuel_amount numeric(20,8);
  container_amount numeric(20,8);
  driver_amount numeric(20,8);
  platform_fee_amount numeric(20,8);
  tax_amount numeric(20,8);
  refundable_deposit_amount numeric(20,8);
  resolved_subtotal_amount numeric(28,8);
  grand_total numeric(28,8);
  taxable_base numeric(28,8);
  currency_decimals integer;
  now_value timestamptz:=timezone('utc',now());
  component_snapshot jsonb;
  quote_context jsonb;
begin
  if target_order_id is null or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='Fuel order ID, idempotency key and object metadata are required';
  end if;

  select * into order_record
  from public.order_records
  where id=target_order_id
  for update;

  if not found then
    raise exception using errcode='P0002',message='Fuel order was not found';
  end if;

  if not exists(
    select 1 from public.business_modules module
    where module.id=order_record.module_id and module.key='fuel'
  ) then
    raise exception using errcode='23514',message='Commercial quote can only be created for a Fuel order';
  end if;

  if auth.role()<>'service_role' and order_record.requester_user_id is distinct from auth.uid() then
    raise exception using errcode='42501',message='Only the customer who created this Fuel order can request its quote';
  end if;

  select * into snapshot_record
  from public.fuel_order_commercial_snapshots
  where service_request_id=order_record.service_request_id
  for update;

  if found then
    if snapshot_record.order_id<>target_order_id
       or snapshot_record.idempotency_key<>target_idempotency_key then
      raise exception using errcode='23505',message='A commercial quote already exists for this Fuel order; create a new order to request a new quote';
    end if;
    return snapshot_record.generic_price_quote_id;
  end if;

  select * into request_record
  from public.service_requests
  where id=order_record.service_request_id
  for update;

  select * into operation_record
  from public.fuel_order_operations
  where order_id=target_order_id
  for update;

  if not found then
    raise exception using errcode='P0002',message='Fuel order operations record was not found';
  end if;

  if operation_record.stage_key<>'awaiting_station_acceptance' then
    raise exception using errcode='55000',message='A commercial quote can only be created before station fulfilment begins';
  end if;

  select * into offer_record
  from public.fuel_branch_product_offers
  where branch_id=operation_record.station_branch_id
    and product_key=operation_record.product_key
    and currency_code=order_record.currency_code
    and status='active'
    and effective_from<=now_value
    and (effective_until is null or effective_until>now_value)
  for share;

  if not found
     or operation_record.requested_litres<offer_record.minimum_litres
     or operation_record.requested_litres>offer_record.maximum_litres
     or not operation_record.fulfillment_mode=any(offer_record.fulfillment_modes) then
    raise exception using errcode='55000',message='The station fuel offer is not currently valid for this order';
  end if;

  select currency.decimal_places into currency_decimals
  from public.currency_definitions currency
  where currency.code=order_record.currency_code and currency.status='enabled';

  if not found then
    raise exception using errcode='23514',message='Fuel order currency is no longer enabled';
  end if;

  select policy.* into policy_record
  from public.pricing_policies policy
  where policy.key='pricing.fuel.commercial-snapshot.v1'
    and policy.status='active'
  order by policy.version desc
  limit 1;

  if not found then
    raise exception using errcode='55000',message='Fuel commercial pricing policy is not active';
  end if;

  select count(*),coalesce(sum(line.line_amount),0)
  into item_count,line_total
  from public.order_line_items line
  where line.order_id=target_order_id;

  if item_count<>1 then
    raise exception using errcode='23514',message='Fuel order must contain exactly one litre-priced catalogue line';
  end if;

  select item.* into item_record
  from public.order_line_items line
  join public.catalog_items item on item.id=line.item_id
  where line.order_id=target_order_id
    and line.item_id=offer_record.catalog_item_id
    and line.variant_id=offer_record.catalog_variant_id
    and abs(line.quantity-operation_record.requested_litres)<0.001;

  if not found then
    raise exception using errcode='23514',message='Fuel order catalogue line must match the selected branch product and requested litres';
  end if;

  select variant.* into variant_record
  from public.catalog_item_variants variant
  where variant.id=offer_record.catalog_variant_id
    and variant.item_id=offer_record.catalog_item_id
    and variant.unit_id in (
      select unit.id from public.catalog_units unit
      where unit.organization_id=offer_record.organization_id and unit.symbol='L'
    );

  if not found then
    raise exception using errcode='23514',message='Fuel catalogue variant must use the canonical litre unit';
  end if;

  if abs(line_total-(operation_record.requested_litres*offer_record.price_per_litre))>0.01 then
    raise exception using errcode='23514',message='Fuel catalogue line total does not match the current branch price per litre';
  end if;

  fuel_amount:=round(operation_record.requested_litres*offer_record.price_per_litre,currency_decimals);
  container_amount:=round(
    (case when operation_record.container_mode='purchase'
      then offer_record.container_purchase_amount
      else offer_record.container_rental_amount end)*operation_record.container_count,
    currency_decimals
  );
  driver_amount:=round(offer_record.driver_delivery_fee_amount,currency_decimals);
  platform_fee_amount:=round(offer_record.platform_fee_amount,currency_decimals);
  refundable_deposit_amount:=case when operation_record.container_mode='rental'
    then round(offer_record.refundable_deposit_amount*operation_record.container_count,currency_decimals)
    else 0 end;
  taxable_base:=fuel_amount+container_amount+driver_amount+platform_fee_amount;
  tax_amount:=round(taxable_base*offer_record.tax_rate_percent/100,currency_decimals);
  resolved_subtotal_amount:=fuel_amount+container_amount+driver_amount+refundable_deposit_amount;
  grand_total:=subtotal_amount+platform_fee_amount+tax_amount;

  if grand_total<=0 then
    raise exception using errcode='23514',message='Fuel commercial quote must have a positive total';
  end if;

  component_snapshot:=jsonb_build_object(
    'product_key',operation_record.product_key,
    'unit','L',
    'requested_litres',operation_record.requested_litres,
    'fuel_unit_price',offer_record.price_per_litre,
    'fuel_amount',fuel_amount,
    'container_mode',operation_record.container_mode,
    'container_type_key',(select type.key from public.fuel_container_types type where type.id=operation_record.container_type_id),
    'container_capacity_litres',(select type.nominal_capacity_litres from public.fuel_container_types type where type.id=operation_record.container_type_id),
    'container_count',operation_record.container_count,
    'container_amount',container_amount,
    'driver_delivery_fee_amount',driver_amount,
    'platform_fee_amount',platform_fee_amount,
    'tax_rate_percent',offer_record.tax_rate_percent,
    'taxable_base',taxable_base,
    'tax_amount',tax_amount,
    'refundable_deposit_amount',refundable_deposit_amount,
    'deposit_treatment',case when operation_record.container_mode='rental' then 'refundable_liability' else 'not_applicable' end,
    'fulfillment_mode',operation_record.fulfillment_mode,
    'currency_code',order_record.currency_code,
    'currency_decimal_places',currency_decimals,
    'offer_id',offer_record.id,
    'pricing_policy_id',policy_record.id,
    'quoted_at',now_value
  );

  quote_context:=jsonb_build_object(
    'module_key','fuel',
    'order_id',target_order_id,
    'fuel_product_key',operation_record.product_key,
    'requested_litres',operation_record.requested_litres,
    'container_mode',operation_record.container_mode,
    'container_count',operation_record.container_count,
    'fulfillment_mode',operation_record.fulfillment_mode,
    'server_calculated',true
  );

  insert into public.price_quotes(
    service_request_id,pricing_policy_id,module_id,currency_code,status,
    subtotal_amount,fee_amount,discount_amount,tax_amount,total_amount,
    pricing_context,calculation_breakdown,expires_at,source,idempotency_key,created_by
  )
  values(
    order_record.service_request_id,policy_record.id,order_record.module_id,order_record.currency_code,
    'calculated',resolved_subtotal_amount,platform_fee_amount,0,tax_amount,grand_total,
    quote_context,component_snapshot,now_value+interval '15 minutes',
    'platform.fuel_pricing',target_idempotency_key||':generic-price-quote',auth.uid()
  )
  returning id into generic_quote_id;

  insert into public.fuel_order_commercial_snapshots(
    service_request_id,order_id,generic_price_quote_id,product_key,requested_litres,container_mode,
    container_count,currency_code,fuel_unit_price,fuel_amount,container_amount,driver_amount,
    platform_fee_amount,tax_amount,refundable_deposit_amount,grand_total,component_snapshot,
    status,valid_until,idempotency_key,metadata
  )
  values(
    order_record.service_request_id,target_order_id,generic_quote_id,operation_record.product_key,
    operation_record.requested_litres,operation_record.container_mode,operation_record.container_count,
    order_record.currency_code,offer_record.price_per_litre,fuel_amount,container_amount,driver_amount,
    platform_fee_amount,tax_amount,refundable_deposit_amount,grand_total,component_snapshot,
    'quoted',now_value+interval '15 minutes',target_idempotency_key,target_metadata
  )
  returning id into snapshot_id;

  update public.order_records
  set subtotal_amount=resolved_subtotal_amount,
      fee_amount=platform_fee_amount,
      discount_amount=0,
      tax_amount=tax_amount,
      total_amount=grand_total,
      metadata=metadata||jsonb_build_object(
        'fuel_commercial_snapshot_id',snapshot_id,
        'fuel_component_snapshot',component_snapshot
      ),
      updated_at=timezone('utc',now())
  where id=target_order_id;

  update public.service_requests
  set request_payload=request_payload||jsonb_build_object(
        'fuel_commercial_snapshot_id',snapshot_id,
        'fuel_component_snapshot',component_snapshot
      ),
      updated_at=timezone('utc',now())
  where id=order_record.service_request_id;

  return generic_quote_id;
end;
$$;

create or replace function public.sync_fuel_commercial_quote_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status then
    update public.fuel_order_commercial_snapshots
    set status=case
          when new.status='accepted' then 'accepted'
          when new.status='expired' then 'expired'
          when new.status='cancelled' then 'cancelled'
          else status
        end,
        updated_at=timezone('utc',now())
    where generic_price_quote_id=new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists fuel_commercial_quote_status_sync on public.price_quotes;
create trigger fuel_commercial_quote_status_sync
after update of status on public.price_quotes
for each row execute function public.sync_fuel_commercial_quote_status();

revoke all on function public.initialize_fuel_order_operation() from public,anon;
revoke all on function public.create_fuel_commercial_quote(uuid,text,jsonb) from public,anon;
revoke all on function public.sync_fuel_commercial_quote_status() from public,anon,authenticated;
grant execute on function public.create_fuel_commercial_quote(uuid,text,jsonb) to authenticated,service_role;
grant execute on function public.register_fuel_container_asset(text,uuid,numeric,uuid,jsonb) to authenticated,service_role;

commit;
