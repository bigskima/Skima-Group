begin;

create or replace function public.normalize_partner_application_coverage_for_location()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application_type_key text;
  application_status text;
  partner_enabled boolean := false;
  candidate_radius integer := 5000;
  coverage_requests jsonb;
  request jsonb;
  selected_geography_id uuid;
  selected_state text;
  detected_state text;
  detected_latitude double precision;
  detected_longitude double precision;
begin
  if new.payload is null or jsonb_typeof(new.payload) <> 'object' then
    return new;
  end if;

  select application_type.key, application.status
  into application_type_key, application_status
  from public.application_records application
  join public.application_type_definitions application_type
    on application_type.id = application.application_type_id
  where application.id = new.application_id;

  if application_type_key not in (
    'application.lpg.driver.phase-one',
    'application.lpg.station.phase-one'
  ) or application_status not in (
    'draft',
    'incomplete',
    'additional_info_required',
    'resubmitted'
  ) then
    return new;
  end if;

  coverage_requests := coalesce(new.payload -> 'service' -> 'coverageRequests', '[]'::jsonb);
  if jsonb_typeof(coverage_requests) <> 'array'
     or jsonb_array_length(coverage_requests) <> 1 then
    return new;
  end if;

  request := coverage_requests -> 0;
  if request ->> 'type' <> 'ADMIN_GEOGRAPHY' then
    return new;
  end if;

  begin
    selected_geography_id := (request ->> 'geographyId')::uuid;
  exception when others then
    return new;
  end;

  detected_state := nullif(
    coalesce(
      new.payload -> 'location' -> 'address' ->> 'state',
      new.payload -> 'location' -> 'address' ->> 'region'
    ),
    ''
  );
  detected_latitude := nullif(new.payload -> 'location' ->> 'latitude', '')::double precision;
  detected_longitude := nullif(new.payload -> 'location' ->> 'longitude', '')::double precision;

  if detected_state is null or detected_latitude is null or detected_longitude is null then
    return new;
  end if;

  select geography.metadata ->> 'state'
  into selected_state
  from public.geographies geography
  where geography.id = selected_geography_id;

  if nullif(selected_state, '') is null then
    return new;
  end if;

  if regexp_replace(lower(detected_state), '\s+state$', '', 'g')
     = regexp_replace(lower(selected_state), '\s+state$', '', 'g') then
    return new;
  end if;

  select
    case application_type_key
      when 'application.lpg.driver.phase-one'
        then coalesce((entry.value ->> 'driverEnabled')::boolean, false)
      when 'application.lpg.station.phase-one'
        then coalesce((entry.value ->> 'stationEnabled')::boolean, false)
      else false
    end,
    greatest(
      coalesce(nullif(entry.value ->> 'minimumRadiusMeters', '')::integer, 500),
      least(
        coalesce(nullif(entry.value ->> 'radiusMeters', '')::integer, 5000),
        coalesce(nullif(entry.value ->> 'maximumRadiusMeters', '')::integer, 50000)
      )
    )
  into partner_enabled, candidate_radius
  from public.configuration_entries entry
  where entry.namespace = 'lpg.partner_onboarding'
    and entry.key = 'universal_candidate_coverage'
    and entry.scope_type = 'global'
    and entry.scope_id is null
    and entry.status = 'active'
    and entry.is_secret = false
    and coalesce((entry.value ->> 'enabled')::boolean, false)
    and (entry.effective_from is null or entry.effective_from <= timezone('utc', now()))
    and (entry.effective_until is null or entry.effective_until > timezone('utc', now()))
  order by entry.version desc, entry.updated_at desc
  limit 1;

  if not coalesce(partner_enabled, false) then
    return new;
  end if;

  new.payload := jsonb_set(
    new.payload,
    '{service,coverageRequests}',
    jsonb_build_array(
      jsonb_build_object(
        'type', 'RADIUS',
        'latitude', detected_latitude,
        'longitude', detected_longitude,
        'radiusMeters', candidate_radius,
        'source', 'universal_candidate_coverage'
      )
    ),
    true
  );

  return new;
end;
$$;

drop trigger if exists normalize_partner_application_coverage_for_location
  on public.application_versions;

create trigger normalize_partner_application_coverage_for_location
before insert or update of payload
on public.application_versions
for each row
execute function public.normalize_partner_application_coverage_for_location();

comment on function public.normalize_partner_application_coverage_for_location() is
  'Prevents editable LPG partner drafts from retaining a mapped service area in a different detected state after the operating location changes; converts the stale selection into a candidate radius request.';

commit;
