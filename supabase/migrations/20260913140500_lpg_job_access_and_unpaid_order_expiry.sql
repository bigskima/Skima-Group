begin;

-- Keep the unpaid-order timeout configurable in the existing LPG policy engine.
insert into public.lpg_operation_policies (
  key,
  display_name,
  policy_kind,
  priority,
  policy,
  status,
  source,
  idempotency_key,
  metadata
)
values (
  'lpg.order.payment_expiry',
  'LPG unpaid order expiry',
  'config',
  100,
  '{"unpaid_expiry_hours":24}'::jsonb,
  'active',
  'lpg.payment_expiry.seed',
  'lpg.payment_expiry.seed:v1',
  '{"purpose":"Expire abandoned unpaid LPG orders without deleting audit history"}'::jsonb
)
on conflict (key) do nothing;

-- Expired is an explicit terminal lifecycle state. It is intentionally different
-- from failed/cancelled because no payment was successfully completed.
alter table public.lpg_refill_orders
  drop constraint if exists lpg_refill_orders_status_check;

alter table public.lpg_refill_orders
  add constraint lpg_refill_orders_status_check
  check (status = any (array[
    'awaiting_payment'::text,
    'payment_reserved'::text,
    'matching_station'::text,
    'matching_driver'::text,
    'driver_offered'::text,
    'driver_accepted'::text,
    'pickup_en_route'::text,
    'pickup_verified'::text,
    'station_en_route'::text,
    'station_verified'::text,
    'refill_in_progress'::text,
    'refill_confirmed'::text,
    'station_settled'::text,
    'return_en_route'::text,
    'delivery_verification_pending'::text,
    'delivered'::text,
    'completed'::text,
    'cancelled'::text,
    'disputed'::text,
    'refunded'::text,
    'failed'::text,
    'expired'::text
  ]));

alter table public.lpg_refill_orders
  drop constraint if exists lpg_refill_orders_payment_status_check;

alter table public.lpg_refill_orders
  add constraint lpg_refill_orders_payment_status_check
  check (payment_status = any (array[
    'pending'::text,
    'reserved'::text,
    'failed'::text,
    'refunded'::text,
    'expired'::text
  ]));

-- Queue visibility and detail access must use the same branch-scoped station
-- permission. This keeps delegated station representatives from seeing a job in
-- the queue and then being rejected by the detail screen.
create or replace function public.can_access_lpg_order(target_lpg_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    auth.role() = 'service_role'
    or public.can_manage_lpg_operations()
    or exists (
      select 1
      from public.lpg_refill_orders target_order
      where target_order.id = target_lpg_order_id
        and target_order.customer_user_id = auth.uid()
    )
    or exists (
      select 1
      from public.lpg_refill_orders target_order
      join public.driver_profiles driver
        on driver.id = target_order.driver_profile_id
      where target_order.id = target_lpg_order_id
        and driver.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.lpg_refill_orders target_order
      join public.lpg_station_branches station
        on station.id = target_order.station_branch_id
      where target_order.id = target_lpg_order_id
        and public.user_can_operate_lpg_station_branch(
          auth.uid(),
          station.id,
          'lpg.orders.read'
        )
    );
$$;

create or replace function public.expire_stale_unpaid_lpg_orders(
  target_limit integer default 100
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_limit integer;
  expiry_hours integer;
  order_record record;
  reservation_record record;
  expired_count integer := 0;
  expired_at timestamptz;
begin
  if auth.role() <> 'service_role'
    and not public.can_manage_lpg_operations()
    and not public.can_execute_platform_runtime() then
    raise exception 'LPG lifecycle worker permission is required';
  end if;

  resolved_limit := least(greatest(coalesce(target_limit, 100), 1), 500);
  expiry_hours := greatest(
    coalesce(
      nullif(public.lpg_policy_config('lpg.order.payment_expiry') ->> 'unpaid_expiry_hours', '')::integer,
      24
    ),
    1
  );

  for order_record in
    select target_order.*
    from public.lpg_refill_orders target_order
    where target_order.status = 'awaiting_payment'
      and target_order.payment_status = 'pending'
      and target_order.created_at <= timezone('utc', now()) - make_interval(hours => expiry_hours)
      and target_order.escrow_hold_id is null
      and target_order.tracking_session_id is null
      and target_order.station_settlement_execution_id is null
      and target_order.station_settlement_statement_id is null
      and target_order.driver_commission_execution_id is null
      and target_order.underfill_refund_transaction_id is null
      and target_order.actual_kg is null
    order by target_order.created_at asc
    for update skip locked
    limit resolved_limit
  loop
    expired_at := timezone('utc', now());

    -- Defensive cleanup for any pre-payment dispatch artefacts. These should not
    -- normally exist for awaiting_payment orders, but they must never remain
    -- operational if an abandoned order is expired.
    if nullif(order_record.metadata ->> 'dispatch_request_id', '') is not null then
      update public.dispatch_candidates
      set status = 'expired',
          updated_at = expired_at
      where dispatch_request_id = (order_record.metadata ->> 'dispatch_request_id')::uuid
        and status in ('eligible', 'offered');

      update public.dispatch_requests
      set status = 'expired',
          updated_at = expired_at
      where id = (order_record.metadata ->> 'dispatch_request_id')::uuid
        and status not in ('completed', 'cancelled', 'expired');
    end if;

    for reservation_record in
      select reservation.*
      from public.lpg_station_capacity_reservations reservation
      where reservation.lpg_order_id = order_record.id
        and reservation.status = 'reserved'
      for update
    loop
      update public.lpg_station_capacity_reservations
      set status = 'expired',
          updated_at = expired_at
      where id = reservation_record.id;

      update public.lpg_station_branches
      set current_available_kg = current_available_kg + reservation_record.reserved_kg,
          availability_status = case
            when availability_status = 'capacity_reached' then 'available'
            else availability_status
          end,
          updated_at = expired_at
      where id = reservation_record.station_branch_id;
    end loop;

    update public.lpg_refill_orders
    set status = 'expired',
        payment_status = 'expired',
        assignment_status = 'unassigned',
        station_branch_id = null,
        driver_profile_id = null,
        vehicle_id = null,
        metadata = (
          metadata
          - 'dispatch_request_id'
          - 'dispatch_idempotency_key'
          - 'driver_offer_expires_at'
          - 'capacity_reservation_id'
        ) || jsonb_strip_nulls(jsonb_build_object(
          'paymentExpiredAt', expired_at,
          'paymentExpiryHours', expiry_hours,
          'expiredStationBranchId', order_record.station_branch_id,
          'expiredDriverProfileId', order_record.driver_profile_id,
          'expiredVehicleId', order_record.vehicle_id
        )),
        updated_at = expired_at
    where id = order_record.id
      and status = 'awaiting_payment'
      and payment_status = 'pending';

    if found then
      perform public.record_lpg_order_event(
        order_record.id,
        'lpg.order.payment_expired',
        'awaiting_payment',
        'expired',
        'lpg.payment-expiry:' || order_record.id::text,
        jsonb_build_object(
          'expiredAt', expired_at,
          'expiryHours', expiry_hours,
          'reason', 'payment_not_completed'
        )
      );

      perform public.queue_lpg_order_status_notifications(
        order_record.id,
        'lpg.payment-expiry:' || order_record.id::text || ':notifications',
        'lpg.lifecycle_worker'
      );

      expired_count := expired_count + 1;
    end if;
  end loop;

  return expired_count;
end;
$$;

revoke all on function public.expire_stale_unpaid_lpg_orders(integer) from public, anon, authenticated;
grant execute on function public.expire_stale_unpaid_lpg_orders(integer) to service_role;

-- The existing runtime worker already invokes process_lpg_order_lifecycle. Fold
-- payment expiry into that established worker instead of creating a second
-- scheduler or duplicated background system.
create or replace function public.process_lpg_order_lifecycle(target_limit integer default 50)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_limit integer;
  order_record record;
  processed_dispatch_count integer := 0;
  expired_offer_count integer := 0;
  expired_unpaid_count integer := 0;
  notification_count integer := 0;
  dispatch_error text;
begin
  if auth.role() <> 'service_role'
    and not public.can_manage_lpg_operations()
    and not public.can_execute_platform_runtime() then
    raise exception 'LPG lifecycle worker permission is required';
  end if;

  resolved_limit := least(greatest(coalesce(target_limit, 50), 1), 200);
  expired_unpaid_count := public.expire_stale_unpaid_lpg_orders(resolved_limit);

  for order_record in
    select target_order.*
    from public.lpg_refill_orders target_order
    where target_order.status = 'payment_reserved'
      and not (target_order.metadata ? 'dispatch_request_id')
    order by target_order.updated_at asc
    limit resolved_limit
  loop
    begin
      perform public.dispatch_lpg_order(
        order_record.id,
        (public.lpg_policy_config('lpg.dispatch.phase_one') ->> 'candidate_limit')::integer,
        'lpg.lifecycle:' || order_record.id::text || ':dispatch',
        'lpg.lifecycle_worker'
      );
      processed_dispatch_count := processed_dispatch_count + 1;
    exception when others then
      dispatch_error := sqlerrm;
      perform public.record_lpg_order_event(
        order_record.id,
        'lpg.lifecycle.dispatch_deferred',
        order_record.status,
        order_record.status,
        'lpg.lifecycle:' || order_record.id::text || ':dispatch-deferred',
        jsonb_build_object('error', dispatch_error)
      );
    end;
  end loop;

  for order_record in
    select target_order.*
    from public.lpg_refill_orders target_order
    where target_order.status = 'driver_offered'
      and nullif(target_order.metadata ->> 'driver_offer_expires_at', '')::timestamptz <= timezone('utc', now())
    order by target_order.updated_at asc
    limit resolved_limit
  loop
    update public.dispatch_candidates
    set status = 'expired',
        updated_at = timezone('utc', now())
    where dispatch_request_id = nullif(order_record.metadata ->> 'dispatch_request_id', '')::uuid
      and candidate_entity_type = 'driver'
      and status = 'offered';

    update public.dispatch_requests
    set status = 'expired',
        updated_at = timezone('utc', now())
    where id = nullif(order_record.metadata ->> 'dispatch_request_id', '')::uuid;

    update public.lpg_station_capacity_reservations
    set status = 'expired',
        updated_at = timezone('utc', now())
    where lpg_order_id = order_record.id
      and status = 'reserved';

    update public.lpg_station_branches station
    set current_available_kg = station.current_available_kg + reservation.reserved_kg,
        availability_status = case when station.availability_status = 'capacity_reached' then 'available' else station.availability_status end,
        updated_at = timezone('utc', now())
    from public.lpg_station_capacity_reservations reservation
    where reservation.lpg_order_id = order_record.id
      and reservation.station_branch_id = station.id
      and reservation.status = 'expired';

    update public.lpg_refill_orders
    set status = 'payment_reserved',
        assignment_status = 'station_assigned',
        driver_profile_id = null,
        vehicle_id = null,
        metadata = metadata - 'dispatch_request_id' - 'dispatch_idempotency_key' - 'driver_offer_expires_at' - 'capacity_reservation_id',
        updated_at = timezone('utc', now())
    where id = order_record.id;

    perform public.record_lpg_order_event(
      order_record.id,
      'lpg.dispatch.offer_expired',
      'driver_offered',
      'payment_reserved',
      'lpg.lifecycle:' || order_record.id::text || ':offer-expired',
      jsonb_build_object('expired_at', timezone('utc', now()))
    );

    expired_offer_count := expired_offer_count + 1;
  end loop;

  for order_record in
    select target_order.*
    from public.lpg_refill_orders target_order
    where target_order.status in ('payment_reserved','driver_offered','driver_accepted','pickup_verified','station_verified','refill_confirmed','station_settled','delivery_verification_pending','delivered','completed','refunded','disputed')
    order by target_order.updated_at desc
    limit resolved_limit
  loop
    notification_count := notification_count + public.queue_lpg_order_status_notifications(
      order_record.id,
      'lpg.lifecycle:' || order_record.id::text || ':notify:' || order_record.status,
      'lpg.lifecycle_worker'
    );
  end loop;

  return jsonb_build_object(
    'dispatched', processed_dispatch_count,
    'expiredOffers', expired_offer_count,
    'expiredUnpaidOrders', expired_unpaid_count,
    'notificationsQueued', notification_count
  );
end;
$$;

-- Active queues must never surface abandoned payment-expired records.
create or replace function public.read_lpg_jobs(
  target_queue text default null,
  target_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_limit integer;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_queue is not null
    and target_queue not in ('customer', 'driver', 'station', 'admin') then
    raise exception 'target_queue is not supported';
  end if;

  resolved_limit := least(greatest(coalesce(target_limit, 50), 1), 200);

  return coalesce((
    select jsonb_agg(job_payload order by (job_payload ->> 'updatedAt') desc)
    from (
      select jsonb_build_object(
        'queue', resolved.queue_name,
        'lpgOrderId', resolved.id,
        'publicReference', resolved.public_reference,
        'status', resolved.status,
        'assignmentStatus', resolved.assignment_status,
        'stationBranchId', resolved.station_branch_id,
        'stationDisplayName', station.display_name,
        'stationAddress', station.formatted_address,
        'driverProfileId', resolved.driver_profile_id,
        'driverDisplayName', assigned_driver.driver_display_name,
        'driverReference', assigned_driver.public_driver_id,
        'driverVerificationStatus', assigned_driver.verification_status,
        'cylinderId', resolved.cylinder_id,
        'cylinderReference', cylinder.public_reference,
        'cylinderIdentifier', cylinder.cylinder_identifier,
        'cylinderSizeKg', cylinder.size_kg,
        'cylinderTagStatus', cylinder.tag_status,
        'activeTagReference', active_tag.public_tag_reference,
        'requestedKg', resolved.requested_kg,
        'actualKg', resolved.actual_kg,
        'updatedAt', resolved.updated_at,
        'metadata', resolved.metadata
      ) as job_payload
      from (
        select 'customer' as queue_name, target_order.*
        from public.lpg_refill_orders target_order
        where (target_queue is null or target_queue = 'customer')
          and target_order.customer_user_id = auth.uid()
          and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed', 'expired')

        union all

        select 'driver' as queue_name, target_order.*
        from public.lpg_refill_orders target_order
        join public.driver_profiles driver on driver.id = target_order.driver_profile_id
        where (target_queue is null or target_queue = 'driver')
          and driver.user_id = auth.uid()
          and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed', 'expired')

        union all

        select 'station' as queue_name, target_order.*
        from public.lpg_refill_orders target_order
        join public.lpg_station_branches station_scope on station_scope.id = target_order.station_branch_id
        where (target_queue is null or target_queue = 'station')
          and public.user_can_operate_lpg_station_branch(auth.uid(), station_scope.id, 'lpg.orders.read')
          and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed', 'expired')

        union all

        select 'admin' as queue_name, target_order.*
        from public.lpg_refill_orders target_order
        where (target_queue is null or target_queue = 'admin')
          and (auth.role() = 'service_role' or public.can_manage_lpg_operations())
          and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed', 'expired')
      ) resolved
      join public.lpg_cylinders cylinder on cylinder.id = resolved.cylinder_id
      left join public.driver_profiles assigned_driver on assigned_driver.id = resolved.driver_profile_id
      left join public.lpg_station_branches station on station.id = resolved.station_branch_id
      left join lateral (
        select tag.public_tag_reference
        from public.lpg_cylinder_tags tag
        where tag.cylinder_id = resolved.cylinder_id
          and tag.status = 'active'
        order by tag.bound_at desc nulls last, tag.created_at desc
        limit 1
      ) active_tag on true
      order by resolved.updated_at desc
      limit resolved_limit
    ) jobs
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.read_lpg_jobs(text, integer) from public, anon;
grant execute on function public.read_lpg_jobs(text, integer) to authenticated, service_role;

commit;
