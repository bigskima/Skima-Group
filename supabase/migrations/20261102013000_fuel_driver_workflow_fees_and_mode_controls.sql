begin;

-- Keep the three Fuel fulfilment modes as separate, auditable qualification paths.
alter table public.fuel_driver_product_qualifications
  add column if not exists fulfillment_mode text not null default 'independent_driver';

update public.fuel_driver_product_qualifications qualification
set fulfillment_mode=case
  when qualification.station_managed_driver_id is not null then 'station_managed'
  when exists (
    select 1
    from public.driver_program_memberships membership
    where membership.driver_profile_id=qualification.driver_profile_id
      and membership.program_key=coalesce(
        public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key',
        'driver.skima_special'
      )
      and membership.status='active'
      and membership.starts_at<=timezone('utc',now())
      and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))
  ) then 'skima_managed'
  else 'independent_driver'
end;

alter table public.fuel_driver_product_qualifications
  drop constraint if exists fuel_driver_product_qualification_mode_identity_check;
alter table public.fuel_driver_product_qualifications
  add constraint fuel_driver_product_qualification_mode_identity_check
  check (
    (fulfillment_mode='station_managed'
      and station_managed_driver_id is not null
      and driver_profile_id is null)
    or
    (fulfillment_mode in ('independent_driver','skima_managed')
      and driver_profile_id is not null
      and station_managed_driver_id is null)
  );

-- Three independent, global product fees. Seed at zero so the release does not
-- introduce new customer charges until an administrator explicitly sets them.
insert into public.financial_policy_definitions(
  key,display_name,policy_family,approval_required,allow_partner_delegation,metadata
)
values
  ('pricing.fuel.pms.platform_fee_per_litre','PMS platform fee per litre','service_fee',true,false,
    '{"module":"fuel","product_key":"fuel.pms","component":"platform_fee_per_litre"}'::jsonb),
  ('pricing.fuel.ago.platform_fee_per_litre','AGO diesel platform fee per litre','service_fee',true,false,
    '{"module":"fuel","product_key":"fuel.ago","component":"platform_fee_per_litre"}'::jsonb),
  ('pricing.fuel.dpk.platform_fee_per_litre','DPK kerosene platform fee per litre','service_fee',true,false,
    '{"module":"fuel","product_key":"fuel.dpk","component":"platform_fee_per_litre"}'::jsonb)
on conflict(key) do nothing;

insert into public.platform_fee_controls(
  key,display_name,description,unit_label,policy_key,configuration_path,display_order,metadata
)
values
  ('fuel_pms_fee_per_litre','PMS platform fee','Global SKIMA platform fee added per litre of petrol sold.','per litre','pricing.fuel.pms.platform_fee_per_litre',array['amount_per_litre'],50,'{"module":"fuel","product_key":"fuel.pms"}'::jsonb),
  ('fuel_ago_fee_per_litre','AGO diesel platform fee','Global SKIMA platform fee added per litre of diesel sold.','per litre','pricing.fuel.ago.platform_fee_per_litre',array['amount_per_litre'],60,'{"module":"fuel","product_key":"fuel.ago"}'::jsonb),
  ('fuel_dpk_fee_per_litre','DPK kerosene platform fee','Global SKIMA platform fee added per litre of kerosene sold.','per litre','pricing.fuel.dpk.platform_fee_per_litre',array['amount_per_litre'],70,'{"module":"fuel","product_key":"fuel.dpk"}'::jsonb)
on conflict(key) do update
set display_name=excluded.display_name,
    description=excluded.description,
    unit_label=excluded.unit_label,
    policy_key=excluded.policy_key,
    configuration_path=excluded.configuration_path,
    display_order=excluded.display_order,
    metadata=public.platform_fee_controls.metadata||excluded.metadata,
    updated_at=timezone('utc',now());

-- Ensure both currently-supported Fuel currencies have distinct, audited zero baselines.
with module_record as (
  select id from public.business_modules where key='fuel'
),
currency_values(currency_code) as (
  select code from public.currency_definitions
  where code in ('NGN','USDC') and status='enabled'
),
missing_scopes as (
  select definition.id as policy_definition_id,
         currency_values.currency_code
  from public.financial_policy_definitions definition
  cross join module_record
  cross join currency_values
  where definition.key in (
    'pricing.fuel.pms.platform_fee_per_litre',
    'pricing.fuel.ago.platform_fee_per_litre',
    'pricing.fuel.dpk.platform_fee_per_litre'
  )
  and not exists (
    select 1 from public.financial_policy_versions existing
    where existing.policy_definition_id=definition.id
      and existing.module_id=module_record.id
      and existing.service_key='fuel.order'
      and existing.geography_type='global'
      and existing.currency_code=currency_values.currency_code
      and existing.lifecycle_status='active'
      and existing.effective_from<=timezone('utc',now())
      and (existing.effective_until is null or existing.effective_until>timezone('utc',now()))
  )
),
numbered_scopes as (
  select missing_scopes.*,
         row_number() over(partition by policy_definition_id order by currency_code) as sequence_number,
         coalesce((
           select max(existing.version)
           from public.financial_policy_versions existing
           where existing.policy_definition_id=missing_scopes.policy_definition_id
         ),0) as current_max_version
  from missing_scopes
)
insert into public.financial_policy_versions(
  policy_definition_id,version,lifecycle_status,module_id,service_key,geography_type,
  geography_key,currency_code,priority,configuration,effective_from,change_reason,
  validation_snapshot,submitted_at,approved_at,activated_at,created_at,updated_at
)
select
  numbered_scopes.policy_definition_id,
  numbered_scopes.current_max_version+numbered_scopes.sequence_number,
  'active',
  module_record.id,
  'fuel.order',
  'global',
  null,
  numbered_scopes.currency_code,
  100,
  '{"amount_per_litre":0}'::jsonb,
  timezone('utc',now()),
  'Initial zero-value Fuel platform fee baseline; administrators may configure a fee prospectively.',
  public.validate_financial_policy_configuration('service_fee','{"amount_per_litre":0}'::jsonb),
  timezone('utc',now()),timezone('utc',now()),timezone('utc',now()),timezone('utc',now()),timezone('utc',now())
from numbered_scopes
cross join module_record;

create or replace function public.configure_fuel_driver_product_qualification_mode(
  target_driver_user_id uuid,
  target_driver_profile_id uuid,
  target_station_managed_driver_id uuid,
  target_fulfillment_mode text,
  target_branch_id uuid,
  target_vehicle_id uuid,
  target_product_key text,
  target_maximum_load_litres numeric,
  target_status text,
  target_valid_until timestamptz,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_record public.driver_profiles%rowtype;
  station_driver_record public.lpg_station_managed_drivers%rowtype;
  branch_record public.organization_branches%rowtype;
  vehicle_record public.vehicles%rowtype;
  qualification_record public.fuel_driver_product_qualifications%rowtype;
  existing_event public.fuel_driver_qualification_events%rowtype;
  before_value jsonb:='{}'::jsonb;
  qualification_id uuid;
  event_key text;
  manager_allowed boolean;
begin
  manager_allowed:=auth.role()='service_role'
    or public.can_manage_fuel_platform()
    or (
      target_branch_id is not null
      and public.has_permission_for_branch(
        'business.fuel.orders.manage',
        (select organization_id from public.organization_branches where id=target_branch_id),
        target_branch_id
      )
    );

  if not manager_allowed then
    raise exception using errcode='42501',message='Fuel driver qualification management permission is required';
  end if;

  if target_driver_user_id is null
     or target_fulfillment_mode is null or target_fulfillment_mode not in ('station_managed','independent_driver','skima_managed')
     or (target_fulfillment_mode='station_managed' and (target_station_managed_driver_id is null or target_driver_profile_id is not null))
     or (target_fulfillment_mode in ('independent_driver','skima_managed') and (target_driver_profile_id is null or target_station_managed_driver_id is not null))
     or target_vehicle_id is null
     or target_product_key is null or target_product_key not in ('fuel.pms','fuel.ago','fuel.dpk')
     or target_maximum_load_litres is null or target_maximum_load_litres<=0
     or target_status is null or target_status not in ('pending','approved','rejected','suspended','expired')
     or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='valid driver identity, vehicle, product, litre capacity, qualification status and idempotency key are required';
  end if;

  select * into existing_event
  from public.fuel_driver_qualification_events
  where idempotency_key=target_idempotency_key;

  if found then
    return existing_event.qualification_id;
  end if;

  if target_driver_profile_id is not null then
    select * into profile_record
    from public.driver_profiles
    where id=target_driver_profile_id and user_id=target_driver_user_id;

    if not found or profile_record.verification_status<>'approved'
       or profile_record.operational_status in ('suspended','inactive','archived') then
      raise exception using errcode='23514',message='The selected driver profile must be approved and active';
    end if;

    if target_fulfillment_mode='independent_driver' then
      if not exists (
        select 1 from public.driver_program_memberships membership
        where membership.driver_profile_id=target_driver_profile_id
          and membership.program_key='driver.independent'
          and membership.status='active'
          and membership.starts_at<=timezone('utc',now())
          and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))
      ) or exists (
        select 1 from public.vehicles vehicle
        where vehicle.id=target_vehicle_id and vehicle.platform_owned is true
      ) then
        raise exception using errcode='23514',message='Independent delivery requires an active Independent Driver membership and a non-SKIMA vehicle';
      end if;
    elsif target_fulfillment_mode='skima_managed' then
      if not exists (
        select 1 from public.driver_program_memberships membership
        where membership.driver_profile_id=target_driver_profile_id
          and membership.program_key=coalesce(
            public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key',
            'driver.skima_special'
          )
          and membership.status='active'
          and membership.starts_at<=timezone('utc',now())
          and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))
      ) or not exists (
        select 1
        from public.driver_vehicle_links link
        join public.vehicles vehicle on vehicle.id=link.vehicle_id
        where link.driver_profile_id=target_driver_profile_id
          and link.vehicle_id=target_vehicle_id
          and link.status='active'
          and link.relationship_type='fleet_owned'
          and link.starts_at<=timezone('utc',now())
          and (link.ends_at is null or link.ends_at>timezone('utc',now()))
          and vehicle.platform_owned is true
      ) then
        raise exception using errcode='23514',message='SKIMA Managed delivery requires an active SKIMA Managed membership and an assigned SKIMA fleet vehicle';
      end if;
    end if;

    if not exists (
      select 1 from public.driver_vehicle_links link
      where link.driver_profile_id=target_driver_profile_id
        and link.vehicle_id=target_vehicle_id
        and link.status='active'
        and link.starts_at<=timezone('utc',now())
        and (link.ends_at is null or link.ends_at>timezone('utc',now()))
    ) then
      raise exception using errcode='23514',message='Fuel vehicle must be actively linked to the independent driver';
    end if;
  else
    select * into station_driver_record
    from public.lpg_station_managed_drivers
    where id=target_station_managed_driver_id
      and user_id=target_driver_user_id
      and status='active';

    if not found or target_branch_id is null or station_driver_record.station_branch_id<>target_branch_id then
      raise exception using errcode='23514',message='Station-managed driver must be active at the selected station branch';
    end if;
  end if;

  if target_branch_id is not null then
    select * into branch_record
    from public.organization_branches
    where id=target_branch_id and status='active';
    if not found then
      raise exception using errcode='23514',message='Fuel qualification branch must be active';
    end if;
  end if;

  select * into vehicle_record
  from public.vehicles
  where id=target_vehicle_id
    and status in ('active','available')
    and (insurance_expires_at is null or insurance_expires_at>=current_date)
    and (inspection_expires_at is null or inspection_expires_at>=current_date)
    and (roadworthiness_expires_at is null or roadworthiness_expires_at>=current_date);

  if not found then
    raise exception using errcode='23514',message='Fuel qualification requires an active serviceable vehicle; any configured insurance, inspection and roadworthiness dates must be current';
  end if;

  if target_fulfillment_mode='station_managed' and (
       target_branch_id is null
       or branch_record.id is null
       or vehicle_record.organization_id is distinct from branch_record.organization_id
       or vehicle_record.platform_owned is true
     ) then
    raise exception using errcode='23514',message='Station Managed delivery requires a non-SKIMA vehicle owned by the selected station branch organization';
  end if;

  if target_branch_id is not null
     and vehicle_record.organization_id is distinct from branch_record.organization_id
     and vehicle_record.owner_user_id is distinct from target_driver_user_id
     and vehicle_record.platform_owned is not true then
    raise exception using errcode='23514',message='The selected vehicle is not authorized for this station or driver';
  end if;

  select * into qualification_record
  from public.fuel_driver_product_qualifications
  where driver_user_id=target_driver_user_id
    and vehicle_id=target_vehicle_id
    and product_key=target_product_key
    and branch_id is not distinct from target_branch_id
  for update;

  if found then
    before_value:=to_jsonb(qualification_record);
  end if;

  insert into public.fuel_driver_product_qualifications(
    driver_user_id,driver_profile_id,station_managed_driver_id,branch_id,vehicle_id,
    product_key,fulfillment_mode,maximum_load_litres,status,approved_by,approved_at,valid_until,
    source,idempotency_key,metadata,created_by
  )
  values(
    target_driver_user_id,target_driver_profile_id,target_station_managed_driver_id,target_branch_id,target_vehicle_id,
    target_product_key,target_fulfillment_mode,target_maximum_load_litres,target_status,
    case when target_status='approved' then auth.uid() else null end,
    case when target_status='approved' then timezone('utc',now()) else null end,
    target_valid_until,'platform.fuel.driver_qualification',target_idempotency_key,target_metadata,auth.uid()
  )
  on conflict on constraint fuel_driver_product_qualification_identity_unique do update
  set driver_profile_id=excluded.driver_profile_id,
      station_managed_driver_id=excluded.station_managed_driver_id,
      fulfillment_mode=excluded.fulfillment_mode,
      maximum_load_litres=excluded.maximum_load_litres,
      status=excluded.status,
      approved_by=excluded.approved_by,
      approved_at=excluded.approved_at,
      valid_until=excluded.valid_until,
      idempotency_key=excluded.idempotency_key,
      metadata=public.fuel_driver_product_qualifications.metadata||excluded.metadata,
      updated_at=timezone('utc',now())
  returning * into qualification_record;

  qualification_id:=qualification_record.id;
  event_key:=case
    when before_value='{}'::jsonb then 'created'
    when target_status='approved' then 'approved'
    when target_status='rejected' then 'rejected'
    when target_status='suspended' then 'suspended'
    when target_status='expired' then 'revoked'
    else 'updated'
  end;

  insert into public.fuel_driver_qualification_events(
    qualification_id,event_key,before_snapshot,after_snapshot,idempotency_key
  )
  values(
    qualification_id,event_key,before_value,to_jsonb(qualification_record),target_idempotency_key||':event'
  );

  return qualification_id;
end;
$$;

revoke all on function public.configure_fuel_driver_product_qualification(uuid,uuid,uuid,uuid,uuid,text,numeric,text,timestamptz,text,jsonb) from public,anon,authenticated;
revoke all on function public.configure_fuel_driver_product_qualification_mode(uuid,uuid,uuid,text,uuid,uuid,text,numeric,text,timestamptz,text,jsonb) from public,anon,authenticated;
grant execute on function public.configure_fuel_driver_product_qualification_mode(uuid,uuid,uuid,text,uuid,uuid,text,numeric,text,timestamptz,text,jsonb) to service_role;

create or replace function public.require_fuel_driver_product_qualification(target_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.order_records%rowtype;
  operation_record public.fuel_order_operations%rowtype;
  assignment_record public.order_assignments%rowtype;
  qualification_record public.fuel_driver_product_qualifications%rowtype;
  driver_user_id_value uuid;
  vehicle_id_value uuid;
  vehicle_record public.vehicles%rowtype;
  delivery_location_record public.lpg_customer_locations%rowtype;
  coverage_result jsonb;
  coverage_entity_id uuid;
begin
  select * into order_record from public.order_records where id=target_order_id;
  select * into operation_record from public.fuel_order_operations where order_id=target_order_id;

  if not found then
    raise exception using errcode='P0002',message='Fuel order operational record was not found';
  end if;

  select * into assignment_record
  from public.order_assignments
  where order_id=target_order_id
    and participant_role='driver'
    and status='active'
  order by assigned_at desc
  limit 1;

  if not found then
    raise exception using errcode='23514',message='An active driver assignment is required';
  end if;

  if assignment_record.entity_type='user' then
    driver_user_id_value:=assignment_record.entity_id;
  elsif assignment_record.entity_type='driver' then
    select user_id into driver_user_id_value
    from public.driver_profiles
    where id=assignment_record.entity_id;
    if driver_user_id_value is null then
      select user_id into driver_user_id_value
      from public.lpg_station_managed_drivers
      where id=assignment_record.entity_id;
    end if;
  else
    raise exception using errcode='23514',message='Fuel order driver assignment must reference a driver profile or user identity';
  end if;

  vehicle_id_value:=coalesce(
    nullif(assignment_record.metadata->>'vehicle_id','')::uuid,
    nullif(assignment_record.metadata->>'vehicleId','')::uuid,
    nullif(assignment_record.metadata->'dispatch'->>'vehicle_id','')::uuid
  );

  coverage_entity_id:=case
    when assignment_record.entity_type='driver' then assignment_record.entity_id
    else null
  end;

  if driver_user_id_value is null or vehicle_id_value is null then
    raise exception using errcode='23514',message='Fuel driver assignment must include a resolvable driver and an assigned vehicle';
  end if;

  select * into qualification_record
  from public.fuel_driver_product_qualifications
  where driver_user_id=driver_user_id_value
    and vehicle_id=vehicle_id_value
    and product_key=operation_record.product_key
    and fulfillment_mode=operation_record.fulfillment_mode
    and status='approved'
    and (branch_id is null or branch_id=operation_record.station_branch_id)
    and (valid_until is null or valid_until>timezone('utc',now()))
    and maximum_load_litres>=operation_record.requested_litres
  order by (branch_id is not null) desc,approved_at desc
  limit 1;

  if not found then
    raise exception using errcode='23514',message='Assigned driver and vehicle are not approved for this exact Fuel fulfilment mode, product and ordered litre capacity';
  end if;

  select * into vehicle_record
  from public.vehicles
  where id=vehicle_id_value
    and status in ('active','available')
    and (insurance_expires_at is null or insurance_expires_at>=current_date)
    and (inspection_expires_at is null or inspection_expires_at>=current_date)
    and (roadworthiness_expires_at is null or roadworthiness_expires_at>=current_date);

  if not found then
    raise exception using errcode='23514',message='Assigned fuel vehicle is not active or its compliance documents have expired';
  end if;

  select * into delivery_location_record
  from public.lpg_customer_locations
  where id=nullif(order_record.order_payload->>'delivery_location_id','')::uuid
    and owner_user_id=operation_record.customer_user_id
    and status='active';

  if not found then
    raise exception using errcode='23514',message='Fuel order delivery location is no longer active or available to its customer';
  end if;

  coverage_result:=public.resolve_operational_coverage_eligibility(
    'DRIVER',
    case when qualification_record.driver_profile_id is not null
      then qualification_record.driver_profile_id
      else qualification_record.station_managed_driver_id end,
    'fuel',
    delivery_location_record.longitude::double precision,
    delivery_location_record.latitude::double precision,
    timezone('utc',now())
  );

  if coalesce((coverage_result->>'eligible')::boolean,false) is not true then
    raise exception using errcode='23514',message='Assigned driver does not have approved Fuel service coverage for this delivery address';
  end if;

  if operation_record.fulfillment_mode='station_managed' then
    if qualification_record.station_managed_driver_id is null
       or not exists (
         select 1 from public.lpg_station_managed_drivers driver
         where driver.id=qualification_record.station_managed_driver_id
           and driver.user_id=driver_user_id_value
           and driver.station_branch_id=operation_record.station_branch_id
           and driver.status='active'
       ) then
      raise exception using errcode='23514',message='Station Managed Fuel orders require an approved driver assigned to this station';
    end if;
    if not exists (
      select 1
      from public.organization_branches branch
      join public.vehicles vehicle
        on vehicle.id=vehicle_id_value
       and vehicle.organization_id=branch.organization_id
       and vehicle.platform_owned is not true
      where branch.id=operation_record.station_branch_id
    ) then
      raise exception using errcode='23514',message='Station Managed dispatch requires a vehicle owned by the same station branch organization';
    end if;
  elsif operation_record.fulfillment_mode in ('independent_driver','skima_managed') then
    if qualification_record.driver_profile_id is null
       or not exists (
         select 1 from public.driver_profiles driver
         where driver.id=qualification_record.driver_profile_id
           and driver.user_id=driver_user_id_value
           and driver.verification_status='approved'
           and driver.operational_status not in ('suspended','inactive','archived')
       ) then
      raise exception using errcode='23514',message='Fuel driver profile is not approved for this product and vehicle';
    end if;
    if operation_record.fulfillment_mode='independent_driver' and (
      not exists (
        select 1 from public.driver_program_memberships membership
        where membership.driver_profile_id=qualification_record.driver_profile_id
          and membership.program_key='driver.independent'
          and membership.status='active'
          and membership.starts_at<=timezone('utc',now())
          and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))
      ) or vehicle_record.platform_owned is true
    ) then
      raise exception using errcode='23514',message='Independent delivery must use an active Independent Driver membership and a non-SKIMA vehicle';
    end if;
    if operation_record.fulfillment_mode='skima_managed' and (
      not exists (
        select 1 from public.driver_program_memberships membership
        where membership.driver_profile_id=qualification_record.driver_profile_id
          and membership.program_key=coalesce(
            public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key',
            'driver.skima_special'
          )
          and membership.status='active'
          and membership.starts_at<=timezone('utc',now())
          and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))
      ) or vehicle_record.platform_owned is not true
    ) then
      raise exception using errcode='23514',message='SKIMA Managed delivery must use an active SKIMA Managed Driver membership and SKIMA-owned fleet vehicle';
    end if;
    if not exists (
      select 1 from public.driver_vehicle_links link
      where link.driver_profile_id=qualification_record.driver_profile_id
        and link.vehicle_id=vehicle_id_value
        and link.status='active'
        and link.starts_at<=timezone('utc',now())
        and (link.ends_at is null or link.ends_at>timezone('utc',now()))
        and (
          (operation_record.fulfillment_mode='skima_managed' and link.relationship_type='fleet_owned')
          or (operation_record.fulfillment_mode='independent_driver' and link.relationship_type<>'fleet_owned')
        )
    ) then
      raise exception using errcode='23514',message='Assigned vehicle is not linked for the selected driver fulfilment mode';
    end if;
  else
    raise exception using errcode='23514',message='Fuel fulfilment mode is not recognized';
  end if;
end;
$$;

create or replace function public.assign_fuel_order_driver(
  target_order_id uuid,
  target_driver_entity_type text,
  target_driver_entity_id uuid,
  target_vehicle_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.order_records%rowtype;
  operation_record public.fuel_order_operations%rowtype;
  qualification_record public.fuel_driver_product_qualifications%rowtype;
  driver_user_id_value uuid;
  assignment_id uuid;
  driver_profile_id_value uuid;
  station_managed_driver_id_value uuid;
  assignment_metadata jsonb;
  existing_assignment public.order_assignments%rowtype;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='Fuel driver assignment must be performed by the authorized SKIMA dispatch runtime';
  end if;

  if target_order_id is null
     or target_driver_entity_type is null or target_driver_entity_type<>'driver'
     or target_driver_entity_id is null
     or target_vehicle_id is null
     or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='Fuel order, driver identity, vehicle, idempotency key and object metadata are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(target_order_id::text,0));

  select * into order_record
  from public.order_records
  where id=target_order_id
  for update;

  if not found or not exists(
    select 1 from public.business_modules module
    where module.id=order_record.module_id and module.key='fuel'
  ) then
    raise exception using errcode='23514',message='Driver assignment requires an existing Fuel order';
  end if;

  select * into operation_record
  from public.fuel_order_operations
  where order_id=target_order_id
  for update;

  if not found or operation_record.stage_key<>'ready_for_driver' then
    raise exception using errcode='55000',message='Fuel order must be fully filled and ready for driver assignment';
  end if;

  select * into qualification_record
  from public.fuel_driver_product_qualifications
  where vehicle_id=target_vehicle_id
    and product_key=operation_record.product_key
    and fulfillment_mode=operation_record.fulfillment_mode
    and status='approved'
    and maximum_load_litres>=operation_record.requested_litres
    and (valid_until is null or valid_until>timezone('utc',now()))
    and (branch_id is null or branch_id=operation_record.station_branch_id)
    and (
      (operation_record.fulfillment_mode='station_managed'
        and station_managed_driver_id=target_driver_entity_id
        and driver_profile_id is null)
      or (operation_record.fulfillment_mode in ('independent_driver','skima_managed')
        and driver_profile_id=target_driver_entity_id
        and station_managed_driver_id is null)
    )
  order by (branch_id is not null) desc,approved_at desc
  limit 1
  for update;

  if not found then
    raise exception using errcode='23514',message='Driver and vehicle are not approved for this Fuel product, branch and litre capacity';
  end if;

  driver_user_id_value:=qualification_record.driver_user_id;
  driver_profile_id_value:=qualification_record.driver_profile_id;
  station_managed_driver_id_value:=qualification_record.station_managed_driver_id;

  if operation_record.fulfillment_mode='station_managed' then
    if station_managed_driver_id_value is null
       or not exists (
         select 1 from public.lpg_station_managed_drivers driver
         where driver.id=station_managed_driver_id_value
           and driver.user_id=driver_user_id_value
           and driver.station_branch_id=operation_record.station_branch_id
           and driver.status='active'
       ) then
      raise exception using errcode='23514',message='Station Managed orders require an active approved driver assigned to this station';
    end if;
    if not exists (
      select 1
      from public.organization_branches branch
      join public.vehicles vehicle
        on vehicle.id=target_vehicle_id
       and vehicle.organization_id=branch.organization_id
       and vehicle.platform_owned is not true
      where branch.id=operation_record.station_branch_id
    ) then
      raise exception using errcode='23514',message='Station Managed dispatch requires a vehicle owned by the same station branch organization';
    end if;
  else
    if driver_profile_id_value is null
       or not exists (
         select 1 from public.driver_profiles driver
         where driver.id=driver_profile_id_value
           and driver.user_id=driver_user_id_value
           and driver.verification_status='approved'
           and driver.operational_status not in ('suspended','inactive','archived')
       )
       or (
         operation_record.fulfillment_mode='independent_driver'
         and (
           not exists (
             select 1 from public.driver_program_memberships membership
             where membership.driver_profile_id=driver_profile_id_value
               and membership.program_key='driver.independent'
               and membership.status='active'
               and membership.starts_at<=timezone('utc',now())
               and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))
           )
           or exists (select 1 from public.vehicles vehicle where vehicle.id=target_vehicle_id and vehicle.platform_owned is true)
         )
       )
       or (
         operation_record.fulfillment_mode='skima_managed'
         and (
           not exists (
             select 1 from public.driver_program_memberships membership
             where membership.driver_profile_id=driver_profile_id_value
               and membership.program_key=coalesce(
                 public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key',
                 'driver.skima_special'
               )
               and membership.status='active'
               and membership.starts_at<=timezone('utc',now())
               and (membership.ends_at is null or membership.ends_at>timezone('utc',now()))
           )
           or not exists (
             select 1 from public.driver_vehicle_links link
             join public.vehicles vehicle on vehicle.id=link.vehicle_id
             where link.driver_profile_id=driver_profile_id_value
               and link.vehicle_id=target_vehicle_id
               and link.status='active'
               and link.relationship_type='fleet_owned'
               and vehicle.platform_owned is true
               and link.starts_at<=timezone('utc',now())
               and (link.ends_at is null or link.ends_at>timezone('utc',now()))
           )
         )
       )
       or not exists (
         select 1 from public.driver_vehicle_links link
         where link.driver_profile_id=driver_profile_id_value
           and link.vehicle_id=target_vehicle_id
           and link.status='active'
           and link.starts_at<=timezone('utc',now())
           and (link.ends_at is null or link.ends_at>timezone('utc',now()))
           and (
             (operation_record.fulfillment_mode='skima_managed' and link.relationship_type='fleet_owned')
             or (operation_record.fulfillment_mode='independent_driver' and link.relationship_type<>'fleet_owned')
           )
       ) then
      raise exception using errcode='23514',message='Driver profile, participation type and vehicle ownership must match the ordered Fuel fulfilment mode';
    end if;
  end if;

  if not exists (
    select 1 from public.vehicles vehicle
    where vehicle.id=target_vehicle_id
      and vehicle.status in ('active','available')
      and (vehicle.insurance_expires_at is null or vehicle.insurance_expires_at>=current_date)
      and (vehicle.inspection_expires_at is null or vehicle.inspection_expires_at>=current_date)
      and (vehicle.roadworthiness_expires_at is null or vehicle.roadworthiness_expires_at>=current_date)
  ) then
    raise exception using errcode='23514',message='Selected Fuel delivery vehicle is no longer active and compliant';
  end if;

  assignment_metadata:=coalesce(target_metadata,'{}'::jsonb)||jsonb_build_object(
    'vehicle_id',target_vehicle_id,
    'fuel_qualification_id',qualification_record.id,
    'fuel_product_key',operation_record.product_key,
    'maximum_load_litres',qualification_record.maximum_load_litres,
    'driver_user_id',driver_user_id_value,
    'fulfillment_mode',operation_record.fulfillment_mode
  );

  select * into existing_assignment
  from public.order_assignments
  where source='platform.fuel.dispatch'
    and idempotency_key=target_idempotency_key||':assignment';

  if found then
    if existing_assignment.order_id<>target_order_id
       or existing_assignment.entity_type<>'driver'
       or existing_assignment.entity_id<>target_driver_entity_id
       or existing_assignment.metadata->>'vehicle_id' is distinct from target_vehicle_id::text then
      raise exception using errcode='23505',message='Fuel dispatch idempotency key was reused with different assignment details';
    end if;
    assignment_id:=existing_assignment.id;
  else
    assignment_id:=public.assign_order_participant(
      target_order_id,
      'driver',
      'driver',
      target_driver_entity_id,
      'platform.fuel.dispatch',
      target_idempotency_key||':assignment',
      assignment_metadata
    );
  end if;

  perform public.record_fuel_order_stage(
    target_order_id,
    'driver_assigned',
    target_idempotency_key||':stage',
    'Qualified Fuel driver and vehicle assigned',
    assignment_metadata||jsonb_build_object('assignment_id',assignment_id)
  );

  return assignment_id;
end;
$$;
revoke all on function public.assign_fuel_order_driver(uuid,text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.assign_fuel_order_driver(uuid,text,uuid,uuid,text,jsonb) to service_role;

create or replace function public.create_fuel_commercial_quote(
  target_order_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.order_records%rowtype;
  request_record public.service_requests%rowtype;
  operation_record public.fuel_order_operations%rowtype;
  offer_record public.fuel_branch_product_offers%rowtype;
  policy_record public.pricing_policies%rowtype;
  currency_record public.currency_definitions%rowtype;
  item_record public.catalog_items%rowtype;
  variant_record public.catalog_item_variants%rowtype;
  snapshot_record public.fuel_order_commercial_snapshots%rowtype;
  generic_quote_id uuid;
  snapshot_id uuid;
  item_count integer;
  line_total numeric(28,8);
  fuel_amount numeric(20,8);
  container_amount numeric(20,8);
  driver_amount numeric(20,8);
  platform_fee_amount numeric(20,8);
  tax_amount numeric(20,8);
  refundable_deposit_amount numeric(20,8);
  admin_fee_policy_key text;
  admin_fee_policy jsonb;
  admin_fee_per_litre numeric(20,8):=0;
  admin_product_fee_amount numeric(20,8):=0;
  resolved_subtotal_amount numeric(28,8);
  grand_total numeric(28,8);
  taxable_base numeric(28,8);
  currency_decimals integer;
  now_value timestamptz:=timezone('utc',now());
  component_snapshot jsonb;
  quote_context jsonb;
begin
  if target_order_id is null or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='Fuel order ID, idempotency key and object metadata are required';
  end if;

  select * into order_record
  from public.order_records
  where id=target_order_id
  for update;

  if not found then
    raise exception using errcode='P0002',message='Fuel order was not found';
  end if;

  if not exists(
    select 1 from public.business_modules module
    where module.id=order_record.module_id and module.key='fuel'
  ) then
    raise exception using errcode='23514',message='Commercial quote can only be created for a Fuel order';
  end if;

  if auth.role()<>'service_role' and order_record.requester_user_id is distinct from auth.uid() then
    raise exception using errcode='42501',message='Only the customer who created this Fuel order can request its quote';
  end if;

  select * into snapshot_record
  from public.fuel_order_commercial_snapshots
  where service_request_id=order_record.service_request_id
  for update;

  if found then
    if snapshot_record.order_id<>target_order_id
       or snapshot_record.idempotency_key<>target_idempotency_key then
      raise exception using errcode='23505',message='A commercial quote already exists for this Fuel order; create a new order to request a new quote';
    end if;
    return snapshot_record.generic_price_quote_id;
  end if;

  select * into request_record
  from public.service_requests
  where id=order_record.service_request_id
  for update;

  select * into operation_record
  from public.fuel_order_operations
  where order_id=target_order_id
  for update;

  if not found then
    raise exception using errcode='P0002',message='Fuel order operations record was not found';
  end if;

  if operation_record.stage_key<>'awaiting_station_acceptance' then
    raise exception using errcode='55000',message='A commercial quote can only be created before station fulfilment begins';
  end if;

  select * into offer_record
  from public.fuel_branch_product_offers
  where branch_id=operation_record.station_branch_id
    and product_key=operation_record.product_key
    and currency_code=order_record.currency_code
    and status='active'
    and effective_from<=now_value
    and (effective_until is null or effective_until>now_value)
  for share;

  if not found
     or operation_record.requested_litres<offer_record.minimum_litres
     or operation_record.requested_litres>offer_record.maximum_litres
     or not operation_record.fulfillment_mode=any(offer_record.fulfillment_modes) then
    raise exception using errcode='55000',message='The station fuel offer is not currently valid for this order';
  end if;

  select currency.decimal_places into currency_decimals
  from public.currency_definitions currency
  where currency.code=order_record.currency_code and currency.status='enabled';

  if not found then
    raise exception using errcode='23514',message='Fuel order currency is no longer enabled';
  end if;

  select policy.* into policy_record
  from public.pricing_policies policy
  where policy.key='pricing.fuel.commercial-snapshot.v1'
    and policy.status='active'
  order by policy.version desc
  limit 1;

  if not found then
    raise exception using errcode='55000',message='Fuel commercial pricing policy is not active';
  end if;

  select count(*),coalesce(sum(line.line_amount),0)
  into item_count,line_total
  from public.order_line_items line
  where line.order_id=target_order_id;

  if item_count<>1 then
    raise exception using errcode='23514',message='Fuel order must contain exactly one litre-priced catalogue line';
  end if;

  select item.* into item_record
  from public.order_line_items line
  join public.catalog_items item on item.id=line.item_id
  where line.order_id=target_order_id
    and line.item_id=offer_record.catalog_item_id
    and line.variant_id=offer_record.catalog_variant_id
    and abs(line.quantity-operation_record.requested_litres)<0.001;

  if not found then
    raise exception using errcode='23514',message='Fuel order catalogue line must match the selected branch product and requested litres';
  end if;

  select variant.* into variant_record
  from public.catalog_item_variants variant
  where variant.id=offer_record.catalog_variant_id
    and variant.item_id=offer_record.catalog_item_id
    and variant.unit_id in (
      select unit.id from public.catalog_units unit
      where unit.organization_id=offer_record.organization_id and unit.symbol='L'
    );

  if not found then
    raise exception using errcode='23514',message='Fuel catalogue variant must use the canonical litre unit';
  end if;

  if abs(line_total-(operation_record.requested_litres*offer_record.price_per_litre))>0.01 then
    raise exception using errcode='23514',message='Fuel catalogue line total does not match the current branch price per litre';
  end if;

  fuel_amount:=round(operation_record.requested_litres*offer_record.price_per_litre,currency_decimals);
  container_amount:=round(
    (case when operation_record.container_mode='purchase'
      then offer_record.container_purchase_amount
      else offer_record.container_rental_amount end)*operation_record.container_count,
    currency_decimals
  );
  driver_amount:=round(offer_record.driver_delivery_fee_amount,currency_decimals);
  admin_fee_policy_key:=case operation_record.product_key
    when 'fuel.pms' then 'pricing.fuel.pms.platform_fee_per_litre'
    when 'fuel.ago' then 'pricing.fuel.ago.platform_fee_per_litre'
    when 'fuel.dpk' then 'pricing.fuel.dpk.platform_fee_per_litre'
    else null
  end;
  if admin_fee_policy_key is null then
    raise exception using errcode='23514',message='A product-specific Fuel platform fee policy is required';
  end if;
  admin_fee_policy:=public.resolve_financial_policy(
    admin_fee_policy_key,
    order_record.currency_code,
    now_value,
    'fuel',
    null,
    'fuel.order',
    'global',
    null
  );
  admin_fee_per_litre:=coalesce(nullif(admin_fee_policy->'configuration'->>'amount_per_litre','')::numeric,0);
  if admin_fee_per_litre<0 then
    raise exception using errcode='23514',message='Fuel product platform fee cannot be negative';
  end if;
  admin_product_fee_amount:=round(operation_record.requested_litres*admin_fee_per_litre,currency_decimals);
  platform_fee_amount:=round(offer_record.platform_fee_amount+admin_product_fee_amount,currency_decimals);
  refundable_deposit_amount:=case when operation_record.container_mode='rental'
    then round(offer_record.refundable_deposit_amount*operation_record.container_count,currency_decimals)
    else 0 end;
  taxable_base:=fuel_amount+container_amount+driver_amount+platform_fee_amount;
  tax_amount:=round(taxable_base*offer_record.tax_rate_percent/100,currency_decimals);
  resolved_subtotal_amount:=fuel_amount+container_amount+driver_amount+refundable_deposit_amount;
  grand_total:=resolved_subtotal_amount+platform_fee_amount+tax_amount;

  if grand_total<=0 then
    raise exception using errcode='23514',message='Fuel commercial quote must have a positive total';
  end if;

  component_snapshot:=jsonb_build_object(
    'product_key',operation_record.product_key,
    'unit','L',
    'requested_litres',operation_record.requested_litres,
    'fuel_unit_price',offer_record.price_per_litre,
    'fuel_amount',fuel_amount,
    'container_mode',operation_record.container_mode,
    'container_type_key',(select type.key from public.fuel_container_types type where type.id=operation_record.container_type_id),
    'container_capacity_litres',(select type.nominal_capacity_litres from public.fuel_container_types type where type.id=operation_record.container_type_id),
    'container_count',operation_record.container_count,
    'container_amount',container_amount,
    'driver_delivery_fee_amount',driver_amount,
    'platform_fee_amount',platform_fee_amount,
    'admin_product_fee_per_litre',admin_fee_per_litre,
    'admin_product_fee_amount',admin_product_fee_amount,
    'admin_product_fee_policy_key',admin_fee_policy_key,
    'admin_product_fee_policy_version_id',admin_fee_policy->'policyVersionId',
    'tax_rate_percent',offer_record.tax_rate_percent,
    'taxable_base',taxable_base,
    'tax_amount',tax_amount,
    'refundable_deposit_amount',refundable_deposit_amount,
    'deposit_treatment',case when operation_record.container_mode='rental' then 'refundable_liability' else 'not_applicable' end,
    'fulfillment_mode',operation_record.fulfillment_mode,
    'currency_code',order_record.currency_code,
    'currency_decimal_places',currency_decimals,
    'offer_id',offer_record.id,
    'pricing_policy_id',policy_record.id,
    'quoted_at',now_value
  );

  quote_context:=jsonb_build_object(
    'module_key','fuel',
    'order_id',target_order_id,
    'fuel_product_key',operation_record.product_key,
    'requested_litres',operation_record.requested_litres,
    'container_mode',operation_record.container_mode,
    'container_count',operation_record.container_count,
    'fulfillment_mode',operation_record.fulfillment_mode,
    'server_calculated',true
  );

  insert into public.price_quotes(
    service_request_id,pricing_policy_id,module_id,currency_code,status,
    subtotal_amount,fee_amount,discount_amount,tax_amount,total_amount,
    pricing_context,calculation_breakdown,expires_at,source,idempotency_key,created_by
  )
  values(
    order_record.service_request_id,policy_record.id,order_record.module_id,order_record.currency_code,
    'calculated',resolved_subtotal_amount,platform_fee_amount,0,tax_amount,grand_total,
    quote_context,component_snapshot,now_value+interval '15 minutes',
    'platform.fuel_pricing',target_idempotency_key||':generic-price-quote',auth.uid()
  )
  returning id into generic_quote_id;

  insert into public.fuel_order_commercial_snapshots(
    service_request_id,order_id,generic_price_quote_id,product_key,requested_litres,container_mode,
    container_count,currency_code,fuel_unit_price,fuel_amount,container_amount,driver_amount,
    platform_fee_amount,tax_amount,refundable_deposit_amount,grand_total,component_snapshot,
    status,valid_until,idempotency_key,metadata
  )
  values(
    order_record.service_request_id,target_order_id,generic_quote_id,operation_record.product_key,
    operation_record.requested_litres,operation_record.container_mode,operation_record.container_count,
    order_record.currency_code,offer_record.price_per_litre,fuel_amount,container_amount,driver_amount,
    platform_fee_amount,tax_amount,refundable_deposit_amount,grand_total,component_snapshot,
    'quoted',now_value+interval '15 minutes',target_idempotency_key,target_metadata
  )
  returning id into snapshot_id;

  update public.order_records
  set subtotal_amount=resolved_subtotal_amount,
      fee_amount=platform_fee_amount,
      discount_amount=0,
      tax_amount=tax_amount,
      total_amount=grand_total,
      metadata=metadata||jsonb_build_object(
        'fuel_commercial_snapshot_id',snapshot_id,
        'fuel_component_snapshot',component_snapshot
      ),
      updated_at=timezone('utc',now())
  where id=target_order_id;

  update public.service_requests
  set request_payload=request_payload||jsonb_build_object(
        'fuel_commercial_snapshot_id',snapshot_id,
        'fuel_component_snapshot',component_snapshot
      ),
      updated_at=timezone('utc',now())
  where id=order_record.service_request_id;

  return generic_quote_id;
end;
$$;

revoke all on function public.create_fuel_commercial_quote(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_fuel_commercial_quote(uuid,text,jsonb) to service_role;

create or replace function public.confirm_fuel_customer_delivery(
  target_order_id uuid,
  target_actor_user_id uuid,
  target_measured_litres numeric,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_record public.fuel_order_operations%rowtype;
  assignment_record public.order_assignments%rowtype;
  allocation_record public.fuel_container_allocations%rowtype;
  driver_user_id_value uuid;
  delivered_litres numeric(16,3):=0;
  allocated_count integer:=0;
  result_event_id uuid;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='Fuel delivery confirmation must use the authenticated driver runtime';
  end if;
  if target_order_id is null or target_actor_user_id is null
     or target_measured_litres is null or target_measured_litres<=0
     or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='order, driver, measured litres, idempotency key and metadata are required';
  end if;

  select id into result_event_id
  from public.fuel_order_operation_events
  where idempotency_key=target_idempotency_key||':stage-delivered';
  if found then return result_event_id; end if;

  select * into operation_record
  from public.fuel_order_operations
  where order_id=target_order_id
  for update;
  if not found or operation_record.stage_key<>'out_for_delivery' then
    raise exception using errcode='55000',message='This Fuel order is not currently out for delivery';
  end if;

  select * into assignment_record
  from public.order_assignments
  where order_id=target_order_id
    and participant_role='driver'
    and status='active'
  order by assigned_at desc
  limit 1
  for update;
  if not found or assignment_record.entity_type<>'driver' then
    raise exception using errcode='23514',message='An active assigned Fuel driver is required';
  end if;

  if operation_record.fulfillment_mode='station_managed' then
    select user_id into driver_user_id_value
    from public.lpg_station_managed_drivers
    where id=assignment_record.entity_id and status='active'
      and station_branch_id=operation_record.station_branch_id;
  else
    select user_id into driver_user_id_value
    from public.driver_profiles
    where id=assignment_record.entity_id;
  end if;
  if driver_user_id_value is distinct from target_actor_user_id then
    raise exception using errcode='42501',message='Only the driver assigned to this Fuel order can confirm its delivery';
  end if;

  select count(*),coalesce(sum(allocation.filled_litres),0)
  into allocated_count,delivered_litres
  from public.fuel_container_allocations allocation
  where allocation.order_id=target_order_id
    and allocation.status='with_driver';
  if allocated_count<>operation_record.container_count
     or abs(delivered_litres-operation_record.requested_litres)>0.001
     or abs(target_measured_litres-delivered_litres)>0.001 then
    raise exception using errcode='23514',message='All filled containers must be with the assigned driver and their measured litres must match the accepted order';
  end if;

  for allocation_record in
    select * from public.fuel_container_allocations allocation
    where allocation.order_id=target_order_id and allocation.status='with_driver'
    order by allocation.created_at,allocation.id
    for update
  loop
    perform public.record_fuel_container_handover(
      allocation_record.id,
      'delivered_to_customer',
      'driver',
      assignment_record.entity_id,
      'customer',
      allocation_record.customer_user_id,
      target_actor_user_id,
      allocation_record.filled_litres,
      null,
      'Driver confirmed the complete Fuel order delivery to the customer',
      target_idempotency_key||':container:'||allocation_record.id::text,
      target_metadata||jsonb_build_object('order_level_delivery_confirmation',true)
    );
  end loop;

  perform public.record_fuel_order_stage(
    target_order_id,
    'delivered',
    target_idempotency_key||':stage-delivered',
    'Driver confirmed the complete customer delivery',
    target_metadata||jsonb_build_object('delivered_litres',delivered_litres)
  );

  if operation_record.container_mode='rental' then
    perform public.record_fuel_order_stage(
      target_order_id,
      'return_due',
      target_idempotency_key||':stage-return-due',
      'Rental containers must be returned by the customer to the assigned driver',
      target_metadata||jsonb_build_object('rental_container_return_required',true)
    );
  else
    perform public.record_fuel_order_stage(
      target_order_id,
      'completed',
      target_idempotency_key||':stage-completed',
      'Purchased containers delivered and ownership transferred',
      target_metadata||jsonb_build_object('driver_delivery_completed',true)
    );
  end if;

  select id into result_event_id
  from public.fuel_order_operation_events
  where idempotency_key=target_idempotency_key||':stage-delivered';
  return result_event_id;
end;
$$;

create or replace function public.confirm_fuel_rental_container_return(
  target_order_id uuid,
  target_actor_user_id uuid,
  target_action text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  operation_record public.fuel_order_operations%rowtype;
  assignment_record public.order_assignments%rowtype;
  allocation_record public.fuel_container_allocations%rowtype;
  driver_user_id_value uuid;
  current_allocation_status text;
  event_key_value text;
  next_stage text;
  from_holder_type text;
  to_holder_type text;
  to_holder_id uuid;
  result_event_id uuid;
  allocation_count integer:=0;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='Fuel rental return confirmation must use the authenticated driver runtime';
  end if;
  if target_order_id is null or target_actor_user_id is null
     or target_action is null or target_action not in ('customer_returned_to_driver','driver_returned_to_station')
     or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='order, driver, return action, idempotency key and metadata are required';
  end if;

  next_stage:=case when target_action='customer_returned_to_driver' then 'returned_to_driver' else 'received_at_station' end;
  select id into result_event_id
  from public.fuel_order_operation_events
  where idempotency_key=target_idempotency_key||':stage:'||next_stage;
  if found then return result_event_id; end if;

  select * into operation_record
  from public.fuel_order_operations
  where order_id=target_order_id
  for update;
  if not found or operation_record.container_mode<>'rental' then
    raise exception using errcode='55000',message='Only rental-container Fuel orders have a return workflow';
  end if;
  if (target_action='customer_returned_to_driver' and operation_record.stage_key<>'return_due')
     or (target_action='driver_returned_to_station' and operation_record.stage_key<>'returned_to_driver') then
    raise exception using errcode='55000',message='The Fuel rental order is not at the requested return stage';
  end if;

  select * into assignment_record
  from public.order_assignments
  where order_id=target_order_id and participant_role='driver' and status='active'
  order by assigned_at desc limit 1 for update;
  if not found or assignment_record.entity_type<>'driver' then
    raise exception using errcode='23514',message='An active assigned Fuel driver is required';
  end if;

  if operation_record.fulfillment_mode='station_managed' then
    select user_id into driver_user_id_value from public.lpg_station_managed_drivers
    where id=assignment_record.entity_id and status='active' and station_branch_id=operation_record.station_branch_id;
  else
    select user_id into driver_user_id_value from public.driver_profiles where id=assignment_record.entity_id;
  end if;
  if driver_user_id_value is distinct from target_actor_user_id then
    raise exception using errcode='42501',message='Only the assigned Fuel driver can confirm rental container return';
  end if;

  if target_action='customer_returned_to_driver' then
    current_allocation_status:='delivered';
    event_key_value:='returned_to_driver';
    from_holder_type:='customer';
    to_holder_type:='driver';
    to_holder_id:=assignment_record.entity_id;
  else
    current_allocation_status:='returned_to_driver';
    event_key_value:='received_at_station';
    from_holder_type:='driver';
    to_holder_type:='station';
    to_holder_id:=operation_record.station_branch_id;
  end if;

  select count(*) into allocation_count
  from public.fuel_container_allocations allocation
  where allocation.order_id=target_order_id and allocation.status=current_allocation_status;
  if allocation_count<>operation_record.container_count then
    raise exception using errcode='23514',message='Every rental container must be in the correct custody state before confirming this return';
  end if;

  for allocation_record in
    select * from public.fuel_container_allocations allocation
    where allocation.order_id=target_order_id and allocation.status=current_allocation_status
    order by allocation.created_at,allocation.id
    for update
  loop
    perform public.record_fuel_container_handover(
      allocation_record.id,
      event_key_value,
      from_holder_type,
      case when from_holder_type='customer' then allocation_record.customer_user_id else assignment_record.entity_id end,
      to_holder_type,
      to_holder_id,
      target_actor_user_id,
      null,
      null,
      case when target_action='customer_returned_to_driver'
        then 'Driver confirmed receipt of all rental containers returned by the customer'
        else 'Driver confirmed all rental containers were received back at the assigned station' end,
      target_idempotency_key||':container:'||allocation_record.id::text,
      target_metadata||jsonb_build_object('order_level_return_confirmation',true)
    );
  end loop;

  perform public.record_fuel_order_stage(
    target_order_id,
    next_stage,
    target_idempotency_key||':stage:'||next_stage,
    case when next_stage='returned_to_driver'
      then 'All rental containers returned by the customer to the assigned driver'
      else 'All rental containers returned by the driver to the assigned station' end,
    target_metadata
  );

  select id into result_event_id
  from public.fuel_order_operation_events
  where idempotency_key=target_idempotency_key||':stage:'||next_stage;
  return result_event_id;
end;
$$;

revoke all on function public.confirm_fuel_customer_delivery(uuid,uuid,numeric,text,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_fuel_customer_delivery(uuid,uuid,numeric,text,jsonb) to service_role;
revoke all on function public.confirm_fuel_rental_container_return(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.confirm_fuel_rental_container_return(uuid,uuid,text,text,jsonb) to service_role;

notify pgrst,'reload schema';
commit;