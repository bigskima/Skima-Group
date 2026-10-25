begin;

-- A Station Managed driver is not sufficient on its own. Every station branch
-- must explicitly register/assign an approved organization-owned LPG-capable
-- vehicle before it can receive customer orders.
create table if not exists public.lpg_station_managed_vehicles (
  id uuid primary key default gen_random_uuid(),
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  status text not null default 'active' check (status in ('active','suspended','removed')),
  assigned_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  change_reason text not null default 'Assigned to Station Managed delivery',
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  unique(station_branch_id, vehicle_id)
);

create unique index if not exists lpg_station_managed_vehicle_one_active_branch_idx
  on public.lpg_station_managed_vehicles(vehicle_id) where status='active';
create index if not exists lpg_station_managed_vehicles_branch_status_idx
  on public.lpg_station_managed_vehicles(station_branch_id,status,created_at desc);

alter table public.lpg_station_managed_vehicles enable row level security;
revoke all on public.lpg_station_managed_vehicles from public,anon,authenticated;
grant select,insert,update,delete on public.lpg_station_managed_vehicles to service_role;

-- Vehicle readiness mirrors SKIMA's existing module-specific vehicle compliance
-- contract: approved active vehicle, ownership by this station organisation,
-- active LPG transport capability and valid evidence for all required common/LPG
-- vehicle requirements. It does not treat a type/capacity label as safety approval.
create or replace function public.is_lpg_station_managed_vehicle_eligible(
  target_station_branch_id uuid,
  target_vehicle_id uuid,
  target_at date default current_date
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists (
    select 1
    from public.lpg_station_branches station
    join public.vehicles vehicle
      on vehicle.id=target_vehicle_id
     and vehicle.organization_id=station.organization_id
     and vehicle.status='active'
     and not coalesce(vehicle.platform_owned,false)
     and nullif(btrim(vehicle.registration_number),'') is not null
     and vehicle.max_load_kg is not null
     and vehicle.max_load_kg>0
     and (vehicle.insurance_expires_at is null or vehicle.insurance_expires_at>=target_at)
     and (vehicle.inspection_expires_at is null or vehicle.inspection_expires_at>=target_at)
     and (vehicle.roadworthiness_expires_at is null or vehicle.roadworthiness_expires_at>=target_at)
    join public.vehicle_types vehicle_type
      on vehicle_type.id=vehicle.vehicle_type_id
     and vehicle_type.status='active'
    where station.id=target_station_branch_id
      and station.approval_status='approved'
      and station.compliance_status='approved'
      and station.availability_status='available'
      and exists (
        select 1 from public.entity_capabilities capability
        where capability.entity_type='vehicle'
          and capability.entity_id=vehicle.id
          and capability.capability_key='vehicle.lpg-transport'
          and capability.status='active'
      )
      and not exists (
        select 1
        from public.compliance_requirement_definitions requirement
        where requirement.subject_type='vehicle'
          and requirement.status='active'
          and requirement.required
          and (requirement.module_key is null or requirement.module_key='lpg')
          and not exists (
            select 1 from public.compliance_evidence evidence
            where evidence.requirement_key=requirement.key
              and evidence.subject_type='vehicle'
              and evidence.subject_id=vehicle.id
              and evidence.status='valid'
              and (evidence.valid_from is null or evidence.valid_from<=target_at)
              and (evidence.valid_until is null or evidence.valid_until>=target_at)
          )
      )
      and not exists (
        select 1
        from public.compliance_requirement_definitions requirement
        where requirement.subject_type='vehicle'
          and requirement.status='active'
          and requirement.required
          and (requirement.module_key is null or requirement.module_key='lpg')
          and requirement.capability_key is not null
          and not exists (
            select 1 from public.entity_capabilities capability
            where capability.entity_type='vehicle'
              and capability.entity_id=vehicle.id
              and capability.capability_key=requirement.capability_key
              and capability.status='active'
          )
      )
  );
$$;

create or replace function public.read_lpg_station_managed_available_vehicles(
  target_station_branch_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare station_record public.lpg_station_branches%rowtype; result jsonb;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  if not public.can_operate_lpg_station_branch(target_station_branch_id,'lpg.stations.manage') then
    raise exception using errcode='42501',message='branch-scoped station management permission is required';
  end if;
  select * into station_record from public.lpg_station_branches where id=target_station_branch_id;
  if not found then raise exception using errcode='22023',message='station branch was not found'; end if;

  select jsonb_build_object(
    'assignedVehicles',coalesce((
      select jsonb_agg(jsonb_build_object(
        'assignmentId',assignment.id,
        'vehicleId',vehicle.id,
        'registrationNumber',vehicle.registration_number,
        'manufacturer',vehicle.manufacturer,
        'model',vehicle.model,
        'vehicleType',vehicle_type.display_name,
        'maxLoadKg',vehicle.max_load_kg,
        'status',assignment.status,
        'eligible',public.is_lpg_station_managed_vehicle_eligible(target_station_branch_id,vehicle.id,current_date),
        'updatedAt',assignment.updated_at,
        'changeReason',assignment.change_reason
      ) order by assignment.updated_at desc)
      from public.lpg_station_managed_vehicles assignment
      join public.vehicles vehicle on vehicle.id=assignment.vehicle_id
      left join public.vehicle_types vehicle_type on vehicle_type.id=vehicle.vehicle_type_id
      where assignment.station_branch_id=target_station_branch_id
        and assignment.status<>'removed'
    ),'[]'::jsonb),
    'availableVehicles',coalesce((
      select jsonb_agg(jsonb_build_object(
        'vehicleId',vehicle.id,
        'registrationNumber',vehicle.registration_number,
        'manufacturer',vehicle.manufacturer,
        'model',vehicle.model,
        'vehicleType',vehicle_type.display_name,
        'maxLoadKg',vehicle.max_load_kg
      ) order by vehicle.registration_number)
      from public.vehicles vehicle
      join public.vehicle_types vehicle_type on vehicle_type.id=vehicle.vehicle_type_id and vehicle_type.status='active'
      where vehicle.organization_id=station_record.organization_id
        and vehicle.status='active'
        and not coalesce(vehicle.platform_owned,false)
        and public.is_lpg_station_managed_vehicle_eligible(target_station_branch_id,vehicle.id,current_date)
        and not exists (
          select 1 from public.lpg_station_managed_vehicles assigned
          where assigned.vehicle_id=vehicle.id and assigned.status='active'
            and assigned.station_branch_id<>target_station_branch_id
        )
        and not exists (
          select 1 from public.lpg_station_managed_vehicles assigned
          where assigned.vehicle_id=vehicle.id and assigned.station_branch_id=target_station_branch_id
            and assigned.status='active'
        )
    ),'[]'::jsonb)
  ) into result;
  return result;
end
$$;

create or replace function public.configure_lpg_station_managed_vehicle(
  target_station_branch_id uuid,
  target_vehicle_id uuid,
  target_enabled boolean,
  target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare assignment public.lpg_station_managed_vehicles%rowtype;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  if not public.can_operate_lpg_station_branch(target_station_branch_id,'lpg.stations.manage') then
    raise exception using errcode='42501',message='branch-scoped station management permission is required';
  end if;
  if target_station_branch_id is null or target_vehicle_id is null
    or target_enabled is null
    or char_length(btrim(coalesce(target_reason,'')))<5
    or char_length(btrim(coalesce(target_reason,'')))>500 then
    raise exception using errcode='22023',message='station, vehicle, enabled state and a 5-500 character reason are required';
  end if;

  if target_enabled and not public.is_lpg_station_managed_vehicle_eligible(target_station_branch_id,target_vehicle_id,current_date) then
    raise exception using errcode='55000',message='vehicle must be active, owned by this station organisation, LPG-approved, compliant and have a verified positive load capacity';
  end if;
  if not target_enabled and exists(
    select 1
    from public.lpg_station_managed_driver_assignments assignment
    join public.lpg_refill_orders order_record on order_record.id=assignment.lpg_order_id
    where assignment.vehicle_id=target_vehicle_id
      and assignment.status in ('assigned','accepted','en_route')
      and order_record.status in ('pickup_verified','station_en_route')
  ) then
    raise exception using errcode='55000',message='vehicle cannot be removed while a station-managed order is carrying a cylinder; complete delivery or resolve the physical handover first';
  end if;

  if target_enabled then
    insert into public.lpg_station_managed_vehicles(
      station_branch_id,vehicle_id,status,assigned_by,change_reason,metadata
    ) values(
      target_station_branch_id,target_vehicle_id,'active',auth.uid(),btrim(target_reason),
      jsonb_build_object('source','station-managed-vehicle-settings')
    )
    on conflict(station_branch_id,vehicle_id) do update
      set status='active',assigned_by=auth.uid(),updated_at=timezone('utc',now()),
          change_reason=btrim(target_reason),
          metadata=public.lpg_station_managed_vehicles.metadata||jsonb_build_object('lastChangedBy',auth.uid(),'lastChangedAt',timezone('utc',now()))
    returning * into assignment;
  else
    update public.lpg_station_managed_vehicles
    set status='removed',assigned_by=auth.uid(),updated_at=timezone('utc',now()),
        change_reason=btrim(target_reason),
        metadata=metadata||jsonb_build_object('removedBy',auth.uid(),'removedAt',timezone('utc',now()))
    where station_branch_id=target_station_branch_id and vehicle_id=target_vehicle_id
    returning * into assignment;
    if not found then
      raise exception using errcode='P0002',message='assigned station vehicle was not found';
    end if;
  end if;

  if not target_enabled then
    with released_assignments as (
      update public.lpg_station_managed_driver_assignments
      set status='cancelled',completed_at=timezone('utc',now()),
          metadata=metadata||jsonb_build_object('vehicleRemovedAt',timezone('utc',now()),'vehicleRemovedReason',btrim(target_reason))
      where vehicle_id=target_vehicle_id and status in ('assigned','accepted','en_route')
      returning lpg_order_id
    )
    update public.lpg_refill_orders order_record
    set vehicle_id=null,
        status='matching_driver',
        assignment_status='unassigned',
        metadata=coalesce(order_record.metadata,'{}'::jsonb)||jsonb_build_object('stationManagedDispatch','waiting_for_station_vehicle','stationManagedVehicleRemovedAt',timezone('utc',now())),
        updated_at=timezone('utc',now())
    where order_record.id in (select lpg_order_id from released_assignments)
      and order_record.fulfillment_mode='station_managed'
      and order_record.status in ('payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_verified','station_en_route');
  end if;
  perform public.auto_dispatch_pending_station_orders_for_branch(target_station_branch_id);
  return public.read_lpg_station_managed_available_vehicles(target_station_branch_id);
end
$$;

alter table public.lpg_station_managed_driver_assignments
  add column if not exists vehicle_id uuid references public.vehicles(id) on delete restrict;

create unique index if not exists lpg_station_managed_assignments_active_vehicle_unique
  on public.lpg_station_managed_driver_assignments(vehicle_id)
  where vehicle_id is not null and status in ('assigned','accepted','en_route');

-- Revalidate candidate vehicles at the time an order is quoted as Station Managed,
-- not merely when the customer first loaded the options.
create or replace function public.read_lpg_station_managed_eligible_stations(
  target_pickup_location_id uuid,
  target_delivery_location_id uuid,
  target_cylinder_id uuid,
  target_requested_kg numeric,
  target_limit integer default 10,
  target_at timestamptz default timezone('utc',now())
)
returns table(
  station_branch_id uuid,display_name text,formatted_address text,latitude numeric,longitude numeric,
  service_radius_meters integer,pickup_distance_meters numeric,return_distance_meters numeric,
  route_proxy_distance_meters numeric,currency_code text,price_per_kg numeric,current_available_kg numeric,
  refill_capacity_kg numeric,supported_cylinder_sizes_kg numeric[],cylinder_size_kg numeric,
  station_managed_vehicle_id uuid,station_managed_vehicle_registration_number text,station_managed_vehicle_max_load_kg numeric
)
language plpgsql security definer
set search_path=public,extensions,pg_temp
as $$
declare
  actor_user_id uuid:=auth.uid();
  pickup_record public.lpg_customer_locations%rowtype;
  delivery_record public.lpg_customer_locations%rowtype;
  cylinder_record public.lpg_cylinders%rowtype;
  coverage_enabled boolean:=false;
begin
  if actor_user_id is null then raise exception using errcode='42501',message='authentication required'; end if;
  if target_requested_kg is null or target_requested_kg<=0 then raise exception using errcode='22023',message='target_requested_kg must be greater than zero'; end if;
  if target_limit is null or target_limit<1 or target_limit>50 then raise exception using errcode='22023',message='target_limit must be between 1 and 50'; end if;

  select * into pickup_record from public.lpg_customer_locations where id=target_pickup_location_id and owner_user_id=actor_user_id and status='active';
  if not found then raise exception using errcode='42501',message='pickup location is not available to this customer'; end if;
  select * into delivery_record from public.lpg_customer_locations where id=target_delivery_location_id and owner_user_id=actor_user_id and status='active';
  if not found then raise exception using errcode='42501',message='return location is not available to this customer'; end if;
  select * into cylinder_record from public.lpg_cylinders where id=target_cylinder_id and owner_user_id=actor_user_id and status<>'deactivated';
  if not found then raise exception using errcode='42501',message='cylinder is not available to this customer'; end if;
  if target_requested_kg>cylinder_record.max_capacity_kg then raise exception using errcode='22023',message='requested refill exceeds verified cylinder capacity'; end if;

  select coalesce(policy.outside_customer_coverage_enabled,false) into coverage_enabled
  from public.lpg_station_managed_coverage_policy policy where policy.singleton=true;
  if not coalesce(coverage_enabled,false) then return; end if;

  return query
  with candidate_stations as (
    select station.*,
      public.geo_distance_meters(station.latitude::double precision,station.longitude::double precision,pickup_record.latitude::double precision,pickup_record.longitude::double precision)::numeric pickup_distance,
      public.geo_distance_meters(station.latitude::double precision,station.longitude::double precision,delivery_record.latitude::double precision,delivery_record.longitude::double precision)::numeric return_distance
    from public.lpg_station_branches station
    join public.lpg_station_fulfillment_settings settings on settings.station_branch_id=station.id and settings.station_managed_enabled
    where station.approval_status='approved' and station.compliance_status='approved' and station.availability_status='available'
      and station.latitude is not null and station.longitude is not null
      and station.service_radius_meters is not null and station.service_radius_meters>0
      and coalesce(station.current_available_kg,0)>=target_requested_kg
      and coalesce(station.refill_capacity_kg,0)>=target_requested_kg
      and (coalesce(array_length(station.supported_cylinder_sizes_kg,1),0)=0 or cylinder_record.size_kg=any(station.supported_cylinder_sizes_kg))
      and exists(select 1 from public.lpg_station_managed_drivers driver where driver.station_branch_id=station.id and driver.status='active')
  ),
  covered_stations as (
    select station.* from candidate_stations station
    where greatest(station.pickup_distance,station.return_distance)<=station.service_radius_meters
  ),
  station_vehicles as (
    select station.id station_id,vehicle.id vehicle_id,vehicle.registration_number,vehicle.max_load_kg,
      row_number() over(partition by station.id order by
        (select count(*) from public.lpg_station_managed_driver_assignments active_assignment
         where active_assignment.vehicle_id=vehicle.id and active_assignment.status in ('assigned','accepted','en_route')),
        vehicle.created_at,vehicle.id) vehicle_rank
    from covered_stations station
    join public.lpg_station_managed_vehicles assigned
      on assigned.station_branch_id=station.id and assigned.status='active'
    join public.vehicles vehicle on vehicle.id=assigned.vehicle_id
    where vehicle.max_load_kg>=target_requested_kg
      and public.is_lpg_station_managed_vehicle_eligible(station.id,vehicle.id,target_at::date)
      and not exists(select 1 from public.lpg_station_managed_driver_assignments busy
        where busy.vehicle_id=vehicle.id and busy.status in ('assigned','accepted','en_route'))
  ),
  prices as (
    select distinct on(station.id)
      station.id station_id,station.display_name,station.formatted_address,station.latitude,station.longitude,
      station.service_radius_meters,station.pickup_distance,station.return_distance,
      station.current_available_kg,station.refill_capacity_kg,station.supported_cylinder_sizes_kg,
      settings.currency_code,catalog_price.amount price_per_kg,
      vehicle.vehicle_id,vehicle.registration_number,vehicle.max_load_kg
    from covered_stations station
    join station_vehicles vehicle on vehicle.station_id=station.id and vehicle.vehicle_rank=1
    join public.lpg_station_fulfillment_settings settings on settings.station_branch_id=station.id
    join public.catalog_prices catalog_price
      on catalog_price.organization_id=station.organization_id and catalog_price.branch_id is not distinct from station.branch_id
    join public.catalog_items catalog_item on catalog_item.id=catalog_price.item_id
    join public.business_modules module on module.id=catalog_item.module_id and module.key='lpg'
    where catalog_item.status='active' and catalog_item.item_type in ('product','service')
      and catalog_price.status='active' and catalog_price.currency_code=settings.currency_code
      and catalog_price.effective_from<=target_at
      and (catalog_price.effective_until is null or catalog_price.effective_until>target_at)
      and catalog_price.metadata->>'price_basis'='per_kg' and catalog_price.amount>0
    order by station.id,catalog_price.effective_from desc,catalog_price.created_at desc
  )
  select priced.station_id,priced.display_name,priced.formatted_address,priced.latitude,priced.longitude,
    priced.service_radius_meters,round(priced.pickup_distance,2),round(priced.return_distance,2),
    round(priced.pickup_distance+priced.return_distance,2),priced.currency_code,priced.price_per_kg,
    priced.current_available_kg,priced.refill_capacity_kg,priced.supported_cylinder_sizes_kg,cylinder_record.size_kg,
    priced.vehicle_id,priced.registration_number,priced.max_load_kg
  from prices priced
  order by greatest(priced.pickup_distance,priced.return_distance),priced.display_name
  limit target_limit;
end
$$;

create or replace function public.read_lpg_station_managed_eligible_stations_for_amount(
  target_pickup_location_id uuid,
  target_delivery_location_id uuid,
  target_cylinder_id uuid,
  target_requested_amount numeric,
  target_limit integer default 10,
  target_at timestamptz default timezone('utc',now())
)
returns table(
  station_branch_id uuid,display_name text,formatted_address text,latitude numeric,longitude numeric,
  service_radius_meters integer,pickup_distance_meters numeric,return_distance_meters numeric,
  route_proxy_distance_meters numeric,currency_code text,price_per_kg numeric,current_available_kg numeric,
  refill_capacity_kg numeric,supported_cylinder_sizes_kg numeric[],cylinder_size_kg numeric,
  station_managed_vehicle_id uuid,station_managed_vehicle_registration_number text,station_managed_vehicle_max_load_kg numeric
)
language plpgsql security definer
set search_path=public,extensions,pg_temp
as $$
declare candidate record; resolved_kg numeric; actor_user_id uuid:=auth.uid();
  pickup_record public.lpg_customer_locations%rowtype; delivery_record public.lpg_customer_locations%rowtype;
  cylinder_record public.lpg_cylinders%rowtype; matched_count integer:=0;
begin
  if actor_user_id is null then raise exception using errcode='42501',message='authentication required'; end if;
  if target_limit is null or target_limit<1 or target_limit>50 then raise exception using errcode='22023',message='target_limit must be between 1 and 50'; end if;
  if target_requested_amount is null or target_requested_amount<=0 then raise exception using errcode='22023',message='target_requested_amount must be greater than zero'; end if;
  select * into pickup_record from public.lpg_customer_locations where id=target_pickup_location_id and owner_user_id=actor_user_id and status='active';
  if not found then raise exception using errcode='42501',message='pickup location is not available to this customer'; end if;
  select * into delivery_record from public.lpg_customer_locations where id=target_delivery_location_id and owner_user_id=actor_user_id and status='active';
  if not found then raise exception using errcode='42501',message='return location is not available to this customer'; end if;
  select * into cylinder_record from public.lpg_cylinders where id=target_cylinder_id and owner_user_id=actor_user_id and status<>'deactivated';
  if not found then raise exception using errcode='42501',message='cylinder is not available to this customer'; end if;

  for candidate in
    select * from public.read_lpg_station_managed_eligible_stations(
      target_pickup_location_id,target_delivery_location_id,target_cylinder_id,
      0.001,50,target_at
    )
  loop
    resolved_kg:=floor((target_requested_amount/candidate.price_per_kg)*1000)/1000;
    if resolved_kg>0
      and resolved_kg<=cylinder_record.max_capacity_kg
      and resolved_kg<=candidate.current_available_kg
      and resolved_kg<=candidate.refill_capacity_kg
      and resolved_kg<=candidate.station_managed_vehicle_max_load_kg then
      station_branch_id:=candidate.station_branch_id;display_name:=candidate.display_name;formatted_address:=candidate.formatted_address;
      latitude:=candidate.latitude;longitude:=candidate.longitude;service_radius_meters:=candidate.service_radius_meters;
      pickup_distance_meters:=candidate.pickup_distance_meters;return_distance_meters:=candidate.return_distance_meters;
      route_proxy_distance_meters:=candidate.route_proxy_distance_meters;currency_code:=candidate.currency_code;
      price_per_kg:=candidate.price_per_kg;current_available_kg:=candidate.current_available_kg;
      refill_capacity_kg:=candidate.refill_capacity_kg;supported_cylinder_sizes_kg:=candidate.supported_cylinder_sizes_kg;
      cylinder_size_kg:=candidate.cylinder_size_kg;station_managed_vehicle_id:=candidate.station_managed_vehicle_id;
      station_managed_vehicle_registration_number:=candidate.station_managed_vehicle_registration_number;
      station_managed_vehicle_max_load_kg:=candidate.station_managed_vehicle_max_load_kg;
      return next;
      matched_count:=matched_count+1;
      if matched_count>=target_limit then return; end if;
    end if;
  end loop;
end
$$;

-- Serviceability override remains restricted to the explicit Station Managed mode;
-- quote/order creation fails closed if no valid station vehicle can serve the quantity.
create or replace function public.enforce_lpg_refill_quote_serviceability()
returns trigger language plpgsql security definer
set search_path=public,extensions,pg_temp
as $$
declare pickup_record record; delivery_record record; pickup_resolution jsonb; delivery_resolution jsonb; station_coverage_override boolean:=false; eligible_station_count integer:=0;
begin
  select location.latitude,location.longitude,location.metadata into pickup_record
  from public.lpg_customer_locations location where location.id=new.pickup_location_id and location.status<>'deleted';
  if not found then raise exception using errcode='23503',message='pickup location is missing for LPG serviceability verification'; end if;
  select location.latitude,location.longitude,location.metadata into delivery_record
  from public.lpg_customer_locations location where location.id=new.delivery_location_id and location.status<>'deleted';
  if not found then raise exception using errcode='23503',message='delivery location is missing for LPG serviceability verification'; end if;

  pickup_resolution:=public.resolve_lpg_serviceability(pickup_record.latitude,pickup_record.longitude,coalesce(pickup_record.metadata,'{}'::jsonb));
  delivery_resolution:=public.resolve_lpg_serviceability(delivery_record.latitude,delivery_record.longitude,coalesce(delivery_record.metadata,'{}'::jsonb));
  if not coalesce((pickup_resolution->>'serviceable')::boolean,false) or not coalesce((delivery_resolution->>'serviceable')::boolean,false) then
    if coalesce(nullif(new.metadata->>'fulfillment_mode',''),new.fulfillment_mode,'independent_driver')<>'station_managed' or new.station_branch_id is null then
      raise exception using errcode='P0001',message='LPG service is not available for this trip through the selected fulfilment model';
    end if;
    select count(*) into eligible_station_count
    from public.read_lpg_station_managed_eligible_stations(new.pickup_location_id,new.delivery_location_id,new.cylinder_id,new.requested_kg,50,timezone('utc',now())) candidate
    where candidate.station_branch_id=new.station_branch_id;
    if eligible_station_count=0 then raise exception using errcode='P0001',message='selected Station Managed branch has no eligible vehicle, stock, pricing or coverage for this trip'; end if;
    station_coverage_override:=true;
  end if;
  new.metadata:=coalesce(new.metadata,'{}'::jsonb)||jsonb_build_object(
    'serviceabilitySnapshot',jsonb_build_object('verifiedAt',timezone('utc',now()),'pickup',pickup_resolution,'return',delivery_resolution,
      'stationManagedCoverageOverride',station_coverage_override,'stationBranchId',case when station_coverage_override then new.station_branch_id else null end)
  );
  return new;
end
$$;

revoke all on function public.is_lpg_station_managed_vehicle_eligible(uuid,uuid,date) from public,anon;
revoke all on function public.read_lpg_station_managed_available_vehicles(uuid) from public,anon;
revoke all on function public.configure_lpg_station_managed_vehicle(uuid,uuid,boolean,text) from public,anon;
revoke all on function public.read_lpg_station_managed_eligible_stations(uuid,uuid,uuid,numeric,integer,timestamptz) from public,anon;
revoke all on function public.read_lpg_station_managed_eligible_stations_for_amount(uuid,uuid,uuid,numeric,integer,timestamptz) from public,anon;

grant execute on function public.is_lpg_station_managed_vehicle_eligible(uuid,uuid,date) to authenticated,service_role;
grant execute on function public.read_lpg_station_managed_available_vehicles(uuid) to authenticated,service_role;
grant execute on function public.configure_lpg_station_managed_vehicle(uuid,uuid,boolean,text) to authenticated,service_role;
grant execute on function public.read_lpg_station_managed_eligible_stations(uuid,uuid,uuid,numeric,integer,timestamptz) to authenticated,service_role;
grant execute on function public.read_lpg_station_managed_eligible_stations_for_amount(uuid,uuid,uuid,numeric,integer,timestamptz) to authenticated,service_role;

-- Dispatch only when both a station-owned driver and a free, approved,
-- organization-owned LPG vehicle can handle the order.
create or replace function public.auto_assign_lpg_station_managed_order_for_id(target_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $dispatch_station_order$
declare
  order_record public.lpg_refill_orders%rowtype;
  driver_record public.lpg_station_managed_drivers%rowtype;
  vehicle_record public.vehicles%rowtype;
  settings_enabled boolean;
  result_id uuid;
  auto_key text;
begin
  select * into order_record from public.lpg_refill_orders where id=target_order_id for update;
  if not found or order_record.fulfillment_channel<>'marketplace' or order_record.fulfillment_mode<>'station_managed'
    or order_record.status not in ('payment_reserved','matching_station','matching_driver','driver_offered','driver_accepted','pickup_verified','station_en_route') then return null; end if;
  select station_managed_enabled into settings_enabled from public.lpg_station_fulfillment_settings where station_branch_id=order_record.station_branch_id;
  if not coalesce(settings_enabled,false) then return null; end if;
  perform pg_advisory_xact_lock(hashtextextended(order_record.station_branch_id::text,0));
  if exists(select 1 from public.lpg_station_managed_driver_assignments where lpg_order_id=order_record.id and status<>'cancelled') then return null; end if;

  select * into driver_record from public.lpg_station_managed_drivers d
  where d.station_branch_id=order_record.station_branch_id and d.status='active'
  order by (select count(*) from public.lpg_station_managed_driver_assignments a where a.station_driver_id=d.id and a.status in ('assigned','accepted','en_route')),d.created_at,d.id
  limit 1 for update;
  if not found then
    update public.lpg_refill_orders set status='matching_driver',assignment_status='unassigned',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('stationManagedDispatch','waiting_for_station_driver'),
      updated_at=timezone('utc',now()) where id=order_record.id and status<>'driver_offered';
    return null;
  end if;

  select vehicle.* into vehicle_record
  from public.lpg_station_managed_vehicles assignment
  join public.vehicles vehicle on vehicle.id=assignment.vehicle_id
  where assignment.station_branch_id=order_record.station_branch_id and assignment.status='active'
    and vehicle.max_load_kg>=order_record.requested_kg
    and public.is_lpg_station_managed_vehicle_eligible(order_record.station_branch_id,vehicle.id,current_date)
    and not exists(select 1 from public.lpg_station_managed_driver_assignments busy
      where busy.vehicle_id=vehicle.id and busy.status in ('assigned','accepted','en_route'))
  order by (select count(*) from public.lpg_station_managed_driver_assignments a where a.vehicle_id=vehicle.id and a.status in ('assigned','accepted','en_route')),vehicle.created_at,vehicle.id
  limit 1 for update of assignment,vehicle;
  if not found then
    update public.lpg_refill_orders set status='matching_driver',assignment_status='unassigned',
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('stationManagedDispatch','waiting_for_station_vehicle'),
      updated_at=timezone('utc',now()) where id=order_record.id and status<>'driver_offered';
    return null;
  end if;

  auto_key:='station-managed-auto:'||order_record.id::text;
  insert into public.lpg_station_managed_driver_assignments(
    lpg_order_id,station_branch_id,station_driver_id,vehicle_id,assigned_by,idempotency_key,metadata
  ) values (
    order_record.id,order_record.station_branch_id,driver_record.id,vehicle_record.id,driver_record.created_by,auto_key,
    jsonb_build_object('source','automatic_station_dispatch','policy','least_active_driver_and_available_vehicle','vehicleRegistration',vehicle_record.registration_number)
  )
  on conflict(lpg_order_id) do update set station_driver_id=excluded.station_driver_id,vehicle_id=excluded.vehicle_id,status='assigned',
    assigned_at=timezone('utc',now()),assigned_by=excluded.assigned_by,completed_at=null,metadata=excluded.metadata
    where public.lpg_station_managed_driver_assignments.status='cancelled'
  returning id into result_id;
  if result_id is null then return null; end if;

  update public.lpg_refill_orders set driver_profile_id=null,vehicle_id=vehicle_record.id,driver_commission_amount=0,
    status='driver_offered',assignment_status='driver_assigned',updated_at=timezone('utc',now()),
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'stationManagedDriverId',driver_record.id,'stationManagedDriverUserId',driver_record.user_id,
      'stationManagedVehicleId',vehicle_record.id,'stationManagedVehicleRegistration',vehicle_record.registration_number,
      'stationManagedDispatch','automatically_assigned'
    )
  where id=order_record.id;
  perform public.record_lpg_order_event(order_record.id,'lpg.station_managed.driver_assigned',order_record.status,'driver_offered',auto_key||':event',
    jsonb_build_object('station_driver_id',driver_record.id,'station_driver_user_id',driver_record.user_id,'vehicle_id',vehicle_record.id,'automatic',true));
  return result_id;
end;
$dispatch_station_order$;

create or replace function public.auto_assign_lpg_station_managed_order()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $dispatch_station_order_trigger$
begin
  if new.fulfillment_channel='marketplace' and new.fulfillment_mode='station_managed'
    and new.station_branch_id is not null then
    perform public.auto_assign_lpg_station_managed_order_for_id(new.id);
  end if;
  return new;
end;
$dispatch_station_order_trigger$;

create or replace function public.on_station_managed_dispatch_readiness_changed()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $dispatch_readiness$
begin
  if tg_table_name='lpg_station_fulfillment_settings' then
    if new.station_managed_enabled then perform public.auto_dispatch_pending_station_orders_for_branch(new.station_branch_id); end if;
  elsif tg_table_name='lpg_station_managed_drivers' then
    if new.status='active' then perform public.auto_dispatch_pending_station_orders_for_branch(new.station_branch_id); end if;
  elsif tg_table_name='lpg_station_managed_vehicles' then
    if new.status='active' then perform public.auto_dispatch_pending_station_orders_for_branch(new.station_branch_id); end if;
  end if;
  return new;
end;
$dispatch_readiness$;

drop trigger if exists trg_station_managed_vehicle_dispatch_pending on public.lpg_station_managed_vehicles;
create trigger trg_station_managed_vehicle_dispatch_pending
after insert or update of status on public.lpg_station_managed_vehicles
for each row execute function public.on_station_managed_dispatch_readiness_changed();

notify pgrst,'reload schema';
commit;
