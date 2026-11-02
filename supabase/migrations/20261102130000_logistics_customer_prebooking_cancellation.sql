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

notify pgrst,'reload schema';
commit;
