begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Bridge only in-flight legacy driver application selections whose service-area
-- mapping has been explicitly verified. This preserves old applications without
-- reviving the retired driver_service_areas write path.
create or replace function public.backfill_universal_driver_coverage_requests_from_legacy(
  p_legacy_area_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  inserted_count integer := 0;
begin
  insert into public.application_operational_coverage_requests (
    application_id,
    application_version_id,
    applicant_user_id,
    entity_type,
    service_key,
    coverage_type,
    geography_id,
    request_snapshot
  )
  select
    selection.application_id,
    selection.application_version_id,
    application.applicant_user_id,
    'DRIVER',
    'lpg',
    'ADMIN_GEOGRAPHY',
    mapping.geography_id,
    jsonb_build_object(
      'type', 'ADMIN_GEOGRAPHY',
      'geographyId', mapping.geography_id,
      'legacyServiceAreaId', selection.service_area_id,
      'bridgeSource', 'legacy_application_selection'
    )
  from public.application_service_area_selections selection
  join public.application_records application
    on application.id = selection.application_id
  join public.application_versions version
    on version.id = selection.application_version_id
   and version.application_id = application.id
   and version.version = application.active_version
  join public.application_type_definitions definition
    on definition.id = application.application_type_id
   and definition.metadata ->> 'bounded_context' = 'lpg'
   and definition.metadata ->> 'workspace' = 'driver'
  join public.geography_migration_mappings mapping
    on mapping.legacy_source = 'service_areas'
   and mapping.legacy_id = selection.service_area_id
   and mapping.migration_status = 'verified'
   and mapping.geography_id is not null
  join public.geographies geography
    on geography.id = mapping.geography_id
   and geography.status = 'active'
   and geography.boundary_geometry is not null
  where selection.selection_role = 'driver_service_area'
    and (p_legacy_area_id is null or selection.service_area_id = p_legacy_area_id)
    and not exists (
      select 1
      from public.application_operational_coverage_requests request
      where request.application_id = selection.application_id
        and request.application_version_id = selection.application_version_id
        and request.entity_type = 'DRIVER'
        and request.service_key = 'lpg'
        and request.coverage_type = 'ADMIN_GEOGRAPHY'
        and request.geography_id = mapping.geography_id
    );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function public.bridge_verified_legacy_driver_coverage_mapping()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.legacy_source = 'service_areas'
     and new.migration_status = 'verified'
     and (
       tg_op = 'INSERT'
       or old.migration_status is distinct from new.migration_status
       or old.geography_id is distinct from new.geography_id
     ) then
    perform public.backfill_universal_driver_coverage_requests_from_legacy(new.legacy_id);
  end if;
  return new;
end;
$$;

drop trigger if exists bridge_verified_legacy_driver_coverage_mapping_after_write
  on public.geography_migration_mappings;

create trigger bridge_verified_legacy_driver_coverage_mapping_after_write
after insert or update of migration_status, geography_id
on public.geography_migration_mappings
for each row
execute function public.bridge_verified_legacy_driver_coverage_mapping();

create or replace function public.bridge_legacy_driver_application_selection()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.selection_role = 'driver_service_area' then
    perform public.backfill_universal_driver_coverage_requests_from_legacy(new.service_area_id);
  end if;
  return new;
end;
$$;

drop trigger if exists bridge_legacy_driver_application_selection_after_write
  on public.application_service_area_selections;

create trigger bridge_legacy_driver_application_selection_after_write
after insert or update of service_area_id, selection_role
on public.application_service_area_selections
for each row
execute function public.bridge_legacy_driver_application_selection();

-- The old activation projection writes driver_service_areas, but those tables
-- are permanently read-only after the universal cutover migration. Universal
-- application coverage requests + approved operational assignments are now the
-- single activation/dispatch coverage path.
drop trigger if exists application_records_project_driver_service_areas
  on public.application_records;

-- Keep driver-facing/public service-zone labels synchronized from the universal
-- coverage authority so Driver Pass and profile screens do not depend on the
-- retired driver_service_areas projection.
create or replace function public.refresh_driver_universal_service_profile(
  p_driver_profile_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  zone_names jsonb := '[]'::jsonb;
  assignment_ids jsonb := '[]'::jsonb;
  geography_ids jsonb := '[]'::jsonb;
  now_at timestamptz := timezone('utc', now());
begin
  if p_driver_profile_id is null then
    return;
  end if;

  with active_coverage as (
    select
      assignment.id,
      assignment.geography_id,
      case assignment.coverage_type
        when 'ADMIN_GEOGRAPHY' then geography.canonical_name
        when 'RADIUS' then coalesce(
          nullif(btrim(assignment.metadata ->> 'displayName'), ''),
          trim(to_char(assignment.radius_meters / 1000.0, 'FM999999990.0')) || ' km radius'
        )
        when 'CUSTOM_ZONE' then coalesce(
          nullif(btrim(assignment.metadata ->> 'displayName'), ''),
          'Approved custom zone'
        )
      end as zone_name
    from public.operational_coverage_assignments assignment
    left join public.geographies geography
      on geography.id = assignment.geography_id
    where assignment.entity_type = 'DRIVER'
      and assignment.entity_id = p_driver_profile_id
      and assignment.service_key = 'lpg'
      and assignment.status in ('approved', 'active')
      and assignment.approved_at is not null
      and (assignment.valid_from is null or assignment.valid_from <= now_at)
      and (assignment.valid_to is null or assignment.valid_to > now_at)
  ),
  deduped_zones as (
    select distinct zone_name
    from active_coverage
    where zone_name is not null
  )
  select
    coalesce(
      (select jsonb_agg(zone_name order by zone_name) from deduped_zones),
      '[]'::jsonb
    ),
    coalesce(
      (select jsonb_agg(id order by id) from active_coverage),
      '[]'::jsonb
    ),
    coalesce(
      (
        select jsonb_agg(geography_id order by geography_id)
        from (
          select distinct geography_id
          from active_coverage
          where geography_id is not null
        ) geography_values
      ),
      '[]'::jsonb
    )
  into zone_names, assignment_ids, geography_ids;

  update public.driver_profiles
  set service_profile = coalesce(service_profile, '{}'::jsonb)
        || jsonb_build_object(
          'zones', zone_names,
          'universalCoverageAssignmentIds', assignment_ids,
          'universalGeographyIds', geography_ids,
          'coverageRuntime', 'universal'
        ),
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'serviceCoverageProjectedAt', now_at,
          'serviceCoverageProjectionSource', 'universal_operational_coverage'
        ),
      updated_at = now_at
  where id = p_driver_profile_id;
end;
$$;

create or replace function public.sync_driver_universal_service_profile_from_coverage()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op in ('UPDATE', 'DELETE')
     and old.entity_type = 'DRIVER'
     and old.service_key = 'lpg' then
    perform public.refresh_driver_universal_service_profile(old.entity_id);
  end if;

  if tg_op in ('INSERT', 'UPDATE')
     and new.entity_type = 'DRIVER'
     and new.service_key = 'lpg'
     and (
       tg_op = 'INSERT'
       or old.entity_id is distinct from new.entity_id
       or old.entity_type is distinct from new.entity_type
       or old.service_key is distinct from new.service_key
       or old.status is distinct from new.status
       or old.geography_id is distinct from new.geography_id
       or old.coverage_type is distinct from new.coverage_type
       or old.radius_meters is distinct from new.radius_meters
       or old.valid_from is distinct from new.valid_from
       or old.valid_to is distinct from new.valid_to
       or old.approved_at is distinct from new.approved_at
       or old.metadata is distinct from new.metadata
     ) then
    perform public.refresh_driver_universal_service_profile(new.entity_id);
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists sync_driver_universal_service_profile_after_coverage
  on public.operational_coverage_assignments;

create trigger sync_driver_universal_service_profile_after_coverage
after insert or update or delete
on public.operational_coverage_assignments
for each row
execute function public.sync_driver_universal_service_profile_from_coverage();

-- Reconcile any legacy selections whose geography was already verified before
-- this migration and refresh existing universal driver profiles.
select public.backfill_universal_driver_coverage_requests_from_legacy(null);

do $$
declare
  driver_id uuid;
begin
  for driver_id in
    select distinct assignment.entity_id
    from public.operational_coverage_assignments assignment
    where assignment.entity_type = 'DRIVER'
      and assignment.service_key = 'lpg'
  loop
    perform public.refresh_driver_universal_service_profile(driver_id);
  end loop;
end;
$$;

revoke all on function public.backfill_universal_driver_coverage_requests_from_legacy(uuid)
  from public, anon, authenticated;
revoke all on function public.bridge_verified_legacy_driver_coverage_mapping()
  from public, anon, authenticated;
revoke all on function public.bridge_legacy_driver_application_selection()
  from public, anon, authenticated;
revoke all on function public.refresh_driver_universal_service_profile(uuid)
  from public, anon, authenticated;
revoke all on function public.sync_driver_universal_service_profile_from_coverage()
  from public, anon, authenticated;

grant execute on function public.backfill_universal_driver_coverage_requests_from_legacy(uuid)
  to service_role;
grant execute on function public.bridge_verified_legacy_driver_coverage_mapping()
  to service_role;
grant execute on function public.bridge_legacy_driver_application_selection()
  to service_role;
grant execute on function public.refresh_driver_universal_service_profile(uuid)
  to service_role;
grant execute on function public.sync_driver_universal_service_profile_from_coverage()
  to service_role;

comment on function public.backfill_universal_driver_coverage_requests_from_legacy(uuid) is
  'Bridges active-version legacy driver application area selections into universal coverage requests only after the legacy geography mapping has been explicitly verified.';

comment on function public.refresh_driver_universal_service_profile(uuid) is
  'Projects active universal LPG driver coverage into driver_profiles.service_profile for driver-facing and public verification surfaces without writing retired legacy driver_service_areas.';

commit;
