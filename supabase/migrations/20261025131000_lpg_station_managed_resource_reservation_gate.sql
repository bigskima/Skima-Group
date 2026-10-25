begin;

-- The customer-facing option is visible only when at least one usable station
-- driver and compliant station-owned vehicle can actually receive an order.
create or replace function public.read_lpg_station_managed_fulfillment_option(
  target_station_branch_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  settings public.lpg_station_fulfillment_settings%rowtype;
  station_record public.lpg_station_branches%rowtype;
  active_driver_count integer:=0;
  available_vehicle_count integer:=0;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  select * into station_record from public.lpg_station_branches
  where id=target_station_branch_id and approval_status='approved'
    and compliance_status='approved' and availability_status='available';
  if not found then return jsonb_build_object('enabled',false,'reason','station_not_ready'); end if;
  select * into settings from public.lpg_station_fulfillment_settings
  where station_branch_id=target_station_branch_id and station_managed_enabled;
  if not found then return jsonb_build_object('enabled',false,'reason','station_managed_disabled'); end if;

  select count(*) into active_driver_count
  from public.lpg_station_managed_drivers driver
  where driver.station_branch_id=target_station_branch_id and driver.status='active';

  select count(*) into available_vehicle_count
  from public.lpg_station_managed_vehicles assignment
  join public.vehicles vehicle on vehicle.id=assignment.vehicle_id
  where assignment.station_branch_id=target_station_branch_id and assignment.status='active'
    and public.is_lpg_station_managed_vehicle_eligible(target_station_branch_id,vehicle.id,current_date)
    and not exists (
      select 1 from public.lpg_station_managed_driver_assignments active_assignment
      where active_assignment.vehicle_id=vehicle.id and active_assignment.status in ('assigned','accepted','en_route')
    );

  return jsonb_build_object(
    'enabled',active_driver_count>0 and available_vehicle_count>0,
    'reason',case when active_driver_count=0 then 'station_driver_required'
      when available_vehicle_count=0 then 'station_lpg_vehicle_required'
      else 'available' end,
    'activeDriverCount',active_driver_count,
    'availableVehicleCount',available_vehicle_count,
    'deliveryPricingMode',settings.delivery_pricing_mode,
    'deliveryFeeAmount',case when settings.delivery_pricing_mode='separate' then settings.delivery_fee_amount else 0 end,
    'currencyCode',settings.currency_code
  );
end;
$$;

-- Guard Station Managed quotes when they are created or when their selected
-- branch/mode/quantity changes. Later lifecycle updates must not depend on a
-- vehicle remaining unassigned after dispatch has reserved it.
create or replace function public.guard_lpg_station_managed_quote_vehicle_readiness()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  requested_mode text;
  eligible_vehicle_count integer:=0;
  active_driver_count integer:=0;
begin
  requested_mode:=coalesce(nullif(new.metadata->>'fulfillment_mode',''),new.fulfillment_mode,'independent_driver');
  if requested_mode<>'station_managed' then return new; end if;

  if tg_op='UPDATE'
    and old.station_branch_id is not distinct from new.station_branch_id
    and old.requested_kg is not distinct from new.requested_kg
    and old.fulfillment_mode is not distinct from new.fulfillment_mode
    and coalesce(old.metadata->>'fulfillment_mode','')=coalesce(new.metadata->>'fulfillment_mode','') then
    return new;
  end if;

  if new.station_branch_id is null then
    raise exception using errcode='P0001',message='Station Managed quote requires a selected station branch';
  end if;
  select count(*) into active_driver_count from public.lpg_station_managed_drivers driver
    where driver.station_branch_id=new.station_branch_id and driver.status='active';
  select count(*) into eligible_vehicle_count
  from public.lpg_station_managed_vehicles assignment
  join public.vehicles vehicle on vehicle.id=assignment.vehicle_id
  where assignment.station_branch_id=new.station_branch_id and assignment.status='active'
    and vehicle.max_load_kg>=new.requested_kg
    and public.is_lpg_station_managed_vehicle_eligible(new.station_branch_id,vehicle.id,current_date)
    and not exists (
      select 1 from public.lpg_station_managed_driver_assignments active_assignment
      where active_assignment.vehicle_id=vehicle.id and active_assignment.status in ('assigned','accepted','en_route')
    );
  if active_driver_count=0 then
    raise exception using errcode='P0001',message='Station Managed requires an active station-owned driver';
  end if;
  if eligible_vehicle_count=0 then
    raise exception using errcode='P0001',message='Station Managed requires an available, approved LPG vehicle with enough load capacity for this refill';
  end if;
  return new;
end;
$$;

drop trigger if exists zzzz_lpg_station_managed_quote_vehicle_guard on public.lpg_refill_quotes;
create trigger zzzz_lpg_station_managed_quote_vehicle_guard
before insert or update on public.lpg_refill_quotes
for each row execute function public.guard_lpg_station_managed_quote_vehicle_readiness();

-- Lock a branch's resource pool before any payment-reservation transition. The
-- AFTER order dispatcher uses the same transaction lock and must assign both
-- driver and vehicle before commit; if no resource exists, reserve-payment fails
-- and the customer's funds remain unreserved.
create or replace function public.require_lpg_station_managed_resources_before_reservation()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  requested_mode text;
  settings_enabled boolean;
  driver_ready boolean;
  vehicle_ready boolean;
begin
  requested_mode:=coalesce(nullif(new.metadata->>'fulfillment_mode',''),new.fulfillment_mode,'independent_driver');
  if new.fulfillment_channel<>'marketplace' or requested_mode<>'station_managed' then return new; end if;
  if new.status<>'payment_reserved' then return new; end if;
  if tg_op='UPDATE' and old.status is not distinct from new.status then return new; end if;

  if new.station_branch_id is null then
    raise exception using errcode='P0001',message='Station Managed order requires a selected branch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(new.station_branch_id::text,0));
  select station_managed_enabled into settings_enabled
  from public.lpg_station_fulfillment_settings where station_branch_id=new.station_branch_id;
  if not coalesce(settings_enabled,false) then
    raise exception using errcode='P0001',message='Station Managed is not enabled for this branch';
  end if;

  select exists(
    select 1 from public.lpg_station_managed_drivers driver
    where driver.station_branch_id=new.station_branch_id and driver.status='active'
  ) into driver_ready;
  if not driver_ready then
    raise exception using errcode='P0001',message='Station Managed payment cannot be reserved until an active station driver is available';
  end if;

  select exists(
    select 1
    from public.lpg_station_managed_vehicles assignment
    join public.vehicles vehicle on vehicle.id=assignment.vehicle_id
    where assignment.station_branch_id=new.station_branch_id and assignment.status='active'
      and vehicle.max_load_kg>=new.requested_kg
      and public.is_lpg_station_managed_vehicle_eligible(new.station_branch_id,vehicle.id,current_date)
      and not exists (
        select 1 from public.lpg_station_managed_driver_assignments active_assignment
        where active_assignment.vehicle_id=vehicle.id and active_assignment.status in ('assigned','accepted','en_route')
      )
  ) into vehicle_ready;
  if not vehicle_ready then
    raise exception using errcode='P0001',message='Station Managed payment cannot be reserved: no available approved LPG vehicle can carry this refill';
  end if;
  return new;
end;
$$;

drop trigger if exists zzzz_lpg_station_managed_resources_before_reservation on public.lpg_refill_orders;
create trigger zzzz_lpg_station_managed_resources_before_reservation
before insert or update of status on public.lpg_refill_orders
for each row execute function public.require_lpg_station_managed_resources_before_reservation();

revoke all on function public.guard_lpg_station_managed_quote_vehicle_readiness() from public,anon,authenticated;
revoke all on function public.require_lpg_station_managed_resources_before_reservation() from public,anon,authenticated;
revoke all on function public.read_lpg_station_managed_fulfillment_option(uuid) from public,anon;
grant execute on function public.read_lpg_station_managed_fulfillment_option(uuid) to authenticated,service_role;

comment on function public.read_lpg_station_managed_fulfillment_option(uuid) is
  'An orderable customer option requires station-managed settings, an active station driver and a free, eligible, compliant station-owned LPG vehicle.';
comment on function public.require_lpg_station_managed_resources_before_reservation() is
  'Fails payment reservation closed if Station Managed has no active branch driver and compliant available vehicle; transaction lock is shared with the after-update dispatch routine.';

notify pgrst,'reload schema';
commit;
