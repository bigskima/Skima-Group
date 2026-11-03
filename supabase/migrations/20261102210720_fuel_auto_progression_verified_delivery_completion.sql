begin;

-- Correct the narrow customer-OTP authorization window. Verification is
-- stamped before the stage transition; the helper must accept that stamped,
-- order-bound verified challenge rather than requiring an unset timestamp.
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
        (operation.container_mode='purchase' and exists(
          select 1 from public.fuel_order_operation_events event
          where event.order_id=target_order_id and event.to_stage='delivered'
        ))
        or operation.container_mode='rental'
      )
  );
$$;

-- The station consumes stock and measures/fills containers in separate
-- operations. Re-evaluate readiness after the measured aggregate is written,
-- not only from the earlier reservation/allocation triggers.
drop trigger if exists fuel_auto_progress_after_measured_fill on public.fuel_order_operations;
create trigger fuel_auto_progress_after_measured_fill
after update of filled_litres on public.fuel_order_operations
for each row
when (new.filled_litres is distinct from old.filled_litres)
execute function public.advance_fuel_order_after_station_preparation();

-- record_fuel_container_handover updates the allocation row before it inserts
-- the custody event. Its allocation trigger therefore runs too early to see
-- the final "handed_to_driver" event. This event trigger runs after the full
-- custody evidence has been written and safely advances the delivery leg.
drop trigger if exists fuel_auto_progress_after_driver_handover_event on public.fuel_container_custody_events;
create trigger fuel_auto_progress_after_driver_handover_event
after insert on public.fuel_container_custody_events
for each row
when (new.event_key='handed_to_driver')
execute function public.advance_fuel_order_after_driver_handover();

-- The same ordering applies to station inspection: the final inspection record
-- is the event boundary. After every rental container has passed inspection,
-- the order completes and the existing completion trigger releases settlement.
create or replace function public.advance_fuel_rental_after_final_inspection_event()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  operation_record public.fuel_order_operations%rowtype;
  inspected_count integer;
begin
  if new.event_key<>'inspection_passed' then return new; end if;

  select * into operation_record
  from public.fuel_order_operations
  where order_id=new.order_id
  for update;

  if not found or operation_record.container_mode<>'rental'
     or operation_record.stage_key<>'received_at_station'
     or operation_record.delivery_verified_at is null then
    return new;
  end if;

  select count(distinct event.allocation_id)
  into inspected_count
  from public.fuel_container_custody_events event
  where event.order_id=new.order_id
    and event.event_key='inspection_passed';

  if inspected_count=operation_record.container_count then
    perform public.record_fuel_order_stage(
      new.order_id,
      'inspection_passed',
      'fuel-auto-inspection-passed:'||new.order_id::text,
      'Every returned rental container passed station inspection',
      jsonb_build_object(
        'progression','station_rental_inspection_complete',
        'automatic',true,
        'inspection_event_id',new.id
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists fuel_auto_progress_after_inspection_event on public.fuel_container_custody_events;
create trigger fuel_auto_progress_after_inspection_event
after insert on public.fuel_container_custody_events
for each row
when (new.event_key='inspection_passed')
execute function public.advance_fuel_rental_after_final_inspection_event();

revoke all on function public.advance_fuel_rental_after_final_inspection_event() from public,anon,authenticated;

-- A global product disable blocks old, already-active station offers as well
-- as new ones. Availability in the app is not a security boundary.
do $patch$
declare
  function_sql text;
  old_decl text;
  new_decl text;
  old_guard text;
  new_guard text;
begin
  select pg_get_functiondef('public.create_fuel_commercial_quote(uuid,text,jsonb)'::regprocedure)
  into function_sql;

  old_decl:=$old$  mode_is_enabled boolean;$old$;
  new_decl:=$new$  mode_is_enabled boolean;
  global_product_is_enabled boolean;$new$;
  if position(old_decl in function_sql)=0 then
    raise exception 'Fuel quote mode declaration changed; refusing an unsafe global product guard';
  end if;
  function_sql:=replace(function_sql,old_decl,new_decl);

  old_guard:=$old$  select control.enabled into mode_is_enabled
  from public.fuel_fulfillment_mode_controls control
  where control.product_key=operation_record.product_key
    and control.fulfillment_mode=operation_record.fulfillment_mode;
  if not found or not mode_is_enabled then
    raise exception using errcode='55000',message='This Fuel fulfillment mode is currently disabled by SKIMA';
  end if;$old$;

  new_guard:=$new$  select exists(
    select 1 from public.fuel_products product
    where product.key=operation_record.product_key
      and product.status='enabled'
  ) into global_product_is_enabled;
  if not global_product_is_enabled then
    raise exception using errcode='55000',message='This Fuel product is globally disabled by SKIMA and cannot be ordered';
  end if;

  select control.enabled into mode_is_enabled
  from public.fuel_fulfillment_mode_controls control
  where control.product_key=operation_record.product_key
    and control.fulfillment_mode=operation_record.fulfillment_mode;
  if not found or not mode_is_enabled then
    raise exception using errcode='55000',message='This Fuel fulfillment mode is currently disabled by SKIMA';
  end if;$new$;

  if position(old_guard in function_sql)=0 then
    raise exception 'Fuel quote mode guard changed; refusing an unsafe global product guard';
  end if;
  execute replace(function_sql,old_guard,new_guard);
end;
$patch$;

-- Idempotent managed-price writes must replay the recorded change instead of
-- trying to create a duplicate immutable price event.
do $patch$
declare
  function_sql text;
  old_lookup text;
  new_lookup text;
begin
  select pg_get_functiondef(
    'public.configure_fuel_managed_product_price(text,text,numeric,boolean,text,text,jsonb)'::regprocedure
  ) into function_sql;

  old_lookup:=$old$  select * into existing
  from public.fuel_managed_product_prices
  where product_key=target_product_key and currency_code=target_currency_code
  for update;
  if found then before_value:=to_jsonb(existing); end if;$old$;

  new_lookup:=$new$  select event.managed_price_id into price_id
  from public.fuel_managed_product_price_events event
  where event.idempotency_key=target_idempotency_key||':event';
  if found then
    if not exists(
      select 1 from public.fuel_managed_product_price_events event
      where event.idempotency_key=target_idempotency_key||':event'
        and event.product_key=target_product_key
        and event.currency_code=target_currency_code
        and nullif(event.after_snapshot->>'price_per_litre','')::numeric=target_price_per_litre
        and (event.after_snapshot->>'enabled')::boolean=target_enabled
    ) then
      raise exception using errcode='23505',message='Fuel managed price idempotency key was reused with different values';
    end if;
    return price_id;
  end if;

  select * into existing
  from public.fuel_managed_product_prices
  where product_key=target_product_key and currency_code=target_currency_code
  for update;
  if found then before_value:=to_jsonb(existing); end if;$new$;

  if position(old_lookup in function_sql)=0 then
    raise exception 'Fuel managed price lookup changed; refusing to patch idempotency behavior';
  end if;
  execute replace(function_sql,old_lookup,new_lookup);
end;
$patch$;

notify pgrst,'reload schema';
commit;
