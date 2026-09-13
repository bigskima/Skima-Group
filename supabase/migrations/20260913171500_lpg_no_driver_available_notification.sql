begin;

create or replace function public.notify_lpg_dispatch_deferred_customer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  order_record record;
  notification_policy jsonb;
  channel_name text;
  provider_key text;
  dispatch_error text;
begin
  if new.event_type <> 'lpg.lifecycle.dispatch_deferred' then
    return new;
  end if;

  dispatch_error := coalesce(new.metadata ->> 'error', '');
  if dispatch_error not ilike '%no eligible LPG driver%' then
    return new;
  end if;

  select target_order.*
  into order_record
  from public.lpg_refill_orders target_order
  where target_order.id = new.lpg_order_id;

  if not found
    or order_record.status not in ('payment_reserved', 'matching_driver')
    or order_record.customer_user_id is null then
    return new;
  end if;

  notification_policy := public.lpg_policy_config('lpg.notification.phase_one');
  channel_name := notification_policy ->> 'channel';
  provider_key := notification_policy ->> 'provider_adapter_key';

  if channel_name is null or provider_key is null then
    return new;
  end if;

  perform public.queue_communication_message(
    channel_name,
    'lpg.order.driver_unavailable',
    'user',
    order_record.customer_user_id,
    null,
    jsonb_build_object(
      'title', 'No Driver available yet',
      'body', 'Your payment is secured, but no eligible Driver is available right now. SKIMA will keep the order queued for matching and you do not need to create another order.',
      'category', 'order',
      'deepLink', '/(customer)/orders/' || order_record.id::text,
      'lpgOrderId', order_record.id,
      'publicReference', order_record.public_reference,
      'status', order_record.status,
      'event', 'driver_unavailable'
    ),
    provider_key,
    'lpg.lifecycle_worker',
    new.idempotency_key || ':customer:driver-unavailable',
    jsonb_build_object(
      'recipient_role', 'customer',
      'event_type', 'lpg.order.driver_unavailable',
      'public_reference', order_record.public_reference,
      'source_event_id', new.id
    )
  );

  return new;
end;
$$;

revoke all on function public.notify_lpg_dispatch_deferred_customer() from public, anon, authenticated;

drop trigger if exists lpg_order_events_notify_dispatch_deferred_customer
  on public.lpg_order_events;

create trigger lpg_order_events_notify_dispatch_deferred_customer
after insert on public.lpg_order_events
for each row
when (new.event_type = 'lpg.lifecycle.dispatch_deferred')
execute function public.notify_lpg_dispatch_deferred_customer();

commit;