begin;

-- Logistics owns its driver-to-booking dispatch records while reusing SKIMA's
-- approved driver profiles, vehicle registry, active vehicle links and compliance view.
alter table public.logistics_bookings
  add column if not exists assigned_driver_profile_id uuid references public.driver_profiles(id) on delete set null,
  add column if not exists assigned_driver_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists assigned_vehicle_id uuid references public.vehicles(id) on delete set null,
  add column if not exists driver_assigned_at timestamptz;

create table if not exists public.logistics_booking_driver_assignments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.logistics_bookings(id) on delete restrict,
  provider_organization_id uuid not null references public.organizations(id) on delete restrict,
  requester_user_id uuid not null references public.profiles(id) on delete restrict,
  driver_profile_id uuid not null references public.driver_profiles(id) on delete restrict,
  driver_user_id uuid not null references public.profiles(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  status text not null default 'offered'
    check (status in ('offered','accepted','in_progress','picked_up','in_transit','delivery_submitted','completed','rejected','reassigned','cancelled')),
  assigned_by uuid references public.profiles(id) on delete set null,
  offered_at timestamptz not null default timezone('utc', now()),
  responded_at timestamptz,
  started_at timestamptz,
  picked_up_at timestamptz,
  in_transit_at timestamptz,
  delivery_submitted_at timestamptz,
  completed_at timestamptz,
  response_reason text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (booking_id, idempotency_key)
);

create unique index if not exists logistics_booking_one_active_driver_assignment_idx
  on public.logistics_booking_driver_assignments(booking_id)
  where status in ('offered','accepted','in_progress','picked_up','in_transit');
create unique index if not exists logistics_driver_one_active_booking_idx
  on public.logistics_booking_driver_assignments(driver_profile_id)
  where status in ('offered','accepted','in_progress','picked_up','in_transit');
create index if not exists logistics_driver_assignments_user_status_idx
  on public.logistics_booking_driver_assignments(driver_user_id,status,offered_at desc);
create index if not exists logistics_driver_assignments_company_status_idx
  on public.logistics_booking_driver_assignments(provider_organization_id,status,offered_at desc);

alter table public.logistics_booking_driver_assignments enable row level security;

create policy logistics_driver_assignments_read_participants
on public.logistics_booking_driver_assignments for select to authenticated
using (
  driver_user_id = auth.uid()
  or public.can_read_logistics_company(provider_organization_id)
  or requester_user_id = auth.uid()
);
create policy logistics_driver_assignments_no_direct_insert
on public.logistics_booking_driver_assignments for insert to authenticated with check (false);
create policy logistics_driver_assignments_no_direct_update
on public.logistics_booking_driver_assignments for update to authenticated using (false) with check (false);
create policy logistics_driver_assignments_no_direct_delete
on public.logistics_booking_driver_assignments for delete to authenticated using (false);

drop policy if exists logistics_bookings_read_customer_or_provider on public.logistics_bookings;
create policy logistics_bookings_read_customer_provider_or_assigned_driver
on public.logistics_bookings for select to authenticated
using (
  requester_user_id = auth.uid()
  or public.can_read_logistics_company(provider_organization_id)
  or public.has_permission('logistics.marketplace.read', null)
  or public.has_permission('logistics.marketplace.manage', null)
  or exists (
    select 1 from public.logistics_booking_driver_assignments assignment
    where assignment.booking_id = logistics_bookings.id
      and assignment.driver_user_id = auth.uid()
      and assignment.status in ('offered','accepted','in_progress','picked_up','in_transit','delivery_submitted','completed')
  )
);

drop policy if exists logistics_booking_events_read_customer_or_provider on public.logistics_booking_events;
create policy logistics_booking_events_read_participants
on public.logistics_booking_events for select to authenticated
using (
  exists (
    select 1 from public.logistics_bookings booking
    where booking.id = logistics_booking_events.booking_id
      and (
        booking.requester_user_id = auth.uid()
        or public.can_read_logistics_company(booking.provider_organization_id)
        or public.has_permission('logistics.marketplace.manage', null)
        or exists (
          select 1 from public.logistics_booking_driver_assignments assignment
          where assignment.booking_id = booking.id and assignment.driver_user_id = auth.uid()
        )
      )
  )
);

create or replace function public.read_logistics_company_dispatch_resources(target_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  resources jsonb;
begin
  if target_organization_id is null then
    raise exception 'target_organization_id is required';
  end if;
  if not public.can_manage_logistics_company(target_organization_id)
    and not public.has_permission('business.logistics.jobs.manage', target_organization_id) then
    raise exception 'company dispatch permission is required';
  end if;

  select coalesce(jsonb_agg(driver_row.resource order by driver_row.display_name), '[]'::jsonb)
  into resources
  from (
    select
      coalesce(nullif(btrim(driver.driver_display_name), ''), profile.display_name, 'Logistics driver') as display_name,
      jsonb_build_object(
        'driver_profile_id', driver.id,
        'user_id', driver.user_id,
        'display_name', coalesce(nullif(btrim(driver.driver_display_name), ''), profile.display_name, 'Logistics driver'),
        'public_driver_id', driver.public_driver_id,
        'operational_status', driver.operational_status,
        'vehicles', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'vehicle_id', vehicle.id,
            'vehicle_type_key', vehicle_type.key,
            'vehicle_type_name', vehicle_type.display_name,
            'registration_number', vehicle.registration_number,
            'manufacturer', vehicle.manufacturer,
            'model', vehicle.model,
            'max_load_kg', vehicle.max_load_kg,
            'cargo_volume_m3', vehicle.cargo_volume_m3,
            'warnings', compliance.warnings
          ) order by vehicle_type.display_name, vehicle.registration_number), '[]'::jsonb)
          from public.driver_vehicle_links link
          join public.vehicles vehicle on vehicle.id = link.vehicle_id
          left join public.vehicle_types vehicle_type on vehicle_type.id = vehicle.vehicle_type_id
          join public.vehicle_assignment_compliance compliance
            on compliance.assignment_id = link.id
          where link.driver_profile_id = driver.id
            and link.status = 'active'
            and link.starts_at <= timezone('utc', now())
            and (link.ends_at is null or link.ends_at > timezone('utc', now()))
            and vehicle.status = 'active'
            and (vehicle.organization_id = target_organization_id or vehicle.owner_user_id = driver.user_id)
            and compliance.driver_approved = true
            and compliance.vehicle_approved = true
            and compliance.assignment_active = true
            and compliance.vehicle_documents_valid = true
            and compliance.owner_approved = true
        )
      ) as resource
    from public.driver_profiles driver
    join public.organization_memberships membership
      on membership.organization_id = target_organization_id
      and membership.user_id = driver.user_id
      and membership.status = 'active'
    left join public.profiles profile on profile.id = driver.user_id
    where driver.verification_status = 'approved'
      and driver.operational_status = 'available'
      and not exists (
        select 1 from public.logistics_booking_driver_assignments active_assignment
        where active_assignment.driver_profile_id = driver.id
          and active_assignment.status in ('offered','accepted','in_progress','picked_up','in_transit')
      )
      and exists (
        select 1
        from public.driver_vehicle_links link
        join public.vehicles vehicle on vehicle.id = link.vehicle_id
        join public.vehicle_assignment_compliance compliance on compliance.assignment_id = link.id
        where link.driver_profile_id = driver.id
          and link.status = 'active'
          and link.starts_at <= timezone('utc', now())
          and (link.ends_at is null or link.ends_at > timezone('utc', now()))
          and vehicle.status = 'active'
          and (vehicle.organization_id = target_organization_id or vehicle.owner_user_id = driver.user_id)
          and compliance.driver_approved = true
          and compliance.vehicle_approved = true
          and compliance.assignment_active = true
          and compliance.vehicle_documents_valid = true
          and compliance.owner_approved = true
      )
  ) driver_row;

  return jsonb_build_object('organization_id',target_organization_id,'drivers',resources);
end;
$$;

create or replace function public.assign_logistics_booking_driver(
  target_booking_id uuid,
  target_driver_profile_id uuid,
  target_vehicle_id uuid,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  booking_record public.logistics_bookings%rowtype;
  driver_record public.driver_profiles%rowtype;
  vehicle_record public.vehicles%rowtype;
  offer_record public.logistics_offers%rowtype;
  service_record public.logistics_provider_services%rowtype;
  job_record public.logistics_job_requests%rowtype;
  existing_assignment public.logistics_booking_driver_assignments%rowtype;
  assignment_id uuid;
  assigned_user_id uuid;
  cargo_weight numeric;
  cargo_volume numeric;
  cargo_types text[];
  vehicle_type_key text;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_booking_id is null or target_driver_profile_id is null or target_vehicle_id is null
    or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'booking, driver, vehicle and valid idempotency key are required';
  end if;

  select * into booking_record from public.logistics_bookings
  where id = target_booking_id for update;
  if not found then raise exception 'logistics booking was not found'; end if;
  if not public.can_manage_logistics_company(booking_record.provider_organization_id)
    and not public.has_permission('business.logistics.jobs.manage', booking_record.provider_organization_id) then
    raise exception 'company dispatch permission is required';
  end if;
  if booking_record.status <> 'provider_accepted' then
    raise exception 'the provider must accept the booking before driver assignment';
  end if;

  select * into existing_assignment
  from public.logistics_booking_driver_assignments
  where booking_id = booking_record.id and idempotency_key = target_idempotency_key;
  if found then
    if existing_assignment.driver_profile_id <> target_driver_profile_id
      or existing_assignment.vehicle_id <> target_vehicle_id then
      raise exception 'driver assignment idempotency key was reused with different details';
    end if;
    return existing_assignment.id;
  end if;

  select * into driver_record
  from public.driver_profiles
  where id = target_driver_profile_id
  for update;
  if not found or driver_record.verification_status <> 'approved'
    or driver_record.operational_status <> 'available' then
    raise exception 'driver must be approved and available';
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = booking_record.provider_organization_id
      and membership.user_id = driver_record.user_id
      and membership.status = 'active'
  ) then
    raise exception 'driver must be an active member of this provider company';
  end if;

  select * into vehicle_record
  from public.vehicles
  where id = target_vehicle_id and status = 'active'
    and (organization_id = booking_record.provider_organization_id or owner_user_id = driver_record.user_id)
  for update;
  if not found then raise exception 'vehicle must be active and owned by the company or assigned driver'; end if;

  if not exists (
    select 1
    from public.driver_vehicle_links link
    join public.vehicle_assignment_compliance compliance on compliance.assignment_id = link.id
    where link.driver_profile_id = driver_record.id
      and link.vehicle_id = vehicle_record.id
      and link.status = 'active'
      and link.starts_at <= timezone('utc', now())
      and (link.ends_at is null or link.ends_at > timezone('utc', now()))
      and compliance.driver_approved = true
      and compliance.vehicle_approved = true
      and compliance.assignment_active = true
      and compliance.vehicle_documents_valid = true
      and compliance.owner_approved = true
  ) then
    raise exception 'driver must have an active, compliant vehicle assignment';
  end if;

  select offer.* into offer_record
  from public.logistics_offers offer
  where offer.id = booking_record.offer_id;
  if not found then raise exception 'selected provider offer was not found'; end if;
  select service.* into service_record
  from public.logistics_provider_services service
  join public.logistics_job_opportunities opportunity
    on opportunity.provider_service_id = service.id
  where opportunity.id = offer_record.opportunity_id;
  if not found then raise exception 'provider service configuration for this booking was not found'; end if;
  select * into job_record from public.logistics_job_requests where id = booking_record.job_id;
  if not found then raise exception 'logistics job request for this booking was not found'; end if;

  select nullif(job_record.cargo_snapshot->>'weight_kg','')::numeric,
         nullif(job_record.cargo_snapshot->>'volume_m3','')::numeric
  into cargo_weight, cargo_volume;

  if vehicle_record.max_load_kg is not null and cargo_weight is not null
    and vehicle_record.max_load_kg < cargo_weight then
    raise exception 'selected vehicle does not have enough weight capacity for this booking';
  end if;
  if vehicle_record.cargo_volume_m3 is not null and cargo_volume is not null
    and vehicle_record.cargo_volume_m3 < cargo_volume then
    raise exception 'selected vehicle does not have enough cargo volume for this booking';
  end if;
  if cardinality(service_record.vehicle_type_keys) > 0 then
    select key into vehicle_type_key from public.vehicle_types where id = vehicle_record.vehicle_type_id;
    if vehicle_type_key is null or not (vehicle_type_key = any(service_record.vehicle_type_keys)) then
      raise exception 'selected vehicle type is not allowed for this provider service';
    end if;
  end if;

  select user_id into assigned_user_id from public.driver_profiles where id = driver_record.id;
  update public.logistics_booking_driver_assignments
  set status = 'reassigned',
      updated_at = timezone('utc', now()),
      metadata = metadata || jsonb_build_object('reassigned_by',actor)
  where booking_id = booking_record.id
    and status in ('offered','accepted','in_progress','picked_up','in_transit');

  insert into public.logistics_booking_driver_assignments (
    booking_id,provider_organization_id,requester_user_id,driver_profile_id,driver_user_id,vehicle_id,
    status,assigned_by,idempotency_key,metadata
  )
  values (
    booking_record.id,booking_record.provider_organization_id,booking_record.requester_user_id,driver_record.id,
    assigned_user_id,vehicle_record.id,'offered',actor,target_idempotency_key,
    jsonb_build_object('source','logistics.company.dispatch')
  )
  returning id into assignment_id;

  update public.logistics_bookings
  set assigned_driver_profile_id = driver_record.id,
      assigned_driver_user_id = assigned_user_id,
      assigned_vehicle_id = vehicle_record.id,
      driver_assigned_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = booking_record.id;

  perform public.record_logistics_booking_event(
    booking_record.id,'logistics.booking.driver_assigned',target_idempotency_key,
    booking_record.status,booking_record.status,
    jsonb_build_object('assignment_id',assignment_id,'driver_profile_id',driver_record.id,'vehicle_id',vehicle_record.id)
  );
  return assignment_id;
end;
$$;

create or replace function public.respond_logistics_driver_assignment(
  target_assignment_id uuid,
  target_decision text,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  assignment_record public.logistics_booking_driver_assignments%rowtype;
  booking_record public.logistics_bookings%rowtype;
  existing_event public.logistics_booking_events%rowtype;
  expected_event_type text;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_assignment_id is null or target_decision not in ('accept','reject')
    or target_idempotency_key is null or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'assignment, decision and valid idempotency key are required';
  end if;

  select * into assignment_record from public.logistics_booking_driver_assignments
  where id = target_assignment_id for update;
  if not found or assignment_record.driver_user_id <> actor then
    raise exception 'driver assignment was not found for the authenticated driver';
  end if;

  select * into booking_record from public.logistics_bookings where id = assignment_record.booking_id for update;
  if not found then raise exception 'booking was not found for this driver assignment'; end if;
  expected_event_type := case when target_decision = 'accept'
    then 'logistics.booking.driver_accepted' else 'logistics.booking.driver_rejected' end;
  select * into existing_event from public.logistics_booking_events
  where booking_id = booking_record.id and idempotency_key = target_idempotency_key;
  if found then
    if existing_event.event_type <> expected_event_type
      or existing_event.metadata->>'assignment_id' <> assignment_record.id::text then
      raise exception 'driver response idempotency key was used for a different action';
    end if;
    return assignment_record.id;
  end if;
  if booking_record.status <> 'provider_accepted' then
    raise exception 'booking is no longer waiting for driver acceptance';
  end if;

  if assignment_record.status in ('accepted','in_progress','picked_up','in_transit') and target_decision = 'accept' then
    return assignment_record.id;
  end if;
  if assignment_record.status <> 'offered' then
    raise exception 'driver assignment is no longer awaiting a response';
  end if;

  if target_decision = 'accept' then
    update public.logistics_booking_driver_assignments
    set status = 'accepted',responded_at = timezone('utc',now()),updated_at = timezone('utc',now())
    where id = assignment_record.id;
  else
    update public.logistics_booking_driver_assignments
    set status = 'rejected',responded_at = timezone('utc',now()),
        response_reason = nullif(btrim(target_reason),''),
        updated_at = timezone('utc',now())
    where id = assignment_record.id;
    update public.logistics_bookings
    set assigned_driver_profile_id = null,assigned_driver_user_id = null,
        assigned_vehicle_id = null,driver_assigned_at = null,updated_at = timezone('utc',now())
    where id = booking_record.id;
  end if;

  perform public.record_logistics_booking_event(
    booking_record.id,
    case when target_decision = 'accept' then 'logistics.booking.driver_accepted' else 'logistics.booking.driver_rejected' end,
    target_idempotency_key,
    booking_record.status,booking_record.status,
    jsonb_build_object('assignment_id',assignment_record.id,'decision',target_decision,'reason',target_reason)
  );
  return assignment_record.id;
end;
$$;

create or replace function public.update_logistics_driver_milestone(
  target_booking_id uuid,
  target_milestone text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  booking_record public.logistics_bookings%rowtype;
  assignment_record public.logistics_booking_driver_assignments%rowtype;
  target_assignment_status text;
  existing_event public.logistics_booking_events%rowtype;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_booking_id is null or target_milestone not in ('picked_up','in_transit')
    or target_idempotency_key is null or char_length(btrim(target_idempotency_key)) not between 8 and 180
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'booking, supported milestone and valid event metadata are required';
  end if;

  select * into booking_record from public.logistics_bookings
  where id = target_booking_id for update;
  if not found then raise exception 'logistics booking was not found'; end if;
  select * into assignment_record from public.logistics_booking_driver_assignments
  where booking_id = booking_record.id
    and driver_user_id = actor
    and status in ('accepted','in_progress','picked_up','in_transit')
  order by created_at desc limit 1 for update;
  if not found then raise exception 'an active accepted driver assignment is required'; end if;

  select * into existing_event from public.logistics_booking_events
  where booking_id = booking_record.id and idempotency_key = target_idempotency_key;
  if found then
    if existing_event.event_type <> ('logistics.booking.driver_' || target_milestone) then
      raise exception 'driver milestone idempotency key was used for a different action';
    end if;
    return assignment_record.id;
  end if;

  if booking_record.status <> 'in_progress' then
    raise exception 'driver must start the booking before updating pickup or transit';
  end if;

  if target_milestone = 'picked_up' then
    if assignment_record.status not in ('in_progress','picked_up') then
      raise exception 'pickup can only be confirmed after the driver starts the job';
    end if;
    target_assignment_status := 'picked_up';
    update public.logistics_booking_driver_assignments
    set status = 'picked_up',picked_up_at = coalesce(picked_up_at,timezone('utc',now())),
        updated_at = timezone('utc',now())
    where id = assignment_record.id;
  else
    if assignment_record.status not in ('picked_up','in_transit') then
      raise exception 'cargo must be picked up before the driver marks it in transit';
    end if;
    target_assignment_status := 'in_transit';
    update public.logistics_booking_driver_assignments
    set status = 'in_transit',in_transit_at = coalesce(in_transit_at,timezone('utc',now())),
        updated_at = timezone('utc',now())
    where id = assignment_record.id;
  end if;

  perform public.record_logistics_booking_event(
    booking_record.id,'logistics.booking.driver_' || target_milestone,
    target_idempotency_key,assignment_record.status,target_assignment_status,target_metadata
  );
  return assignment_record.id;
end;
$$;

create or replace function public.start_logistics_booking(
  target_booking_id uuid,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  booking_record public.logistics_bookings%rowtype;
  assignment_record public.logistics_booking_driver_assignments%rowtype;
  existing_event public.logistics_booking_events%rowtype;
  actor_is_company boolean;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_booking_id is null or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'booking and valid idempotency key are required';
  end if;

  select * into booking_record from public.logistics_bookings
  where id = target_booking_id for update;
  if not found then raise exception 'logistics booking was not found'; end if;

  actor_is_company := public.can_manage_logistics_company(booking_record.provider_organization_id)
    or public.has_permission('business.logistics.jobs.manage',booking_record.provider_organization_id);
  select * into assignment_record from public.logistics_booking_driver_assignments
  where booking_id = booking_record.id and status in ('offered','accepted','in_progress','picked_up','in_transit')
  order by created_at desc limit 1 for update;

  if assignment_record.id is null then
    raise exception 'company must assign an eligible driver before the service can start';
  end if;
  if assignment_record.status = 'offered' then
    raise exception 'assigned driver must accept the job before the service can start';
  end if;
  if assignment_record.driver_user_id <> actor and not actor_is_company then
    raise exception 'only the assigned driver or company dispatcher can start this job';
  end if;

  select * into existing_event from public.logistics_booking_events
  where booking_id = booking_record.id and idempotency_key = target_idempotency_key;
  if found then
    if existing_event.event_type <> 'logistics.booking.service_started' then
      raise exception 'booking idempotency key was used for a different action';
    end if;
    return booking_record.id;
  end if;

  if booking_record.status = 'in_progress' then return booking_record.id; end if;
  if booking_record.status <> 'provider_accepted' then
    raise exception 'provider must accept the booking before starting the service';
  end if;

  update public.logistics_bookings
  set status = 'in_progress',
      service_started_at = coalesce(service_started_at,timezone('utc',now())),
      updated_at = timezone('utc',now())
  where id = booking_record.id;
  update public.logistics_booking_driver_assignments
  set status = 'in_progress',started_at = coalesce(started_at,timezone('utc',now())),
      updated_at = timezone('utc',now())
  where id = assignment_record.id;


  update public.service_requests set status = 'in_progress',updated_at = timezone('utc',now())
  where id = booking_record.service_request_id;
  update public.order_records
  set status = 'preparing',preparing_at = coalesce(preparing_at,timezone('utc',now())),
      updated_at = timezone('utc',now())
  where id = booking_record.order_id;
  update public.logistics_job_requests
  set status = 'in_progress',updated_at = timezone('utc',now())
  where id = booking_record.job_id;

  perform public.record_logistics_booking_event(
    booking_record.id,'logistics.booking.service_started',target_idempotency_key,
    booking_record.status,'in_progress',jsonb_build_object('assignment_id',assignment_record.id,'driver_user_id',assignment_record.driver_user_id)
  );
  perform public.record_logistics_job_event(
    booking_record.job_id,'logistics.booking.service_started',target_idempotency_key || ':job',
    'booked','in_progress',jsonb_build_object('booking_id',booking_record.id,'assignment_id',assignment_record.id)
  );
  return booking_record.id;
end;
$$;

create or replace function public.submit_logistics_booking_delivery(
  target_booking_id uuid,
  target_delivery_submission jsonb,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  booking_record public.logistics_bookings%rowtype;
  assignment_record public.logistics_booking_driver_assignments%rowtype;
  recipient_name text;
  delivery_note text;
  actor_is_company boolean;
  existing_event public.logistics_booking_events%rowtype;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_booking_id is null or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180
    or target_delivery_submission is null
    or jsonb_typeof(target_delivery_submission) <> 'object' then
    raise exception 'booking, delivery details and a valid idempotency key are required';
  end if;

  recipient_name := nullif(btrim(target_delivery_submission ->> 'recipient_name'),'');
  delivery_note := nullif(btrim(target_delivery_submission ->> 'delivery_note'),'');
  if recipient_name is null or char_length(recipient_name) not between 2 and 160 then
    raise exception 'the name of the person receiving the delivery is required';
  end if;
  if delivery_note is not null and char_length(delivery_note) > 1200 then
    raise exception 'delivery note must not exceed 1200 characters';
  end if;

  select * into booking_record from public.logistics_bookings
  where id = target_booking_id for update;
  if not found then raise exception 'logistics booking was not found'; end if;
  actor_is_company := public.can_manage_logistics_company(booking_record.provider_organization_id)
    or public.has_permission('business.logistics.jobs.manage',booking_record.provider_organization_id);

    if not actor_is_company and not exists (
      select 1 from public.logistics_booking_driver_assignments assignment
      where assignment.id::text = existing_event.metadata->>'assignment_id'
        and assignment.driver_user_id = actor
    ) then
      raise exception 'delivery submission retry is not available to this actor';
    end if;
    return booking_record.id;
  end if;

  select * into assignment_record from public.logistics_booking_driver_assignments
  where booking_id = booking_record.id
    and status = 'in_transit'
  order by created_at desc limit 1 for update;

  if assignment_record.id is null or
    (assignment_record.driver_user_id <> actor and not actor_is_company) then
    raise exception 'delivery can only be submitted by the assigned driver or company dispatcher';
  end if;

  select * into existing_event from public.logistics_booking_events
  where booking_id = booking_record.id and idempotency_key = target_idempotency_key;
  if found then
    if existing_event.event_type <> 'logistics.booking.delivery_submitted' then
      raise exception 'booking idempotency key was used for a different action';
    end if;
    return booking_record.id;
  end if;
  if booking_record.status = 'delivered' then return booking_record.id; end if;
  if booking_record.status <> 'in_progress' then
    raise exception 'only an in-progress booking can be marked delivered';
  end if;

  update public.logistics_bookings
  set status = 'delivered',
      delivery_submitted_at = timezone('utc',now()),
      delivery_submitted_by = actor,
      delivery_submission_snapshot = jsonb_strip_nulls(jsonb_build_object(
        'recipient_name',recipient_name,'delivery_note',delivery_note,'submitted_at',timezone('utc',now()),
        'driver_profile_id',assignment_record.driver_profile_id,'vehicle_id',assignment_record.vehicle_id
      )),
      updated_at = timezone('utc',now())
  where id = booking_record.id;

  update public.logistics_booking_driver_assignments
  set status = 'delivery_submitted',delivery_submitted_at = timezone('utc',now()),
      updated_at = timezone('utc',now())
  where id = assignment_record.id;


  update public.service_requests set status = 'fulfilled',updated_at = timezone('utc',now())
  where id = booking_record.service_request_id;
  update public.order_records
  set status = 'fulfilled',fulfilled_at = coalesce(fulfilled_at,timezone('utc',now())),
      updated_at = timezone('utc',now())
  where id = booking_record.order_id;
  update public.logistics_job_requests set status = 'delivered',updated_at = timezone('utc',now())
  where id = booking_record.job_id;

  perform public.record_logistics_booking_event(
    booking_record.id,'logistics.booking.delivery_submitted',target_idempotency_key,
    booking_record.status,'delivered',jsonb_build_object(
      'recipient_name',recipient_name,'delivery_note',delivery_note,'assignment_id',assignment_record.id
    )
  );
  perform public.record_logistics_job_event(
    booking_record.job_id,'logistics.booking.delivery_submitted',target_idempotency_key || ':job',
    'in_progress','delivered',jsonb_build_object('booking_id',booking_record.id,'recipient_name',recipient_name)
  );
  return booking_record.id;
end;
$$;

create or replace function public.read_my_logistics_driver_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  driver_record public.driver_profiles%rowtype;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  select * into driver_record
  from public.driver_profiles
  where user_id = actor;
  if not found then
    return jsonb_build_object('driver_profile_id',null,'registered',false,'eligible',false);
  end if;
  return jsonb_build_object(
    'driver_profile_id',driver_record.id,
    'registered',true,
    'verification_status',driver_record.verification_status,
    'operational_status',driver_record.operational_status,
    'driver_display_name',driver_record.driver_display_name,
    'public_driver_id',driver_record.public_driver_id,
    'organization_id',driver_record.organization_id,
    'eligible',driver_record.verification_status = 'approved'
  );
end;
$$;

create or replace function public.read_my_logistics_driver_bookings()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  result jsonb;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'booking_id',booking.id,
    'booking_status',booking.status,
    'payment_mode',booking.payment_mode,
    'currency_code',booking.currency_code,
    'delivery_amount',booking.delivery_amount,
    'customer_name',opportunity.customer_contact_snapshot->>'name',
    'customer_phone',opportunity.customer_contact_snapshot->>'phone',
    'pickup_location',job.pickup_location,
    'destination_location',job.destination_location,
    'title',job.title,
    'description',job.description,
    'instructions',job.instructions,
    'cargo_snapshot',job.cargo_snapshot,
    'requested_pickup_at',job.requested_pickup_at,
    'delivery_submission_snapshot',booking.delivery_submission_snapshot,
    'assignment',jsonb_build_object(
      'id',assignment.id,'status',assignment.status,'driver_profile_id',assignment.driver_profile_id,
      'vehicle_id',assignment.vehicle_id,'offered_at',assignment.offered_at,
      'responded_at',assignment.responded_at,'started_at',assignment.started_at,
      'picked_up_at',assignment.picked_up_at,'in_transit_at',assignment.in_transit_at,
      'delivery_submitted_at',assignment.delivery_submitted_at,
      'vehicle',jsonb_build_object('registration_number',vehicle.registration_number,'manufacturer',vehicle.manufacturer,
        'model',vehicle.model,'vehicle_type',vehicle_type.display_name)
    )
  ) order by assignment.offered_at desc),'[]'::jsonb)
  into result
  from public.logistics_booking_driver_assignments assignment
  join public.logistics_bookings booking on booking.id=assignment.booking_id
  join public.logistics_job_requests job on job.id=booking.job_id
  join public.logistics_offers offer on offer.id=booking.offer_id
  join public.logistics_job_opportunities opportunity on opportunity.id=offer.opportunity_id
  join public.vehicles vehicle on vehicle.id=assignment.vehicle_id
  left join public.vehicle_types vehicle_type on vehicle_type.id=vehicle.vehicle_type_id
  where assignment.driver_user_id=actor
    and assignment.status not in ('rejected','reassigned','cancelled');
  return result;
end;
$$;

create or replace function public.complete_logistics_driver_assignment_after_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('settled','completed_offline') and old.status <> new.status then
    update public.logistics_booking_driver_assignments
    set status='completed',completed_at=coalesce(completed_at,timezone('utc',now())),
        updated_at=timezone('utc',now())
    where booking_id=new.id and status='delivery_submitted';
  elsif new.status in ('cancelled','refunded') and old.status <> new.status then
    update public.logistics_booking_driver_assignments
    set status='cancelled',updated_at=timezone('utc',now())
    where booking_id=new.id and status in ('offered','accepted','in_progress','picked_up','in_transit','delivery_submitted');
  end if;
  return new;
end;
$$;

drop trigger if exists logistics_driver_assignment_after_booking_settlement on public.logistics_bookings;
create trigger logistics_driver_assignment_after_booking_settlement
after update of status on public.logistics_bookings
for each row execute function public.complete_logistics_driver_assignment_after_settlement();

revoke all on function public.read_logistics_company_dispatch_resources(uuid) from public,anon;
revoke all on function public.assign_logistics_booking_driver(uuid,uuid,uuid,text) from public,anon;
revoke all on function public.respond_logistics_driver_assignment(uuid,text,text,text) from public,anon;
revoke all on function public.update_logistics_driver_milestone(uuid,text,text,jsonb) from public,anon;
revoke all on function public.start_logistics_booking(uuid,text) from public,anon;
revoke all on function public.submit_logistics_booking_delivery(uuid,jsonb,text) from public,anon;
revoke all on function public.read_my_logistics_driver_profile() from public,anon;\nrevoke all on function public.read_my_logistics_driver_bookings() from public,anon;

grant execute on function public.read_logistics_company_dispatch_resources(uuid) to authenticated,service_role;
grant execute on function public.assign_logistics_booking_driver(uuid,uuid,uuid,text) to authenticated,service_role;
grant execute on function public.respond_logistics_driver_assignment(uuid,text,text,text) to authenticated,service_role;
grant execute on function public.update_logistics_driver_milestone(uuid,text,text,jsonb) to authenticated,service_role;
grant execute on function public.start_logistics_booking(uuid,text) to authenticated,service_role;
grant execute on function public.submit_logistics_booking_delivery(uuid,jsonb,text) to authenticated,service_role;
grant execute on function public.read_my_logistics_driver_profile() to authenticated,service_role;\ngrant execute on function public.read_my_logistics_driver_bookings() to authenticated,service_role;

grant select on public.logistics_booking_driver_assignments to authenticated,service_role;
notify pgrst,'reload schema';
commit;
