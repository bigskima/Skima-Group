begin;

create or replace function public.provision_lpg_station_for_application(target_application_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record public.application_records%rowtype;
  version_payload jsonb;
  station_payload jsonb;
  organization_record public.organizations%rowtype;
  target_branch_id uuid;
  target_station_id uuid;
  display_name_value text;
  formatted_address_value text;
  latitude_value numeric;
  longitude_value numeric;
  refill_capacity_value numeric;
  supported_sizes numeric[];
begin
  select *
  into application_record
  from public.application_records
  where id = target_application_id;

  if not found then
    raise exception 'application not found';
  end if;

  if application_record.status <> 'approved'
     or application_record.organization_id is null
     or application_record.activated_subject_type <> 'partner' then
    return null;
  end if;

  select payload
  into version_payload
  from public.application_versions
  where application_id = target_application_id
    and version = application_record.active_version;

  station_payload := version_payload -> 'station';
  if jsonb_typeof(station_payload) <> 'object' then
    return null;
  end if;

  select *
  into organization_record
  from public.organizations
  where id = application_record.organization_id;

  if not found then
    raise exception 'activated station application has no organization';
  end if;

  display_name_value := coalesce(
    nullif(station_payload ->> 'displayName', ''),
    nullif(station_payload ->> 'display_name', ''),
    organization_record.display_name,
    organization_record.legal_name
  );
  formatted_address_value := coalesce(
    nullif(station_payload ->> 'formattedAddress', ''),
    nullif(station_payload ->> 'formatted_address', ''),
    nullif(station_payload #>> '{location,formattedAddress}', ''),
    nullif(station_payload #>> '{location,formatted_address}', '')
  );
  latitude_value := coalesce(
    nullif(station_payload ->> 'latitude', '')::numeric,
    nullif(station_payload #>> '{location,latitude}', '')::numeric
  );
  longitude_value := coalesce(
    nullif(station_payload ->> 'longitude', '')::numeric,
    nullif(station_payload #>> '{location,longitude}', '')::numeric
  );
  refill_capacity_value := coalesce(
    nullif(station_payload ->> 'refillCapacityKg', '')::numeric,
    nullif(station_payload ->> 'refill_capacity_kg', '')::numeric,
    0
  );

  if display_name_value is null
     or formatted_address_value is null
     or latitude_value is null
     or longitude_value is null then
    raise exception 'approved station application is missing required station identity/location data';
  end if;

  select coalesce(array_agg(size_value::numeric), array[]::numeric[])
  into supported_sizes
  from jsonb_array_elements_text(
    case
      when jsonb_typeof(station_payload -> 'supportedCylinderSizesKg') = 'array'
        then station_payload -> 'supportedCylinderSizesKg'
      when jsonb_typeof(station_payload -> 'supported_cylinder_sizes_kg') = 'array'
        then station_payload -> 'supported_cylinder_sizes_kg'
      else '[]'::jsonb
    end
  ) as sizes(size_value);

  insert into public.organization_branches (
    organization_id,
    key,
    display_name,
    address,
    geo_location,
    status,
    source,
    idempotency_key,
    metadata,
    created_by
  )
  values (
    application_record.organization_id,
    'station.primary',
    display_name_value,
    jsonb_build_object('formatted_address', formatted_address_value),
    jsonb_build_object('latitude', latitude_value, 'longitude', longitude_value),
    'active',
    'lpg.application_activation',
    target_application_id::text,
    jsonb_build_object('source_application_id', target_application_id),
    application_record.applicant_user_id
  )
  on conflict (organization_id, key) do update
  set display_name = excluded.display_name,
      address = excluded.address,
      geo_location = excluded.geo_location,
      status = 'active',
      metadata = public.organization_branches.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into target_branch_id;

  insert into public.lpg_station_branches (
    organization_id,
    branch_id,
    display_name,
    formatted_address,
    latitude,
    longitude,
    operating_hours,
    supported_cylinder_sizes_kg,
    refill_capacity_kg,
    availability_status,
    approval_status,
    compliance_status,
    metadata,
    source,
    idempotency_key,
    business_legal_name,
    public_display_name,
    applicant_authority_profile
  )
  values (
    application_record.organization_id,
    target_branch_id,
    display_name_value,
    formatted_address_value,
    latitude_value,
    longitude_value,
    coalesce(station_payload -> 'operatingHours', station_payload -> 'operating_hours', '{}'::jsonb),
    supported_sizes,
    refill_capacity_value,
    'available',
    'approved',
    'approved',
    jsonb_build_object(
      'source_application_id', target_application_id,
      'activated_partner_id', application_record.activated_subject_id
    ),
    'lpg.application_activation',
    target_application_id::text,
    organization_record.legal_name,
    display_name_value,
    coalesce(version_payload -> 'authority', '{}'::jsonb)
  )
  on conflict (source, idempotency_key) do update
  set organization_id = excluded.organization_id,
      branch_id = excluded.branch_id,
      display_name = excluded.display_name,
      formatted_address = excluded.formatted_address,
      latitude = excluded.latitude,
      longitude = excluded.longitude,
      operating_hours = excluded.operating_hours,
      supported_cylinder_sizes_kg = excluded.supported_cylinder_sizes_kg,
      refill_capacity_kg = excluded.refill_capacity_kg,
      availability_status = 'available',
      approval_status = 'approved',
      compliance_status = 'approved',
      metadata = public.lpg_station_branches.metadata || excluded.metadata,
      business_legal_name = excluded.business_legal_name,
      public_display_name = excluded.public_display_name,
      applicant_authority_profile = excluded.applicant_authority_profile,
      updated_at = timezone('utc', now())
  returning id into target_station_id;

  return target_station_id;
end;
$$;

revoke all on function public.provision_lpg_station_for_application(uuid) from public, anon, authenticated;
grant execute on function public.provision_lpg_station_for_application(uuid) to service_role;

create or replace function public.handle_lpg_station_application_activation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'approved'
     and new.organization_id is not null
     and new.activated_subject_type = 'partner'
     and new.activated_subject_id is not null then
    perform public.provision_lpg_station_for_application(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.handle_lpg_station_application_activation() from public, anon, authenticated;

drop trigger if exists trg_lpg_station_application_activation on public.application_records;
create trigger trg_lpg_station_application_activation
after insert or update of status, organization_id, activated_subject_type, activated_subject_id
on public.application_records
for each row
execute function public.handle_lpg_station_application_activation();

do $$
declare
  application_id uuid;
begin
  for application_id in
    select ar.id
    from public.application_records ar
    join public.application_versions av
      on av.application_id = ar.id
     and av.version = ar.active_version
    where ar.status = 'approved'
      and ar.organization_id is not null
      and ar.activated_subject_type = 'partner'
      and ar.activated_subject_id is not null
      and jsonb_typeof(av.payload -> 'station') = 'object'
  loop
    perform public.provision_lpg_station_for_application(application_id);
  end loop;
end;
$$;

commit;
