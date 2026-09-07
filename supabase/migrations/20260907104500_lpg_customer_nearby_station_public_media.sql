begin;

-- Customer-facing station discovery is location-scoped. The app must never
-- treat the full station table as a "nearby" list.
create or replace function public.read_nearby_lpg_stations(
  target_latitude numeric,
  target_longitude numeric,
  target_radius_meters numeric default 25000,
  target_limit integer default 30
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  result jsonb;
  resolved_radius numeric := least(greatest(coalesce(target_radius_meters, 25000), 500), 100000);
  resolved_limit integer := least(greatest(coalesce(target_limit, 30), 1), 100);
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if target_latitude is null or target_latitude < -90 or target_latitude > 90
     or target_longitude is null or target_longitude < -180 or target_longitude > 180 then
    raise exception using errcode = '22023', message = 'valid latitude and longitude are required';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(candidate) order by candidate.distance_meters, candidate.display_name),
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
      station.geofence,
      station.metadata,
      station.created_at,
      station.updated_at,
      round(
        public.lpg_distance_meters(
          target_latitude,
          target_longitude,
          station.latitude,
          station.longitude
        )
      )::bigint as distance_meters
    from public.lpg_station_branches station
    where station.latitude is not null
      and station.longitude is not null
      and station.approval_status = 'approved'
      and station.compliance_status = 'approved'
      and station.availability_status in ('available', 'busy')
      and coalesce(station.service_radius_meters, 0) > 0
      and public.lpg_distance_meters(
        target_latitude,
        target_longitude,
        station.latitude,
        station.longitude
      ) <= least(resolved_radius, station.service_radius_meters)
    order by
      public.lpg_distance_meters(
        target_latitude,
        target_longitude,
        station.latitude,
        station.longitude
      ) asc,
      station.display_name asc
    limit resolved_limit
  ) candidate;

  return result;
end;
$$;

revoke all on function public.read_nearby_lpg_stations(numeric,numeric,numeric,integer)
from public, anon;
grant execute on function public.read_nearby_lpg_stations(numeric,numeric,numeric,integer)
to authenticated, service_role;

comment on function public.read_nearby_lpg_stations(numeric,numeric,numeric,integer) is
  'Returns only approved operational LPG stations whose service radius contains the signed-in customer location, ordered by distance.';

-- Public-safe station photographs are presentation content, not credentials.
-- Once the station itself is operationally activated, public-profile candidate
-- images should become visible automatically. KYC, regulatory, tank and other
-- private/internal evidence is never promoted by this function.
create or replace function public.publish_station_profile_media_for_application(
  target_application_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application_record record;
  station_record record;
  candidate record;
  published_count integer := 0;
begin
  if target_application_id is null then
    raise exception using errcode = '22023', message = 'target_application_id is required';
  end if;

  select app.*
  into application_record
  from public.application_records app
  join public.application_type_definitions app_type
    on app_type.id = app.application_type_id
  where app.id = target_application_id
    and app_type.application_category = 'business'
    and app.operational_status = 'active';

  if not found then
    return 0;
  end if;

  select station.*
  into station_record
  from public.lpg_station_branches station
  where station.metadata ->> 'source_application_id' = target_application_id::text
     or station.metadata ->> 'activated_from_application_id' = target_application_id::text
  order by station.created_at asc
  limit 1;

  if not found then
    return 0;
  end if;

  update public.entity_media_links
  set is_primary = false,
      updated_at = timezone('utc', now())
  where entity_type = 'station'
    and entity_id = station_record.id
    and media_role = 'station.photo.public'
    and status = 'active'
    and is_primary;

  for candidate in
    select
      submission.media_asset_id,
      requirement.key as requirement_key,
      row_number() over (
        order by
          case requirement.key
            when 'station.photo.front' then 0
            when 'station.photo.entrance' then 1
            when 'station.photo.signboard' then 2
            when 'station.photo.compound' then 3
            when 'station.photo.pump' then 4
            when 'station.photo.drone' then 5
            else 100
          end,
          submission.created_at asc,
          submission.id asc
      ) - 1 as display_order
    from public.document_submissions submission
    join public.document_requirements requirement
      on requirement.id = submission.requirement_id
    join public.media_assets media
      on media.id = submission.media_asset_id
    where submission.application_id = target_application_id
      and submission.status in ('uploaded', 'approved')
      and media.status = 'active'
      and coalesce(
        nullif(requirement.metadata ->> 'privacy_classification', ''),
        nullif(requirement.metadata ->> 'privacy_tier', ''),
        nullif(requirement.metadata ->> 'classification', '')
      ) = 'PUBLIC_PROFILE_CANDIDATE'
      and coalesce((requirement.metadata ->> 'public_safe_candidate')::boolean, false)
      and media.privacy_classification not in ('PRIVATE_KYC', 'PRIVATE_VERIFICATION', 'INTERNAL_ONLY')
    order by display_order
  loop
    update public.media_assets
    set privacy_classification = 'PUBLIC_APPROVED',
        organization_id = coalesce(organization_id, station_record.organization_id),
        metadata = metadata || jsonb_build_object(
          'public_approved_at', timezone('utc', now()),
          'public_approval_mode', 'station_activation',
          'public_station_branch_id', station_record.id,
          'source_application_id', target_application_id,
          'requirement_key', candidate.requirement_key
        ),
        updated_at = timezone('utc', now())
    where id = candidate.media_asset_id
      and status = 'active'
      and privacy_classification not in ('PRIVATE_KYC', 'PRIVATE_VERIFICATION', 'INTERNAL_ONLY');

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
      station_record.id,
      candidate.media_asset_id,
      'station.photo.public',
      candidate.display_order = 0,
      candidate.display_order,
      'active',
      jsonb_build_object(
        'application_id', target_application_id,
        'requirement_key', candidate.requirement_key,
        'public_approved', true,
        'approval_mode', 'station_activation'
      ),
      'skima.station_activation',
      'station-activation-public-media:' || station_record.id::text || ':' || candidate.media_asset_id::text,
      coalesce(application_record.activated_by, application_record.applicant_user_id)
    )
    on conflict (entity_type, entity_id, media_asset_id, media_role) do update
    set is_primary = excluded.is_primary,
        display_order = excluded.display_order,
        status = 'active',
        metadata = public.entity_media_links.metadata || excluded.metadata,
        updated_at = timezone('utc', now());

    published_count := published_count + 1;
  end loop;

  return published_count;
end;
$$;

revoke all on function public.publish_station_profile_media_for_application(uuid)
from public, anon, authenticated;
grant execute on function public.publish_station_profile_media_for_application(uuid)
to service_role;

create or replace function public.publish_station_profile_media_on_activation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  category_value text;
begin
  if new.operational_status = 'active'
     and old.operational_status is distinct from new.operational_status then
    select app_type.application_category
    into category_value
    from public.application_type_definitions app_type
    where app_type.id = new.application_type_id;

    if category_value = 'business' then
      perform public.publish_station_profile_media_for_application(new.id);
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists application_records_publish_station_media
on public.application_records;

create trigger application_records_publish_station_media
after update of operational_status
on public.application_records
for each row
execute function public.publish_station_profile_media_on_activation();

revoke all on function public.publish_station_profile_media_on_activation()
from public, anon, authenticated;

-- Make the new policy effective for stations that were already activated
-- before this migration without exposing any private requirement class.
do $$
declare
  active_application record;
begin
  for active_application in
    select app.id
    from public.application_records app
    join public.application_type_definitions app_type
      on app_type.id = app.application_type_id
    where app.operational_status = 'active'
      and app_type.application_category = 'business'
  loop
    perform public.publish_station_profile_media_for_application(active_application.id);
  end loop;
end;
$$;

commit;
