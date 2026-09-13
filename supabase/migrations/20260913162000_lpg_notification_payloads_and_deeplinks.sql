begin;

create or replace function public.queue_lpg_order_status_notifications(
  target_lpg_order_id uuid,
  target_idempotency_key text,
  target_source text default 'lpg.lifecycle_worker'
)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  order_record record;
  driver_user_id uuid;
  station_org_id uuid;
  notification_policy jsonb;
  channel_name text;
  provider_key text;
  queued_count integer := 0;
  customer_title text;
  customer_body text;
  driver_title text;
  driver_body text;
  station_title text;
  station_body text;
  customer_category text := 'order';
  driver_category text := 'order';
  station_category text := 'order';
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.communications.manage', null)
    and not public.can_manage_lpg_operations() then
    raise exception 'communication management permission is required';
  end if;

  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select target_order.*
  into order_record
  from public.lpg_refill_orders target_order
  where target_order.id = target_lpg_order_id;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  notification_policy := public.lpg_policy_config('lpg.notification.phase_one');
  channel_name := notification_policy ->> 'channel';
  provider_key := notification_policy ->> 'provider_adapter_key';

  if channel_name is null or provider_key is null then
    raise exception 'LPG notification policy is incomplete';
  end if;

  select driver.user_id
  into driver_user_id
  from public.driver_profiles driver
  where driver.id = order_record.driver_profile_id;

  select station.organization_id
  into station_org_id
  from public.lpg_station_branches station
  where station.id = order_record.station_branch_id;

  customer_title := case order_record.status
    when 'awaiting_payment' then 'Payment required'
    when 'payment_reserved' then 'Payment confirmed'
    when 'matching_station' then 'Finding a station'
    when 'matching_driver' then 'Finding a driver'
    when 'driver_offered' then 'Driver matching in progress'
    when 'driver_accepted' then 'Driver assigned'
    when 'pickup_en_route' then 'Driver is on the way'
    when 'pickup_verified' then 'Cylinder picked up'
    when 'station_en_route' then 'Heading to the station'
    when 'station_verified' then 'Station received your cylinder'
    when 'refill_in_progress' then 'Refill started'
    when 'refill_confirmed' then 'Refill completed'
    when 'station_settled' then 'Station processing complete'
    when 'return_en_route' then 'Cylinder is returning'
    when 'delivery_verification_pending' then 'Confirm your delivery'
    when 'delivered' then 'Delivery completed'
    when 'completed' then 'Order completed'
    when 'cancelled' then 'Order cancelled'
    when 'refunded' then 'Refund completed'
    when 'disputed' then 'Order under review'
    when 'failed' then 'Order needs attention'
    when 'expired' then 'Payment expired'
    else 'LPG order update'
  end;

  customer_body := case order_record.status
    when 'awaiting_payment' then 'Complete payment to continue your LPG refill order.'
    when 'payment_reserved' then 'Your payment is secured and SKIMA is preparing fulfillment.'
    when 'matching_station' then 'SKIMA is finding an eligible station for your refill.'
    when 'matching_driver' then 'SKIMA is matching an available driver to your order.'
    when 'driver_offered' then 'A driver match is being confirmed for your order.'
    when 'driver_accepted' then 'A driver accepted your order. You can follow the order from tracking.'
    when 'pickup_en_route' then 'Your driver is heading to your pickup location.'
    when 'pickup_verified' then 'Your cylinder pickup has been confirmed.'
    when 'station_en_route' then 'Your cylinder is on the way to the assigned station.'
    when 'station_verified' then 'The station confirmed receipt of your cylinder.'
    when 'refill_in_progress' then 'The station has started your LPG refill.'
    when 'refill_confirmed' then 'Your refill has been completed and recorded.'
    when 'station_settled' then 'The station stage is complete and your order is moving to return delivery.'
    when 'return_en_route' then 'Your refilled cylinder is on the way back to you.'
    when 'delivery_verification_pending' then 'Your cylinder has arrived. Confirm delivery to complete the order.'
    when 'delivered' then 'Delivery has been recorded successfully.'
    when 'completed' then 'Your LPG refill order is complete.'
    when 'cancelled' then 'This LPG order has been cancelled.'
    when 'refunded' then 'The applicable refund for this order has been completed.'
    when 'disputed' then 'This order is under review. SKIMA will keep the relevant funds protected while it is resolved.'
    when 'failed' then 'This LPG order could not continue. Open it for the latest details.'
    when 'expired' then 'The payment window expired before payment was confirmed. The order is no longer active.'
    else 'Your LPG order status has changed.'
  end;

  if order_record.status in ('refunded') then
    customer_category := 'wallet';
  end if;

  perform public.queue_communication_message(
    channel_name,
    'lpg.order.' || order_record.status,
    'user',
    order_record.customer_user_id,
    null,
    jsonb_build_object(
      'title', customer_title,
      'body', customer_body,
      'category', customer_category,
      'deepLink', '/(customer)/orders/' || order_record.id::text,
      'lpgOrderId', order_record.id,
      'publicReference', order_record.public_reference,
      'status', order_record.status
    ),
    provider_key,
    target_source,
    target_idempotency_key || ':customer:' || order_record.status,
    jsonb_build_object(
      'recipient_role', 'customer',
      'event_type', 'lpg.order.' || order_record.status,
      'public_reference', order_record.public_reference
    )
  );
  queued_count := queued_count + 1;

  if driver_user_id is not null and order_record.status in (
    'driver_offered','driver_accepted','pickup_en_route','pickup_verified','station_en_route',
    'station_verified','refill_confirmed','station_settled','return_en_route',
    'delivery_verification_pending','delivered','completed','cancelled','refunded','disputed','failed'
  ) then
    driver_title := case order_record.status
      when 'driver_offered' then 'New LPG job available'
      when 'driver_accepted' then 'LPG job accepted'
      when 'pickup_en_route' then 'Pickup is active'
      when 'pickup_verified' then 'Pickup confirmed'
      when 'station_en_route' then 'Proceed to the station'
      when 'station_verified' then 'Station handoff confirmed'
      when 'refill_confirmed' then 'Refill is ready'
      when 'station_settled' then 'Return delivery can continue'
      when 'return_en_route' then 'Return delivery active'
      when 'delivery_verification_pending' then 'Customer confirmation pending'
      when 'delivered' then 'Delivery recorded'
      when 'completed' then 'Job completed'
      when 'cancelled' then 'Job cancelled'
      when 'refunded' then 'Order refunded'
      when 'disputed' then 'Job under review'
      when 'failed' then 'Job needs attention'
      else 'LPG job update'
    end;

    driver_body := case order_record.status
      when 'driver_offered' then 'Review the LPG job and respond before the offer expires.'
      when 'driver_accepted' then 'The job is assigned to you. Follow the next operational step in SKIMA.'
      when 'pickup_en_route' then 'Continue to the customer pickup location.'
      when 'pickup_verified' then 'Cylinder pickup has been verified.'
      when 'station_en_route' then 'Continue to the assigned station.'
      when 'station_verified' then 'The station confirmed the cylinder handoff.'
      when 'refill_confirmed' then 'The refill is complete and ready for return.'
      when 'station_settled' then 'The station stage is complete. Continue the return workflow.'
      when 'return_en_route' then 'Return the cylinder to the customer.'
      when 'delivery_verification_pending' then 'Delivery is awaiting customer confirmation.'
      when 'delivered' then 'Delivery has been recorded.'
      when 'completed' then 'This LPG job is complete.'
      when 'cancelled' then 'This LPG job was cancelled. No further action is required.'
      when 'refunded' then 'The related order was refunded.'
      when 'disputed' then 'The related order is under review.'
      when 'failed' then 'This job could not continue. Open it for the latest details.'
      else 'Your LPG job status changed.'
    end;

    perform public.queue_communication_message(
      channel_name,
      'lpg.order.' || order_record.status,
      'user',
      driver_user_id,
      null,
      jsonb_build_object(
        'title', driver_title,
        'body', driver_body,
        'category', driver_category,
        'deepLink', '/(driver)/job/' || order_record.id::text,
        'lpgOrderId', order_record.id,
        'publicReference', order_record.public_reference,
        'status', order_record.status
      ),
      provider_key,
      target_source,
      target_idempotency_key || ':driver:' || order_record.status,
      jsonb_build_object(
        'recipient_role', 'driver',
        'event_type', 'lpg.order.' || order_record.status,
        'public_reference', order_record.public_reference
      )
    );
    queued_count := queued_count + 1;
  end if;

  if station_org_id is not null and order_record.status in (
    'driver_offered','driver_accepted','pickup_verified','station_en_route','station_verified',
    'refill_in_progress','refill_confirmed','station_settled','return_en_route',
    'completed','cancelled','refunded','disputed','failed'
  ) then
    station_title := case order_record.status
      when 'driver_offered' then 'Incoming LPG order'
      when 'driver_accepted' then 'Driver assigned to Station job'
      when 'pickup_verified' then 'Cylinder pickup confirmed'
      when 'station_en_route' then 'Cylinder heading to Station'
      when 'station_verified' then 'Cylinder received'
      when 'refill_in_progress' then 'Refill in progress'
      when 'refill_confirmed' then 'Refill completed'
      when 'station_settled' then 'Station settlement released'
      when 'return_en_route' then 'Cylinder leaving Station'
      when 'completed' then 'Station job completed'
      when 'cancelled' then 'Station job cancelled'
      when 'refunded' then 'Order refunded'
      when 'disputed' then 'Order under review'
      when 'failed' then 'Station job needs attention'
      else 'Station LPG update'
    end;

    station_body := case order_record.status
      when 'driver_offered' then 'A paid LPG order is entering the Station workflow.'
      when 'driver_accepted' then 'A driver has accepted the LPG order assigned to this Station.'
      when 'pickup_verified' then 'The customer cylinder pickup has been verified.'
      when 'station_en_route' then 'The cylinder is on the way to this Station.'
      when 'station_verified' then 'Station receipt has been confirmed. Continue the refill workflow.'
      when 'refill_in_progress' then 'The refill workflow is active.'
      when 'refill_confirmed' then 'The actual refill quantity has been recorded.'
      when 'station_settled' then 'The applicable Station earnings for this order have been released.'
      when 'return_en_route' then 'The cylinder has left the Station for return delivery.'
      when 'completed' then 'This Station LPG job is complete.'
      when 'cancelled' then 'This Station LPG job was cancelled.'
      when 'refunded' then 'The related customer order was refunded.'
      when 'disputed' then 'This order is under review.'
      when 'failed' then 'This Station job could not continue. Open it for the latest details.'
      else 'The Station LPG job status changed.'
    end;

    if order_record.status = 'station_settled' then
      station_category := 'wallet';
    end if;

    perform public.queue_communication_message(
      channel_name,
      'lpg.order.' || order_record.status,
      'organization',
      station_org_id,
      null,
      jsonb_build_object(
        'title', station_title,
        'body', station_body,
        'category', station_category,
        'deepLink', '/(station)/job/' || order_record.id::text,
        'lpgOrderId', order_record.id,
        'publicReference', order_record.public_reference,
        'status', order_record.status
      ),
      provider_key,
      target_source,
      target_idempotency_key || ':station:' || order_record.status,
      jsonb_build_object(
        'recipient_role', 'station',
        'event_type', 'lpg.order.' || order_record.status,
        'public_reference', order_record.public_reference
      )
    );
    queued_count := queued_count + 1;
  end if;

  return queued_count;
end;
$$;

commit;
