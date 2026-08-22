create or replace function public.read_application_location_reviews()
returns table (
  verification_id uuid,
  application_id uuid,
  application_version_id uuid,
  application_type_key text,
  application_type_name text,
  workspace text,
  applicant_user_id uuid,
  applicant_display_name text,
  application_status text,
  location_purpose text,
  formatted_address text,
  latitude double precision,
  longitude double precision,
  accuracy_meters double precision,
  provider_source text,
  provider_place_id text,
  recorded_at timestamptz,
  verification_status text,
  reviewer_user_id uuid,
  reviewed_at timestamptz,
  review_reason text,
  selected_service_areas jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.role() <> 'service_role' and not public.can_review_applications() then
    raise exception using errcode = '42501', message = 'Application review permission is required';
  end if;

  return query
  select
    verification.id,
    application.id,
    verification.application_version_id,
    application_type.key,
    application_type.display_name,
    application_type.metadata ->> 'workspace',
    application.applicant_user_id,
    profile.display_name,
    application.status,
    verification.location_purpose,
    verification.formatted_address,
    verification.latitude,
    verification.longitude,
    verification.accuracy_meters,
    verification.provider_source,
    verification.provider_place_id,
    verification.recorded_at,
    verification.status,
    verification.reviewer_user_id,
    verification.reviewed_at,
    verification.review_reason,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'areaId', area.id,
          'displayName', area.display_name,
          'areaType', area.area_type,
          'isPrimary', selection.is_primary,
          'stateName', area.state_name,
          'lgaName', area.lga_name,
          'cityName', area.city_name,
          'townName', area.town_name,
          'localityName', area.locality_name
        )
        order by selection.is_primary desc, area.display_name
      )
      from public.application_service_area_selections selection
      join public.service_areas area on area.id = selection.service_area_id
      where selection.application_version_id = verification.application_version_id
        and selection.selection_role = 'driver_service_area'
    ), '[]'::jsonb),
    verification.created_at,
    verification.updated_at
  from public.application_location_verifications verification
  join public.application_records application on application.id = verification.application_id
  join public.application_type_definitions application_type on application_type.id = application.application_type_id
  left join public.profiles profile on profile.id = application.applicant_user_id
  where coalesce(application_type.metadata ->> 'bounded_context', '') = 'lpg'
    and application_type.metadata ->> 'workspace' in ('driver','station')
  order by
    case verification.status when 'pending' then 0 when 'rejected' then 1 else 2 end,
    verification.updated_at desc;
end;
$$;

revoke all on function public.read_application_location_reviews() from public, anon;
grant execute on function public.read_application_location_reviews() to authenticated, service_role;

create or replace function public.review_application_location(
  target_verification_id uuid,
  target_decision text,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  existing record;
begin
  if auth.role() <> 'service_role' and not public.can_review_applications() then
    raise exception using errcode = '42501', message = 'Application review permission is required';
  end if;
  if target_verification_id is null then
    raise exception using errcode = '22023', message = 'Location verification is required';
  end if;
  if target_decision not in ('verified','rejected') then
    raise exception using errcode = '22023', message = 'Location decision must be verified or rejected';
  end if;
  if target_reason is null or btrim(target_reason) = '' then
    raise exception using errcode = '22023', message = 'A review reason is required';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'Idempotency key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'Review metadata must be an object';
  end if;

  select * into existing
  from public.application_location_verifications
  where id = target_verification_id
  for update;

  if not found then
    raise exception using errcode = '22023', message = 'Location verification could not be found';
  end if;

  if coalesce(existing.metadata ->> 'lastReviewIdempotencyKey', '') = target_idempotency_key then
    return target_verification_id;
  end if;

  update public.application_location_verifications
  set status = target_decision,
      reviewer_user_id = auth.uid(),
      reviewed_at = timezone('utc', now()),
      review_reason = btrim(target_reason),
      metadata = coalesce(metadata, '{}'::jsonb) || target_metadata || jsonb_build_object(
        'lastReviewIdempotencyKey', target_idempotency_key,
        'lastReviewDecision', target_decision,
        'lastReviewedAt', timezone('utc', now())
      ),
      updated_at = timezone('utc', now())
  where id = target_verification_id;

  return target_verification_id;
end;
$$;

revoke all on function public.review_application_location(uuid,text,text,text,jsonb) from public, anon;
grant execute on function public.review_application_location(uuid,text,text,text,jsonb) to authenticated, service_role;

create or replace function public.guard_lpg_partner_location_before_approval()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application_type_record record;
  active_version_id uuid;
  expected_purpose text;
  selected_count integer;
  primary_count integer;
begin
  if new.status <> 'approved' or old.status = 'approved' then
    return new;
  end if;

  select application_type.* into application_type_record
  from public.application_type_definitions application_type
  where application_type.id = new.application_type_id;

  if coalesce(application_type_record.metadata ->> 'bounded_context', '') <> 'lpg'
     or application_type_record.metadata ->> 'workspace' not in ('driver','station') then
    return new;
  end if;

  select version.id into active_version_id
  from public.application_versions version
  where version.application_id = new.id
    and version.version = new.active_version;

  if active_version_id is null then
    raise exception using errcode = '23514', message = 'Application location must be verified before approval';
  end if;

  expected_purpose := case application_type_record.metadata ->> 'workspace'
    when 'driver' then 'driver.base_location'
    else 'station.facility_location'
  end;

  if not exists (
    select 1
    from public.application_location_verifications verification
    where verification.application_version_id = active_version_id
      and verification.location_purpose = expected_purpose
      and verification.status = 'verified'
  ) then
    raise exception using errcode = '23514', message = 'Application location must be verified before approval';
  end if;

  if application_type_record.metadata ->> 'workspace' = 'driver' then
    select count(*), count(*) filter (where selection.is_primary)
    into selected_count, primary_count
    from public.application_service_area_selections selection
    where selection.application_version_id = active_version_id
      and selection.selection_role = 'driver_service_area';

    if selected_count < 1 then
      raise exception using errcode = '23514', message = 'Driver must choose at least one service area before approval';
    end if;
    if primary_count <> 1 then
      raise exception using errcode = '23514', message = 'Driver must have exactly one primary service area before approval';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists application_records_guard_lpg_partner_location_approval on public.application_records;
create trigger application_records_guard_lpg_partner_location_approval
before update of status on public.application_records
for each row execute function public.guard_lpg_partner_location_before_approval();

create or replace function public.preserve_lpg_driver_geography_payload()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application_type_record record;
  prior_payload jsonb;
begin
  select application_type.* into application_type_record
  from public.application_records application
  join public.application_type_definitions application_type on application_type.id = application.application_type_id
  where application.id = new.application_id;

  if coalesce(application_type_record.metadata ->> 'bounded_context', '') <> 'lpg'
     or application_type_record.metadata ->> 'workspace' <> 'driver' then
    return new;
  end if;

  if tg_op = 'UPDATE' then
    prior_payload := old.payload;
  else
    select version.payload into prior_payload
    from public.application_versions version
    where version.application_id = new.application_id
      and version.version < new.version
    order by version.version desc
    limit 1;
  end if;

  if prior_payload is null then
    return new;
  end if;

  if not (new.payload ? 'service') and prior_payload ? 'service' then
    new.payload := new.payload || jsonb_build_object('service', prior_payload -> 'service');
  end if;
  if not (new.payload ? 'location') and prior_payload ? 'location' then
    new.payload := new.payload || jsonb_build_object('location', prior_payload -> 'location');
  end if;

  return new;
end;
$$;

drop trigger if exists application_versions_preserve_lpg_driver_geography on public.application_versions;
create trigger application_versions_preserve_lpg_driver_geography
before insert or update of payload on public.application_versions
for each row execute function public.preserve_lpg_driver_geography_payload();