begin;

-- Keep the incumbent driver assignment recoverable until the replacement accepts.
-- The previous driver is hidden from the active queue but remains reserved so they
-- cannot be double-booked while the replacement decision is pending.
alter table public.logistics_booking_driver_assignments
  drop constraint if exists logistics_booking_driver_assignments_status_check;

alter table public.logistics_booking_driver_assignments
  add constraint logistics_booking_driver_assignments_status_check
  check (status in (
    'offered','accepted','replacement_pending','in_progress','picked_up','in_transit',
    'delivery_submitted','completed','rejected','reassigned','cancelled'
  ));

drop index if exists public.logistics_booking_one_active_driver_assignment_idx;
create unique index logistics_booking_one_active_driver_assignment_idx
  on public.logistics_booking_driver_assignments(booking_id)
  where status in ('offered','accepted','in_progress','picked_up','in_transit');

drop index if exists public.logistics_driver_one_active_booking_idx;
create unique index logistics_driver_one_active_booking_idx
  on public.logistics_booking_driver_assignments(driver_profile_id)
  where status in ('offered','accepted','replacement_pending','in_progress','picked_up','in_transit');

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
  prior_assignment public.logistics_booking_driver_assignments%rowtype;
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
  if exists (
    select 1 from public.logistics_booking_driver_assignments
    where booking_id = booking_record.id and status = 'replacement_pending'
  ) then
    raise exception 'a replacement driver offer is already awaiting a response';
  end if;

  if exists (
    select 1 from public.logistics_booking_driver_assignments
    where booking_id = booking_record.id and status in ('in_progress','picked_up','in_transit')
  ) then
    raise exception 'an active delivery cannot use pre-start driver replacement';
  end if;

  select * into prior_assignment
  from public.logistics_booking_driver_assignments
  where booking_id = booking_record.id
    and status in ('offered','accepted')
  order by created_at desc
  limit 1
  for update;

  if prior_assignment.id is not null then
    update public.logistics_booking_driver_assignments
    set status = 'replacement_pending',
        updated_at = timezone('utc', now()),
        metadata = metadata || jsonb_build_object(
          'replacement_requested_by', actor,
          'replacement_requested_at', timezone('utc', now())
        )
    where id = prior_assignment.id;
  end if;

  insert into public.logistics_booking_driver_assignments (
    booking_id,provider_organization_id,requester_user_id,driver_profile_id,driver_user_id,vehicle_id,
    status,assigned_by,idempotency_key,metadata
  )
  values (
    booking_record.id,booking_record.provider_organization_id,booking_record.requester_user_id,driver_record.id,
    assigned_user_id,vehicle_record.id,'offered',actor,target_idempotency_key,
    jsonb_strip_nulls(jsonb_build_object(
      'source','logistics.company.dispatch',
      'replaces_assignment_id', prior_assignment.id,
      'replaces_assignment_status', prior_assignment.status
    ))
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
  prior_assignment public.logistics_booking_driver_assignments%rowtype;
  booking_record public.logistics_bookings%rowtype;
  existing_event public.logistics_booking_events%rowtype;
  expected_event_type text;
  replacement_assignment_id uuid;
  restored_assignment_status text;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_assignment_id is null or target_decision not in ('accept','reject')
    or target_idempotency_key is null or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'assignment, decision and valid idempotency key are required';
  end if;

  -- Use the booking-first lock order shared by dispatch and milestone operations.
  select * into assignment_record
  from public.logistics_booking_driver_assignments
  where id = target_assignment_id;
  if not found or assignment_record.driver_user_id <> actor then
    raise exception 'driver assignment was not found for the authenticated driver';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = assignment_record.booking_id
  for update;
  if not found then raise exception 'booking was not found for this driver assignment'; end if;

  select * into assignment_record
  from public.logistics_booking_driver_assignments
  where id = target_assignment_id and booking_id = booking_record.id
  for update;
  if not found or assignment_record.driver_user_id <> actor then
    raise exception 'driver assignment was not found for the authenticated driver';
  end if;

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

  replacement_assignment_id := nullif(assignment_record.metadata->>'replaces_assignment_id','')::uuid;
  if target_decision = 'accept' then
    if replacement_assignment_id is not null then
      select * into prior_assignment
      from public.logistics_booking_driver_assignments
      where id = replacement_assignment_id and booking_id = booking_record.id
      for update;
      if not found or prior_assignment.status <> 'replacement_pending' then
        raise exception 'the previous assignment is not available for a safe replacement handoff';
      end if;
      update public.logistics_booking_driver_assignments
      set status = 'reassigned',
          updated_at = timezone('utc', now()),
          metadata = metadata || jsonb_build_object(
            'reassigned_by', actor,
            'reassigned_after_acceptance', assignment_record.id
          )
      where id = prior_assignment.id;
    end if;

    update public.logistics_booking_driver_assignments
    set status = 'accepted',
        responded_at = timezone('utc',now()),
        updated_at = timezone('utc',now())
    where id = assignment_record.id;
  else
    update public.logistics_booking_driver_assignments
    set status = 'rejected',
        responded_at = timezone('utc',now()),
        response_reason = nullif(btrim(target_reason),''),
        updated_at = timezone('utc',now())
    where id = assignment_record.id;

    if replacement_assignment_id is not null then
      select * into prior_assignment
      from public.logistics_booking_driver_assignments
      where id = replacement_assignment_id and booking_id = booking_record.id
      for update;
      if not found or prior_assignment.status <> 'replacement_pending' then
        raise exception 'the previous assignment cannot be restored safely';
      end if;
      restored_assignment_status := coalesce(assignment_record.metadata->>'replaces_assignment_status','accepted');
      if restored_assignment_status not in ('offered','accepted') then
        raise exception 'the previous assignment has an invalid recovery state';
      end if;

      update public.logistics_booking_driver_assignments
      set status = restored_assignment_status,
          updated_at = timezone('utc',now()),
          metadata = metadata || jsonb_build_object(
            'replacement_declined_by', actor,
            'replacement_declined_at', timezone('utc', now())
          )
      where id = prior_assignment.id;

      update public.logistics_bookings
      set assigned_driver_profile_id = prior_assignment.driver_profile_id,
          assigned_driver_user_id = prior_assignment.driver_user_id,
          assigned_vehicle_id = prior_assignment.vehicle_id,
          driver_assigned_at = prior_assignment.offered_at,
          updated_at = timezone('utc',now())
      where id = booking_record.id;
    else
      update public.logistics_bookings
      set assigned_driver_profile_id = null,
          assigned_driver_user_id = null,
          assigned_vehicle_id = null,
          driver_assigned_at = null,
          updated_at = timezone('utc',now())
      where id = booking_record.id;
    end if;
  end if;

  perform public.record_logistics_booking_event(
    booking_record.id,
    case when target_decision = 'accept' then 'logistics.booking.driver_accepted' else 'logistics.booking.driver_rejected' end,
    target_idempotency_key,
    booking_record.status,
    booking_record.status,
    jsonb_build_object(
      'assignment_id',assignment_record.id,
      'decision',target_decision,
      'reason',target_reason,
      'replaces_assignment_id',replacement_assignment_id
    )
  );
  return assignment_record.id;
end;
$$;

revoke all on function public.assign_logistics_booking_driver(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.assign_logistics_booking_driver(uuid,uuid,uuid,text) to authenticated,service_role;
revoke all on function public.respond_logistics_driver_assignment(uuid,text,text,text) from public,anon;
grant execute on function public.respond_logistics_driver_assignment(uuid,text,text,text) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
