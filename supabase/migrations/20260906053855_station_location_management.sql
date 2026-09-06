begin;

create table if not exists public.lpg_station_location_requests (
  id uuid primary key default gen_random_uuid(),
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete cascade,
  request_kind text not null check (request_kind in ('PRIMARY_UPDATE','ADDITIONAL_LOCATION')),
  label text not null,
  location_id uuid not null references public.locations(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','approved','rejected','cancelled','superseded')),
  submitted_by uuid not null references public.profiles(id) on delete restrict default auth.uid(),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  source text not null check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (submitted_by, source, idempotency_key),
  check ((status in ('approved','rejected')) = (reviewed_at is not null))
);

create index if not exists lpg_station_location_requests_branch_status_idx
on public.lpg_station_location_requests(station_branch_id,status,created_at desc);

create index if not exists lpg_station_location_requests_location_idx
on public.lpg_station_location_requests(location_id);

drop trigger if exists set_lpg_station_location_requests_updated_at
on public.lpg_station_location_requests;
create trigger set_lpg_station_location_requests_updated_at
before update on public.lpg_station_location_requests
for each row execute function public.set_updated_at();

drop trigger if exists audit_lpg_station_location_requests
on public.lpg_station_location_requests;
create trigger audit_lpg_station_location_requests
after insert or update or delete on public.lpg_station_location_requests
for each row execute function public.record_table_audit();

alter table public.lpg_station_location_requests enable row level security;

drop policy if exists lpg_station_location_requests_branch_read
on public.lpg_station_location_requests;
create policy lpg_station_location_requests_branch_read
on public.lpg_station_location_requests
for select to authenticated
using (public.can_read_lpg_station_branch(station_branch_id));

revoke all on table public.lpg_station_location_requests from public, anon, authenticated;
grant all on table public.lpg_station_location_requests to service_role;

create or replace function public.submit_lpg_station_location_request(
  target_station_branch_id uuid,
  target_request_kind text,
  target_label text,
  target_formatted_address text,
  target_latitude double precision,
  target_longitude double precision,
  target_accuracy_meters numeric,
  target_address jsonb,
  target_provider_source text,
  target_provider_place_id text,
  target_captured_at timestamptz,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.station_location'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  location_id uuid;
  request_id uuid;
  capture_source text;
  normalized_label text;
begin
  if auth.uid() is null and coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501',message='authenticated station user required';
  end if;

  if coalesce(auth.role(),'') <> 'service_role'
     and not public.can_operate_lpg_station_branch(target_station_branch_id,'lpg.stations.manage') then
    raise exception using errcode='42501',message='station location management permission required';
  end if;

  if target_request_kind not in ('PRIMARY_UPDATE','ADDITIONAL_LOCATION') then
    raise exception using errcode='22023',message='station location request type is not supported';
  end if;

  normalized_label := nullif(btrim(target_label),'');
  if normalized_label is null then
    normalized_label := case when target_request_kind='PRIMARY_UPDATE' then 'Main station' else 'Additional station location' end;
  end if;

  if nullif(btrim(target_formatted_address),'') is null then
    raise exception using errcode='22023',message='station address is required';
  end if;

  if target_latitude is null or target_longitude is null
     or target_latitude < -90 or target_latitude > 90
     or target_longitude < -180 or target_longitude > 180 then
    raise exception using errcode='22023',message='valid station coordinates are required';
  end if;

  if target_accuracy_meters is not null and target_accuracy_meters < 0 then
    raise exception using errcode='22023',message='location accuracy cannot be negative';
  end if;

  if target_address is null or jsonb_typeof(target_address) <> 'object' then
    raise exception using errcode='22023',message='structured station address is required';
  end if;

  if nullif(btrim(coalesce(target_address->>'country','')),'') is null
     or nullif(btrim(coalesce(target_address->>'countryCode','')),'') is null
     or nullif(btrim(coalesce(target_address->>'state',target_address->>'region','')),'') is null
     or nullif(btrim(coalesce(target_address->>'city',target_address->>'town',target_address->>'village',target_address->>'district','')),'') is null then
    raise exception using errcode='22023',
      message='country, country code, state, and city or town are required for a station location';
  end if;

  if nullif(btrim(target_idempotency_key),'') is null then
    raise exception using errcode='22023',message='idempotency key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception using errcode='22023',message='station location metadata must be an object';
  end if;

  select request.id into request_id
  from public.lpg_station_location_requests request
  where request.submitted_by=coalesce(auth.uid(),request.submitted_by)
    and request.source=target_source
    and request.idempotency_key=target_idempotency_key
  limit 1;

  if request_id is not null then
    return request_id;
  end if;

  capture_source := case lower(coalesce(target_provider_source,''))
    when 'manual_pin' then 'MAP_PIN'
    when 'maps_adapter' then 'GEOCODED'
    when 'device_geocoder' then 'DEVICE_GPS'
    when 'device_coordinates' then 'DEVICE_GPS'
    else 'GEOCODED'
  end;

  insert into public.locations(
    point,
    accuracy_meters,
    formatted_address,
    country,
    country_code,
    admin_area_1,
    admin_area_2,
    locality,
    sublocality,
    street,
    house_number,
    postal_code,
    landmark,
    capture_source,
    geocoder_provider,
    geocoder_reference,
    geocoder_raw,
    captured_at,
    created_by,
    metadata
  )
  values(
    extensions.st_setsrid(extensions.st_makepoint(target_longitude,target_latitude),4326)::extensions.geography,
    target_accuracy_meters,
    btrim(target_formatted_address),
    nullif(btrim(target_address->>'country'),''),
    upper(nullif(btrim(target_address->>'countryCode'),'')),
    nullif(btrim(coalesce(target_address->>'state',target_address->>'region')),''),
    nullif(btrim(coalesce(target_address->>'lga',target_address->>'district')),''),
    nullif(btrim(coalesce(target_address->>'city',target_address->>'town',target_address->>'village')),''),
    nullif(btrim(coalesce(target_address->>'neighbourhood',target_address->>'district')),''),
    nullif(btrim(target_address->>'street'),''),
    nullif(btrim(target_address->>'houseNumber'),''),
    nullif(btrim(target_address->>'postalCode'),''),
    nullif(btrim(coalesce(target_address->>'landmark',target_address->>'name')),''),
    capture_source,
    nullif(btrim(target_provider_source),''),
    nullif(btrim(target_provider_place_id),''),
    target_address,
    coalesce(target_captured_at,timezone('utc',now())),
    auth.uid(),
    target_metadata || jsonb_build_object(
      'stationBranchId',target_station_branch_id,
      'stationLocationRequestKind',target_request_kind
    )
  )
  returning id into location_id;

  insert into public.lpg_station_location_requests(
    station_branch_id,
    request_kind,
    label,
    location_id,
    status,
    submitted_by,
    source,
    idempotency_key,
    metadata
  )
  values(
    target_station_branch_id,
    target_request_kind,
    normalized_label,
    location_id,
    'pending',
    auth.uid(),
    target_source,
    target_idempotency_key,
    target_metadata
  )
  returning id into request_id;

  return request_id;
end;
$$;

revoke all on function public.submit_lpg_station_location_request(
  uuid,text,text,text,double precision,double precision,numeric,jsonb,text,text,timestamptz,text,jsonb,text
) from public,anon;
grant execute on function public.submit_lpg_station_location_request(
  uuid,text,text,text,double precision,double precision,numeric,jsonb,text,text,timestamptz,text,jsonb,text
) to authenticated,service_role;

create or replace function public.read_lpg_station_locations(
  target_station_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  station_record public.lpg_station_branches%rowtype;
begin
  select station.* into station_record
  from public.lpg_station_branches station
  where (target_station_branch_id is null or station.id=target_station_branch_id)
    and public.can_read_lpg_station_branch(station.id)
  order by station.created_at
  limit 1;

  if not found then
    raise exception using errcode='42501',message='branch-scoped LPG station access is required';
  end if;

  return jsonb_build_object(
    'stationBranchId',station_record.id,
    'stationDisplayName',station_record.display_name,
    'currentLocation',(
      select jsonb_build_object(
        'relationshipId',relationship.id,
        'locationId',location.id,
        'label','Main station',
        'purpose',relationship.purpose,
        'formattedAddress',location.formatted_address,
        'country',location.country,
        'countryCode',location.country_code,
        'state',location.admin_area_1,
        'lga',location.admin_area_2,
        'city',location.locality,
        'locality',location.sublocality,
        'street',location.street,
        'houseNumber',location.house_number,
        'postalCode',location.postal_code,
        'landmark',location.landmark,
        'latitude',extensions.st_y(location.point::extensions.geometry),
        'longitude',extensions.st_x(location.point::extensions.geometry),
        'accuracyMeters',location.accuracy_meters,
        'captureSource',location.capture_source,
        'providerSource',location.geocoder_provider,
        'providerPlaceId',location.geocoder_reference,
        'confirmedAt',location.confirmed_at,
        'updatedAt',location.updated_at
      )
      from public.entity_locations relationship
      join public.locations location on location.id=relationship.location_id
      where relationship.entity_type='STATION'
        and relationship.entity_id=station_record.id
        and relationship.purpose='STATION_PHYSICAL'
        and relationship.is_current
      order by relationship.valid_from desc
      limit 1
    ),
    'additionalLocations',coalesce((
      select jsonb_agg(jsonb_build_object(
        'relationshipId',relationship.id,
        'locationId',location.id,
        'label',coalesce(relationship.metadata->>'label','Additional station location'),
        'purpose',relationship.purpose,
        'formattedAddress',location.formatted_address,
        'country',location.country,
        'countryCode',location.country_code,
        'state',location.admin_area_1,
        'lga',location.admin_area_2,
        'city',location.locality,
        'locality',location.sublocality,
        'street',location.street,
        'houseNumber',location.house_number,
        'postalCode',location.postal_code,
        'landmark',location.landmark,
        'latitude',extensions.st_y(location.point::extensions.geometry),
        'longitude',extensions.st_x(location.point::extensions.geometry),
        'accuracyMeters',location.accuracy_meters,
        'confirmedAt',location.confirmed_at,
        'createdAt',relationship.created_at
      ) order by relationship.created_at desc)
      from public.entity_locations relationship
      join public.locations location on location.id=relationship.location_id
      where relationship.entity_type='STATION'
        and relationship.entity_id=station_record.id
        and relationship.purpose='STATION_ADDITIONAL'
        and relationship.is_current
    ),'[]'::jsonb),
    'requests',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',request.id,
        'requestKind',request.request_kind,
        'label',request.label,
        'status',request.status,
        'formattedAddress',location.formatted_address,
        'country',location.country,
        'countryCode',location.country_code,
        'state',location.admin_area_1,
        'lga',location.admin_area_2,
        'city',location.locality,
        'locality',location.sublocality,
        'street',location.street,
        'landmark',location.landmark,
        'latitude',extensions.st_y(location.point::extensions.geometry),
        'longitude',extensions.st_x(location.point::extensions.geometry),
        'accuracyMeters',location.accuracy_meters,
        'reviewReason',request.review_reason,
        'reviewedAt',request.reviewed_at,
        'createdAt',request.created_at,
        'updatedAt',request.updated_at
      ) order by request.created_at desc)
      from public.lpg_station_location_requests request
      join public.locations location on location.id=request.location_id
      where request.station_branch_id=station_record.id
    ),'[]'::jsonb)
  );
end;
$$;

revoke all on function public.read_lpg_station_locations(uuid) from public,anon;
grant execute on function public.read_lpg_station_locations(uuid) to authenticated,service_role;

create or replace function public.read_lpg_station_location_requests_admin(
  target_status text default null,
  target_limit integer default 200
)
returns table(
  request_id uuid,
  station_branch_id uuid,
  station_display_name text,
  request_kind text,
  label text,
  status text,
  formatted_address text,
  country text,
  country_code text,
  state text,
  lga text,
  city text,
  locality text,
  street text,
  landmark text,
  latitude double precision,
  longitude double precision,
  accuracy_meters numeric,
  provider_source text,
  submitted_by uuid,
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if coalesce(auth.role(),'') <> 'service_role'
     and not public.is_platform_super_admin()
     and not public.has_permission('platform.applications.review',null)
     and not public.has_permission('platform.location_evidence.read',null) then
    raise exception using errcode='42501',message='station location review permission required';
  end if;

  return query
  select
    request.id,
    request.station_branch_id,
    station.display_name,
    request.request_kind,
    request.label,
    request.status,
    location.formatted_address,
    location.country,
    location.country_code,
    location.admin_area_1,
    location.admin_area_2,
    location.locality,
    location.sublocality,
    location.street,
    location.landmark,
    extensions.st_y(location.point::extensions.geometry),
    extensions.st_x(location.point::extensions.geometry),
    location.accuracy_meters,
    location.geocoder_provider,
    request.submitted_by,
    request.reviewed_by,
    request.reviewed_at,
    request.review_reason,
    request.created_at,
    request.updated_at
  from public.lpg_station_location_requests request
  join public.lpg_station_branches station on station.id=request.station_branch_id
  join public.locations location on location.id=request.location_id
  where target_status is null or request.status=target_status
  order by case when request.status='pending' then 0 else 1 end,request.created_at desc
  limit least(greatest(coalesce(target_limit,200),1),500);
end;
$$;

revoke all on function public.read_lpg_station_location_requests_admin(text,integer) from public,anon;
grant execute on function public.read_lpg_station_location_requests_admin(text,integer) to authenticated,service_role;

create or replace function public.review_lpg_station_location_request(
  target_request_id uuid,
  target_decision text,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.admin.station_location'
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  request_record public.lpg_station_location_requests%rowtype;
  location_record public.locations%rowtype;
  station_record public.lpg_station_branches%rowtype;
  normalized_decision text;
begin
  if coalesce(auth.role(),'') <> 'service_role'
     and not public.is_platform_super_admin()
     and not public.has_permission('platform.applications.review',null) then
    raise exception using errcode='42501',message='station location review permission required';
  end if;

  normalized_decision:=lower(coalesce(target_decision,''));
  if normalized_decision not in ('approved','rejected') then
    raise exception using errcode='22023',message='station location decision must be approved or rejected';
  end if;

  if normalized_decision='rejected' and nullif(btrim(coalesce(target_reason,'')),'') is null then
    raise exception using errcode='22023',message='reason is required when rejecting a station location';
  end if;

  if nullif(btrim(target_idempotency_key),'') is null then
    raise exception using errcode='22023',message='idempotency key is required';
  end if;

  select * into request_record
  from public.lpg_station_location_requests
  where id=target_request_id
  for update;

  if not found then
    raise exception using errcode='P0002',message='station location request was not found';
  end if;

  if request_record.status in ('approved','rejected') then
    if request_record.status=normalized_decision then return request_record.id; end if;
    raise exception using errcode='23514',message='station location request has already been reviewed';
  end if;

  if request_record.status <> 'pending' then
    raise exception using errcode='23514',message='only pending station location requests can be reviewed';
  end if;

  select * into station_record
  from public.lpg_station_branches
  where id=request_record.station_branch_id
  for update;

  select * into location_record
  from public.locations
  where id=request_record.location_id
  for update;

  if normalized_decision='approved' then
    update public.locations
    set confirmed_at=coalesce(confirmed_at,timezone('utc',now())),
        updated_at=timezone('utc',now())
    where id=request_record.location_id;

    if request_record.request_kind='PRIMARY_UPDATE' then
      update public.entity_locations
      set is_current=false,
          valid_to=timezone('utc',now()),
          updated_at=timezone('utc',now())
      where entity_type='STATION'
        and entity_id=request_record.station_branch_id
        and purpose='STATION_PHYSICAL'
        and is_current;

      insert into public.entity_locations(
        entity_type,entity_id,location_id,purpose,is_current,valid_from,metadata
      )
      values(
        'STATION',
        request_record.station_branch_id,
        request_record.location_id,
        'STATION_PHYSICAL',
        true,
        timezone('utc',now()),
        jsonb_build_object(
          'label',request_record.label,
          'stationLocationRequestId',request_record.id,
          'approvedBy',auth.uid()
        ) || coalesce(target_metadata,'{}'::jsonb)
      );

      update public.lpg_station_branches
      set formatted_address=location_record.formatted_address,
          latitude=extensions.st_y(location_record.point::extensions.geometry),
          longitude=extensions.st_x(location_record.point::extensions.geometry),
          metadata=metadata || jsonb_build_object(
            'current_location_id',request_record.location_id,
            'current_location_request_id',request_record.id,
            'location_updated_at',timezone('utc',now())
          ),
          updated_at=timezone('utc',now())
      where id=request_record.station_branch_id;

      if station_record.branch_id is not null then
        update public.organization_branches
        set address=coalesce(address,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
              'formatted_address',location_record.formatted_address,
              'country',location_record.country,
              'country_code',location_record.country_code,
              'state',location_record.admin_area_1,
              'lga',location_record.admin_area_2,
              'city',location_record.locality,
              'locality',location_record.sublocality,
              'street',location_record.street,
              'house_number',location_record.house_number,
              'postal_code',location_record.postal_code,
              'landmark',location_record.landmark
            )),
            geo_location=jsonb_strip_nulls(jsonb_build_object(
              'latitude',extensions.st_y(location_record.point::extensions.geometry),
              'longitude',extensions.st_x(location_record.point::extensions.geometry),
              'accuracy_meters',location_record.accuracy_meters,
              'provider',location_record.geocoder_provider,
              'provider_place_id',location_record.geocoder_reference,
              'location_id',location_record.id
            )),
            metadata=metadata || jsonb_build_object(
              'current_location_id',request_record.location_id,
              'current_location_request_id',request_record.id
            ),
            updated_at=timezone('utc',now())
        where id=station_record.branch_id;
      end if;
    else
      insert into public.entity_locations(
        entity_type,entity_id,location_id,purpose,is_current,valid_from,metadata
      )
      values(
        'STATION',
        request_record.station_branch_id,
        request_record.location_id,
        'STATION_ADDITIONAL',
        true,
        timezone('utc',now()),
        jsonb_build_object(
          'label',request_record.label,
          'stationLocationRequestId',request_record.id,
          'approvedBy',auth.uid(),
          'operational',false
        ) || coalesce(target_metadata,'{}'::jsonb)
      );
    end if;
  end if;

  update public.lpg_station_location_requests
  set status=normalized_decision,
      reviewed_by=auth.uid(),
      reviewed_at=timezone('utc',now()),
      review_reason=nullif(btrim(coalesce(target_reason,'')),''),
      metadata=metadata || coalesce(target_metadata,'{}'::jsonb)
  where id=request_record.id;

  insert into public.lpg_station_branch_events(
    station_branch_id,event_type,payload,source,idempotency_key
  )
  values(
    request_record.station_branch_id,
    case when normalized_decision='approved'
      then 'lpg.station.location.approved'
      else 'lpg.station.location.rejected'
    end,
    jsonb_build_object(
      'requestId',request_record.id,
      'requestKind',request_record.request_kind,
      'locationId',request_record.location_id,
      'decision',normalized_decision,
      'reason',nullif(btrim(coalesce(target_reason,'')),'')
    ),
    target_source,
    target_idempotency_key
  )
  on conflict(source,idempotency_key) do nothing;

  return request_record.id;
end;
$$;

revoke all on function public.review_lpg_station_location_request(
  uuid,text,text,text,jsonb,text
) from public,anon;
grant execute on function public.review_lpg_station_location_request(
  uuid,text,text,text,jsonb,text
) to authenticated,service_role;

-- Attach existing application location evidence to the actual activated station
-- branch so Admin, station profile, maps and dispatch all have one canonical
-- station entity location instead of only an application-time point.
insert into public.entity_locations(
  entity_type,entity_id,location_id,purpose,is_current,valid_from,metadata
)
select
  'STATION',
  station.id,
  application_location.location_id,
  'STATION_PHYSICAL',
  true,
  coalesce(application_location.valid_from,station.created_at),
  jsonb_build_object(
    'backfilledFromApplication',station.metadata->>'source_application_id',
    'source','station_location_management_backfill'
  )
from public.lpg_station_branches station
join public.entity_locations application_location
  on application_location.entity_type='APPLICATION'
 and application_location.entity_id=(station.metadata->>'source_application_id')::uuid
 and application_location.purpose='STATION_PHYSICAL'
 and application_location.is_current
where coalesce(station.metadata->>'source_application_id','') ~ '^[0-9a-fA-F-]{36}$'
  and not exists(
    select 1 from public.entity_locations existing
    where existing.entity_type='STATION'
      and existing.entity_id=station.id
      and existing.purpose='STATION_PHYSICAL'
      and existing.is_current
  );

-- If an older station has no canonical application location at all, preserve
-- its existing branch coordinates in the canonical location model.
do $$
declare
  station_record record;
  canonical_location_id uuid;
begin
  for station_record in
    select station.*
    from public.lpg_station_branches station
    where not exists(
      select 1 from public.entity_locations existing
      where existing.entity_type='STATION'
        and existing.entity_id=station.id
        and existing.purpose='STATION_PHYSICAL'
        and existing.is_current
    )
  loop
    insert into public.locations(
      point,formatted_address,capture_source,created_by,metadata
    )
    values(
      extensions.st_setsrid(
        extensions.st_makepoint(station_record.longitude::double precision,station_record.latitude::double precision),
        4326
      )::extensions.geography,
      station_record.formatted_address,
      'IMPORTED',
      null,
      jsonb_build_object(
        'stationBranchId',station_record.id,
        'source','lpg_station_branches_backfill'
      )
    )
    returning id into canonical_location_id;

    insert into public.entity_locations(
      entity_type,entity_id,location_id,purpose,is_current,valid_from,metadata
    )
    values(
      'STATION',station_record.id,canonical_location_id,'STATION_PHYSICAL',true,
      station_record.created_at,
      jsonb_build_object('source','station_location_management_backfill')
    );
  end loop;
end
$$;

-- Repair the known Emelie Station legacy record. Its verified GPS point was
-- retained, but the old device-coordinate capture never resolved the address
-- components. These fields describe the existing recorded address and do not
-- change its GPS point.
update public.locations location
set formatted_address='Nsugbe, Anambra State, Nigeria',
    country='Nigeria',
    country_code='NG',
    admin_area_1='Anambra',
    admin_area_2='Anambra East',
    locality='Nsugbe',
    updated_at=timezone('utc',now())
from public.entity_locations relationship
join public.lpg_station_branches station
  on station.id=relationship.entity_id
where relationship.entity_type='STATION'
  and relationship.purpose='STATION_PHYSICAL'
  and relationship.is_current
  and relationship.location_id=location.id
  and lower(station.display_name)='emelie station'
  and abs(station.latitude::double precision-6.2069667)<0.00001
  and abs(station.longitude::double precision-6.8006117)<0.00001;

update public.lpg_station_branches station
set formatted_address='Nsugbe, Anambra State, Nigeria',
    metadata=metadata || jsonb_build_object('structured_location_backfilled',true),
    updated_at=timezone('utc',now())
where lower(station.display_name)='emelie station'
  and abs(station.latitude::double precision-6.2069667)<0.00001
  and abs(station.longitude::double precision-6.8006117)<0.00001;

update public.organization_branches branch
set address=coalesce(branch.address,'{}'::jsonb) || jsonb_build_object(
      'formatted_address','Nsugbe, Anambra State, Nigeria',
      'country','Nigeria',
      'country_code','NG',
      'state','Anambra',
      'lga','Anambra East',
      'city','Nsugbe'
    ),
    metadata=branch.metadata || jsonb_build_object('structured_location_backfilled',true),
    updated_at=timezone('utc',now())
from public.lpg_station_branches station
where station.branch_id=branch.id
  and lower(station.display_name)='emelie station'
  and abs(station.latitude::double precision-6.2069667)<0.00001
  and abs(station.longitude::double precision-6.8006117)<0.00001;

-- Sync whatever structured canonical address is available into organisation
-- branch display metadata for all activated stations.
update public.organization_branches branch
set address=coalesce(branch.address,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'formatted_address',location.formatted_address,
      'country',location.country,
      'country_code',location.country_code,
      'state',location.admin_area_1,
      'lga',location.admin_area_2,
      'city',location.locality,
      'locality',location.sublocality,
      'street',location.street,
      'house_number',location.house_number,
      'postal_code',location.postal_code,
      'landmark',location.landmark
    )),
    geo_location=coalesce(branch.geo_location,'{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
      'latitude',extensions.st_y(location.point::extensions.geometry),
      'longitude',extensions.st_x(location.point::extensions.geometry),
      'accuracy_meters',location.accuracy_meters,
      'provider',location.geocoder_provider,
      'provider_place_id',location.geocoder_reference,
      'location_id',location.id
    )),
    updated_at=timezone('utc',now())
from public.lpg_station_branches station
join public.entity_locations relationship
  on relationship.entity_type='STATION'
 and relationship.entity_id=station.id
 and relationship.purpose='STATION_PHYSICAL'
 and relationship.is_current
join public.locations location on location.id=relationship.location_id
where station.branch_id=branch.id;

comment on table public.lpg_station_location_requests is
  'Station-submitted physical location changes. Main-location updates remain pending until Admin approval; additional locations are verified references and are not automatically dispatch-enabled branches.';

comment on function public.submit_lpg_station_location_request(
  uuid,text,text,text,double precision,double precision,numeric,jsonb,text,text,timestamptz,text,jsonb,text
) is
  'Creates a branch-scoped station location review request and preserves structured canonical address evidence without changing live station coordinates before approval.';

comment on function public.review_lpg_station_location_request(uuid,text,text,text,jsonb,text) is
  'Admin review action for station location changes. Approved primary updates become the canonical physical station point; approved additional locations remain non-operational reference points.';

commit;
