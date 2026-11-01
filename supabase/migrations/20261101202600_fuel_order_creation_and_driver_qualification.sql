begin;

create table if not exists public.fuel_driver_product_qualifications (
  id uuid primary key default gen_random_uuid(),
  driver_user_id uuid not null references public.profiles(id) on delete restrict,
  driver_profile_id uuid references public.driver_profiles(id) on delete restrict,
  station_managed_driver_id uuid references public.lpg_station_managed_drivers(id) on delete restrict,
  branch_id uuid references public.organization_branches(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  product_key text not null references public.fuel_products(key) on update cascade on delete restrict,
  maximum_load_litres numeric(16,3) not null check (maximum_load_litres > 0),
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','suspended','expired')),
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  valid_until timestamptz,
  source text not null default 'platform.fuel.driver_qualification',
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  constraint fuel_driver_product_qualification_identity_check
    check ((driver_profile_id is not null)::integer + (station_managed_driver_id is not null)::integer = 1),
  constraint fuel_driver_product_qualification_identity_unique
    unique nulls not distinct(driver_user_id,vehicle_id,product_key,branch_id),
  check (valid_until is null or valid_until > created_at),
  check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$')
);

create index if not exists fuel_driver_product_qualifications_lookup_idx
on public.fuel_driver_product_qualifications(driver_user_id,product_key,status,branch_id);

create index if not exists fuel_driver_product_qualifications_vehicle_idx
on public.fuel_driver_product_qualifications(vehicle_id,product_key,status);

create table if not exists public.fuel_driver_qualification_events (
  id uuid primary key default gen_random_uuid(),
  qualification_id uuid not null references public.fuel_driver_product_qualifications(id) on delete restrict,
  event_key text not null check (event_key in ('created','approved','rejected','suspended','revoked','updated')),
  before_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(before_snapshot)='object'),
  after_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(after_snapshot)='object'),
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc',now())
);

create or replace function public.create_fuel_order_with_quote(
  target_branch_id uuid,
  target_product_key text,
  target_requested_litres numeric,
  target_container_mode text,
  target_container_type_key text,
  target_fulfillment_mode text,
  target_currency_code text,
  target_idempotency_key text,
  target_delivery_location_id uuid default null,
  target_delivery_instructions text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  branch_record public.organization_branches%rowtype;
  offer_record public.fuel_branch_product_offers%rowtype;
  product_record public.fuel_products%rowtype;
  container_type_record public.fuel_container_types%rowtype;
  delivery_location_record public.lpg_customer_locations%rowtype;
  station_profile_id uuid;
  customer_serviceability jsonb;
  station_serviceability jsonb;
  order_id uuid;
  quote_id uuid;
  order_record public.order_records%rowtype;
  snapshot_record public.fuel_order_commercial_snapshots%rowtype;
  quote_record public.price_quotes%rowtype;
  payload jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='customer authentication is required to create a Fuel order';
  end if;

  if target_branch_id is null
     or target_product_key is null or target_product_key not in ('fuel.pms','fuel.ago','fuel.dpk')
     or target_requested_litres is null or target_requested_litres<=0
     or target_container_mode is null or target_container_mode not in ('purchase','rental')
     or coalesce(btrim(target_container_type_key),'')=''
     or target_fulfillment_mode is null or target_fulfillment_mode not in ('station_managed','independent_driver','skima_managed')
     or coalesce(btrim(target_currency_code),'')=''
     or coalesce(btrim(target_idempotency_key),'')=''
     or target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='valid branch, product, litres, container option, container type, fulfillment mode, currency and idempotency key are required';
  end if;

  select * into product_record
  from public.fuel_products
  where key=target_product_key and status='enabled';

  if not found then
    raise exception using errcode='55000',message='The selected fuel product is not enabled';
  end if;

  select * into branch_record
  from public.organization_branches
  where id=target_branch_id and status='active';

  if not found then
    raise exception using errcode='55000',message='The selected station branch is not active';
  end if;

  select * into offer_record
  from public.fuel_branch_product_offers
  where branch_id=target_branch_id
    and product_key=target_product_key
    and currency_code=target_currency_code
    and status='active'
    and effective_from<=timezone('utc',now())
    and (effective_until is null or effective_until>timezone('utc',now()))
  for share;

  if not found then
    raise exception using errcode='55000',message='The selected station is not currently offering this fuel product in the requested currency';
  end if;

  if target_requested_litres<offer_record.minimum_litres
     or target_requested_litres>offer_record.maximum_litres then
    raise exception using errcode='23514',message='Requested litres are outside the station minimum and maximum';
  end if;

  if not target_fulfillment_mode=any(offer_record.fulfillment_modes) then
    raise exception using errcode='23514',message='The selected fulfilment mode is unavailable for this station and product';
  end if;

  select * into container_type_record
  from public.fuel_container_types
  where key=target_container_type_key
    and status='active'
    and target_product_key=any(supported_product_keys)
  for share;

  if not found then
    raise exception using errcode='23514',message='Choose an active container type compatible with the selected fuel product';
  end if;

  if target_delivery_location_id is null then
    raise exception using errcode='22023',message='Choose a saved delivery location before placing a Fuel order';
  end if;

  select * into delivery_location_record
  from public.lpg_customer_locations
  where id=target_delivery_location_id
    and owner_user_id=auth.uid()
    and status='active';

  if not found then
    raise exception using errcode='42501',message='The selected delivery location is not available to this customer';
  end if;

  customer_serviceability:=public.resolve_service_availability(
    'fuel','customer_ordering',
    delivery_location_record.longitude::double precision,
    delivery_location_record.latitude::double precision,
    timezone('utc',now())
  );

  if coalesce((customer_serviceability->>'available')::boolean,false) is not true then
    raise exception using errcode='55000',message='Fuel delivery is not available at this address: '||coalesce(customer_serviceability->>'reason','SERVICE_NOT_LAUNCHED');
  end if;

  select station.id into station_profile_id
  from public.lpg_station_branches station
  where station.branch_id=target_branch_id
    and station.approval_status='approved'
    and station.compliance_status='approved'
  order by station.updated_at desc
  limit 1;

  if station_profile_id is null then
    raise exception using errcode='55000',message='The selected station has no approved operational station profile';
  end if;

  station_serviceability:=public.resolve_operational_coverage_eligibility(
    'STATION',station_profile_id,'fuel',
    delivery_location_record.longitude::double precision,
    delivery_location_record.latitude::double precision,
    timezone('utc',now())
  );

  if coalesce((station_serviceability->>'eligible')::boolean,false) is not true then
    raise exception using errcode='55000',message='The selected station is not approved to serve this delivery address for Fuel';
  end if;

  -- Merge caller metadata first; server-selected order details must always win.
  payload:=coalesce(target_metadata,'{}'::jsonb) || jsonb_build_object(
    'fuel_product_key',target_product_key,
    'requested_litres',round(target_requested_litres,3),
    'container_mode',target_container_mode,
    'container_type_key',target_container_type_key,
    'fulfillment_mode',target_fulfillment_mode,
    'delivery_location_id',target_delivery_location_id,
    'delivery_instructions',nullif(btrim(target_delivery_instructions),'')
  );

  order_id:=public.create_order_from_catalog(
    'fuel',
    branch_record.organization_id,
    target_branch_id,
    jsonb_build_array(jsonb_build_object(
      'itemId',offer_record.catalog_item_id,
      'variantId',offer_record.catalog_variant_id,
      'quantity',round(target_requested_litres,3)
    )),
    'fuel_delivery',
    target_currency_code,
    'order.acceptance.fuel.manual.v1',
    payload,
    'platform.fuel.mobile',
    target_idempotency_key,
    jsonb_build_object('module_key','fuel','product_key',target_product_key,'entrypoint','customer_mobile')
  );

  quote_id:=public.create_fuel_commercial_quote(
    order_id,
    target_idempotency_key||':commercial-quote',
    jsonb_build_object('created_via','create_fuel_order_with_quote')
  );

  select * into order_record from public.order_records where id=order_id;
  select * into quote_record from public.price_quotes where id=quote_id;
  select * into snapshot_record from public.fuel_order_commercial_snapshots where order_id=order_id;

  return jsonb_build_object(
    'order_id',order_id,
    'service_request_id',order_record.service_request_id,
    'price_quote_id',quote_id,
    'order_status',order_record.status,
    'quote_status',quote_record.status,
    'currency_code',quote_record.currency_code,
    'subtotal_amount',quote_record.subtotal_amount,
    'fee_amount',quote_record.fee_amount,
    'tax_amount',quote_record.tax_amount,
    'total_amount',quote_record.total_amount,
    'expires_at',quote_record.expires_at,
    'container_count',snapshot_record.container_count,
    'component_snapshot',snapshot_record.component_snapshot
  );
end;
$$;

create or replace function public.configure_fuel_driver_product_qualification(
  target_driver_user_id uuid,
  target_driver_profile_id uuid,
  target_station_managed_driver_id uuid,
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
     or ((target_driver_profile_id is not null)::integer+(target_station_managed_driver_id is not null)::integer)<>1
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
      raise exception using errcode='23514',message='Independent driver must have an approved and active driver profile';
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
    product_key,maximum_load_litres,status,approved_by,approved_at,valid_until,
    source,idempotency_key,metadata,created_by
  )
  values(
    target_driver_user_id,target_driver_profile_id,target_station_managed_driver_id,target_branch_id,target_vehicle_id,
    target_product_key,target_maximum_load_litres,target_status,
    case when target_status='approved' then auth.uid() else null end,
    case when target_status='approved' then timezone('utc',now()) else null end,
    target_valid_until,'platform.fuel.driver_qualification',target_idempotency_key,target_metadata,auth.uid()
  )
  on conflict on constraint fuel_driver_product_qualification_identity_unique do update
  set driver_profile_id=excluded.driver_profile_id,
      station_managed_driver_id=excluded.station_managed_driver_id,
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
    and status='approved'
    and (branch_id is null or branch_id=operation_record.station_branch_id)
    and (valid_until is null or valid_until>timezone('utc',now()))
    and maximum_load_litres>=operation_record.requested_litres
  order by (branch_id is not null) desc,approved_at desc
  limit 1;

  if not found then
    raise exception using errcode='23514',message='Assigned driver and vehicle are not approved for this fuel product and ordered litre capacity';
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
  else
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
    if not exists (
      select 1 from public.driver_vehicle_links link
      where link.driver_profile_id=qualification_record.driver_profile_id
        and link.vehicle_id=vehicle_id_value
        and link.status='active'
        and link.starts_at<=timezone('utc',now())
        and (link.ends_at is null or link.ends_at>timezone('utc',now()))
    ) then
      raise exception using errcode='23514',message='Assigned vehicle is no longer linked to the approved fuel driver';
    end if;
  end if;
end;
$$;

create or replace function public.guard_fuel_order_operational_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record public.service_requests%rowtype;
begin
  if new.stage_key is not distinct from old.stage_key then
    return new;
  end if;

  if new.stage_key='stock_reserved' then
    select * into request_record
    from public.service_requests
    where id=new.service_request_id;

    if not found or request_record.escrow_hold_id is null
       or request_record.status<>'payment_reserved'
       or not exists (
         select 1 from public.escrow_holds hold
         where hold.id=request_record.escrow_hold_id
           and hold.status='held'
       ) then
      raise exception using errcode='55000',message='Fuel order must have a confirmed escrow payment before station stock can be reserved';
    end if;
  elsif new.stage_key='driver_assigned' then
    perform public.require_fuel_driver_product_qualification(new.order_id);
  end if;

  return new;
end;
$$;

drop trigger if exists fuel_order_operations_security_gate on public.fuel_order_operations;
create trigger fuel_order_operations_security_gate
before update of stage_key on public.fuel_order_operations
for each row execute function public.guard_fuel_order_operational_stage();

alter table public.fuel_driver_product_qualifications enable row level security;
alter table public.fuel_driver_qualification_events enable row level security;

drop policy if exists fuel_driver_product_qualifications_read_accessible on public.fuel_driver_product_qualifications;
create policy fuel_driver_product_qualifications_read_accessible
on public.fuel_driver_product_qualifications for select to authenticated
using (
  driver_user_id=auth.uid()
  or public.can_read_fuel_platform()
  or (branch_id is not null and public.can_read_fuel_branch(branch_id))
);

drop policy if exists fuel_driver_qualification_events_read_accessible on public.fuel_driver_qualification_events;
create policy fuel_driver_qualification_events_read_accessible
on public.fuel_driver_qualification_events for select to authenticated
using (
  exists (
    select 1 from public.fuel_driver_product_qualifications qualification
    where qualification.id=qualification_id
      and (
        qualification.driver_user_id=auth.uid()
        or public.can_read_fuel_platform()
        or (qualification.branch_id is not null and public.can_read_fuel_branch(qualification.branch_id))
      )
  )
);

grant select on public.fuel_driver_product_qualifications,public.fuel_driver_qualification_events to authenticated,service_role;

drop trigger if exists fuel_driver_product_qualifications_set_updated_at on public.fuel_driver_product_qualifications;
create trigger fuel_driver_product_qualifications_set_updated_at
before update on public.fuel_driver_product_qualifications
for each row execute function public.set_updated_at();

drop trigger if exists fuel_driver_product_qualifications_audit on public.fuel_driver_product_qualifications;
create trigger fuel_driver_product_qualifications_audit
after insert or update or delete on public.fuel_driver_product_qualifications
for each row execute function public.record_table_audit();

drop trigger if exists fuel_driver_qualification_events_immutable on public.fuel_driver_qualification_events;
create trigger fuel_driver_qualification_events_immutable
before update or delete on public.fuel_driver_qualification_events
for each row execute function public.prevent_fuel_event_mutation();

revoke all on function public.create_fuel_order_with_quote(uuid,text,numeric,text,text,text,text,text,uuid,text,jsonb) from public,anon;
revoke all on function public.configure_fuel_driver_product_qualification(uuid,uuid,uuid,uuid,uuid,text,numeric,text,timestamptz,text,jsonb) from public,anon;
revoke all on function public.require_fuel_driver_product_qualification(uuid) from public,anon,authenticated;
revoke all on function public.guard_fuel_order_operational_stage() from public,anon,authenticated;
grant execute on function public.create_fuel_order_with_quote(uuid,text,numeric,text,text,text,text,text,uuid,text,jsonb) to authenticated,service_role;
grant execute on function public.configure_fuel_driver_product_qualification(uuid,uuid,uuid,uuid,uuid,text,numeric,text,timestamptz,text,jsonb) to authenticated,service_role;

commit;
