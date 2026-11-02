begin;

-- Customer withdrawal of an open Logistics request. Match the offer->job lock
-- order used by booking creation so cancellation cannot race provider selection.
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
  if actor is null then raise exception 'authentication is required'; end if;
  if target_job_id is null
    or target_reason is null
    or char_length(btrim(target_reason)) not between 5 and 1200
    or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'job, cancellation reason and valid idempotency key are required';
  end if;

  -- Booking creation locks an offer before its job. Lock the offer set first,
  -- then the job, to keep the same order and avoid a booking/cancel deadlock.
  perform offer.id
  from public.logistics_offers offer
  where offer.job_id = target_job_id
  order by offer.id
  for update;

  select * into job_record
  from public.logistics_job_requests
  where id = target_job_id
  for update;

  if not found or job_record.requester_user_id <> actor then
    raise exception 'logistics job was not found for the authenticated customer';
  end if;

  select * into existing_event
  from public.logistics_job_events
  where job_id = job_record.id
    and idempotency_key = target_idempotency_key;
  if found then
    if existing_event.actor_user_id is distinct from actor
      or existing_event.event_type <> 'logistics.job.cancelled'
      or existing_event.metadata->>'reason' is distinct from target_reason then
      raise exception 'job cancellation idempotency key was reused with different details';
    end if;
    return job_record.id;
  end if;

  if job_record.status not in ('open','matching','offers_received') then
    raise exception 'a logistics request can only be withdrawn before a provider booking is created';
  end if;

  if exists (
    select 1 from public.logistics_bookings booking
    where booking.job_id = job_record.id
  ) then
    raise exception 'a request with a provider booking must use the booking cancellation flow';
  end if;

  update public.logistics_job_requests
  set status = 'cancelled',
      metadata = metadata || jsonb_build_object(
        'cancellation_reason', target_reason,
        'cancelled_at', timezone('utc', now())
      ),
      updated_at = timezone('utc', now())
  where id = job_record.id;

  update public.logistics_offers
  set status = 'withdrawn'
  where job_id = job_record.id
    and status in ('submitted','countered');

  update public.logistics_job_opportunities
  set status = 'withdrawn',
      updated_at = timezone('utc', now())
  where job_id = job_record.id
    and status in ('matched','viewed','offered');

  perform public.record_logistics_job_event(
    job_record.id,
    'logistics.job.cancelled',
    target_idempotency_key,
    job_record.status,
    'cancelled',
    jsonb_build_object('reason', target_reason)
  );

  return job_record.id;
end;
$$;

-- A customer may withdraw a booking only before online escrow or offline fees
-- have been posted. The booking row lock serializes cancellation with payment.
create or replace function public.cancel_logistics_booking_before_payment(
  target_booking_id uuid,
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
  booking_record public.logistics_bookings%rowtype;
  existing_event public.logistics_booking_events%rowtype;
  job_status text;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_booking_id is null
    or target_reason is null
    or char_length(btrim(target_reason)) not between 5 and 1200
    or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'booking, cancellation reason and valid idempotency key are required';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;

  if not found or booking_record.requester_user_id <> actor then
    raise exception 'logistics booking was not found for the authenticated customer';
  end if;

  select * into existing_event
  from public.logistics_booking_events
  where booking_id = booking_record.id
    and idempotency_key = target_idempotency_key;
  if found then
    if existing_event.actor_user_id is distinct from actor
      or existing_event.event_type <> 'logistics.booking.cancelled'
      or existing_event.metadata->>'reason' is distinct from target_reason then
      raise exception 'booking cancellation idempotency key was reused with different details';
    end if;
    return booking_record.id;
  end if;

  if booking_record.status not in ('awaiting_payment','awaiting_offline_confirmation') then
    raise exception 'a booking can only be cancelled before payment or offline fee collection';
  end if;

  if booking_record.escrow_hold_id is not null
    or booking_record.payment_transaction_id is not null
    or booking_record.offline_fee_transaction_id is not null
    or booking_record.settlement_execution_id is not null then
    raise exception 'booking has a financial record and cannot use pre-payment cancellation';
  end if;

  update public.logistics_bookings
  set status = 'cancelled',
      metadata = metadata || jsonb_build_object(
        'cancellation_reason', target_reason,
        'cancelled_at', timezone('utc', now())
      ),
      updated_at = timezone('utc', now())
  where id = booking_record.id;

  update public.logistics_job_requests
  set status = 'cancelled',
      metadata = metadata || jsonb_build_object(
        'cancellation_reason', target_reason,
        'cancelled_at', timezone('utc', now())
      ),
      updated_at = timezone('utc', now())
  where id = booking_record.job_id
  returning status into job_status;

  update public.logistics_offers
  set status = 'withdrawn'
  where job_id = booking_record.job_id
    and status in ('submitted','countered','selected');

  update public.logistics_job_opportunities
  set status = 'withdrawn',
      updated_at = timezone('utc', now())
  where job_id = booking_record.job_id
    and status in ('matched','viewed','offered','selected');

  update public.service_requests
  set status = 'cancelled',
      updated_at = timezone('utc', now())
  where id = booking_record.service_request_id;

  update public.order_records
  set status = 'cancelled',
      cancelled_at = coalesce(cancelled_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = booking_record.order_id;

  perform public.record_logistics_booking_event(
    booking_record.id,
    'logistics.booking.cancelled',
    target_idempotency_key,
    booking_record.status,
    'cancelled',
    jsonb_build_object('reason', target_reason, 'payment_mode', booking_record.payment_mode)
  );

  perform public.record_logistics_job_event(
    booking_record.job_id,
    'logistics.job.booking_cancelled',
    target_idempotency_key || ':job',
    'booked',
    'cancelled',
    jsonb_build_object('booking_id', booking_record.id, 'reason', target_reason)
  );

  return booking_record.id;
end;
$$;

-- Fund online wallet payment and link the escrow hold in one transaction.
-- The booking lock is held through both ledger posting and status projection,
-- so a pre-payment cancellation cannot slip between the two operations.
create or replace function public.reserve_logistics_booking_online_payment(
  target_booking_id uuid,
  target_requester_user_id uuid,
  target_customer_wallet_id uuid,
  target_client_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_record public.logistics_bookings%rowtype;
  wallet_record public.wallet_accounts%rowtype;
  hold_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required';
  end if;
  if target_booking_id is null
    or target_requester_user_id is null
    or target_customer_wallet_id is null
    or target_client_idempotency_key is null
    or char_length(btrim(target_client_idempotency_key)) not between 8 and 180 then
    raise exception 'booking, customer, wallet and valid payment idempotency key are required';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;

  if not found or booking_record.requester_user_id <> target_requester_user_id then
    raise exception 'logistics booking was not found for the authenticated customer';
  end if;
  if booking_record.payment_mode <> 'online_wallet' then
    raise exception 'this booking was created for offline payment';
  end if;

  if booking_record.status = 'payment_reserved' and booking_record.escrow_hold_id is not null then
    return jsonb_build_object(
      'booking_id', booking_record.id,
      'service_request_id', booking_record.service_request_id,
      'escrow_hold_id', booking_record.escrow_hold_id,
      'status', booking_record.status,
      'currency_code', booking_record.currency_code,
      'total_amount', booking_record.total_customer_charge,
      'idempotent_replay', true
    );
  end if;

  if booking_record.status <> 'awaiting_payment' then
    raise exception 'logistics booking is not awaiting online payment';
  end if;
  if booking_record.order_id is null or booking_record.service_request_id is null then
    raise exception 'logistics booking is missing its payment order or service request';
  end if;

  select * into wallet_record
  from public.wallet_accounts
  where id = target_customer_wallet_id
    and wallet_type = 'customer'
    and owner_entity_type = 'user'
    and owner_entity_id = target_requester_user_id
    and currency_code = booking_record.currency_code
    and status = 'active'
  for update;
  if not found then
    raise exception 'an active customer wallet owned by this customer in the booking currency is required';
  end if;

  hold_id := public.fund_order_from_wallet(
    booking_record.order_id,
    wallet_record.id,
    null,
    'platform.logistics.bookings',
    'logistics-booking:' || booking_record.id::text || ':online-wallet:v1',
    jsonb_build_object(
      'module_key', 'logistics_network',
      'logistics_booking_id', booking_record.id,
      'service_request_id', booking_record.service_request_id,
      'payment_channel', 'customer_wallet',
      'client_idempotency_key', target_client_idempotency_key,
      'policy_snapshots', booking_record.policy_snapshots
    )
  );

  perform public.mark_logistics_booking_payment_reserved(
    booking_record.id,
    target_requester_user_id,
    hold_id
  );

  return jsonb_build_object(
    'booking_id', booking_record.id,
    'service_request_id', booking_record.service_request_id,
    'escrow_hold_id', hold_id,
    'status', 'payment_reserved',
    'currency_code', booking_record.currency_code,
    'total_amount', booking_record.total_customer_charge,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.cancel_logistics_job(uuid,text,text) from public,anon;
revoke all on function public.cancel_logistics_booking_before_payment(uuid,text,text) from public,anon;
revoke all on function public.reserve_logistics_booking_online_payment(uuid,uuid,uuid,text) from public,anon,authenticated;

grant execute on function public.cancel_logistics_job(uuid,text,text) to authenticated,service_role;
grant execute on function public.cancel_logistics_booking_before_payment(uuid,text,text) to authenticated,service_role;
grant execute on function public.reserve_logistics_booking_online_payment(uuid,uuid,uuid,text) to service_role;

notify pgrst,'reload schema';
commit;
