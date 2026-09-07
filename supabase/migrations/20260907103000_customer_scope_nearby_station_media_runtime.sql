begin;

-- Customer station discovery must be location-scoped and serviceable, not a raw station table listing.
create or replace function public.read_nearby_lpg_stations(
  target_latitude numeric,
  target_longitude numeric,
  target_radius_meters integer default 25000,
  target_limit integer default 50
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  result jsonb;
  search_point extensions.geography(Point, 4326);
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='authentication required';
  end if;

  if target_latitude is null or target_latitude < -90 or target_latitude > 90
     or target_longitude is null or target_longitude < -180 or target_longitude > 180 then
    raise exception using errcode='22023', message='valid latitude and longitude are required';
  end if;

  if coalesce(target_radius_meters, 0) < 500 or target_radius_meters > 100000 then
    raise exception using errcode='22023', message='nearby station radius must be between 500 and 100000 meters';
  end if;

  search_point := extensions.st_setsrid(
    extensions.st_makepoint(target_longitude, target_latitude),
    4326
  )::extensions.geography;

  select coalesce(
    jsonb_agg(to_jsonb(candidate) order by candidate.distance_meters asc, candidate.display_name asc),
    '[]'::jsonb
  )
  into result
  from (
    select
      station.id,
      station.organization_id,
      station.branch_id,
      station.display_name,
      station.formatted_address,
      station.latitude,
      station.longitude,
      station.service_radius_meters,
      station.operating_hours,
      station.supported_cylinder_sizes_kg,
      station.refill_capacity_kg,
      station.current_available_kg,
      station.availability_status,
      station.approval_status,
      station.compliance_status,
      station.metadata,
      station.created_at,
      station.updated_at,
      public.lpg_distance_meters(
        target_latitude,
        target_longitude,
        station.latitude,
        station.longitude
      )::numeric as distance_meters
    from public.lpg_station_branches station
    where station.latitude is not null
      and station.longitude is not null
      and station.approval_status = 'approved'
      and station.compliance_status = 'approved'
      and station.availability_status in ('available','busy')
      and coalesce(station.service_radius_meters, 0) > 0
      and public.lpg_distance_meters(
        target_latitude,
        target_longitude,
        station.latitude,
        station.longitude
      ) <= least(target_radius_meters, station.service_radius_meters)
      and exists (
        select 1
        from public.operational_coverage_assignments coverage
        left join public.geographies geography
          on geography.id = coverage.geography_id
        where coverage.entity_type = 'STATION'
          and coverage.entity_id = station.id
          and coverage.service_key = 'lpg'
          and coverage.status in ('approved','active')
          and coverage.approved_at is not null
          and (coverage.valid_from is null or coverage.valid_from <= timezone('utc', now()))
          and (coverage.valid_to is null or coverage.valid_to > timezone('utc', now()))
          and case coverage.coverage_type
            when 'ADMIN_GEOGRAPHY' then
              geography.boundary_geometry is not null
              and extensions.st_covers(geography.boundary_geometry, search_point)
            when 'RADIUS' then
              coverage.center_point is not null
              and coverage.radius_meters is not null
              and extensions.st_dwithin(coverage.center_point, search_point, coverage.radius_meters)
            when 'CUSTOM_ZONE' then
              coverage.coverage_geometry is not null
              and extensions.st_covers(coverage.coverage_geometry, search_point)
            else false
          end
      )
    order by
      public.lpg_distance_meters(
        target_latitude,
        target_longitude,
        station.latitude,
        station.longitude
      ) asc,
      station.display_name asc
    limit least(greatest(coalesce(target_limit, 50), 1), 100)
  ) candidate;

  return result;
end;
$$;

revoke all on function public.read_nearby_lpg_stations(numeric,numeric,integer,integer) from public, anon;
grant execute on function public.read_nearby_lpg_stations(numeric,numeric,integer,integer) to authenticated, service_role;

comment on function public.read_nearby_lpg_stations(numeric,numeric,integer,integer) is
  'Returns only approved, compliant LPG stations whose operational coverage and station service radius include the requested customer location, ordered by distance.';

-- Public-safe station premises photos should become public automatically once the station is active.
-- Private KYC, compliance, tank/infrastructure and credential evidence remains private.
create or replace function public.publish_active_station_public_media(
  target_station_branch_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  station_record public.lpg_station_branches%rowtype;
  source_application_id uuid;
  candidate record;
  published_count integer := 0;
begin
  select *
  into station_record
  from public.lpg_station_branches
  where id = target_station_branch_id;

  if not found then
    raise exception using errcode='22023', message='station branch not found';
  end if;

  if station_record.approval_status <> 'approved'
     or station_record.compliance_status <> 'approved' then
    return 0;
  end if;

  source_application_id := case
    when coalesce(station_record.metadata ->> 'source_application_id','') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (station_record.metadata ->> 'source_application_id')::uuid
    when coalesce(station_record.metadata ->> 'activated_from_application_id','') ~*
      '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (station_record.metadata ->> 'activated_from_application_id')::uuid
    else null
  end;

  if source_application_id is null then
    return 0;
  end if;

  for candidate in
    select
      submission.media_asset_id,
      requirement.key as requirement_key,
      row_number() over (
        order by
          case requirement.key
            when 'station.photo.front' then 0
            when 'station.photo.signboard' then 1
            when 'station.photo.entrance' then 2
            when 'station.photo.compound' then 3
            when 'station.photo.pump' then 4
            when 'station.photo.drone' then 5
            else 100
          end,
          submission.created_at asc
      ) - 1 as display_order
    from public.document_submissions submission
    join public.document_requirements requirement
      on requirement.id = submission.requirement_id
    join public.media_assets media
      on media.id = submission.media_asset_id
    where submission.application_id = source_application_id
      and submission.status = 'approved'
      and coalesce(
        nullif(requirement.metadata ->> 'privacy_classification',''),
        nullif(requirement.metadata ->> 'privacy_tier',''),
        nullif(requirement.metadata ->> 'classification','')
      ) = 'PUBLIC_PROFILE_CANDIDATE'
      and media.status = 'active'
      and media.privacy_classification not in ('PRIVATE_KYC','PRIVATE_VERIFICATION','INTERNAL_ONLY')
  loop
    update public.media_assets
    set privacy_classification = 'PUBLIC_APPROVED',
        organization_id = coalesce(organization_id, station_record.organization_id),
        metadata = metadata || jsonb_build_object(
          'public_station_branch_id', target_station_branch_id,
          'source_application_id', source_application_id,
          'public_published_automatically', true,
          'public_published_at', timezone('utc', now())
        ),
        updated_at = timezone('utc', now())
    where id = candidate.media_asset_id;

    insert into public.entity_media_links (
      organization_id,
      entity_type,
      entity_id,
      media_asset_id,
      media_role,
      is_primary,
      display_order,
      status,
      metadata,
      source,
      idempotency_key,
      created_by
    )
    values (
      station_record.organization_id,
      'station',
      target_station_branch_id,
      candidate.media_asset_id,
      'station.photo.public',
      candidate.display_order = 0,
      candidate.display_order,
      'active',
      jsonb_build_object(
        'application_id', source_application_id,
        'requirement_key', candidate.requirement_key,
        'public_published_automatically', true
      ),
      'skima.station_activation',
      'station-public-media:' || target_station_branch_id::text || ':' || candidate.media_asset_id::text,
      coalesce(auth.uid(), station_record.metadata ->> 'owner_user_id')::uuid
    )
    on conflict (entity_type, entity_id, media_asset_id, media_role)
    do update set
      is_primary = excluded.is_primary,
      display_order = excluded.display_order,
      status = 'active',
      metadata = public.entity_media_links.metadata || excluded.metadata,
      updated_at = timezone('utc', now());

    published_count := published_count + 1;
  end loop;

  return published_count;
end;
$$;

revoke all on function public.publish_active_station_public_media(uuid) from public, anon, authenticated;
grant execute on function public.publish_active_station_public_media(uuid) to service_role;

create or replace function public.sync_station_public_media_after_activation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  station_id uuid;
begin
  if new.operational_status = 'active'
     and old.operational_status is distinct from new.operational_status then
    for station_id in
      select station.id
      from public.lpg_station_branches station
      where station.metadata ->> 'source_application_id' = new.id::text
         or station.metadata ->> 'activated_from_application_id' = new.id::text
    loop
      perform public.publish_active_station_public_media(station_id);
    end loop;
  end if;

  return new;
end;
$$;

drop trigger if exists application_records_publish_station_media on public.application_records;
create trigger application_records_publish_station_media
after update of operational_status on public.application_records
for each row execute function public.sync_station_public_media_after_activation();

revoke all on function public.sync_station_public_media_after_activation() from public, anon, authenticated;

create or replace function public.sync_station_public_media_after_document_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  station_id uuid;
  privacy_classification text;
begin
  if new.status <> 'approved'
     or old.status is not distinct from new.status then
    return new;
  end if;

  select coalesce(
    nullif(requirement.metadata ->> 'privacy_classification',''),
    nullif(requirement.metadata ->> 'privacy_tier',''),
    nullif(requirement.metadata ->> 'classification','')
  )
  into privacy_classification
  from public.document_requirements requirement
  where requirement.id = new.requirement_id;

  if privacy_classification <> 'PUBLIC_PROFILE_CANDIDATE' then
    return new;
  end if;

  if not exists (
    select 1
    from public.application_records application
    where application.id = new.application_id
      and application.operational_status = 'active'
  ) then
    return new;
  end if;

  for station_id in
    select station.id
    from public.lpg_station_branches station
    where station.metadata ->> 'source_application_id' = new.application_id::text
       or station.metadata ->> 'activated_from_application_id' = new.application_id::text
  loop
    perform public.publish_active_station_public_media(station_id);
  end loop;

  return new;
end;
$$;

drop trigger if exists document_submissions_publish_station_media on public.document_submissions;
create trigger document_submissions_publish_station_media
after update of status on public.document_submissions
for each row execute function public.sync_station_public_media_after_document_approval();

revoke all on function public.sync_station_public_media_after_document_approval() from public, anon, authenticated;

-- Backfill existing activated stations so their already-approved public-safe premises images appear immediately.
do $$
declare
  station_id uuid;
begin
  for station_id in
    select station.id
    from public.lpg_station_branches station
    join public.application_records application
      on application.id::text = coalesce(
        nullif(station.metadata ->> 'source_application_id',''),
        nullif(station.metadata ->> 'activated_from_application_id','')
      )
    where application.operational_status = 'active'
      and station.approval_status = 'approved'
      and station.compliance_status = 'approved'
  loop
    perform public.publish_active_station_public_media(station_id);
  end loop;
end;
$$;

commit;
