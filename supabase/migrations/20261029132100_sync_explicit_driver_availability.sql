-- Keep the driver profile's dispatch availability in sync with explicit availability actions.
-- Background GPS updates carry no driverAvailabilityAction marker and therefore cannot
-- unexpectedly toggle a driver back online or offline.

create or replace function public.record_operational_driver_location(
  target_driver_profile_id uuid,
  target_latitude numeric,
  target_longitude numeric,
  target_online_status text,
  target_lpg_order_id uuid default null,
  target_accuracy_meters numeric default null,
  target_heading_degrees numeric default null,
  target_speed_meters_per_second numeric default null,
  target_recorded_at timestamptz default timezone('utc', now()),
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.driver_location_api',
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  legacy_id uuid;
  effective_recorded_at timestamptz := coalesce(target_recorded_at, timezone('utc', now()));
begin
  legacy_id := public.record_lpg_driver_location(
    target_driver_profile_id,
    target_latitude,
    target_longitude,
    target_idempotency_key,
    target_lpg_order_id,
    target_accuracy_meters,
    target_heading_degrees,
    target_speed_meters_per_second,
    target_online_status,
    effective_recorded_at,
    target_metadata,
    target_source
  );

  if coalesce(target_metadata->>'driverAvailabilityAction', 'false') = 'true' then
    update public.driver_profiles
    set operational_status = case target_online_status
          when 'online' then 'available'
          when 'busy' then 'busy'
          when 'offline' then 'offline'
        end,
        updated_at = timezone('utc', now())
    where id = target_driver_profile_id
      and verification_status = 'approved';

    if not found then
      raise exception using errcode='P0001',
        message='An approved driver profile is required to change availability';
    end if;
  end if;

  insert into public.driver_location_state(
    driver_id, point, accuracy_meters, heading, speed, captured_at, received_at, status, metadata
  )
  values(
    target_driver_profile_id,
    extensions.st_setsrid(extensions.st_makepoint(target_longitude, target_latitude),4326)::extensions.geography,
    target_accuracy_meters,
    target_heading_degrees,
    target_speed_meters_per_second,
    effective_recorded_at,
    timezone('utc',now()),
    case when target_online_status='online' then 'available' else 'unavailable' end,
    coalesce(target_metadata,'{}'::jsonb)||jsonb_build_object('source',target_source,'legacyLocationId',legacy_id)
  )
  on conflict(driver_id) do update
  set point=excluded.point,
      accuracy_meters=excluded.accuracy_meters,
      heading=excluded.heading,
      speed=excluded.speed,
      captured_at=excluded.captured_at,
      received_at=excluded.received_at,
      status=excluded.status,
      metadata=excluded.metadata
  where excluded.captured_at>=public.driver_location_state.captured_at;

  return legacy_id;
end
$function$;
