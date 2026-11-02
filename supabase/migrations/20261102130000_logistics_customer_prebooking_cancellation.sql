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

notify pgrst,'reload schema';
commit;
