begin;

-- A driver may release an assignment only after accepting it and before starting
-- the booking. This returns the still-funded/accepted booking to company dispatch;
-- it does not cancel the customer booking or touch payment/escrow state.
create or replace function public.release_logistics_driver_assignment(
  target_assignment_id uuid,
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
  target_booking_id uuid;
  booking_record public.logistics_bookings%rowtype;
  assignment_record public.logistics_booking_driver_assignments%rowtype;
  existing_event public.logistics_booking_events%rowtype;
begin
  if actor is null then
    raise exception 'authentication is required';
  end if;
  if target_assignment_id is null
    or target_reason is null
    or char_length(btrim(target_reason)) not between 5 and 500
    or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'assignment, reason and valid idempotency key are required';
  end if;

  -- Read the booking key first, then always lock booking before assignment.
  select assignment.booking_id
  into target_booking_id
  from public.logistics_booking_driver_assignments assignment
  where assignment.id = target_assignment_id;

  if target_booking_id is null then
    raise exception 'driver assignment was not found';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;

  if not found then
    raise exception 'booking was not found for this driver assignment';
  end if;

  select * into assignment_record
  from public.logistics_booking_driver_assignments
  where id = target_assignment_id
    and booking_id = booking_record.id
  for update;

  if not found or assignment_record.driver_user_id <> actor then
    raise exception 'assignment was not found for the authenticated driver';
  end if;

  select * into existing_event
  from public.logistics_booking_events
  where booking_id = booking_record.id
    and idempotency_key = target_idempotency_key;

  if found then
    if existing_event.event_type <> 'logistics.booking.driver_released'
      or existing_event.metadata->>'assignment_id' is distinct from assignment_record.id::text
      or existing_event.metadata->>'driver_user_id' is distinct from actor::text
      or existing_event.metadata->>'reason' is distinct from btrim(target_reason) then
      raise exception 'driver release idempotency key was used for a different action';
    end if;
    return assignment_record.id;
  end if;

  if booking_record.status <> 'provider_accepted'
    or assignment_record.status <> 'accepted'
    or booking_record.assigned_driver_user_id is distinct from actor
    or booking_record.assigned_driver_profile_id is distinct from assignment_record.driver_profile_id then
    raise exception 'a driver may release only their accepted assignment before the service starts';
  end if;

  update public.logistics_booking_driver_assignments
  set status = 'reassigned',
      responded_at = coalesce(responded_at, timezone('utc', now())),
      response_reason = btrim(target_reason),
      updated_at = timezone('utc', now()),
      metadata = metadata || jsonb_build_object(
        'released_by_driver', actor,
        'release_stage', 'before_service_start'
      )
  where id = assignment_record.id;

  update public.logistics_bookings
  set assigned_driver_profile_id = null,
      assigned_driver_user_id = null,
      assigned_vehicle_id = null,
      driver_assigned_at = null,
      updated_at = timezone('utc', now())
  where id = booking_record.id;

  perform public.record_logistics_booking_event(
    booking_record.id,
    'logistics.booking.driver_released',
    target_idempotency_key,
    booking_record.status,
    booking_record.status,
    jsonb_build_object(
      'assignment_id', assignment_record.id,
      'driver_profile_id', assignment_record.driver_profile_id,
      'driver_user_id', actor,
      'reason', btrim(target_reason),
      'previous_assignment_status', assignment_record.status,
      'next_assignment_status', 'reassigned'
    )
  );

  return assignment_record.id;
end;
$$;

revoke all on function public.release_logistics_driver_assignment(uuid,text,text) from public, anon;
grant execute on function public.release_logistics_driver_assignment(uuid,text,text) to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
