begin;

-- Provider hand-off and customer-confirmed completion for the separate Logistics module.
-- Online settlement releases the existing service-request escrow through the shared
-- settlement engine. Offline completion records delivery only; its two applicable fees
-- were already posted when the offline booking was confirmed.

alter table public.logistics_bookings
  add column if not exists provider_accepted_at timestamptz,
  add column if not exists service_started_at timestamptz,
  add column if not exists delivery_submitted_at timestamptz,
  add column if not exists delivery_submitted_by uuid references public.profiles(id) on delete set null,
  add column if not exists delivery_submission_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(delivery_submission_snapshot) = 'object');

create index if not exists logistics_bookings_provider_active_idx
  on public.logistics_bookings (provider_organization_id, status, updated_at desc);

create or replace function public.accept_logistics_booking(
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
  existing_event public.logistics_booking_events%rowtype;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_booking_id is null or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'booking and valid idempotency key are required';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;
  if not found then raise exception 'logistics booking was not found'; end if;

  if not public.can_manage_logistics_company(booking_record.provider_organization_id)
    and not public.has_permission('business.logistics.jobs.manage', booking_record.provider_organization_id) then
    raise exception 'provider company booking management permission is required';
  end if;

  select * into existing_event
  from public.logistics_booking_events
  where booking_id = booking_record.id and idempotency_key = target_idempotency_key;
  if found then
    if existing_event.event_type <> 'logistics.booking.provider_accepted' then
      raise exception 'booking idempotency key was used for a different action';
    end if;
    return booking_record.id;
  end if;

  if booking_record.status = 'provider_accepted' then return booking_record.id; end if;
  if booking_record.payment_mode = 'online_wallet' and booking_record.status <> 'payment_reserved' then
    raise exception 'online booking must be paid into escrow before provider acceptance';
  end if;
  if booking_record.payment_mode = 'offline' and booking_record.status <> 'offline_payment_confirmed' then
    raise exception 'offline booking fees must be confirmed before provider acceptance';
  end if;

  update public.logistics_bookings
  set status = 'provider_accepted',
      provider_accepted_at = coalesce(provider_accepted_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = booking_record.id;

  update public.service_requests
  set status = 'workflow_started', updated_at = timezone('utc', now())
  where id = booking_record.service_request_id
    and status in ('requested', 'priced', 'payment_reserved');

  update public.order_records
  set status = case when status in ('received', 'accepted') then 'accepted' else status end,
      accepted_at = coalesce(accepted_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = booking_record.order_id;

  perform public.record_logistics_booking_event(
    booking_record.id, 'logistics.booking.provider_accepted', target_idempotency_key,
    booking_record.status, 'provider_accepted',
    jsonb_build_object('provider_organization_id', booking_record.provider_organization_id)
  );

  perform public.record_logistics_job_event(
    booking_record.job_id, 'logistics.booking.provider_accepted',
    target_idempotency_key || ':job',
    'booked', 'booked',
    jsonb_build_object('booking_id', booking_record.id, 'provider_organization_id', booking_record.provider_organization_id)
  );

  return booking_record.id;
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
  existing_event public.logistics_booking_events%rowtype;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_booking_id is null or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'booking and valid idempotency key are required';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;
  if not found then raise exception 'logistics booking was not found'; end if;

  if not public.can_manage_logistics_company(booking_record.provider_organization_id)
    and not public.has_permission('business.logistics.jobs.manage', booking_record.provider_organization_id) then
    raise exception 'provider company booking management permission is required';
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
      service_started_at = coalesce(service_started_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = booking_record.id;

  update public.service_requests
  set status = 'in_progress', updated_at = timezone('utc', now())
  where id = booking_record.service_request_id;

  update public.order_records
  set status = 'preparing',
      preparing_at = coalesce(preparing_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = booking_record.order_id;

  perform public.record_logistics_booking_event(
    booking_record.id, 'logistics.booking.service_started', target_idempotency_key,
    booking_record.status, 'in_progress', '{}'::jsonb
  );

  perform public.record_logistics_job_event(
    booking_record.job_id, 'logistics.booking.service_started',
    target_idempotency_key || ':job', 'booked', 'in_progress',
    jsonb_build_object('booking_id', booking_record.id)
  );

  update public.logistics_job_requests
  set status = 'in_progress', updated_at = timezone('utc', now())
  where id = booking_record.job_id;

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
  recipient_name text;
  delivery_note text;
  existing_event public.logistics_booking_events%rowtype;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_booking_id is null or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180
    or target_delivery_submission is null
    or jsonb_typeof(target_delivery_submission) <> 'object' then
    raise exception 'booking, delivery details and a valid idempotency key are required';
  end if;

  recipient_name := nullif(btrim(target_delivery_submission ->> 'recipient_name'), '');
  delivery_note := nullif(btrim(target_delivery_submission ->> 'delivery_note'), '');
  if recipient_name is null or char_length(recipient_name) not between 2 and 160 then
    raise exception 'the name of the person receiving the delivery is required';
  end if;
  if delivery_note is not null and char_length(delivery_note) > 1200 then
    raise exception 'delivery note must not exceed 1200 characters';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;
  if not found then raise exception 'logistics booking was not found'; end if;

  if not public.can_manage_logistics_company(booking_record.provider_organization_id)
    and not public.has_permission('business.logistics.jobs.manage', booking_record.provider_organization_id) then
    raise exception 'provider company delivery permission is required';
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
      delivery_submitted_at = timezone('utc', now()),
      delivery_submitted_by = actor,
      delivery_submission_snapshot = jsonb_strip_nulls(jsonb_build_object(
        'recipient_name', recipient_name,
        'delivery_note', delivery_note,
        'submitted_at', timezone('utc', now())
      )),
      updated_at = timezone('utc', now())
  where id = booking_record.id;

  update public.service_requests
  set status = 'fulfilled', updated_at = timezone('utc', now())
  where id = booking_record.service_request_id;

  update public.order_records
  set status = 'fulfilled',
      fulfilled_at = coalesce(fulfilled_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = booking_record.order_id;

  update public.logistics_job_requests
  set status = 'delivered', updated_at = timezone('utc', now())
  where id = booking_record.job_id;

  perform public.record_logistics_booking_event(
    booking_record.id, 'logistics.booking.delivery_submitted', target_idempotency_key,
    booking_record.status, 'delivered',
    jsonb_build_object('recipient_name', recipient_name, 'delivery_note', delivery_note)
  );

  perform public.record_logistics_job_event(
    booking_record.job_id, 'logistics.booking.delivery_submitted',
    target_idempotency_key || ':job', 'in_progress', 'delivered',
    jsonb_build_object('booking_id', booking_record.id, 'recipient_name', recipient_name)
  );

  return booking_record.id;
end;
$$;

create or replace function public.confirm_logistics_booking_delivery(
  target_booking_id uuid,
  target_requester_user_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_record public.logistics_bookings%rowtype;
  provider_wallet_id uuid;
  revenue_wallet_id uuid;
  settlement_id uuid;
  distribution jsonb := '[]'::jsonb;
  platform_revenue_amount numeric(28,8);
  current_status text;
begin
  if auth.role() <> 'service_role' then raise exception 'service role is required'; end if;
  if target_booking_id is null or target_requester_user_id is null
    or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'booking, requester and valid idempotency key are required';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;
  if not found or booking_record.requester_user_id <> target_requester_user_id then
    raise exception 'logistics booking was not found for the authenticated customer';
  end if;

  if booking_record.status in ('settled', 'completed_offline') then
    return jsonb_build_object(
      'booking_id', booking_record.id,
      'status', booking_record.status,
      'settlement_execution_id', booking_record.settlement_execution_id
    );
  end if;

  if booking_record.status <> 'delivered'
    or booking_record.delivery_submitted_at is null
    or booking_record.delivery_submitted_by is null then
    raise exception 'provider must submit delivery details before customer confirmation';
  end if;

  if booking_record.payment_mode = 'online_wallet' then
    if booking_record.escrow_hold_id is null then
      raise exception 'online booking is missing its protected escrow hold';
    end if;
    if booking_record.delivery_amount <= 0
      or booking_record.provider_net_amount <= 0 then
      raise exception 'online provider settlement amounts must be positive';
    end if;

    provider_wallet_id := public.ensure_wallet_account(
      'partner', 'organization', booking_record.provider_organization_id, booking_record.currency_code,
      'platform.logistics.wallet_engine',
      jsonb_build_object('module_key', 'logistics_network', 'wallet_role', 'provider'),
      'logistics-provider:' || booking_record.provider_organization_id::text || ':' || booking_record.currency_code
    );

    distribution := jsonb_build_array(jsonb_build_object(
      'wallet_id', provider_wallet_id,
      'amount', booking_record.provider_net_amount,
      'entry_type', 'principal',
      'metadata', jsonb_build_object('role', 'logistics_provider_net', 'booking_id', booking_record.id)
    ));

    platform_revenue_amount := booking_record.customer_booking_fee_amount + booking_record.provider_commission_amount;
    if platform_revenue_amount > 0 then
      revenue_wallet_id := public.ensure_platform_purpose_wallet(
        'platform_revenue', 'logistics_marketplace_fees', booking_record.currency_code,
        'platform.logistics.wallet_engine',
        'logistics-revenue:' || booking_record.currency_code
      );
      distribution := distribution || jsonb_build_array(jsonb_build_object(
        'wallet_id', revenue_wallet_id,
        'amount', platform_revenue_amount,
        'entry_type', 'fee',
        'metadata', jsonb_build_object(
          'role', 'logistics_platform_revenue',
          'booking_id', booking_record.id,
          'customer_booking_fee_amount', booking_record.customer_booking_fee_amount,
          'provider_commission_amount', booking_record.provider_commission_amount
        )
      ));
    end if;

    if booking_record.provider_net_amount + platform_revenue_amount <> booking_record.total_customer_charge then
      raise exception 'locked provider and platform settlement amounts do not equal the escrowed customer total';
    end if;

    settlement_id := public.execute_service_request_settlement(
      booking_record.service_request_id,
      booking_record.escrow_hold_id,
      distribution,
      'logistics-booking:' || booking_record.id::text || ':settlement:v1',
      'platform.logistics.settlement',
      jsonb_build_object(
        'booking_id', booking_record.id,
        'payment_mode', 'online_wallet',
        'policy_snapshot', booking_record.policy_snapshots,
        'delivery_submission', booking_record.delivery_submission_snapshot,
        'provider_net_amount', booking_record.provider_net_amount,
        'customer_booking_fee_amount', booking_record.customer_booking_fee_amount,
        'provider_commission_amount', booking_record.provider_commission_amount
      )
    );

    current_status := 'settled';
    update public.order_records
    set status = 'completed',
        completed_at = coalesce(completed_at, timezone('utc', now())),
        updated_at = timezone('utc', now())
    where id = booking_record.order_id;
  elsif booking_record.payment_mode = 'offline' then
    if (booking_record.customer_booking_fee_amount + booking_record.provider_receival_fee_amount) > 0
      and booking_record.offline_fee_transaction_id is null then
      raise exception 'configured offline booking fees must be confirmed before delivery completion';
    end if;
    -- The provider receives the delivery price offline. The platform already
    -- collected the customer booking fee and provider receival fee at confirmation.
    -- Do not run an online commission or escrow release for this payment mode.
    current_status := 'completed_offline';

    update public.service_requests
    set status = 'completed', updated_at = timezone('utc', now())
    where id = booking_record.service_request_id;

    update public.order_records
    set status = 'completed',
        completed_at = coalesce(completed_at, timezone('utc', now())),
        updated_at = timezone('utc', now())
    where id = booking_record.order_id;
  else
    raise exception 'booking payment mode is not supported';
  end if;

  update public.logistics_bookings
  set status = current_status,
      settlement_execution_id = settlement_id,
      delivery_verified_at = timezone('utc', now()),
      delivery_verified_by = target_requester_user_id,
      delivery_verification_snapshot = jsonb_build_object(
        'confirmed_by', target_requester_user_id,
        'confirmed_at', timezone('utc', now()),
        'delivery_submission_snapshot', booking_record.delivery_submission_snapshot
      ),
      updated_at = timezone('utc', now())
  where id = booking_record.id;

  update public.logistics_job_requests
  set status = 'completed', updated_at = timezone('utc', now())
  where id = booking_record.job_id;

  perform public.record_logistics_booking_event(
    booking_record.id, 'logistics.booking.delivery_confirmed',
    target_idempotency_key,
    booking_record.status, current_status,
    jsonb_build_object(
      'payment_mode', booking_record.payment_mode,
      'settlement_execution_id', settlement_id
    )
  );

  perform public.record_logistics_job_event(
    booking_record.job_id, 'logistics.booking.delivery_confirmed',
    target_idempotency_key || ':job',
    'delivered', 'completed',
    jsonb_build_object('booking_id', booking_record.id, 'payment_mode', booking_record.payment_mode)
  );

  return jsonb_build_object(
    'booking_id', booking_record.id,
    'status', current_status,
    'settlement_execution_id', settlement_id
  );
end;
$$;

-- Offline fee confirmation happens before provider acceptance. Keep the shared
-- service request in its requested state until the provider accepts the job.
create or replace function public.confirm_logistics_offline_booking_payment(
  target_booking_id uuid,
  target_requester_user_id uuid,
  target_customer_wallet_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_record public.logistics_bookings%rowtype;
  customer_wallet public.wallet_accounts%rowtype;
  provider_wallet_id uuid;
  revenue_wallet_id uuid;
  customer_balance numeric(28,8) := 0;
  provider_balance numeric(28,8) := 0;
  total_fee_amount numeric(28,8) := 0;
  transaction_entries jsonb := '[]'::jsonb;
  fee_transaction_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service role is required'; end if;
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) < 8 then
    raise exception 'valid idempotency key is required';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;
  if not found or booking_record.requester_user_id <> target_requester_user_id then
    raise exception 'logistics booking was not found for the authenticated customer';
  end if;

  if booking_record.payment_mode <> 'offline' then
    raise exception 'offline fee collection is not allowed for an online-wallet booking';
  end if;
  if booking_record.status = 'offline_payment_confirmed' then
    return jsonb_build_object(
      'booking_id', booking_record.id,
      'status', booking_record.status,
      'fee_transaction_id', booking_record.offline_fee_transaction_id
    );
  end if;
  if booking_record.status <> 'awaiting_offline_confirmation' then
    raise exception 'logistics booking is not awaiting offline payment confirmation';
  end if;

  select * into customer_wallet
  from public.wallet_accounts
  where id = target_customer_wallet_id
    and wallet_type = 'customer'
    and owner_entity_type = 'user'
    and owner_entity_id = target_requester_user_id
    and currency_code = booking_record.currency_code
    and status = 'active';
  if not found then raise exception 'an active customer wallet owned by this customer is required'; end if;

  provider_wallet_id := public.ensure_wallet_account(
    'partner', 'organization', booking_record.provider_organization_id, booking_record.currency_code,
    'platform.logistics.wallet_engine',
    jsonb_build_object('module_key', 'logistics_network', 'wallet_role', 'provider'),
    'logistics-provider:' || booking_record.provider_organization_id::text || ':' || booking_record.currency_code
  );

  revenue_wallet_id := public.ensure_platform_purpose_wallet(
    'platform_revenue', 'logistics_marketplace_fees', booking_record.currency_code,
    'platform.logistics.wallet_engine',
    'logistics-revenue:' || booking_record.currency_code
  );

  select coalesce((
    select balance.balance
    from public.wallet_balances balance
    where balance.wallet_id = customer_wallet.id
  ), 0) into customer_balance;

  select coalesce((
    select balance.balance
    from public.wallet_balances balance
    where balance.wallet_id = provider_wallet_id
  ), 0) into provider_balance;

  if booking_record.customer_booking_fee_amount > 0
    and customer_balance < booking_record.customer_booking_fee_amount then
    raise exception 'customer wallet has insufficient balance for the Logistics booking fee';
  end if;
  if booking_record.provider_receival_fee_amount > 0
    and provider_balance < booking_record.provider_receival_fee_amount then
    raise exception 'provider company wallet has insufficient balance for its offline receival fee';
  end if;

  if booking_record.customer_booking_fee_amount > 0 then
    transaction_entries := transaction_entries || jsonb_build_array(jsonb_build_object(
      'wallet_id', customer_wallet.id,
      'direction', 'debit',
      'amount', booking_record.customer_booking_fee_amount,
      'entry_type', 'fee',
      'metadata', jsonb_build_object('role', 'customer_booking_fee', 'booking_id', booking_record.id)
    ));
    total_fee_amount := total_fee_amount + booking_record.customer_booking_fee_amount;
  end if;

  if booking_record.provider_receival_fee_amount > 0 then
    transaction_entries := transaction_entries || jsonb_build_array(jsonb_build_object(
      'wallet_id', provider_wallet_id,
      'direction', 'debit',
      'amount', booking_record.provider_receival_fee_amount,
      'entry_type', 'fee',
      'metadata', jsonb_build_object('role', 'provider_offline_receival_fee', 'booking_id', booking_record.id)
    ));
    total_fee_amount := total_fee_amount + booking_record.provider_receival_fee_amount;
  end if;

  if total_fee_amount > 0 then
    transaction_entries := transaction_entries || jsonb_build_array(jsonb_build_object(
      'wallet_id', revenue_wallet_id,
      'direction', 'credit',
      'amount', total_fee_amount,
      'entry_type', 'fee',
      'metadata', jsonb_build_object('role', 'logistics_marketplace_fee_revenue', 'booking_id', booking_record.id)
    ));

    fee_transaction_id := public.post_financial_transaction(
      'fee',
      booking_record.currency_code,
      'platform.logistics.offline_booking_fees',
      'logistics_booking',
      booking_record.id,
      transaction_entries,
      target_idempotency_key,
      null,
      null,
      booking_record.policy_snapshots,
      jsonb_build_object(
        'booking_id', booking_record.id,
        'requester_user_id', target_requester_user_id,
        'payment_mode', 'offline',
        'fee_collection', 'customer_booking_and_provider_receival'
      )
    );
  end if;

  update public.logistics_bookings
  set status = 'offline_payment_confirmed',
      offline_fee_transaction_id = fee_transaction_id,
      updated_at = timezone('utc', now())
  where id = booking_record.id;

  update public.service_requests
  set status = 'requested', updated_at = timezone('utc', now())
  where id = booking_record.service_request_id;

  update public.order_records
  set status = 'accepted', accepted_at = coalesce(accepted_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = booking_record.order_id;

  perform public.record_logistics_booking_event(
    booking_record.id, 'logistics.booking.offline_payment_confirmed',
    target_idempotency_key || ':event',
    booking_record.status, 'offline_payment_confirmed',
    jsonb_build_object(
      'customer_booking_fee_amount', booking_record.customer_booking_fee_amount,
      'provider_receival_fee_amount', booking_record.provider_receival_fee_amount,
      'fee_transaction_id', fee_transaction_id
    )
  );

  return jsonb_build_object(
    'booking_id', booking_record.id,
    'status', 'offline_payment_confirmed',
    'fee_transaction_id', fee_transaction_id
  );
end;
$$;

revoke all on function public.accept_logistics_booking(uuid,text) from public,anon;
revoke all on function public.start_logistics_booking(uuid,text) from public,anon;
revoke all on function public.submit_logistics_booking_delivery(uuid,jsonb,text) from public,anon;
revoke all on function public.confirm_logistics_booking_delivery(uuid,uuid,text) from public,anon,authenticated;

grant execute on function public.accept_logistics_booking(uuid,text) to authenticated,service_role;
grant execute on function public.start_logistics_booking(uuid,text) to authenticated,service_role;
grant execute on function public.submit_logistics_booking_delivery(uuid,jsonb,text) to authenticated,service_role;
grant execute on function public.confirm_logistics_booking_delivery(uuid,uuid,text) to service_role;

notify pgrst,'reload schema';
commit;
