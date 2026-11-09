create or replace function public.register_logistics_company_vehicle(
  target_organization_id uuid,
  target_vehicle_type_id uuid,
  target_registration_number text,
  target_manufacturer text,
  target_model text,
  target_model_year integer,
  target_color text,
  target_max_load_kg numeric,
  target_cargo_volume_m3 numeric,
  target_passenger_capacity integer,
  target_fuel_type text,
  target_insurance_expires_at date,
  target_inspection_expires_at date,
  target_roadworthiness_expires_at date,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  actor uuid := auth.uid();
  registered_vehicle_id uuid;
  vehicle_type_key text;
  now_at timestamptz := timezone('utc', now());
begin
  if actor is null then
    raise exception 'authentication is required';
  end if;

  if target_organization_id is null
     or not public.can_manage_logistics_company(target_organization_id) then
    raise exception 'company fleet management permission is required';
  end if;

  if not exists (
    select 1
    from public.logistics_provider_profiles provider
    where provider.organization_id = target_organization_id
  ) then
    raise exception 'Logistics company profile was not found';
  end if;

  if target_vehicle_type_id is null then
    raise exception 'vehicle type is required';
  end if;

  if target_registration_number is null
     or char_length(btrim(target_registration_number)) not between 3 and 40 then
    raise exception 'a valid vehicle registration number is required';
  end if;

  if target_model_year is not null
     and target_model_year not between 1900 and extract(year from now())::integer + 1 then
    raise exception 'vehicle model year is invalid';
  end if;

  if target_max_load_kg is not null and target_max_load_kg < 0 then
    raise exception 'maximum load cannot be negative';
  end if;
  if target_cargo_volume_m3 is not null and target_cargo_volume_m3 < 0 then
    raise exception 'cargo volume cannot be negative';
  end if;
  if target_passenger_capacity is not null and target_passenger_capacity < 0 then
    raise exception 'passenger capacity cannot be negative';
  end if;

  if target_idempotency_key is null
     or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'a valid idempotency key is required';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(target_organization_id::text || ':' || target_idempotency_key, 0)
  );

  select vehicle_type.key
    into vehicle_type_key
  from public.vehicle_types vehicle_type
  where vehicle_type.id = target_vehicle_type_id
    and vehicle_type.status = 'active';

  if vehicle_type_key is null then
    raise exception 'selected vehicle type is unavailable';
  end if;

  select vehicle.id
    into registered_vehicle_id
  from public.vehicles vehicle
  where vehicle.organization_id = target_organization_id
    and vehicle.metadata ->> 'company_registration_idempotency_key' = target_idempotency_key
  limit 1;

  if registered_vehicle_id is null then
    if exists (
      select 1
      from public.vehicles vehicle
      where vehicle.organization_id = target_organization_id
        and lower(coalesce(vehicle.registration_number, '')) = lower(btrim(target_registration_number))
        and vehicle.status <> 'archived'
    ) then
      raise exception 'this registration number is already in the company fleet';
    end if;

    insert into public.vehicles (
      organization_id,
      owner_user_id,
      vehicle_type_id,
      status,
      capacity_profile,
      metadata,
      created_by,
      ownership_type,
      manufacturer,
      model,
      model_year,
      registration_number,
      color,
      max_load_kg,
      cargo_volume_m3,
      passenger_capacity,
      fuel_type,
      insurance_expires_at,
      inspection_expires_at,
      roadworthiness_expires_at,
      fleet_partner_id,
      ownership_relationship,
      platform_owned
    )
    values (
      target_organization_id,
      null,
      target_vehicle_type_id,
      'active',
      jsonb_strip_nulls(jsonb_build_object(
        'maximumLoadKg', target_max_load_kg,
        'cargoVolumeM3', target_cargo_volume_m3,
        'passengerCapacity', target_passenger_capacity
      )),
      jsonb_build_object(
        'product_module', 'logistics_network',
        'company_managed', true,
        'company_registration_idempotency_key', target_idempotency_key,
        'vehicle_type_key', vehicle_type_key,
        'company_attested_ownership', true,
        'licensing_responsibility', 'company',
        'registered_by_user_id', actor,
        'registered_at', now_at
      ),
      actor,
      'business_owned',
      nullif(btrim(target_manufacturer), ''),
      nullif(btrim(target_model), ''),
      target_model_year,
      upper(btrim(target_registration_number)),
      nullif(btrim(target_color), ''),
      target_max_load_kg,
      target_cargo_volume_m3,
      target_passenger_capacity,
      nullif(btrim(target_fuel_type), ''),
      target_insurance_expires_at,
      target_inspection_expires_at,
      target_roadworthiness_expires_at,
      null,
      'business_owned',
      false
    )
    returning id into registered_vehicle_id;
  end if;

  -- The AFTER INSERT trigger on public.vehicles establishes the one canonical
  -- legal_owner relationship from organization_id. Do not insert it again here.
  if not exists (
    select 1
    from public.vehicle_party_relationships owner_relationship
    where owner_relationship.vehicle_id = registered_vehicle_id
      and owner_relationship.party_type = 'organization'
      and owner_relationship.party_id = target_organization_id
      and owner_relationship.relationship_role = 'legal_owner'
      and owner_relationship.status = 'active'
      and owner_relationship.valid_until is null
  ) then
    raise exception 'the company legal-owner relationship could not be established for this vehicle';
  end if;

  -- Fleet operation is a distinct relationship and is not created by the owner
  -- seed trigger, so it remains an explicit, idempotent insert.
  insert into public.vehicle_party_relationships (
    vehicle_id,
    party_type,
    party_id,
    relationship_role,
    valid_from,
    status,
    source,
    idempotency_key,
    reason,
    metadata,
    authorized_by
  )
  values (
    registered_vehicle_id,
    'organization',
    target_organization_id,
    'fleet_operator',
    now_at,
    'active',
    'skima.logistics.company.fleet',
    target_idempotency_key || ':fleet-operator',
    'Company manages the operation and licensing records for this vehicle.',
    jsonb_build_object('module', 'logistics_network', 'company_managed', true),
    actor
  )
  on conflict (source, idempotency_key) do nothing;

  return registered_vehicle_id;
end;
$function$;

revoke all on function public.register_logistics_company_vehicle(uuid,uuid,text,text,text,integer,text,numeric,numeric,integer,text,date,date,date,text) from public, anon;
grant execute on function public.register_logistics_company_vehicle(uuid,uuid,text,text,text,integer,text,numeric,numeric,integer,text,date,date,date,text) to authenticated, service_role;
