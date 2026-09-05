begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Keep every approved LPG station branch represented in the universal
-- operational-coverage runtime. Existing migrations backfill old stations,
-- while this trigger closes the lifecycle gap for newly activated stations and
-- later radius/coordinate changes.
create or replace function public.sync_lpg_station_universal_coverage()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  mapped_assignment_id uuid;
  now_at timestamptz := timezone('utc', now());
begin
  select mapping.coverage_assignment_id
  into mapped_assignment_id
  from public.operational_coverage_legacy_mappings mapping
  where mapping.legacy_source = 'lpg_station_branches'
    and mapping.legacy_id = new.id
  for update;

  if new.approval_status = 'approved' then
    if mapped_assignment_id is null then
      select assignment.id
      into mapped_assignment_id
      from public.operational_coverage_assignments assignment
      where assignment.entity_type = 'STATION'
        and assignment.entity_id = new.id
        and assignment.service_key = 'lpg'
        and assignment.coverage_type = 'RADIUS'
        and assignment.source = 'SYSTEM_ASSIGNED'
        and assignment.metadata ->> 'legacyStationBranchId' = new.id::text
      order by assignment.updated_at desc, assignment.id
      limit 1;
    end if;

    if mapped_assignment_id is null then
      insert into public.operational_coverage_assignments (
        entity_type,
        entity_id,
        service_key,
        coverage_type,
        center_point,
        radius_meters,
        status,
        source,
        approved_by,
        approved_at,
        metadata
      )
      values (
        'STATION',
        new.id,
        'lpg',
        'RADIUS',
        extensions.st_setsrid(
          extensions.st_makepoint(new.longitude, new.latitude),
          4326
        )::extensions.geography,
        new.service_radius_meters,
        'active',
        'SYSTEM_ASSIGNED',
        auth.uid(),
        now_at,
        jsonb_build_object(
          'legacyStationBranchId', new.id,
          'syncSource', 'station_branch_lifecycle'
        )
      )
      returning id into mapped_assignment_id;
    else
      update public.operational_coverage_assignments
      set center_point = extensions.st_setsrid(
            extensions.st_makepoint(new.longitude, new.latitude),
            4326
          )::extensions.geography,
          radius_meters = new.service_radius_meters,
          status = 'active',
          approved_at = coalesce(approved_at, now_at),
          approved_by = coalesce(approved_by, auth.uid()),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'legacyStationBranchId', new.id,
            'syncSource', 'station_branch_lifecycle',
            'lastSyncedAt', now_at
          ),
          updated_at = now_at
      where id = mapped_assignment_id
        and entity_type = 'STATION'
        and entity_id = new.id
        and service_key = 'lpg'
        and coverage_type = 'RADIUS'
        and source = 'SYSTEM_ASSIGNED';

      if not found then
        mapped_assignment_id := null;

        insert into public.operational_coverage_assignments (
          entity_type,
          entity_id,
          service_key,
          coverage_type,
          center_point,
          radius_meters,
          status,
          source,
          approved_by,
          approved_at,
          metadata
        )
        values (
          'STATION',
          new.id,
          'lpg',
          'RADIUS',
          extensions.st_setsrid(
            extensions.st_makepoint(new.longitude, new.latitude),
            4326
          )::extensions.geography,
          new.service_radius_meters,
          'active',
          'SYSTEM_ASSIGNED',
          auth.uid(),
          now_at,
          jsonb_build_object(
            'legacyStationBranchId', new.id,
            'syncSource', 'station_branch_lifecycle'
          )
        )
        returning id into mapped_assignment_id;
      end if;
    end if;

    insert into public.operational_coverage_legacy_mappings (
      legacy_source,
      legacy_id,
      coverage_assignment_id,
      metadata
    )
    values (
      'lpg_station_branches',
      new.id,
      mapped_assignment_id,
      jsonb_build_object(
        'migration', 'station_radius_lifecycle_sync',
        'syncedAt', now_at
      )
    )
    on conflict (legacy_source, legacy_id)
    do update set
      coverage_assignment_id = excluded.coverage_assignment_id,
      metadata = public.operational_coverage_legacy_mappings.metadata
        || excluded.metadata,
      migrated_at = now_at;

    return new;
  end if;

  -- Do not leave system-generated station coverage active after approval is
  -- withdrawn. Admin-assigned custom coverage is intentionally untouched.
  if mapped_assignment_id is not null then
    update public.operational_coverage_assignments
    set status = 'retired',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'retiredByStationApprovalStatus', new.approval_status,
          'lastSyncedAt', now_at
        ),
        updated_at = now_at
    where id = mapped_assignment_id
      and entity_type = 'STATION'
      and entity_id = new.id
      and source = 'SYSTEM_ASSIGNED'
      and status <> 'retired';
  end if;

  return new;
end;
$$;

drop trigger if exists sync_lpg_station_universal_coverage_after_write
  on public.lpg_station_branches;

create trigger sync_lpg_station_universal_coverage_after_write
after insert or update of approval_status, latitude, longitude, service_radius_meters
on public.lpg_station_branches
for each row
execute function public.sync_lpg_station_universal_coverage();

-- Backfill/synchronize current approved branches using the same lifecycle
-- function logic by touching only the columns that define station coverage.
update public.lpg_station_branches
set service_radius_meters = service_radius_meters
where approval_status = 'approved';

revoke all on function public.sync_lpg_station_universal_coverage()
  from public, anon, authenticated;
grant execute on function public.sync_lpg_station_universal_coverage()
  to service_role;

comment on function public.sync_lpg_station_universal_coverage() is
  'Synchronizes approved LPG station branch coordinates/radius into universal STATION operational coverage and retires only the system-generated assignment when approval is withdrawn.';

commit;
