begin;

create or replace function public.assign_fuel_order_driver(
  target_order_id uuid,
  target_driver_entity_type text,
  target_driver_entity_id uuid,
  target_vehicle_id uuid,
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
  operation_record public.fuel_order_operations%rowtype;
  qualification_record public.fuel_driver_product_qualifications%rowtype;
  driver_user_id_value uuid;
  assignment_id uuid;
  driver_profile_id_value uuid;
  station_managed_driver_id_value uuid;
  assignment_metadata jsonb;
  existing_assignment public.order_assignments%rowtype;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='Fuel driver assignment must be performed by the authorized SKIMA dispatch runtime';
  end if;

  if target_order_id is null
     or target_driver_entity_type is null or target_driver_entity_type<>'driver'
     or target_driver_entity_id is null
     or target_vehicle_id is null
     or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='Fuel order, driver identity, vehicle, idempotency key and object metadata are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_order_id::text,0));

  select * into order_record
  from public.order_records
  where id=target_order_id
  for update;

  if not found or not exists(
    select 1 from public.business_modules module
    where module.id=order_record.module_id and module.key='fuel'
  ) then
    raise exception using errcode='23514',message='Driver assignment requires an existing Fuel order';
  end if;

  select * into operation_record
  from public.fuel_order_operations
  where order_id=target_order_id
  for update;

  if not found or operation_record.stage_key<>'ready_for_driver' then
    raise exception using errcode='55000',message='Fuel order must be fully filled and ready for driver assignment';
  end if;

  select * into qualification_record
  from public.fuel_driver_product_qualifications
  where vehicle_id=target_vehicle_id
    and product_key=operation_record.product_key
    and status='approved'
    and maximum_load_litres>=operation_record.requested_litres
    and (valid_until is null or valid_until>timezone('utc',now()))
    and (branch_id is null or branch_id=operation_record.station_branch_id)
    and (
      (operation_record.fulfillment_mode='station_managed'
        and station_managed_driver_id=target_driver_entity_id
        and driver_profile_id is null)
      or (operation_record.fulfillment_mode in ('independent_driver','skima_managed')
        and driver_profile_id=target_driver_entity_id
        and station_managed_driver_id is null)
    )
  order by (branch_id is not null) desc,approved_at desc
  limit 1
  for update;

  if not found then
    raise exception using errcode='23514',message='Driver and vehicle are not approved for this Fuel product, branch and litre capacity';
  end if;

  driver_user_id_value:=qualification_record.driver_user_id;
  driver_profile_id_value:=qualification_record.driver_profile_id;
  station_managed_driver_id_value:=qualification_record.station_managed_driver_id;

  if operation_record.fulfillment_mode='station_managed' then
    if station_managed_driver_id_value is null
       or not exists (
         select 1 from public.lpg_station_managed_drivers driver
         where driver.id=station_managed_driver_id_value
           and driver.user_id=driver_user_id_value
           and driver.station_branch_id=operation_record.station_branch_id
           and driver.status='active'
       ) then
      raise exception using errcode='23514',message='Station Managed orders require an active approved driver assigned to this station';
    end if;
  else
    if driver_profile_id_value is null
       or not exists (
         select 1 from public.driver_profiles driver
         where driver.id=driver_profile_id_value
           and driver.user_id=driver_user_id_value
           and driver.verification_status='approved'
           and driver.operational_status not in ('suspended','inactive','archived')
       )
       or not exists (
         select 1 from public.driver_vehicle_links link
         where link.driver_profile_id=driver_profile_id_value
           and link.vehicle_id=target_vehicle_id
           and link.status='active'
           and link.starts_at<=timezone('utc',now())
           and (link.ends_at is null or link.ends_at>timezone('utc',now()))
       ) then
      raise exception using errcode='23514',message='Independent or SKIMA Managed driver profile and vehicle link must remain approved and active';
    end if;
  end if;

  if not exists (
    select 1 from public.vehicles vehicle
    where vehicle.id=target_vehicle_id
      and vehicle.status in ('active','available')
      and (vehicle.insurance_expires_at is null or vehicle.insurance_expires_at>=current_date)
      and (vehicle.inspection_expires_at is null or vehicle.inspection_expires_at>=current_date)
      and (vehicle.roadworthiness_expires_at is null or vehicle.roadworthiness_expires_at>=current_date)
  ) then
    raise exception using errcode='23514',message='Selected Fuel delivery vehicle is no longer active and compliant';
  end if;

  assignment_metadata:=coalesce(target_metadata,'{}'::jsonb)||jsonb_build_object(
    'vehicle_id',target_vehicle_id,
    'fuel_qualification_id',qualification_record.id,
    'fuel_product_key',operation_record.product_key,
    'maximum_load_litres',qualification_record.maximum_load_litres,
    'driver_user_id',driver_user_id_value,
    'fulfillment_mode',operation_record.fulfillment_mode
  );

  select * into existing_assignment
  from public.order_assignments
  where source='platform.fuel.dispatch'
    and idempotency_key=target_idempotency_key||':assignment';

  if found then
    if existing_assignment.order_id<>target_order_id
       or existing_assignment.entity_type<>'driver'
       or existing_assignment.entity_id<>target_driver_entity_id
       or existing_assignment.metadata->>'vehicle_id' is distinct from target_vehicle_id::text then
      raise exception using errcode='23505',message='Fuel dispatch idempotency key was reused with different assignment details';
    end if;
    assignment_id:=existing_assignment.id;
  else
    assignment_id:=public.assign_order_participant(
      target_order_id,
      'driver',
      'driver',
      target_driver_entity_id,
      'platform.fuel.dispatch',
      target_idempotency_key||':assignment',
      assignment_metadata
    );
  end if;

  perform public.record_fuel_order_stage(
    target_order_id,
    'driver_assigned',
    target_idempotency_key||':stage',
    'Qualified Fuel driver and vehicle assigned',
    assignment_metadata||jsonb_build_object('assignment_id',assignment_id)
  );

  return assignment_id;
end;
$$;

revoke all on function public.assign_fuel_order_driver(uuid,text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.assign_fuel_order_driver(uuid,text,uuid,uuid,text,jsonb) to service_role;

commit;
