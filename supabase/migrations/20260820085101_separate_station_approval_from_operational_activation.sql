begin;

create or replace function public.activate_configured_lpg_station_branch(
  target_application_id uuid default null::uuid,
  target_organization_id uuid default null::uuid,
  target_branch_id uuid default null::uuid,
  target_display_name text default null::text,
  target_formatted_address text default null::text,
  target_latitude numeric default null::numeric,
  target_longitude numeric default null::numeric,
  target_idempotency_key text default null::text,
  target_owner_user_id uuid default null::uuid,
  target_branch_key text default null::text,
  target_supported_cylinder_sizes_kg numeric[] default array[]::numeric[],
  target_refill_capacity_kg numeric default null::numeric,
  target_current_available_kg numeric default null::numeric,
  target_operating_hours jsonb default '{}'::jsonb,
  target_geofence jsonb default '{}'::jsonb,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.station_activation_api'::text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  activation_policy jsonb;
  configured_service_radius_meters integer;
begin
  -- Final application approval is intentionally separate from operational activation.
  -- The API decision flow may still invoke this compatibility hook, so treat that
  -- source as a no-op and leave the approved application in pending activation state.
  if target_source = 'skima.application.final_approval' then
    return null;
  end if;

  activation_policy := public.lpg_policy_config('lpg.station_activation.phase_one');
  configured_service_radius_meters := nullif(
    activation_policy ->> 'service_radius_meters',
    ''
  )::integer;

  if configured_service_radius_meters is null or configured_service_radius_meters <= 0 then
    raise exception 'LPG station activation policy must define a positive service_radius_meters';
  end if;

  return public.activate_lpg_station_branch(
    target_application_id => target_application_id,
    target_organization_id => target_organization_id,
    target_branch_id => target_branch_id,
    target_display_name => target_display_name,
    target_formatted_address => target_formatted_address,
    target_latitude => target_latitude,
    target_longitude => target_longitude,
    target_idempotency_key => target_idempotency_key,
    target_owner_user_id => target_owner_user_id,
    target_branch_key => target_branch_key,
    target_service_radius_meters => configured_service_radius_meters,
    target_supported_cylinder_sizes_kg => target_supported_cylinder_sizes_kg,
    target_refill_capacity_kg => target_refill_capacity_kg,
    target_current_available_kg => target_current_available_kg,
    target_operating_hours => target_operating_hours,
    target_geofence => target_geofence,
    target_metadata => target_metadata,
    target_source => target_source
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
