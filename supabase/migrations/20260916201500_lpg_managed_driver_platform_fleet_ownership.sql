alter table public.vehicles add column if not exists platform_owned boolean not null default false;

alter table public.vehicles drop constraint if exists vehicles_fleet_owner_required_check;
alter table public.vehicles add constraint vehicles_fleet_owner_required_check
check (ownership_relationship <> 'fleet_owned' or fleet_partner_id is not null or platform_owned);

alter table public.vehicles drop constraint if exists vehicles_platform_owned_shape_check;
alter table public.vehicles add constraint vehicles_platform_owned_shape_check
check (
  not platform_owned or (
    owner_user_id is null
    and fleet_partner_id is null
    and ownership_relationship = 'fleet_owned'
    and ownership_type = 'fleet_assigned'
  )
);

create index if not exists vehicles_platform_owned_status_idx
on public.vehicles(platform_owned,status) where platform_owned;

create unique index if not exists vehicles_registration_number_ci_unique_idx
on public.vehicles(lower(btrim(registration_number)))
where nullif(btrim(registration_number),'') is not null;

create or replace function public.hydrate_vehicle_from_application()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_application_id uuid;
  vehicle_payload jsonb;
  ownership_value text;
begin
  if new.metadata ? 'source_application_id'
    and (new.metadata ->> 'source_application_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    source_application_id := (new.metadata ->> 'source_application_id')::uuid;

    select coalesce(application_version.payload -> 'vehicle', '{}'::jsonb)
    into vehicle_payload
    from public.application_records application_record
    join public.application_type_definitions application_type
      on application_type.id = application_record.application_type_id
    join public.application_versions application_version
      on application_version.application_id = application_record.id
      and application_version.version = application_record.active_version
    where application_record.id = source_application_id
      and application_type.application_category = 'vehicle';

    if found then
      ownership_value := coalesce(nullif(vehicle_payload ->> 'ownershipType', ''),nullif(vehicle_payload ->> 'ownership_type', ''));
      if ownership_value in ('driver_owned','business_owned','leased','rented','third_party_authorized','fleet_assigned','other') then
        new.ownership_type := ownership_value;
      end if;
      new.manufacturer := coalesce(new.manufacturer, nullif(vehicle_payload ->> 'manufacturer', ''));
      new.model := coalesce(new.model, nullif(vehicle_payload ->> 'model', ''));
      new.registration_number := coalesce(new.registration_number,nullif(vehicle_payload ->> 'registrationNumber', ''),nullif(vehicle_payload ->> 'registration_number', ''));
      new.vin := coalesce(new.vin, nullif(vehicle_payload ->> 'vin', ''), nullif(vehicle_payload ->> 'chassisNumber', ''));
      new.color := coalesce(new.color, nullif(vehicle_payload ->> 'color', ''));
      new.fuel_type := coalesce(new.fuel_type, nullif(vehicle_payload ->> 'fuelType', ''), nullif(vehicle_payload ->> 'fuel_type', ''));
      if new.model_year is null and coalesce(vehicle_payload ->> 'year', vehicle_payload ->> 'modelYear') ~ '^[0-9]{4}$' then new.model_year := coalesce(vehicle_payload ->> 'year', vehicle_payload ->> 'modelYear')::integer; end if;
      if new.max_load_kg is null and coalesce(vehicle_payload ->> 'maxLoadKg', vehicle_payload ->> 'max_load_kg') ~ '^[0-9]+(\.[0-9]+)?$' then new.max_load_kg := coalesce(vehicle_payload ->> 'maxLoadKg', vehicle_payload ->> 'max_load_kg')::numeric; end if;
      if new.cargo_volume_m3 is null and coalesce(vehicle_payload ->> 'cargoVolumeM3', vehicle_payload ->> 'cargo_volume_m3') ~ '^[0-9]+(\.[0-9]+)?$' then new.cargo_volume_m3 := coalesce(vehicle_payload ->> 'cargoVolumeM3', vehicle_payload ->> 'cargo_volume_m3')::numeric; end if;
      if new.passenger_capacity is null and coalesce(vehicle_payload ->> 'passengerCapacity', vehicle_payload ->> 'passenger_capacity') ~ '^[0-9]+$' then new.passenger_capacity := coalesce(vehicle_payload ->> 'passengerCapacity', vehicle_payload ->> 'passenger_capacity')::integer; end if;
      if new.insurance_expires_at is null and (vehicle_payload ->> 'insuranceExpiresAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then new.insurance_expires_at := (vehicle_payload ->> 'insuranceExpiresAt')::date; end if;
      if new.inspection_expires_at is null and (vehicle_payload ->> 'inspectionExpiresAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then new.inspection_expires_at := (vehicle_payload ->> 'inspectionExpiresAt')::date; end if;
      if new.roadworthiness_expires_at is null and (vehicle_payload ->> 'roadworthinessExpiresAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then new.roadworthiness_expires_at := (vehicle_payload ->> 'roadworthinessExpiresAt')::date; end if;
    end if;
  end if;

  if new.status = 'active' and new.vehicle_type_id is null then raise exception 'vehicle type is required before activation'; end if;
  if new.status = 'active' and new.owner_user_id is null and new.organization_id is null and not coalesce(new.platform_owned,false) then
    raise exception 'vehicle owner, organization, or platform ownership is required before activation';
  end if;
  if coalesce(auth.jwt()->>'role','') <> 'service_role' and auth.uid() = new.owner_user_id and not public.has_permission('platform.vehicles.manage', new.organization_id) then
    if tg_op = 'INSERT' and new.status = 'active' then raise exception 'vehicle approval cannot be self-assigned'; end if;
    if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status = 'active' then raise exception 'vehicle approval cannot be self-assigned'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.register_platform_fleet_vehicle(
  target_vehicle_type_id uuid,
  target_registration_number text,
  target_manufacturer text,
  target_model text,
  target_model_year integer default null,
  target_color text default null,
  target_max_load_kg numeric default null,
  target_vin text default null,
  target_fuel_type text default null,
  target_insurance_expires_at date default null,
  target_inspection_expires_at date default null,
  target_roadworthiness_expires_at date default null,
  target_reason text default null,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare saved_id uuid; registration text:=upper(btrim(coalesce(target_registration_number,''))); existing_id uuid;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' and not public.has_permission('platform.fleets.manage',null) and not public.has_permission('platform.vehicles.manage',null) and not public.is_platform_super_admin() then raise exception using errcode='42501',message='SKIMA fleet management permission is required'; end if;
  if target_vehicle_type_id is null or registration='' or nullif(btrim(target_manufacturer),'') is null or nullif(btrim(target_model),'') is null or nullif(btrim(target_reason),'') is null or nullif(btrim(target_idempotency_key),'') is null or jsonb_typeof(coalesce(target_metadata,'{}'::jsonb))<>'object' then raise exception using errcode='22023',message='vehicle type, registration, manufacturer, model, reason, and idempotency key are required'; end if;
  if target_model_year is not null and target_model_year not between 1900 and 2100 then raise exception using errcode='22023',message='vehicle model year is invalid'; end if;
  if target_max_load_kg is not null and target_max_load_kg<0 then raise exception using errcode='22023',message='vehicle maximum load cannot be negative'; end if;
  if not exists(select 1 from public.vehicle_types where id=target_vehicle_type_id and status='active') then raise exception using errcode='22023',message='choose an active vehicle type'; end if;
  perform pg_advisory_xact_lock(hashtextextended('platform-fleet:'||btrim(target_idempotency_key),0));
  select id into existing_id from public.vehicles where metadata->>'platformFleetRegistrationIdempotencyKey'=btrim(target_idempotency_key) limit 1;
  if existing_id is not null then return existing_id; end if;
  if exists(select 1 from public.vehicles where lower(btrim(registration_number))=lower(registration)) then raise exception using errcode='23505',message='a vehicle with this registration number already exists'; end if;
  insert into public.vehicles(
    organization_id,owner_user_id,vehicle_type_id,status,capacity_profile,metadata,created_by,
    ownership_type,manufacturer,model,model_year,registration_number,vin,color,max_load_kg,fuel_type,
    insurance_expires_at,inspection_expires_at,roadworthiness_expires_at,fleet_partner_id,ownership_relationship,platform_owned
  ) values(
    null,null,target_vehicle_type_id,'pending','{}'::jsonb,
    coalesce(target_metadata,'{}'::jsonb)||jsonb_build_object('assetOwner','platform','assetOwnerLabel','SKIMA','platformFleetRegistrationIdempotencyKey',btrim(target_idempotency_key),'registrationReason',btrim(target_reason)),auth.uid(),
    'fleet_assigned',btrim(target_manufacturer),btrim(target_model),target_model_year,registration,nullif(btrim(coalesce(target_vin,'')),''),nullif(btrim(coalesce(target_color,'')),''),target_max_load_kg,nullif(btrim(coalesce(target_fuel_type,'')),''),
    target_insurance_expires_at,target_inspection_expires_at,target_roadworthiness_expires_at,null,'fleet_owned',true
  ) returning id into saved_id;
  return saved_id;
end;
$$;

create or replace function public.read_platform_fleet_vehicle_options()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' and not public.has_permission('platform.fleets.read',null) and not public.has_permission('platform.fleets.manage',null) and not public.has_permission('platform.vehicles.manage',null) and not public.has_permission('platform.drivers.manage',null) and not public.can_manage_lpg_operations() and not public.is_platform_super_admin() then raise exception using errcode='42501',message='SKIMA fleet read permission is required'; end if;
  select coalesce(jsonb_agg(item order by registration_number),'[]'::jsonb) into result
  from (
    select v.registration_number,
      jsonb_build_object(
        'vehicleId',v.id,'registrationNumber',v.registration_number,'manufacturer',v.manufacturer,'model',v.model,'modelYear',v.model_year,'color',v.color,'status',v.status,'platformOwned',v.platform_owned,
        'vehicleTypeId',v.vehicle_type_id,'vehicleTypeLabel',vt.display_name,'maxLoadKg',v.max_load_kg,'insuranceExpiresAt',v.insurance_expires_at,'inspectionExpiresAt',v.inspection_expires_at,'roadworthinessExpiresAt',v.roadworthiness_expires_at,
        'complianceReady',coalesce(compliance.compliant,false),'currentAssignmentId',assignment.id,'currentDriverProfileId',assignment.driver_profile_id,
        'currentDriverName',coalesce(driver.driver_display_name,driver.public_driver_id),'currentDriverPublicId',driver.public_driver_id,
        'availableForAssignment',v.status='active' and assignment.id is null
      ) item
    from public.vehicles v
    left join public.vehicle_types vt on vt.id=v.vehicle_type_id
    left join public.subject_compliance_status compliance on compliance.subject_type='vehicle' and compliance.subject_id=v.id
    left join lateral (
      select link.* from public.driver_vehicle_links link
      where link.vehicle_id=v.id and link.relationship_type='fleet_owned' and link.status='active' and link.starts_at<=timezone('utc',now()) and (link.ends_at is null or link.ends_at>timezone('utc',now()))
      order by link.starts_at desc limit 1
    ) assignment on true
    left join public.driver_profiles driver on driver.id=assignment.driver_profile_id
    where v.platform_owned
  ) rows;
  return result;
end;
$$;

create or replace function public.assign_platform_fleet_vehicle(
  target_driver_profile_id uuid,
  target_vehicle_id uuid,
  target_starts_at timestamptz default timezone('utc',now()),
  target_reason text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns public.driver_vehicle_links
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare result public.driver_vehicle_links; start_time timestamptz:=coalesce(target_starts_at,timezone('utc',now())); managed_key text;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' and not public.has_permission('platform.fleets.manage',null) and not public.has_permission('platform.vehicles.manage',null) and not public.has_permission('platform.drivers.manage',null) and not public.is_platform_super_admin() then raise exception using errcode='42501',message='SKIMA fleet assignment permission is required'; end if;
  if target_driver_profile_id is null or target_vehicle_id is null or nullif(btrim(target_reason),'') is null then raise exception using errcode='22023',message='Driver, SKIMA vehicle, and assignment reason are required'; end if;
  managed_key:=coalesce(public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key','driver.skima_special');
  if not exists(select 1 from public.driver_profiles driver join public.driver_program_memberships membership on membership.driver_profile_id=driver.id where driver.id=target_driver_profile_id and driver.verification_status='approved' and membership.program_key=managed_key and membership.status='active' and membership.starts_at<=timezone('utc',now()) and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))) then raise exception using errcode='55000',message='Only an approved SKIMA Managed Driver can receive a SKIMA fleet vehicle'; end if;
  if not exists(select 1 from public.vehicles where id=target_vehicle_id and platform_owned and status='active') then raise exception using errcode='55000',message='Choose an active SKIMA-owned fleet vehicle'; end if;
  perform pg_advisory_xact_lock(hashtextextended('platform-fleet-driver:'||target_driver_profile_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('platform-fleet-vehicle:'||target_vehicle_id::text,0));
  update public.driver_vehicle_links link set status='revoked',ends_at=greatest(start_time,link.starts_at+interval '1 millisecond'),metadata=link.metadata||jsonb_build_object('unassignedReason','Reassigned SKIMA fleet vehicle','unassignedBy',auth.uid()),updated_at=timezone('utc',now())
  where link.status='active' and link.relationship_type='fleet_owned' and (link.driver_profile_id=target_driver_profile_id or link.vehicle_id=target_vehicle_id) and exists(select 1 from public.vehicles v where v.id=link.vehicle_id and v.platform_owned);
  insert into public.driver_vehicle_links(driver_profile_id,vehicle_id,relationship_type,status,authorized_by,starts_at,ends_at,metadata,created_by)
  values(target_driver_profile_id,target_vehicle_id,'fleet_owned','active',auth.uid(),start_time,null,coalesce(target_metadata,'{}'::jsonb)||jsonb_build_object('assignmentKind','platform_fleet','ownerLabel','SKIMA','reason',btrim(target_reason)),auth.uid())
  on conflict(driver_profile_id,vehicle_id,relationship_type) do update set status='active',authorized_by=auth.uid(),starts_at=start_time,ends_at=null,metadata=public.driver_vehicle_links.metadata||excluded.metadata,updated_at=timezone('utc',now()) returning * into result;
  return result;
end;
$$;

create or replace function public.unassign_platform_fleet_vehicle(target_assignment_id uuid,target_reason text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare assignment public.driver_vehicle_links;
begin
  if coalesce(auth.jwt()->>'role','') <> 'service_role' and not public.has_permission('platform.fleets.manage',null) and not public.has_permission('platform.vehicles.manage',null) and not public.has_permission('platform.drivers.manage',null) and not public.is_platform_super_admin() then raise exception using errcode='42501',message='SKIMA fleet assignment permission is required'; end if;
  if target_assignment_id is null or nullif(btrim(target_reason),'') is null then raise exception using errcode='22023',message='assignment and reason are required'; end if;
  select link.* into assignment from public.driver_vehicle_links link join public.vehicles vehicle on vehicle.id=link.vehicle_id and vehicle.platform_owned where link.id=target_assignment_id and link.relationship_type='fleet_owned' for update of link;
  if not found then raise exception using errcode='P0002',message='SKIMA fleet assignment was not found'; end if;
  if assignment.status='active' then update public.driver_vehicle_links set status='revoked',ends_at=greatest(timezone('utc',now()),starts_at+interval '1 millisecond'),metadata=metadata||jsonb_build_object('unassignedReason',btrim(target_reason),'unassignedBy',auth.uid()),updated_at=timezone('utc',now()) where id=assignment.id; end if;
  return assignment.id;
end;
$$;

create or replace function public.guard_managed_driver_vehicle_assignment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare managed_key text; is_managed boolean; is_platform_vehicle boolean;
begin
  if new.status<>'active' or new.starts_at>timezone('utc',now()) or (new.ends_at is not null and new.ends_at<=timezone('utc',now())) then return new; end if;
  managed_key:=coalesce(public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key','driver.skima_special');
  select exists(select 1 from public.driver_program_memberships m where m.driver_profile_id=new.driver_profile_id and m.program_key=managed_key and m.status='active' and m.starts_at<=timezone('utc',now()) and (m.ends_at is null or m.ends_at>timezone('utc',now()))) into is_managed;
  select coalesce(v.platform_owned,false) into is_platform_vehicle from public.vehicles v where v.id=new.vehicle_id;
  if is_managed and (not coalesce(is_platform_vehicle,false) or new.relationship_type<>'fleet_owned') then raise exception using errcode='55000',message='SKIMA Managed Drivers can only be assigned SKIMA-owned fleet vehicles'; end if;
  if coalesce(is_platform_vehicle,false) and (not is_managed or new.relationship_type<>'fleet_owned') then raise exception using errcode='55000',message='SKIMA-owned fleet vehicles can only be assigned to SKIMA Managed Drivers'; end if;
  if coalesce(is_platform_vehicle,false) and exists(select 1 from public.driver_vehicle_links l join public.vehicles v on v.id=l.vehicle_id and v.platform_owned where l.id<>coalesce(new.id,gen_random_uuid()) and l.status='active' and l.starts_at<=timezone('utc',now()) and (l.ends_at is null or l.ends_at>timezone('utc',now())) and (l.driver_profile_id=new.driver_profile_id or l.vehicle_id=new.vehicle_id)) then raise exception using errcode='55000',message='A Managed Driver and SKIMA fleet vehicle can only have one active fleet assignment at a time'; end if;
  return new;
end;
$$;

drop trigger if exists guard_managed_driver_vehicle_assignment on public.driver_vehicle_links;
create trigger guard_managed_driver_vehicle_assignment before insert or update of driver_profile_id,vehicle_id,relationship_type,status,starts_at,ends_at on public.driver_vehicle_links for each row execute function public.guard_managed_driver_vehicle_assignment();

create or replace function public.set_lpg_managed_driver_assignment(target_driver_profile_id uuid,target_managed boolean,target_reason text,target_idempotency_key text,target_metadata jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare membership_id uuid; resolved_program_key text; driver_record public.driver_profiles%rowtype;
begin
  if coalesce(auth.jwt()->>'role','')<>'service_role' and not public.has_permission('platform.drivers.manage',null) and not public.is_platform_super_admin() then raise exception using errcode='42501',message='driver management permission required'; end if;
  if target_driver_profile_id is null then raise exception using errcode='22023',message='driver is required'; end if;
  if target_managed is null then raise exception using errcode='22023',message='driver type is required'; end if;
  if char_length(btrim(coalesce(target_reason,'')))<3 then raise exception using errcode='22023',message='reason is required'; end if;
  if coalesce(btrim(target_idempotency_key),'')='' then raise exception using errcode='22023',message='idempotency key is required'; end if;
  if target_metadata is null or jsonb_typeof(target_metadata)<>'object' then raise exception using errcode='22023',message='metadata must be an object'; end if;
  select * into driver_record from public.driver_profiles where id=target_driver_profile_id;
  if not found then raise exception using errcode='22023',message='driver profile not found'; end if;
  if target_managed and driver_record.verification_status<>'approved' then raise exception using errcode='55000',message='Only an approved Driver can be added to the SKIMA Managed Driver team.'; end if;
  resolved_program_key:=case when target_managed then coalesce(public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key','driver.skima_special') else 'driver.independent' end;
  membership_id:=public.set_driver_participation_program(target_driver_profile_id,resolved_program_key,target_reason,target_idempotency_key,target_metadata||jsonb_build_object('managedDriver',target_managed,'adminLabel',case when target_managed then 'SKIMA Managed Driver' else 'Independent Driver' end),'skima.admin.managed_drivers');
  if target_managed then
    update public.driver_vehicle_links link
    set status='revoked',ends_at=greatest(timezone('utc',now()),link.starts_at+interval '1 millisecond'),metadata=link.metadata||jsonb_build_object('revokedBecause','Driver became SKIMA Managed Driver','revokedBy',auth.uid()),updated_at=timezone('utc',now())
    where link.driver_profile_id=target_driver_profile_id and link.status='active' and (link.ends_at is null or link.ends_at>timezone('utc',now())) and not exists(select 1 from public.vehicles v where v.id=link.vehicle_id and v.platform_owned and link.relationship_type='fleet_owned');
  end if;
  return jsonb_build_object('driverProfileId',target_driver_profile_id,'managed',target_managed,'membershipId',membership_id,'label',case when target_managed then 'SKIMA Managed Driver' else 'Independent Driver' end);
end;
$$;

update public.driver_vehicle_links link
set status='revoked',ends_at=greatest(timezone('utc',now()),link.starts_at+interval '1 millisecond'),metadata=link.metadata||jsonb_build_object('revokedBecause','Managed Driver requires SKIMA-owned fleet vehicle'),updated_at=timezone('utc',now())
where link.status='active'
and exists(select 1 from public.driver_program_memberships membership where membership.driver_profile_id=link.driver_profile_id and membership.program_key=coalesce(public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key','driver.skima_special') and membership.status='active' and membership.starts_at<=timezone('utc',now()) and (membership.ends_at is null or membership.ends_at>timezone('utc',now())))
and not exists(select 1 from public.vehicles vehicle where vehicle.id=link.vehicle_id and vehicle.platform_owned and link.relationship_type='fleet_owned');

revoke all on function public.register_platform_fleet_vehicle(uuid,text,text,text,integer,text,numeric,text,text,date,date,date,text,text,jsonb) from public, anon;
grant execute on function public.register_platform_fleet_vehicle(uuid,text,text,text,integer,text,numeric,text,text,date,date,date,text,text,jsonb) to authenticated, service_role;
revoke all on function public.read_platform_fleet_vehicle_options() from public, anon;
grant execute on function public.read_platform_fleet_vehicle_options() to authenticated, service_role;
revoke all on function public.assign_platform_fleet_vehicle(uuid,uuid,timestamptz,text,jsonb) from public, anon;
grant execute on function public.assign_platform_fleet_vehicle(uuid,uuid,timestamptz,text,jsonb) to authenticated, service_role;
revoke all on function public.unassign_platform_fleet_vehicle(uuid,text) from public, anon;
grant execute on function public.unassign_platform_fleet_vehicle(uuid,text) to authenticated, service_role;
revoke all on function public.guard_managed_driver_vehicle_assignment() from public, anon, authenticated;
revoke all on function public.set_lpg_managed_driver_assignment(uuid,boolean,text,text,jsonb) from public, anon;
grant execute on function public.set_lpg_managed_driver_assignment(uuid,boolean,text,text,jsonb) to authenticated, service_role;
