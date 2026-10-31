begin;

-- Completing the customer's verified delivery hand-off must advance the
-- authoritative LPG order state. The delivered event is the established
-- hand-off that releases marketplace driver commission / closes managed jobs.
do $migration$
declare
  function_sql text;
  old_verify_block text := $old$
  update public.lpg_refill_orders
  set delivery_challenge_id = target_challenge_id,
      updated_at = timezone('utc', now())
  where id = order_record.id;

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.delivery.challenge_verified',
    order_record.status,
    order_record.status,
    target_idempotency_key || ':event',
    jsonb_build_object('challenge_id', verified_challenge_id)
  );

  return verified_challenge_id;
$old$;
  new_verify_block text := $new$
  if order_record.delivery_challenge_id is distinct from target_challenge_id then
    raise exception 'delivery challenge is not the current challenge for this LPG order';
  end if;

  if order_record.status not in ('delivery_verification_pending', 'delivered', 'completed') then
    raise exception 'delivery cannot be completed from the current LPG order status';
  end if;

  if order_record.status = 'completed' then
    return verified_challenge_id;
  end if;

  if order_record.status = 'delivery_verification_pending' then
    update public.lpg_refill_orders
    set status = 'delivered',
        updated_at = timezone('utc', now())
    where id = order_record.id
      and status = 'delivery_verification_pending';

    if not found then
      raise exception 'LPG order changed while completing the customer hand-over; refresh and retry';
    end if;
  end if;

  -- This event fires the existing atomic release workflow. Marketplace jobs
  -- execute the locked driver payout policy; Station Managed jobs close the
  -- station assignment and remain payable by their station.
  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.delivery.completed',
    order_record.status,
    'delivered',
    target_idempotency_key || ':delivery-completed',
    jsonb_build_object(
      'challenge_id', verified_challenge_id,
      'verification', 'customer_otp',
      'customer_user_id', order_record.customer_user_id
    )
  );

  return verified_challenge_id;
$new$;
begin
  select pg_get_functiondef(
    'public.verify_lpg_delivery_challenge(uuid,uuid,text,text,jsonb)'::regprocedure
  ) into function_sql;

  if position(old_verify_block in function_sql) = 0 then
    raise exception 'verify_lpg_delivery_challenge body has changed; refusing an unsafe patch';
  end if;

  function_sql := replace(function_sql, old_verify_block, new_verify_block);
  execute function_sql;
end;
$migration$;

-- The delivery-completion trigger executes in the customer's verified
-- confirmation transaction. Permit that customer to provision only the
-- assigned, approved marketplace driver's own NGN/currency wallet for this
-- exact completed order. This is wallet creation only: it does not authorize
-- withdrawals, balance changes or arbitrary driver-wallet creation.
do $migration$
declare
  function_sql text;
  old_wallet_guard text := $old$
  can_create_driver_wallet :=
    target_wallet_type = 'driver'
    and target_owner_entity_type = 'driver'
    and exists (
      select 1
      from public.driver_profiles driver
      where driver.id = target_owner_entity_id
        and driver.user_id = auth.uid()
        and driver.verification_status = 'approved'
    );
$old$;
  new_wallet_guard text := $new$
  can_create_driver_wallet :=
    target_wallet_type = 'driver'
    and target_owner_entity_type = 'driver'
    and (
      exists (
        select 1
        from public.driver_profiles driver
        where driver.id = target_owner_entity_id
          and driver.user_id = auth.uid()
          and driver.verification_status = 'approved'
      )
      or exists (
        select 1
        from public.lpg_refill_orders verified_order
        join public.driver_profiles assigned_driver
          on assigned_driver.id = verified_order.driver_profile_id
        where verified_order.customer_user_id = auth.uid()
          and verified_order.driver_profile_id = target_owner_entity_id
          and assigned_driver.verification_status = 'approved'
          and verified_order.fulfillment_mode = 'independent_driver'
          and verified_order.fulfillment_channel = 'marketplace'
          and verified_order.status in ('delivered', 'completed')
          and verified_order.station_settlement_execution_id is not null
          and verified_order.delivery_challenge_id is not null
          and public.lpg_delivery_challenge_is_verified(
            verified_order.id,
            verified_order.delivery_challenge_id
          )
      )
      or (
        pg_trigger_depth() > 0
        and target_source = 'lpg.wallet_engine'
        and nullif(btrim(target_metadata ->> 'lpg_order_id'), '') is not null
        and exists (
          select 1
          from public.lpg_refill_orders verified_order
          join public.driver_profiles assigned_driver
            on assigned_driver.id = verified_order.driver_profile_id
          where verified_order.id::text = target_metadata ->> 'lpg_order_id'
            and verified_order.driver_profile_id = target_owner_entity_id
            and verified_order.fulfillment_mode = 'independent_driver'
            and verified_order.fulfillment_channel = 'marketplace'
            and verified_order.status = 'delivered'
            and verified_order.currency_code = target_currency_code
            and verified_order.station_settlement_execution_id is not null
            and verified_order.metadata ->> 'platform_revenue_classification_transaction_id' is not null
            and verified_order.driver_commission_execution_id is null
            and verified_order.delivery_challenge_id is not null
            and assigned_driver.verification_status = 'approved'
            and public.lpg_delivery_challenge_is_verified(
              verified_order.id,
              verified_order.delivery_challenge_id
            )
        )
      )
    );
$new$;
begin
  select pg_get_functiondef(
    'public.ensure_wallet_account(text,text,uuid,text,text,jsonb,text)'::regprocedure
  ) into function_sql;

  if position(old_wallet_guard in function_sql) = 0 then
    raise exception 'ensure_wallet_account guard has changed; refusing an unsafe patch';
  end if;

  function_sql := replace(function_sql, old_wallet_guard, new_wallet_guard);
  execute function_sql;
end;
$migration$;

-- Recover orders where the OTP was already accepted before this migration,
-- but the old verification function never transitioned the order to delivered.
-- Only server-verified, current challenges with completed station settlement
-- are eligible. Station Managed jobs additionally require an active driver
-- assignment; the established delivered-event trigger performs their correct
-- station-owned completion, or the marketplace commission execution.
do $migration$
declare
  stuck_order record;
begin
  for stuck_order in
    select
      order_record.id,
      order_record.status,
      order_record.customer_user_id,
      order_record.delivery_challenge_id,
      order_record.fulfillment_channel,
      order_record.fulfillment_mode
    from public.lpg_refill_orders order_record
    where order_record.status = 'delivery_verification_pending'
      and order_record.delivery_challenge_id is not null
      and order_record.station_settlement_execution_id is not null
      and order_record.driver_profile_id is not null
      and public.lpg_delivery_challenge_is_verified(
        order_record.id,
        order_record.delivery_challenge_id
      )
      and (
        order_record.fulfillment_mode is distinct from 'station_managed'
        or exists (
          select 1
          from public.lpg_station_managed_driver_assignments station_assignment
          where station_assignment.lpg_order_id = order_record.id
            and station_assignment.status in ('assigned', 'accepted', 'en_route', 'delivered')
        )
      )
      and (
        coalesce(order_record.fulfillment_channel, 'marketplace') <> 'marketplace'
        or exists (
          select 1
          from public.driver_profiles assigned_driver
          where assigned_driver.id = order_record.driver_profile_id
            and assigned_driver.verification_status = 'approved'
            and assigned_driver.user_id is not null
        )
      )
    order by order_record.updated_at, order_record.id
    for update
  loop
    update public.lpg_refill_orders
    set status = 'delivered',
        updated_at = timezone('utc', now())
    where id = stuck_order.id
      and status = 'delivery_verification_pending';

    if found then
      perform public.record_lpg_order_event(
        stuck_order.id,
        'lpg.delivery.completed',
        stuck_order.status,
        'delivered',
        'lpg-delivery-otp-completion-backfill:' || stuck_order.id::text,
        jsonb_build_object(
          'challenge_id', stuck_order.delivery_challenge_id,
          'verification', 'previously_verified_customer_otp',
          'customer_user_id', stuck_order.customer_user_id,
          'repair', '20261031120000_lpg_delivery_otp_completion_and_payout_bridge'
        )
      );
    end if;
  end loop;
end;
$migration$;

commit;
