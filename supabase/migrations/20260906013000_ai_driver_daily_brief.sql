begin;

-- SKIMA Driver Daily Brief.
-- Deterministic, read-only operational guidance for the signed-in driver.
-- This projection never changes availability, assignments, dispatch ranking, order state,
-- location records, wallet balances, commissions, or any other authoritative runtime state.

create or replace function public.read_my_lpg_driver_daily_brief()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  driver_record record;
  now_at timestamptz := timezone('utc', now());
  latest_location record;
  active_jobs integer := 0;
  pickup_jobs integer := 0;
  station_jobs integer := 0;
  return_jobs integer := 0;
  completion_jobs integer := 0;
  disputed_jobs integer := 0;
  next_job record;
  posted_earnings numeric := 0;
  pending_earnings numeric := 0;
  posted_commissions integer := 0;
  pending_commissions integer := 0;
  next_step text;
  readiness text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select
    driver.id,
    driver.user_id,
    driver.verification_status,
    driver.operational_status,
    driver.updated_at
  into driver_record
  from public.driver_profiles driver
  where driver.user_id = auth.uid()
  order by driver.created_at asc
  limit 1;

  if driver_record.id is null then
    raise exception using errcode = '42501', message = 'driver workspace access is required';
  end if;

  select
    location.latitude,
    location.longitude,
    location.online_status,
    location.recorded_at
  into latest_location
  from public.lpg_driver_locations location
  where location.driver_profile_id = driver_record.id
  order by location.recorded_at desc
  limit 1;

  select
    count(*)::integer,
    count(*) filter (
      where orders.status in ('driver_offered','driver_accepted','pickup_en_route','pickup_verified')
    )::integer,
    count(*) filter (
      where orders.status in ('station_en_route','station_verified','refill_in_progress','refill_confirmed','station_settled')
    )::integer,
    count(*) filter (
      where orders.status in ('return_en_route','delivery_verification_pending')
    )::integer,
    count(*) filter (
      where orders.status = 'delivered'
    )::integer,
    count(*) filter (
      where orders.status = 'disputed'
    )::integer
  into active_jobs, pickup_jobs, station_jobs, return_jobs, completion_jobs, disputed_jobs
  from public.lpg_refill_orders orders
  where orders.driver_profile_id = driver_record.id
    and orders.status not in ('completed','cancelled','refunded','failed');

  select
    orders.id,
    orders.public_reference,
    orders.status,
    orders.assignment_status,
    orders.station_branch_id,
    orders.requested_kg,
    orders.actual_kg,
    orders.currency_code,
    orders.created_at,
    orders.updated_at
  into next_job
  from public.lpg_refill_orders orders
  where orders.driver_profile_id = driver_record.id
    and orders.status not in ('completed','cancelled','refunded','failed')
  order by
    case orders.status
      when 'disputed' then 5
      when 'delivery_verification_pending' then 10
      when 'return_en_route' then 20
      when 'station_settled' then 30
      when 'refill_confirmed' then 40
      when 'refill_in_progress' then 50
      when 'station_verified' then 60
      when 'station_en_route' then 70
      when 'pickup_verified' then 80
      when 'pickup_en_route' then 90
      when 'driver_accepted' then 100
      when 'driver_offered' then 110
      when 'delivered' then 120
      else 200
    end asc,
    orders.updated_at asc,
    orders.id asc
  limit 1;

  select
    coalesce(sum(case when commission.status = 'posted' then commission.amount else 0 end), 0),
    coalesce(sum(case when commission.status <> 'posted' then commission.amount else 0 end), 0),
    count(*) filter (where commission.status = 'posted')::integer,
    count(*) filter (where commission.status <> 'posted')::integer
  into posted_earnings, pending_earnings, posted_commissions, pending_commissions
  from public.commission_executions commission
  join public.lpg_refill_orders orders on orders.id = commission.order_id
  where orders.driver_profile_id = driver_record.id
    and commission.created_at >= now_at - interval '24 hours';

  readiness := case
    when driver_record.verification_status <> 'approved' then 'approval_required'
    when driver_record.operational_status not in ('available','busy') then 'not_available'
    when latest_location.recorded_at is null then 'location_required'
    when latest_location.recorded_at < now_at - interval '10 minutes' then 'location_stale'
    when coalesce(latest_location.online_status, '') <> 'online' then 'offline'
    else 'ready'
  end;

  next_step := case
    when driver_record.verification_status <> 'approved'
      then 'Complete driver approval requirements before taking LPG jobs.'
    when driver_record.operational_status not in ('available','busy')
      then 'Set your driver availability through the normal driver controls when you are ready to work.'
    when latest_location.recorded_at is null
      then 'Enable location so SKIMA can use your current position for dispatch.'
    when latest_location.recorded_at < now_at - interval '10 minutes'
      then 'Refresh your location before relying on route or dispatch guidance.'
    when coalesce(latest_location.online_status, '') <> 'online'
      then 'Go online through the normal driver controls when you are ready for work.'
    when next_job.id is null
      then 'No active LPG job needs action right now. Stay available if you want to receive work.'
    when next_job.status = 'disputed'
      then 'This job is disputed. Follow the support and operations instructions shown in the canonical job record; do not attempt to change settlement or delivery state yourself.'
    when next_job.status in ('driver_offered','driver_accepted','pickup_en_route')
      then 'Proceed with the customer pickup using the normal assigned-job workflow.'
    when next_job.status = 'pickup_verified'
      then 'The cylinder pickup is verified. Proceed toward the assigned station using the normal job workflow.'
    when next_job.status in ('station_en_route','station_verified','refill_in_progress')
      then 'Follow the station handoff and refill verification steps before leaving the station.'
    when next_job.status in ('refill_confirmed','station_settled')
      then 'Return the refilled cylinder to the customer and continue delivery tracking.'
    when next_job.status = 'return_en_route'
      then 'Continue to the customer delivery location and prepare for required delivery verification.'
    when next_job.status = 'delivery_verification_pending'
      then 'Complete the customer delivery verification. Do not mark delivery complete without the required verification.'
    when next_job.status = 'delivered'
      then 'The delivery is recorded. Wait for the canonical completion and commission workflow to finish.'
    else 'Open the active job and follow the next action shown by the canonical LPG workflow.'
  end;

  return jsonb_build_object(
    'driverProfileId', driver_record.id,
    'verificationStatus', driver_record.verification_status,
    'operationalStatus', driver_record.operational_status,
    'readiness', readiness,
    'location', jsonb_build_object(
      'onlineStatus', latest_location.online_status,
      'recordedAt', latest_location.recorded_at,
      'fresh', latest_location.recorded_at is not null
        and latest_location.recorded_at >= now_at - interval '10 minutes'
    ),
    'workload', jsonb_build_object(
      'activeJobs', active_jobs,
      'pickupStageJobs', pickup_jobs,
      'stationStageJobs', station_jobs,
      'returnStageJobs', return_jobs,
      'completionStageJobs', completion_jobs,
      'disputedJobs', disputed_jobs
    ),
    'nextJob', case
      when next_job.id is null then null
      else jsonb_build_object(
        'id', next_job.id,
        'publicReference', next_job.public_reference,
        'status', next_job.status,
        'assignmentStatus', next_job.assignment_status,
        'stationBranchId', next_job.station_branch_id,
        'requestedKg', next_job.requested_kg,
        'actualKg', next_job.actual_kg,
        'currencyCode', next_job.currency_code,
        'updatedAt', next_job.updated_at
      )
    end,
    'earningsLast24Hours', jsonb_build_object(
      'postedAmount', posted_earnings,
      'pendingAmount', pending_earnings,
      'postedCommissionCount', posted_commissions,
      'pendingCommissionCount', pending_commissions,
      'postedAmountIsAuthoritativeOnlyWhenCommissionStatusIsPosted', true
    ),
    'nextStep', next_step,
    'generatedAt', now_at,
    'limits', jsonb_build_object(
      'readOnly', true,
      'doesNotChangeAvailability', true,
      'doesNotChangeLocation', true,
      'doesNotAssignJobs', true,
      'doesNotChangeDispatchRank', true,
      'doesNotChangeOrderState', true,
      'doesNotPostCommission', true,
      'doesNotMoveWalletFunds', true
    )
  );
end;
$$;

revoke all on function public.read_my_lpg_driver_daily_brief()
from public, anon;
grant execute on function public.read_my_lpg_driver_daily_brief()
to authenticated, service_role;

comment on function public.read_my_lpg_driver_daily_brief() is
  'Own-driver read-only daily brief from canonical LPG jobs, location freshness and commission state. It never changes dispatch, availability, order state or financial records.';

commit;
