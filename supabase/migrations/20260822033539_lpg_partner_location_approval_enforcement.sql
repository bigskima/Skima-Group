with driver_type as (
  select id,
         coalesce(metadata -> 'submission_required_fields', '[]'::jsonb) as current_fields
  from public.application_type_definitions
  where key = 'application.lpg.driver.phase-one'
), missing_fields as (
  select driver_type.id,
         coalesce(jsonb_agg(candidate.field order by candidate.ordinality), '[]'::jsonb) as fields_to_add
  from driver_type
  cross join lateral jsonb_array_elements(
    '[
      {"path":"location.latitude","step":2,"label":"Operating location latitude"},
      {"path":"location.longitude","step":2,"label":"Operating location longitude"},
      {"path":"service.serviceAreaIds","step":2,"label":"Service areas"},
      {"path":"service.primaryServiceAreaId","step":2,"label":"Primary service area"}
    ]'::jsonb
  ) with ordinality as candidate(field, ordinality)
  where not exists (
    select 1
    from jsonb_array_elements(driver_type.current_fields) existing(field)
    where existing.field ->> 'path' = candidate.field ->> 'path'
  )
  group by driver_type.id
)
update public.application_type_definitions application_type
set metadata = jsonb_set(
      application_type.metadata,
      '{submission_required_fields}',
      coalesce(application_type.metadata -> 'submission_required_fields', '[]'::jsonb)
        || coalesce(missing_fields.fields_to_add, '[]'::jsonb),
      true
    ),
    updated_at = timezone('utc', now())
from missing_fields
where application_type.id = missing_fields.id;

create or replace function public.enforce_lpg_partner_location_before_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application_type_record record;
  active_version_id uuid;
  workspace_key text;
  location_purpose_key text;
  selected_area_count integer;
  primary_area_count integer;
  inactive_area_count integer;
begin
  if new.status <> 'approved' or old.status is not distinct from new.status then
    return new;
  end if;

  select application_type.*
  into application_type_record
  from public.application_type_definitions application_type
  where application_type.id = new.application_type_id;

  if not found
     or coalesce(application_type_record.metadata ->> 'bounded_context', '') <> 'lpg' then
    return new;
  end if;

  workspace_key := application_type_record.metadata ->> 'workspace';
  if workspace_key not in ('driver','station') then
    return new;
  end if;

  select version.id
  into active_version_id
  from public.application_versions version
  where version.application_id = new.id
    and version.version = new.active_version;

  if active_version_id is null then
    raise exception using errcode = '23514',
      message = 'The current application version could not be verified.';
  end if;

  location_purpose_key := case workspace_key
    when 'driver' then 'driver.base_location'
    when 'station' then 'station.facility_location'
  end;

  if not exists (
    select 1
    from public.application_location_verifications verification
    where verification.application_id = new.id
      and verification.application_version_id = active_version_id
      and verification.location_purpose = location_purpose_key
      and verification.status = 'verified'
  ) then
    raise exception using errcode = '23514',
      message = case workspace_key
        when 'driver' then 'Verify the driver operating location before approving this application.'
        else 'Verify the station facility location before approving this application.'
      end;
  end if;

  if workspace_key = 'driver' then
    select
      count(*),
      count(*) filter (where selection.is_primary),
      count(*) filter (where area.status <> 'active')
    into selected_area_count, primary_area_count, inactive_area_count
    from public.application_service_area_selections selection
    join public.service_areas area on area.id = selection.service_area_id
    where selection.application_id = new.id
      and selection.application_version_id = active_version_id
      and selection.selection_role = 'driver_service_area';

    if selected_area_count < 1 then
      raise exception using errcode = '23514',
        message = 'Choose at least one driver service area before approving this application.';
    end if;

    if primary_area_count <> 1 then
      raise exception using errcode = '23514',
        message = 'The driver application must have exactly one primary service area before approval.';
    end if;

    if inactive_area_count > 0 then
      raise exception using errcode = '23514',
        message = 'One or more requested driver service areas are no longer active. Update the application before approval.';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_lpg_partner_location_before_approval() from public, anon, authenticated;
grant execute on function public.enforce_lpg_partner_location_before_approval() to service_role;

drop trigger if exists application_records_require_verified_lpg_partner_location on public.application_records;
create trigger application_records_require_verified_lpg_partner_location
before update of status on public.application_records
for each row execute function public.enforce_lpg_partner_location_before_approval();