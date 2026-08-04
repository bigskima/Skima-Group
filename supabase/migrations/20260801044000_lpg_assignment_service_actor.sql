begin;

create or replace function public.accept_lpg_driver_assignment(
  target_lpg_order_id uuid,
  target_idempotency_key text,
  target_source text default 'lpg.driver_api',
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  driver_record record;
  accepted_dispatch_request_id uuid;
  resolved_tracking_session_id uuid;
  existing_tracking record;
  actor_user_id uuid;
  public_metadata jsonb;
begin
  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  actor_user_id := auth.uid();

  if auth.role() = 'service_role' then
    actor_user_id := nullif(target_metadata ->> 'server_actor_user_id', '')::uuid;
  end if;

  if actor_user_id is null then
    raise exception 'authenticated user is required';
  end if;

  public_metadata := target_metadata - 'server_actor_user_id';

  select target_order.*
  into order_record
  from public.lpg_refill_orders target_order
  where target_order.id = target_lpg_order_id
  for update;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if order_record.status = 'driver_accepted' then
    return order_record.id;
  end if;

  if order_record.status <> 'driver_offered' then
    raise exception 'LPG assignment can only be accepted after a driver offer';
  end if;

  select driver.*
  into driver_record
  from public.driver_profiles driver
  where driver.id = order_record.driver_profile_id
    and driver.user_id = actor_user_id
    and driver.verification_status = 'approved';

  if not found then
    raise exception 'assigned approved LPG driver is required';
  end if;

  accepted_dispatch_request_id := nullif(order_record.metadata ->> 'dispatch_request_id', '')::uuid;

  if order_record.tracking_session_id is not null then
    resolved_tracking_session_id := order_record.tracking_session_id;
  else
    select existing.*
    into existing_tracking
    from public.tracking_sessions existing
    where existing.source = 'lpg.tracking_engine'
      and existing.idempotency_key = target_idempotency_key || ':tracking-session';

    if found then
      resolved_tracking_session_id := existing_tracking.id;
    else
      insert into public.tracking_sessions (
        subject_type,
        subject_id,
        status,
        started_by,
        metadata,
        source,
        idempotency_key
      )
      values (
        'lpg_order',
        order_record.id,
        'active',
        actor_user_id,
        public_metadata || jsonb_build_object('driver_profile_id', order_record.driver_profile_id),
        'lpg.tracking_engine',
        target_idempotency_key || ':tracking-session'
      )
      returning id into resolved_tracking_session_id;

      insert into public.tracking_session_events (
        tracking_session_id,
        status,
        idempotency_key,
        metadata
      )
      values (
        resolved_tracking_session_id,
        'active',
        target_idempotency_key || ':tracking-session:started',
        jsonb_build_object('source', target_source, 'lpg_order_id', order_record.id)
      )
      on conflict do nothing;
    end if;
  end if;

  update public.lpg_refill_orders
  set status = 'driver_accepted',
      assignment_status = 'driver_assigned',
      tracking_session_id = resolved_tracking_session_id,
      metadata = metadata || public_metadata || jsonb_build_object(
        'driver_acceptance_source',
        target_source,
        'driver_acceptance_idempotency_key',
        target_idempotency_key
      ),
      updated_at = timezone('utc', now())
  where id = order_record.id;

  update public.service_requests
  set status = 'assigned',
      updated_at = timezone('utc', now())
  where id = order_record.service_request_id;

  if order_record.order_record_id is not null then
    update public.order_records
    set status = 'accepted',
        accepted_at = coalesce(accepted_at, timezone('utc', now())),
        updated_at = timezone('utc', now())
    where id = order_record.order_record_id;
  end if;

  if accepted_dispatch_request_id is not null then
    perform public.assign_dispatch_request(
      accepted_dispatch_request_id,
      'driver',
      order_record.driver_profile_id,
      target_idempotency_key || ':dispatch-assigned',
      jsonb_build_object('vehicle_id', order_record.vehicle_id)
    );

    update public.dispatch_candidates
    set status = case
          when candidate_entity_id = order_record.driver_profile_id then 'accepted'
          else 'expired'
        end,
        updated_at = timezone('utc', now())
    where public.dispatch_candidates.dispatch_request_id = accepted_dispatch_request_id
      and candidate_entity_type = 'driver';
  end if;

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.dispatch.driver_accepted',
    order_record.status,
    'driver_accepted',
    target_idempotency_key || ':event',
    public_metadata || jsonb_build_object('tracking_session_id', resolved_tracking_session_id)
  );

  return order_record.id;
end;
$$;

commit;
