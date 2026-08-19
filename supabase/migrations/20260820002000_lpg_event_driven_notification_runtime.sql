begin;

-- ============================================================================
-- 1. NOTIFICATION RLS ENHANCEMENT:
--    Allow users to read their own messages & organization members to read org notifications
-- ============================================================================

drop policy if exists communication_messages_select_owner_or_privileged on public.communication_messages;

create policy communication_messages_select_owner_or_privileged on public.communication_messages
for select to authenticated
using (
  (recipient_entity_type = 'user' and recipient_entity_id = auth.uid())
  or (
    recipient_entity_type = 'organization'
    and exists (
      select 1
      from public.organization_memberships member
      where member.organization_id = communication_messages.recipient_entity_id
        and member.user_id = auth.uid()
        and member.status = 'active'
    )
  )
  or public.has_permission('platform.communications.read', null)
  or public.has_permission('platform.communications.manage', null)
);

-- ============================================================================
-- 2. UNIVERSAL NOTIFICATION EMITTER FUNCTION
-- ============================================================================

create or replace function public.emit_platform_notification(
  target_user_id uuid,
  target_title text,
  target_body text,
  target_category text,
  target_purpose text,
  target_deep_link text default null,
  target_entity_id uuid default null,
  target_source text default 'platform.event_engine',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  resolved_idempotency_key text;
  communication_id uuid;
begin
  if target_user_id is null then
    return null;
  end if;

  resolved_idempotency_key := coalesce(
    target_idempotency_key,
    'notif:' || target_user_id::text || ':' || target_purpose || ':' || extract(epoch from now())::text
  );

  select public.queue_communication_message(
    'in_app',
    target_purpose,
    'user',
    target_user_id,
    null,
    jsonb_build_object(
      'title', target_title,
      'body', target_body,
      'category', coalesce(target_category, 'general'),
      'deepLink', target_deep_link,
      'entityId', target_entity_id
    ) || target_metadata,
    'provider.communication.sandbox',
    target_source,
    resolved_idempotency_key,
    jsonb_build_object('category', target_category)
  ) into communication_id;

  return communication_id;
end;
$$;

-- ============================================================================
-- 3. WALLET TRANSACTION NOTIFICATION TRIGGER
-- ============================================================================

create or replace function public.trigger_wallet_transaction_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_record record;
  user_id_val uuid;
  title_val text;
  body_val text;
  category_val text := 'wallet';
  deep_link_val text := '/(customer)/wallet';
begin
  select * into wallet_record
  from public.wallets
  where id = new.wallet_id;

  if not found or wallet_record.owner_user_id is null then
    return new;
  end if;

  user_id_val := wallet_record.owner_user_id;

  if new.transaction_kind = 'deposit' or new.transaction_type = 'deposit' or new.transaction_kind = 'credit' then
    title_val := 'Top-up Successful';
    body_val := 'Your SKIMA Wallet has been credited with ' || coalesce(wallet_record.currency_code, 'NGN') || ' ' || new.amount::text || '.';
  elsif new.transaction_kind = 'withdrawal' or new.transaction_type = 'withdrawal' or new.transaction_kind = 'debit' then
    title_val := 'Withdrawal Processed';
    body_val := 'A withdrawal of ' || coalesce(wallet_record.currency_code, 'NGN') || ' ' || new.amount::text || ' from your wallet has been recorded.';
  elsif new.transaction_kind = 'refund' or new.transaction_type = 'refund' then
    title_val := 'Refund Received';
    body_val := 'A refund of ' || coalesce(wallet_record.currency_code, 'NGN') || ' ' || new.amount::text || ' has been credited to your wallet.';
  else
    title_val := 'Wallet Updated';
    body_val := 'Your wallet transaction of ' || coalesce(wallet_record.currency_code, 'NGN') || ' ' || new.amount::text || ' was confirmed.';
  end if;

  perform public.emit_platform_notification(
    user_id_val,
    title_val,
    body_val,
    category_val,
    'wallet.transaction.' || coalesce(new.transaction_kind, 'recorded'),
    deep_link_val,
    new.id,
    'platform.wallet_engine',
    'wallet-tx-notif:' || new.id::text,
    jsonb_build_object('amount', new.amount, 'wallet_id', new.wallet_id)
  );

  return new;
exception when others then
  -- Fail-safe so notification errors never block core financial ledger operations
  return new;
end;
$$;

drop trigger if exists wallet_transactions_notification_trigger on public.wallet_transactions;
create trigger wallet_transactions_notification_trigger
after insert on public.wallet_transactions
for each row execute function public.trigger_wallet_transaction_notification();

-- ============================================================================
-- 4. LPG ORDER LIFECYCLE NOTIFICATION ENHANCEMENT
-- ============================================================================

create or replace function public.trigger_lpg_order_lifecycle_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_title text;
  customer_body text;
  driver_title text;
  driver_body text;
  station_title text;
  station_body text;
  driver_user_id_val uuid;
  station_owner_user_id_val uuid;
  order_ref text;
begin
  order_ref := coalesce(new.public_reference, substr(new.id::text, 1, 8));

  -- Determine notification contents based on order status
  case new.status
    when 'created', 'draft' then
      customer_title := 'Order Placed';
      customer_body := 'Your LPG refill order #' || order_ref || ' has been placed.';
    when 'payment_confirmed', 'paid' then
      customer_title := 'Payment Confirmed';
      customer_body := 'Payment for order #' || order_ref || ' is confirmed. Matching station and driver.';
    when 'driver_assigned', 'driver_offered' then
      customer_title := 'Driver Assigned';
      customer_body := 'A SKIMA delivery driver has been assigned to order #' || order_ref || '.';
      driver_title := 'New Delivery Job Assigned';
      driver_body := 'You have a new refill delivery job for order #' || order_ref || '.';
    when 'pickup_en_route' then
      customer_title := 'Driver Heading to Pickup';
      customer_body := 'Your driver is heading to collect your empty cylinder.';
    when 'pickup_verified', 'cylinder_picked_up' then
      customer_title := 'Cylinder Collected';
      customer_body := 'Your empty cylinder has been collected and is en route to the station.';
      station_title := 'Cylinder En Route to Station';
      station_body := 'A driver is bringing cylinder for refill order #' || order_ref || '.';
    when 'station_verified', 'arrived_at_station' then
      customer_title := 'Cylinder at Station';
      customer_body := 'Your cylinder has arrived at the station for safety inspection and refill.';
      station_title := 'Cylinder Arrived for Refill';
      station_body := 'Cylinder for order #' || order_ref || ' has arrived at your station.';
    when 'refill_in_progress' then
      customer_title := 'Refill in Progress';
      customer_body := 'Your cylinder is being refilled with verified LPG.';
    when 'refill_confirmed' then
      customer_title := 'Refill Complete';
      customer_body := 'Your cylinder refill is complete and ready for return delivery.';
      driver_title := 'Refill Ready for Delivery';
      driver_body := 'Refilled cylinder for order #' || order_ref || ' is ready to be collected and delivered.';
    when 'return_en_route', 'delivery_en_route' then
      customer_title := 'Cylinder Returning to You';
      customer_body := 'Your filled cylinder is on the way back to your delivery location.';
    when 'delivery_arriving' then
      customer_title := 'Driver Arriving Now';
      customer_body := 'Your SKIMA driver is arriving at your address with your cylinder.';
    when 'delivered', 'completed' then
      customer_title := 'Delivery Completed';
      customer_body := 'Your LPG refill order #' || order_ref || ' has been safely delivered. Thank you!';
      driver_title := 'Delivery Completed';
      driver_body := 'Delivery for order #' || order_ref || ' confirmed. Earnings have been credited.';
    when 'cancelled' then
      customer_title := 'Order Cancelled';
      customer_body := 'Your LPG refill order #' || order_ref || ' was cancelled.';
    when 'refunded' then
      customer_title := 'Order Refunded';
      customer_body := 'Your LPG refill order #' || order_ref || ' was refunded to your wallet.';
    else
      customer_title := null;
  end case;

  -- Notify Customer
  if customer_title is not null and new.customer_user_id is not null then
    perform public.emit_platform_notification(
      new.customer_user_id,
      customer_title,
      customer_body,
      'order',
      'lpg.order.' || new.status,
      '/(customer)/orders',
      new.id,
      'lpg.order_engine',
      'order-notif-cust:' || new.id::text || ':' || new.status
    );
  end if;

  -- Resolve Driver User ID if driver profile assigned
  if new.driver_profile_id is not null then
    select user_id into driver_user_id_val
    from public.driver_profiles
    where id = new.driver_profile_id;

    if driver_user_id_val is not null and driver_title is not null then
      perform public.emit_platform_notification(
        driver_user_id_val,
        driver_title,
        driver_body,
        'order',
        'lpg.order.' || new.status,
        '/(driver)/jobs',
        new.id,
        'lpg.order_engine',
        'order-notif-driver:' || new.id::text || ':' || new.status
      );
    end if;
  end if;

  -- Resolve Station Owner User ID if station branch assigned
  if new.station_branch_id is not null then
    select (metadata ->> 'owner_user_id')::uuid into station_owner_user_id_val
    from public.lpg_station_branches
    where id = new.station_branch_id;

    if station_owner_user_id_val is not null and station_title is not null then
      perform public.emit_platform_notification(
        station_owner_user_id_val,
        station_title,
        station_body,
        'order',
        'lpg.order.' || new.status,
        '/(station)/inventory',
        new.id,
        'lpg.order_engine',
        'order-notif-station:' || new.id::text || ':' || new.status
      );
    end if;
  end if;

  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists lpg_refill_orders_notification_trigger on public.lpg_refill_orders;
create trigger lpg_refill_orders_notification_trigger
after insert or update of status on public.lpg_refill_orders
for each row execute function public.trigger_lpg_order_lifecycle_notification();

-- ============================================================================
-- 5. APPLICATION SUBMISSION & DECISION NOTIFICATION TRIGGERS
-- ============================================================================

create or replace function public.trigger_application_lifecycle_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  app_type_cat text;
  title_val text;
  body_val text;
  deep_link_val text;
begin
  select application_category into app_type_cat
  from public.application_type_definitions
  where id = new.application_type_id;

  deep_link_val := '/(customer)/' || case when app_type_cat = 'driver' then 'driver' else 'station' end || '-application';

  if (tg_op = 'INSERT' and new.status in ('submitted', 'under_review'))
     or (tg_op = 'UPDATE' and old.status <> new.status and new.status in ('submitted', 'under_review')) then
    title_val := case when app_type_cat = 'driver' then 'Driver Application Submitted' else 'Station Application Submitted' end;
    body_val := 'Your application has been received and is now being reviewed by SKIMA admin.';

    perform public.emit_platform_notification(
      new.applicant_user_id,
      title_val,
      body_val,
      'partner',
      'application.submitted',
      deep_link_val,
      new.id,
      'platform.application_engine',
      'app-submitted-notif:' || new.id::text || ':' || new.status
    );
  elsif tg_op = 'UPDATE' and old.status <> new.status and new.status = 'approved' then
    title_val := case when app_type_cat = 'driver' then 'Driver Application Approved' else 'Station Application Approved' end;
    body_val := 'Congratulations! Your SKIMA application has been approved. Final account activation is underway.';

    perform public.emit_platform_notification(
      new.applicant_user_id,
      title_val,
      body_val,
      'partner',
      'application.approved',
      deep_link_val,
      new.id,
      'platform.application_engine',
      'app-approved-notif:' || new.id::text || ':' || new.status
    );
  elsif tg_op = 'UPDATE' and old.status <> new.status and new.status = 'rejected' then
    title_val := case when app_type_cat = 'driver' then 'Driver Application Decision' else 'Station Application Decision' end;
    body_val := 'Your application was not approved at this time. Please view details in your account.';

    perform public.emit_platform_notification(
      new.applicant_user_id,
      title_val,
      body_val,
      'partner',
      'application.rejected',
      deep_link_val,
      new.id,
      'platform.application_engine',
      'app-rejected-notif:' || new.id::text || ':' || new.status
    );
  end if;

  return new;
exception when others then
  return new;
end;
$$;

drop trigger if exists application_records_notification_trigger on public.application_records;
create trigger application_records_notification_trigger
after insert or update of status on public.application_records
for each row execute function public.trigger_application_lifecycle_notification();

revoke all on function public.emit_platform_notification(uuid, text, text, text, text, text, uuid, text, text, jsonb) from public, anon;
grant execute on function public.emit_platform_notification(uuid, text, text, text, text, text, uuid, text, text, jsonb) to authenticated, service_role;

commit;
