begin;

-- The chosen container size is the maximum physical capacity for this order.
-- Existing purchase/rental orders are untouched; exchange is additive.
do $constraints$
declare
  item record;
begin
  for item in
    select conname from pg_constraint
    where conrelid='public.fuel_order_operations'::regclass
      and contype='c'
      and pg_get_constraintdef(oid) ilike '%container_mode%'
  loop
    execute format('alter table public.fuel_order_operations drop constraint %I',item.conname);
  end loop;

  for item in
    select conname from pg_constraint
    where conrelid='public.fuel_order_commercial_snapshots'::regclass
      and contype='c'
      and pg_get_constraintdef(oid) ilike '%container_mode%'
  loop
    execute format('alter table public.fuel_order_commercial_snapshots drop constraint %I',item.conname);
  end loop;

  for item in
    select conname from pg_constraint
    where conrelid='public.fuel_container_allocations'::regclass
      and contype='c'
      and pg_get_constraintdef(oid) ilike '%allocation_mode%'
  loop
    execute format('alter table public.fuel_container_allocations drop constraint %I',item.conname);
  end loop;
end;
$constraints$;

alter table public.fuel_order_operations
  add constraint fuel_order_operations_container_mode_exchange_check
  check (container_mode in ('purchase','rental','exchange'));

alter table public.fuel_order_commercial_snapshots
  add constraint fuel_order_commercial_snapshots_container_mode_exchange_check
  check (container_mode in ('purchase','rental','exchange'));

alter table public.fuel_container_allocations
  add constraint fuel_container_allocations_mode_exchange_check
  check (allocation_mode in ('purchase','rental','exchange'));

alter table public.fuel_container_allocations
  add constraint fuel_container_allocations_exchange_amounts_check
  check (
    (allocation_mode='purchase' and rental_amount=0 and refundable_deposit_amount=0)
    or (allocation_mode='rental' and purchase_amount=0)
    or (allocation_mode='exchange' and purchase_amount=0 and rental_amount=0 and refundable_deposit_amount=0)
  );

-- Every customer order passes through this trigger. Keep its server-side
-- capacity decision aligned with the customer selection and the order RPC.
do $patch$
declare
  function_sql text;
  old_mode text;
  new_mode text;
  old_count text;
  new_count text;
  old_metadata text;
  new_metadata text;
begin
  select pg_get_functiondef('public.initialize_fuel_order_operation()'::regprocedure)
  into function_sql;

  old_mode:=$old$or requested_container_mode not in ('purchase','rental')$old$;
  new_mode:=$new$or requested_container_mode not in ('purchase','rental','exchange')$new$;
  if position(old_mode in function_sql)=0 then
    raise exception 'Fuel order container-mode guard changed; refusing exchange patch';
  end if;
  function_sql:=replace(function_sql,old_mode,new_mode);

  old_count:=$old$requested_container_count:=ceil(requested_litres/container_type_record.nominal_capacity_litres)::integer;
  if requested_container_count<1
     or (supplied_container_count is not null and supplied_container_count<>requested_container_count) then
    raise exception using errcode='23514',message='Container count must match the quantity and configured container capacity';
  end if;$old$;
  new_count:=$new$if requested_litres>container_type_record.nominal_capacity_litres then
    raise exception using errcode='23514',message='The requested fuel quantity exceeds the selected container capacity; choose a larger container or reduce the litres';
  end if;
  requested_container_count:=1;
  if supplied_container_count is not null and supplied_container_count<>requested_container_count then
    raise exception using errcode='23514',message='One selected container must hold the complete requested fuel quantity';
  end if;$new$;
  if position(old_count in function_sql)=0 then
    raise exception 'Fuel container count calculation changed; refusing capacity patch';
  end if;
  function_sql:=replace(function_sql,old_count,new_count);

  old_metadata:=$old$'container_count_calculated_by_server',true,
      'fulfillment_mode',requested_fulfillment_mode$old$;
  new_metadata:=$new$'container_count_calculated_by_server',true,
      'customer_container_exchange',requested_container_mode='exchange',
      'customer_container_capacity_litres',container_type_record.nominal_capacity_litres,
      'fulfillment_mode',requested_fulfillment_mode$new$;
  if position(old_metadata in function_sql)=0 then
    raise exception 'Fuel order metadata changed; refusing exchange metadata patch';
  end if;
  function_sql:=replace(function_sql,old_metadata,new_metadata);

  execute function_sql;
end;
$patch$;

-- This authenticated RPC rejects an over-capacity request before it creates
-- any order rows. The trigger above remains an independent final guard.
do $patch$
declare
  function_sql text;
  old_mode text;
  new_mode text;
  old_type text;
  new_type text;
  old_payload text;
  new_payload text;
begin
  select pg_get_functiondef(
    'public.create_fuel_order_with_quote(uuid,text,numeric,text,text,text,text,text,uuid,text,jsonb)'::regprocedure
  ) into function_sql;

  old_mode:=$old$target_container_mode not in ('purchase','rental')$old$;
  new_mode:=$new$target_container_mode not in ('purchase','rental','exchange')$new$;
  if position(old_mode in function_sql)=0 then
    raise exception 'Fuel order RPC container-mode guard changed';
  end if;
  function_sql:=replace(function_sql,old_mode,new_mode);

  old_type:=$old$  if not found then
    raise exception using errcode='23514',message='Choose an active container type compatible with the selected fuel product';
  end if;$old$;
  new_type:=$new$  if not found then
    raise exception using errcode='23514',message='Choose an active container type compatible with the selected fuel product';
  end if;
  if target_requested_litres>container_type_record.nominal_capacity_litres then
    raise exception using errcode='23514',message='The requested fuel quantity exceeds the selected container capacity; choose a larger container or reduce the litres';
  end if;$new$;
  if position(old_type in function_sql)=0 then
    raise exception 'Fuel order container lookup changed; refusing capacity patch';
  end if;
  function_sql:=replace(function_sql,old_type,new_type);

  old_payload:=$old$'container_mode',target_container_mode,
    'container_type_key',target_container_type_key,
    'fulfillment_mode',target_fulfillment_mode,$old$;
  new_payload:=$new$'container_mode',target_container_mode,
    'container_type_key',target_container_type_key,
    'customer_container_exchange',target_container_mode='exchange',
    'customer_container_capacity_litres',container_type_record.nominal_capacity_litres,
    'fulfillment_mode',target_fulfillment_mode,$new$;
  if position(old_payload in function_sql)=0 then
    raise exception 'Fuel order payload changed; refusing exchange metadata patch';
  end if;
  function_sql:=replace(function_sql,old_payload,new_payload);

  execute function_sql;
end;
$patch$;

-- A customer-owned container is collected offline and exchanged for a filled
-- SKIMA-owned container of the same configured type. No purchase, rental fee
-- or refundable deposit is charged.
do $patch$
declare
  function_sql text;
  old_amount text;
  new_amount text;
  old_snapshot text;
  new_snapshot text;
begin
  select pg_get_functiondef('public.create_fuel_commercial_quote(uuid,text,jsonb)'::regprocedure)
  into function_sql;

  old_amount:=$old$container_amount:=round(
    (case when operation_record.container_mode='purchase'
      then offer_record.container_purchase_amount
      else offer_record.container_rental_amount end)*operation_record.container_count,
    currency_decimals
  );$old$;
  new_amount:=$new$container_amount:=round(
    (case
      when operation_record.container_mode='purchase' then offer_record.container_purchase_amount
      when operation_record.container_mode='rental' then offer_record.container_rental_amount
      else 0
    end)*operation_record.container_count,
    currency_decimals
  );$new$;
  if position(old_amount in function_sql)=0 then
    raise exception 'Fuel quote container pricing formula changed; refusing exchange pricing patch';
  end if;
  function_sql:=replace(function_sql,old_amount,new_amount);

  old_snapshot:=$old$'container_mode',operation_record.container_mode,
    'container_type_key',$old$;
  new_snapshot:=$new$'container_mode',operation_record.container_mode,
    'customer_container_exchange',operation_record.container_mode='exchange',
    'container_type_key',$new$;
  if position(old_snapshot in function_sql)=0 then
    raise exception 'Fuel quote snapshot changed; refusing exchange context patch';
  end if;
  function_sql:=replace(function_sql,old_snapshot,new_snapshot);

  execute function_sql;
end;
$patch$;

-- Only SKIMA-owned matching containers can be allocated for a Fuel delivery;
-- exchange allocations must carry zero purchase/rental/deposit amounts.
do $patch$
declare
  function_sql text;
  old_mode text;
  new_mode text;
  old_amount_guard text;
  new_amount_guard text;
  old_profile_guard text;
  new_profile_guard text;
  old_sum text;
  new_sum text;
  old_increment text;
  new_increment text;
begin
  select pg_get_functiondef(
    'public.reserve_fuel_order_container(uuid,uuid,numeric,text,numeric,numeric,numeric,text,text,jsonb)'::regprocedure
  ) into function_sql;

  old_mode:=$old$target_allocation_mode not in ('purchase','rental')$old$;
  new_mode:=$new$target_allocation_mode not in ('purchase','rental','exchange')$new$;
  if position(old_mode in function_sql)=0 then
    raise exception 'Fuel container allocation mode guard changed';
  end if;
  function_sql:=replace(function_sql,old_mode,new_mode);

  old_amount_guard:=$old$  if target_allocation_mode='rental' and target_purchase_amount<>0 then
    raise exception using errcode='22023',message='rental allocation cannot contain a container purchase amount';
  end if;$old$;
  new_amount_guard:=$new$  if target_allocation_mode='rental' and target_purchase_amount<>0 then
    raise exception using errcode='22023',message='rental allocation cannot contain a container purchase amount';
  end if;
  if target_allocation_mode='exchange'
     and (target_purchase_amount<>0 or target_rental_amount<>0 or target_refundable_deposit_amount<>0) then
    raise exception using errcode='22023',message='container exchange cannot include a purchase charge, rental fee or deposit';
  end if;$new$;
  if position(old_amount_guard in function_sql)=0 then
    raise exception 'Fuel allocation amount guards changed';
  end if;
  function_sql:=replace(function_sql,old_amount_guard,new_amount_guard);

  old_profile_guard:=$old$if not found or profile_record.status<>'available' or profile_record.ownership_mode<>'skima' then
    raise exception using errcode='55000',message='only available SKIMA-owned containers can be allocated to a Fuel order';
  end if;$old$;
  new_profile_guard:=$new$if not found or profile_record.status<>'available' or profile_record.ownership_mode<>'skima'
     or target_allocated_litres>profile_record.capacity_litres then
    raise exception using errcode='55000',message='only an available SKIMA-owned container with sufficient capacity can be allocated to a Fuel order';
  end if;$new$;
  if position(old_profile_guard in function_sql)=0 then
    raise exception 'Fuel container profile guard changed';
  end if;
  function_sql:=replace(function_sql,old_profile_guard,new_profile_guard);

  old_sum:=$old$coalesce(sum(case when allocation_mode='purchase' then purchase_amount else rental_amount end),0)$old$;
  new_sum:=$new$coalesce(sum(case when allocation_mode='purchase' then purchase_amount when allocation_mode='rental' then rental_amount else 0 end),0)$new$;
  if position(old_sum in function_sql)=0 then
    raise exception 'Fuel allocation aggregate formula changed';
  end if;
  function_sql:=replace(function_sql,old_sum,new_sum);

  old_increment:=$old$(case when target_allocation_mode='purchase' then target_purchase_amount else target_rental_amount end)$old$;
  new_increment:=$new$(case when target_allocation_mode='purchase' then target_purchase_amount when target_allocation_mode='rental' then target_rental_amount else 0 end)$new$;
  if position(old_increment in function_sql)=0 then
    raise exception 'Fuel allocation quote reconciliation changed';
  end if;
  function_sql:=replace(function_sql,old_increment,new_increment);

  execute function_sql;
end;
$patch$;

-- A verified customer OTP completes an exchange just like a purchase. Rentals
-- remain open until SKIMA-owned rental containers are returned and inspected.
create or replace function public.can_advance_fuel_order_from_verified_otp(target_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select pg_trigger_depth()>0 and exists(
    select 1 from public.fuel_order_operations operation
    where operation.order_id=target_order_id
      and operation.stage_key='delivered'
      and operation.delivery_verified_at is not null
      and operation.delivery_challenge_id is not null
      and public.fuel_delivery_challenge_is_verified(target_order_id,operation.delivery_challenge_id)
      and (
        (operation.container_mode in ('purchase','exchange') and exists(
          select 1 from public.fuel_order_operation_events event
          where event.order_id=target_order_id and event.to_stage='delivered'
        ))
        or operation.container_mode='rental'
      )
  );
$$;

-- A driver must confirm the physical collection of the customer's empty
-- container before an exchange may be recorded as delivered.
create or replace function public.require_customer_container_exchange_confirmation()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.to_stage='delivered'
     and exists(
       select 1 from public.fuel_order_operations operation
       where operation.order_id=new.order_id
         and operation.container_mode='exchange'
     )
     and (
       new.metadata->>'customer_container_collected' is distinct from 'true'
       or coalesce(nullif(new.metadata->>'customer_container_collected_by',''),'')=''
     ) then
    raise exception using errcode='23514',message='The assigned driver must confirm collection of the customer empty container before this exchange delivery can be recorded';
  end if;
  return new;
end;
$$;

drop trigger if exists fuel_require_customer_container_exchange_confirmation on public.fuel_order_operation_events;
create trigger fuel_require_customer_container_exchange_confirmation
before insert on public.fuel_order_operation_events
for each row execute function public.require_customer_container_exchange_confirmation();

revoke all on function public.require_customer_container_exchange_confirmation() from public,anon,authenticated;

notify pgrst,'reload schema';
commit;
