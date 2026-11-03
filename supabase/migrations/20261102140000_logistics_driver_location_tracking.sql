begin;

alter table public.logistics_bookings
  add column if not exists tracking_session_id uuid references public.tracking_sessions(id) on delete set null;

create or replace function public.can_read_logistics_tracking_session(target_tracking_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.tracking_sessions session
    join public.logistics_bookings booking
      on booking.id = session.subject_id
     and booking.tracking_session_id = session.id
    where session.id = target_tracking_session_id
      and session.subject_type = 'logistics_booking'
      and (
        booking.requester_user_id = auth.uid()
        or public.can_read_logistics_company(booking.provider_organization_id)
        or public.has_permission('logistics.marketplace.read', null)
        or public.has_permission('logistics.marketplace.manage', null)
        or exists (
          select 1
          from public.logistics_booking_driver_assignments assignment
          where assignment.booking_id = booking.id
            and assignment.driver_user_id = auth.uid()
            and assignment.status not in ('rejected','reassigned','cancelled')
        )
      )
  );
$$;

drop policy if exists tracking_sessions_select_logistics_booking_participants on public.tracking_sessions;
create policy tracking_sessions_select_logistics_booking_participants
on public.tracking_sessions for select to authenticated
using (
  subject_type = 'logistics_booking'
  and public.can_read_logistics_tracking_session(id)
);

drop policy if exists tracking_points_select_logistics_booking_participants on public.tracking_points;
create policy tracking_points_select_logistics_booking_participants
on public.tracking_points for select to authenticated
using (public.can_read_logistics_tracking_session(tracking_session_id));

drop policy if exists tracking_session_events_select_logistics_booking_participants on public.tracking_session_events;
create policy tracking_session_events_select_logistics_booking_participants
on public.tracking_session_events for select to authenticated
using (public.can_read_logistics_tracking_session(tracking_session_id));

create or replace function public.record_logistics_driver_location(
  target_booking_id uuid,
  target_driver_user_id uuid,
  target_latitude numeric,
  target_longitude numeric,
  target_accuracy_meters numeric,
  target_speed_meters_per_second numeric,
  target_heading_degrees numeric,
  target_recorded_at timestamptz,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_record public.logistics_bookings%rowtype;
  tracking_session_id uuid;
  tracking_point_id uuid;
  point_metadata jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required';
  end if;

  if target_booking_id is null
    or target_driver_user_id is null
    or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'booking, driver and valid location idempotency key are required';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;

  if not found
    or booking_record.assigned_driver_user_id is distinct from target_driver_user_id then
    raise exception 'booking is not assigned to the authenticated driver';
  end if;
  if booking_record.status <> 'in_progress' then
    raise exception 'driver location can only be shared while a logistics booking is in progress';
  end if;
  if not exists (
    select 1
    from public.logistics_booking_driver_assignments assignment
    where assignment.booking_id = booking_record.id
      and assignment.driver_user_id = target_driver_user_id
      and assignment.status in ('in_progress','picked_up','in_transit')
  ) then
    raise exception 'an active driver assignment is required to share location';
  end if;

  if target_latitude is null or target_latitude < -90 or target_latitude > 90
    or target_longitude is null or target_longitude < -180 or target_longitude > 180 then
    raise exception 'valid latitude and longitude are required';
  end if;
  if target_accuracy_meters is not null and target_accuracy_meters < 0 then
    raise exception 'location accuracy must be greater than or equal to zero';
  end if;
  if target_speed_meters_per_second is not null and target_speed_meters_per_second < 0 then
    raise exception 'location speed must be greater than or equal to zero';
  end if;
  if target_heading_degrees is not null
    and (target_heading_degrees < 0 or target_heading_degrees >= 360) then
    raise exception 'location heading must be between zero and less than 360';
  end if;

  tracking_session_id := booking_record.tracking_session_id;
  if tracking_session_id is null then
    tracking_session_id := public.start_tracking_session(
      'platform.logistics.driver_tracking',
      'logistics_booking',
      booking_record.id,
      null,
      jsonb_build_object(
        'module_key','logistics_network',
        'booking_id',booking_record.id,
        'provider_organization_id',booking_record.provider_organization_id,
        'driver_user_id',target_driver_user_id
      ),
      'logistics-booking:' || booking_record.id::text || ':driver-tracking:v1'
    );

    update public.logistics_bookings
    set tracking_session_id = tracking_session_id,
        updated_at = timezone('utc', now())
    where id = booking_record.id;
  end if;

  point_metadata := jsonb_build_object(
    'module_key','logistics_network',
    'booking_id',booking_record.id,
    'driver_user_id',target_driver_user_id,
    'captured_from','skima-logistics-driver-workspace'
  );

  tracking_point_id := public.record_tracking_point(
    tracking_session_id,
    target_latitude,
    target_longitude,
    target_accuracy_meters,
    target_speed_meters_per_second,
    target_heading_degrees,
    point_metadata,
    coalesce(target_recorded_at,timezone('utc',now())),
    target_idempotency_key
  );

  return jsonb_build_object(
    'booking_id',booking_record.id,
    'tracking_session_id',tracking_session_id,
    'tracking_point_id',tracking_point_id,
    'recorded_at',coalesce(target_recorded_at,timezone('utc',now()))
  );
end;
$$;

create or replace function public.read_logistics_booking_tracking(target_booking_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  booking_record public.logistics_bookings%rowtype;
  tracking_record public.tracking_sessions%rowtype;
  points jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id;

  if not found then
    raise exception 'logistics booking was not found';
  end if;
  if booking_record.requester_user_id is distinct from auth.uid()
    and not public.can_read_logistics_company(booking_record.provider_organization_id)
    and not public.has_permission('logistics.marketplace.read',null)
    and not public.has_permission('logistics.marketplace.manage',null)
    and not exists (
      select 1
      from public.logistics_booking_driver_assignments assignment
      where assignment.booking_id = booking_record.id
        and assignment.driver_user_id = auth.uid()
        and assignment.status not in ('rejected','reassigned','cancelled')
    ) then
    raise exception 'tracking is available only to the customer, provider company and assigned driver';
  end if;

  if booking_record.tracking_session_id is null then
    return jsonb_build_object('booking_id',booking_record.id,'tracking_session',null,'points','[]'::jsonb);
  end if;

  select * into tracking_record
  from public.tracking_sessions
  where id = booking_record.tracking_session_id
    and subject_type = 'logistics_booking'
    and subject_id = booking_record.id;

  if not found then
    return jsonb_build_object('booking_id',booking_record.id,'tracking_session',null,'points','[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(point_row.point_data order by point_row.recorded_at asc),'[]'::jsonb)
  into points
  from (
    select
      jsonb_build_object(
        'latitude',point.latitude,
        'longitude',point.longitude,
        'accuracy_meters',point.accuracy_meters,
        'speed_meters_per_second',point.speed_meters_per_second,
        'heading_degrees',point.heading_degrees,
        'recorded_at',point.recorded_at
      ) as point_data,
      point.recorded_at
    from public.tracking_points point
    where point.tracking_session_id = tracking_record.id
    order by point.recorded_at desc
    limit 100
  ) point_row;

  return jsonb_build_object(
    'booking_id',booking_record.id,
    'tracking_session',jsonb_build_object(
      'id',tracking_record.id,
      'status',tracking_record.status,
      'started_at',tracking_record.started_at,
      'ended_at',tracking_record.ended_at
    ),
    'points',points
  );
end;
$$;

create or replace function public.finish_logistics_tracking_after_booking_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  closing_status text;
begin
  if new.tracking_session_id is null or old.status = new.status then
    return new;
  end if;

  if new.status in ('delivered','settled','completed_offline') then
    closing_status := 'completed';
  elsif new.status in ('cancelled','refunded') then
    closing_status := 'cancelled';
  else
    return new;
  end if;

  -- The booking may be closed by the customer, not the driver who started
  -- tracking. Update the shared tracking record as part of this trusted
  -- SECURITY DEFINER trigger instead of invoking the actor-restricted client RPC.
  perform tracking_session.id
  from public.tracking_sessions tracking_session
  where tracking_session.id = new.tracking_session_id
  for update;

  if not found then
    return new;
  end if;

  if exists (
    select 1 from public.tracking_sessions tracking_session
    where tracking_session.id = new.tracking_session_id
      and tracking_session.status in ('completed','cancelled')
  ) then
    return new;
  end if;

  update public.tracking_sessions
  set status = closing_status,
      ended_at = coalesce(ended_at,timezone('utc',now())),
      metadata = metadata || jsonb_build_object(
        'module_key','logistics_network',
        'booking_id',new.id,
        'closed_by_booking_status',new.status
      ),
      updated_at = timezone('utc',now())
  where id = new.tracking_session_id;

  insert into public.tracking_session_events (
    tracking_session_id,status,idempotency_key,metadata
  )
  values (
    new.tracking_session_id,
    closing_status,
    'logistics-booking:' || new.id::text || ':tracking:' || closing_status || ':v1',
    jsonb_build_object('module_key','logistics_network','booking_id',new.id,'booking_status',new.status)
  )
  on conflict (tracking_session_id,idempotency_key) do nothing;

  return new;
end;
$$;

drop trigger if exists logistics_tracking_after_booking_close on public.logistics_bookings;
create trigger logistics_tracking_after_booking_close
after update of status on public.logistics_bookings
for each row execute function public.finish_logistics_tracking_after_booking_close();

revoke all on function public.can_read_logistics_tracking_session(uuid) from public,anon;
revoke all on function public.record_logistics_driver_location(uuid,uuid,numeric,numeric,numeric,numeric,numeric,timestamptz,text) from public,anon,authenticated;
revoke all on function public.read_logistics_booking_tracking(uuid) from public,anon;
revoke all on function public.finish_logistics_tracking_after_booking_close() from public,anon;

grant execute on function public.can_read_logistics_tracking_session(uuid) to authenticated,service_role;
grant execute on function public.record_logistics_driver_location(uuid,uuid,numeric,numeric,numeric,numeric,numeric,timestamptz,text) to service_role;
grant execute on function public.read_logistics_booking_tracking(uuid) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
