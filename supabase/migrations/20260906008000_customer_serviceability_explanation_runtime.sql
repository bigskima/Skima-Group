begin;

-- Customer-facing LPG serviceability explanation projection.
-- This uses the same coordinate-based service coverage resolver that gates LPG ordering/dispatch.
-- It never infers availability from address text and never exposes coverage policy IDs/configuration.

create or replace function public.read_my_lpg_location_serviceability(
  target_location_id uuid default null,
  target_limit integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if target_limit is null or target_limit < 1 or target_limit > 25 then
    raise exception using errcode = '22023', message = 'target_limit must be between 1 and 25';
  end if;

  if target_location_id is not null
    and not exists (
      select 1
      from public.lpg_customer_locations owned_location
      where owned_location.id = target_location_id
        and owned_location.owner_user_id = auth.uid()
        and owned_location.status <> 'deleted'
    ) then
    raise exception using errcode = '42501', message = 'owned LPG location was not found';
  end if;

  select coalesce(
    jsonb_agg(row_data order by updated_at desc),
    '[]'::jsonb
  )
  into result
  from (
    select
      customer_location.updated_at,
      jsonb_build_object(
        'locationId', customer_location.id,
        'label', customer_location.label,
        'formattedAddress', customer_location.formatted_address,
        'verificationStatus', customer_location.verification_status,
        'locationStatus', customer_location.status,
        'accuracyMeters', customer_location.accuracy_meters,
        'available', coalesce((availability.decision ->> 'available')::boolean, false),
        'reason', coalesce(availability.decision ->> 'reason', 'LOCATION_REQUIRED'),
        'matchedGeography', case
          when geography.id is null then null
          else jsonb_build_object(
            'name', geography.canonical_name,
            'level', geography_level.key
          )
        end,
        'explanationKey', case coalesce(availability.decision ->> 'reason', 'LOCATION_REQUIRED')
          when 'AVAILABLE' then 'service_enabled_here'
          when 'SERVICE_NOT_LAUNCHED' then 'service_not_currently_launched_here'
          when 'AREA_EXCLUDED' then 'location_outside_current_enabled_coverage'
          when 'POLICY_CONFIGURATION_CONFLICT' then 'coverage_configuration_needs_review'
          when 'SERVICE_PAUSED' then 'service_temporarily_paused_here'
          when 'LOCATION_TOO_INACCURATE' then 'location_accuracy_needs_improvement'
          else 'location_evidence_required'
        end,
        'authority', 'resolve_service_availability:lpg:customer_ordering',
        'coordinateBased', true,
        'addressTextUsedForDecision', false,
        'futureLaunchPromised', false,
        'mutableByAi', false
      ) as row_data
    from public.lpg_customer_locations customer_location
    cross join lateral (
      select public.resolve_service_availability(
        'lpg',
        'customer_ordering',
        customer_location.longitude::double precision,
        customer_location.latitude::double precision,
        timezone('utc', now())
      ) as decision
    ) availability
    left join public.geographies geography
      on geography.id = nullif(availability.decision ->> 'matchedGeographyId', '')::uuid
    left join public.geography_levels geography_level
      on geography_level.id = geography.geography_level_id
    where customer_location.owner_user_id = auth.uid()
      and customer_location.status <> 'deleted'
      and (
        target_location_id is null
        or customer_location.id = target_location_id
      )
    order by customer_location.updated_at desc
    limit target_limit
  ) customer_locations;

  return result;
end;
$$;

revoke all on function public.read_my_lpg_location_serviceability(uuid, integer)
from public, anon;
grant execute on function public.read_my_lpg_location_serviceability(uuid, integer)
to authenticated;

comment on function public.read_my_lpg_location_serviceability(uuid, integer) is
  'Returns signed-in customer saved-location LPG ordering availability using the canonical coordinate resolver. No address-text inference, internal coverage policy IDs, or launch promise is exposed.';

commit;
