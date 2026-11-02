begin;

-- Customers may withdraw a request only before a provider booking is created.
-- This deliberately does not cancel a funded booking or move wallet/escrow funds.
create or replace function public.cancel_logistics_job(
  target_job_id uuid,
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
  job_record public.logistics_job_requests%rowtype;
  existing_event public.logistics_job_events%rowtype;
begin
  if actor is null then
    raise exception 'authentication is required';
  end if;
  if target_job_id is null
    or target_reason is null
    or char_length(btrim(target_reason)) not between 3 and 500
    or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'job, cancellation reason and valid idempotency key are required';
  end if;

  select * into job_record
  from public.logistics_job_requests
  where id = target_job_id
  for update;

  if not found then
    raise exception 'logistics request was not found';
  end if;
  if job_record.requester_user_id <> actor then
    raise exception 'only the customer who created this logistics request may cancel it';
  end if;

  select * into existing_event
  from public.logistics_job_events
  where job_id = job_record.id
    and idempotency_key = target_idempotency_key;
  if found then
    if existing_event.event_type <> 'logistics.job.customer_cancelled' then
      raise exception 'cancellation idempotency key was used for a different action';
    end if;
    return job_record.id;
  end if;

  if job_record.status = 'cancelled' then
    return job_record.id;
  end if;
  if job_record.status not in ('open', 'matching', 'offers_received') then
    raise exception 'this request can no longer be cancelled from the pre-booking stage';
  end if;

  if exists (
    select 1
    from public.logistics_bookings booking
    where booking.job_id = job_record.id
      and booking.status not in ('cancelled', 'payment_failed', 'refunded')
  ) then
    raise exception 'a provider booking already exists; use the booking support and settlement process instead';
  end if;

  update public.logistics_job_requests
  set status = 'cancelled',
      updated_at = timezone('utc', now())
  where id = job_record.id;

  update public.logistics_job_opportunities
  set status = 'withdrawn',
      updated_at = timezone('utc', now())
  where job_id = job_record.id
    and status in ('matched', 'viewed', 'offered');

  update public.logistics_offers
  set status = 'withdrawn'
  where job_id = job_record.id
    and status in ('submitted', 'countered');

  perform public.record_logistics_job_event(
    job_record.id,
    'logistics.job.customer_cancelled',
    target_idempotency_key,
    job_record.status,
    'cancelled',
    jsonb_build_object(
      'reason', btrim(target_reason),
      'actor_user_id', actor,
      'cancellation_stage', 'before_provider_booking'
    )
  );

  return job_record.id;
end;
$$;

revoke all on function public.cancel_logistics_job(uuid,text,text) from public, anon;
grant execute on function public.cancel_logistics_job(uuid,text,text) to authenticated, service_role;


-- The customer may also cancel a newly selected offer while payment is still
-- awaiting completion. This path is limited to unpaid bookings; funded bookings
-- require a separate dispute/refund decision and are deliberately not touched.
create or replace function public.cancel_logistics_booking_before_payment(
  target_booking_id uuid,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $
declare
  actor uuid := auth.uid();
  booking_record public.logistics_bookings%rowtype;
  existing_event public.logistics_booking_events%rowtype;
begin
  if actor is null then
    raise exception 'authentication is required';
  end if;
  if target_booking_id is null
    or target_reason is null
    or char_length(btrim(target_reason)) not between 3 and 500
    or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'booking, cancellation reason and valid idempotency key are required';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;
  if not found then
    raise exception 'logistics booking was not found';
  end if;
  if booking_record.requester_user_id <> actor then
    raise exception 'only the customer who created this booking may cancel it';
  end if;

  select * into existing_event
  from public.logistics_booking_events
  where booking_id = booking_record.id
    and idempotency_key = target_idempotency_key;
  if found then
    if existing_event.event_type <> 'logistics.booking.customer_cancelled_before_payment' then
      raise exception 'booking cancellation idempotency key was used for a different action';
    end if;
    return booking_record.id;
  end if;

  if booking_record.status = 'cancelled' then
    return booking_record.id;
  end if;
  if booking_record.status not in ('awaiting_payment', 'awaiting_offline_confirmation') then
    raise exception 'this booking can only be cancelled before payment or offline fees are collected';
  end if;
  if booking_record.escrow_hold_id is not null
    or booking_record.payment_transaction_id is not null
    or booking_record.offline_fee_transaction_id is not null then
    raise exception 'this booking has a financial record and cannot use pre-payment cancellation';
  end if;

  update public.logistics_bookings
  set status = 'cancelled',
      updated_at = timezone('utc', now())
  where id = booking_record.id;

  update public.logistics_job_requests
  set status = 'cancelled',
      updated_at = timezone('utc', now())
  where id = booking_record.job_id;

  update public.service_requests
  set status = 'cancelled',
      updated_at = timezone('utc', now())
  where id = booking_record.service_request_id
    and status not in ('completed', 'settled', 'refunded', 'disputed');

  update public.order_records
  set status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = booking_record.order_id
    and status not in ('completed', 'fulfilled', 'disputed');

  update public.logistics_job_opportunities
  set status = 'withdrawn',
      updated_at = timezone('utc', now())
  where job_id = booking_record.job_id
    and status in ('matched', 'viewed', 'offered', 'selected');

  update public.logistics_offers
  set status = 'withdrawn'
  where job_id = booking_record.job_id
    and status in ('submitted', 'countered', 'selected');

  perform public.record_logistics_booking_event(
    booking_record.id,
    'logistics.booking.customer_cancelled_before_payment',
    target_idempotency_key,
    booking_record.status,
    'cancelled',
    jsonb_build_object(
      'reason', btrim(target_reason),
      'actor_user_id', actor,
      'payment_mode', booking_record.payment_mode,
      'financial_effect', 'none'
    )
  );

  perform public.record_logistics_job_event(
    booking_record.job_id,
    'logistics.booking.customer_cancelled_before_payment',
    target_idempotency_key || ':job',
    'booked',
    'cancelled',
    jsonb_build_object('booking_id', booking_record.id, 'actor_user_id', actor)
  );

  return booking_record.id;
end;
$;

revoke all on function public.cancel_logistics_booking_before_payment(uuid,text,text) from public, anon;
grant execute on function public.cancel_logistics_booking_before_payment(uuid,text,text) to authenticated, service_role;


-- Serialize online wallet funding against cancellation. The payment-processing
-- state is acquired before the wallet transfer and remains in place if a hold
-- was created but its booking projection needs a retry.
alter table public.logistics_bookings
  add column if not exists payment_attempt_wallet_id uuid references public.wallet_accounts(id) on delete set null,
  add column if not exists payment_attempt_idempotency_key text;

alter table public.logistics_bookings
  drop constraint if exists logistics_bookings_status_check;

alter table public.logistics_bookings
  add constraint logistics_bookings_status_check
  check (status in (
    'awaiting_payment',
    'awaiting_offline_confirmation',
    'payment_processing',
    'payment_reserved',
    'offline_payment_confirmed',
    'provider_accepted',
    'in_progress',
    'delivered',
    'settled',
    'completed_offline',
    'cancelled',
    'payment_failed',
    'disputed',
    'refunded'
  ));

create or replace function public.begin_logistics_booking_online_payment(
  target_booking_id uuid,
  target_requester_user_id uuid,
  target_customer_wallet_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $
declare
  booking_record public.logistics_bookings%rowtype;
  wallet_record public.wallet_accounts%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required';
  end if;
  if target_booking_id is null
    or target_requester_user_id is null
    or target_customer_wallet_id is null
    or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'booking, requester, wallet and valid payment idempotency key are required';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;
  if not found or booking_record.requester_user_id <> target_requester_user_id then
    raise exception 'logistics booking was not found for the authenticated customer';
  end if;
  if booking_record.payment_mode <> 'online_wallet' then
    raise exception 'online payment is not available for an offline booking';
  end if;

  select * into wallet_record
  from public.wallet_accounts
  where id = target_customer_wallet_id
    and wallet_type = 'customer'
    and owner_entity_type = 'user'
    and owner_entity_id = target_requester_user_id
    and currency_code = booking_record.currency_code
    and status = 'active';
  if not found then
    raise exception 'an active customer wallet owned by this customer in the booking currency is required';
  end if;

  if booking_record.status = 'payment_reserved' then
    return jsonb_build_object(
      'booking_id', booking_record.id,
      'status', booking_record.status,
      'escrow_hold_id', booking_record.escrow_hold_id
    );
  end if;

  if booking_record.status = 'payment_processing' then
    if booking_record.payment_attempt_wallet_id <> target_customer_wallet_id
      or booking_record.payment_attempt_idempotency_key <> target_idempotency_key then
      raise exception 'an online payment attempt is already in progress; retry with the original wallet and idempotency key';
    end if;
    return jsonb_build_object(
      'booking_id', booking_record.id,
      'status', booking_record.status,
      'wallet_id', booking_record.payment_attempt_wallet_id,
      'idempotent_replay', true
    );
  end if;

  if booking_record.status <> 'awaiting_payment' then
    raise exception 'logistics booking is not awaiting online payment';
  end if;
  if booking_record.escrow_hold_id is not null
    or booking_record.payment_transaction_id is not null then
    raise exception 'booking already has a financial record and requires reconciliation';
  end if;

  update public.logistics_bookings
  set status = 'payment_processing',
      payment_attempt_wallet_id = target_customer_wallet_id,
      payment_attempt_idempotency_key = target_idempotency_key,
      updated_at = timezone('utc', now())
  where id = booking_record.id;

  perform public.record_logistics_booking_event(
    booking_record.id,
    'logistics.booking.payment_processing_started',
    target_idempotency_key || ':processing',
    booking_record.status,
    'payment_processing',
    jsonb_build_object(
      'wallet_id', target_customer_wallet_id,
      'requester_user_id', target_requester_user_id
    )
  );

  return jsonb_build_object(
    'booking_id', booking_record.id,
    'status', 'payment_processing',
    'wallet_id', target_customer_wallet_id,
    'idempotent_replay', false
  );
end;
$;

create or replace function public.reset_logistics_booking_payment_attempt(
  target_booking_id uuid,
  target_requester_user_id uuid,
  target_idempotency_key text,
  target_failure_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $
declare
  booking_record public.logistics_bookings%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required';
  end if;
  if target_booking_id is null
    or target_requester_user_id is null
    or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180
    or target_failure_reason is null
    or char_length(btrim(target_failure_reason)) not between 3 and 500 then
    raise exception 'booking, requester, payment key and failure reason are required';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;
  if not found or booking_record.requester_user_id <> target_requester_user_id then
    raise exception 'logistics booking was not found for the authenticated customer';
  end if;

  if booking_record.status = 'awaiting_payment' then
    return booking_record.id;
  end if;
  if booking_record.status <> 'payment_processing'
    or booking_record.payment_attempt_idempotency_key <> target_idempotency_key then
    raise exception 'the online payment attempt cannot be reset by this request';
  end if;

  if booking_record.escrow_hold_id is not null
    or booking_record.payment_transaction_id is not null
    or exists (
      select 1
      from public.escrow_holds hold_record
      where hold_record.subject_type = 'service_request'
        and hold_record.subject_id = booking_record.service_request_id
    ) then
    raise exception 'an escrow hold exists; preserve payment processing and retry payment confirmation';
  end if;

  update public.logistics_bookings
  set status = 'awaiting_payment',
      payment_attempt_wallet_id = null,
      payment_attempt_idempotency_key = null,
      updated_at = timezone('utc', now())
  where id = booking_record.id;

  perform public.record_logistics_booking_event(
    booking_record.id,
    'logistics.booking.payment_processing_reset',
    target_idempotency_key || ':reset',
    'payment_processing',
    'awaiting_payment',
    jsonb_build_object('reason', btrim(target_failure_reason))
  );

  return booking_record.id;
end;
$;

create or replace function public.mark_logistics_booking_payment_reserved(
  target_booking_id uuid,
  target_requester_user_id uuid,
  target_escrow_hold_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $
declare
  booking_record public.logistics_bookings%rowtype;
  hold_record public.escrow_holds%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;
  if not found or booking_record.requester_user_id <> target_requester_user_id then
    raise exception 'logistics booking was not found for the authenticated customer';
  end if;

  select * into hold_record
  from public.escrow_holds
  where id = target_escrow_hold_id
    and subject_type = 'service_request'
    and subject_id = booking_record.service_request_id
  for update;
  if not found then
    raise exception 'the payment hold does not belong to this logistics booking';
  end if;

  if hold_record.hold_amount <> booking_record.total_customer_charge
    or hold_record.currency_code <> booking_record.currency_code then
    raise exception 'escrow hold does not match the locked logistics booking total';
  end if;

  if booking_record.status = 'payment_reserved' then
    if booking_record.escrow_hold_id <> hold_record.id then
      raise exception 'booking was already funded by a different escrow hold';
    end if;
    return booking_record.id;
  end if;
  if booking_record.status <> 'payment_processing'
    or booking_record.payment_attempt_wallet_id is null then
    raise exception 'booking payment was not safely started before escrow funding';
  end if;

  update public.logistics_bookings
  set status = 'payment_reserved',
      escrow_hold_id = hold_record.id,
      payment_transaction_id = hold_record.source_transaction_id,
      updated_at = timezone('utc', now())
  where id = booking_record.id;

  perform public.record_logistics_booking_event(
    booking_record.id,
    'logistics.booking.payment_reserved',
    'payment_reserved:' || hold_record.id::text,
    booking_record.status,
    'payment_reserved',
    jsonb_build_object('escrow_hold_id', hold_record.id, 'transaction_id', hold_record.source_transaction_id)
  );

  return booking_record.id;
end;
$;

revoke all on function public.begin_logistics_booking_online_payment(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.reset_logistics_booking_payment_attempt(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.mark_logistics_booking_payment_reserved(uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.begin_logistics_booking_online_payment(uuid,uuid,uuid,text) to service_role;
grant execute on function public.reset_logistics_booking_payment_attempt(uuid,uuid,text,text) to service_role;
grant execute on function public.mark_logistics_booking_payment_reserved(uuid,uuid,uuid) to service_role;

notify pgrst,'reload schema';
commit;
