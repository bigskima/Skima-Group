begin;

-- Driver-facing LPG earnings explanation projection.
-- Reads only the signed-in driver's own assigned LPG orders and their canonical
-- commission execution / locked payout snapshot. It never estimates earnings,
-- posts commission, moves funds, or exposes unrelated financial records.

create or replace function public.read_my_lpg_driver_earnings_explanations(
  target_lpg_order_id uuid default null,
  target_limit integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  driver_id uuid;
  result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if target_limit is null or target_limit < 1 or target_limit > 25 then
    raise exception using errcode = '22023', message = 'target_limit must be between 1 and 25';
  end if;

  select driver.id
  into driver_id
  from public.driver_profiles driver
  where driver.user_id = auth.uid()
  limit 1;

  if driver_id is null then
    return '[]'::jsonb;
  end if;

  if target_lpg_order_id is not null
    and not exists (
      select 1
      from public.lpg_refill_orders owned_order
      where owned_order.id = target_lpg_order_id
        and owned_order.driver_profile_id = driver_id
    ) then
    raise exception using errcode = '42501', message = 'assigned LPG order was not found';
  end if;

  select coalesce(
    jsonb_agg(row_data order by created_at desc),
    '[]'::jsonb
  )
  into result
  from (
    select
      target_order.created_at,
      jsonb_build_object(
        'orderId', target_order.id,
        'publicReference', target_order.public_reference,
        'orderStatus', target_order.status,
        'currencyCode', target_order.currency_code,
        'quotedKg', coalesce(
          nullif(target_order.financial_policy_snapshot #>> '{acceptedQuote,quotedKg}', '')::numeric,
          target_order.quoted_kg,
          target_order.requested_kg
        ),
        'actualKg', target_order.actual_kg,
        'routeDistanceKm',
          nullif(target_order.financial_policy_snapshot #>> '{commercialQuote,route,distanceKilometers}', '')::numeric,
        'lockedPayoutAmount', target_order.driver_commission_amount,
        'payoutStatus', case
          when execution.id is not null then execution.status
          when target_order.status in ('cancelled','refunded','failed') then 'not_payable'
          when target_order.status in ('delivered','completed') then 'awaiting_posting'
          else 'pending_delivery'
        end,
        'postedPayoutAmount', execution.amount,
        'walletPostingRecorded', case
          when execution.id is null then false
          when execution.amount = 0 and execution.status = 'posted' then true
          else execution.transaction_id is not null and execution.status = 'posted'
        end,
        'postedAt', execution.created_at,
        'calculation', jsonb_build_object(
          'baseAmount',
            nullif(target_order.financial_policy_snapshot #>> '{driverPayout,configuration,base_amount}', '')::numeric,
          'perKmAmount',
            nullif(target_order.financial_policy_snapshot #>> '{driverPayout,configuration,per_km_amount}', '')::numeric,
          'loadAmountPerKg',
            nullif(target_order.financial_policy_snapshot #>> '{driverPayout,configuration,load_amount_per_kg}', '')::numeric,
          'routeSurchargeAmount',
            nullif(target_order.financial_policy_snapshot #>> '{commercialQuote,distanceBand,driver_surcharge_amount}', '')::numeric
        ),
        'releaseCondition', 'verified_delivery_after_station_settlement',
        'snapshotSource', case
          when target_order.financial_policy_snapshot -> 'driverPayout' is not null
            then 'immutable_order_payout_snapshot'
          else 'order_locked_payout_amount'
        end,
        'authoritative', true,
        'estimatedByAi', false,
        'mutableByAi', false
      ) as row_data
    from public.lpg_refill_orders target_order
    left join public.commission_executions execution
      on execution.id = target_order.driver_commission_execution_id
    where target_order.driver_profile_id = driver_id
      and (
        target_lpg_order_id is null
        or target_order.id = target_lpg_order_id
      )
    order by target_order.created_at desc
    limit target_limit
  ) driver_earnings;

  return result;
end;
$$;

revoke all on function public.read_my_lpg_driver_earnings_explanations(uuid, integer)
from public, anon;
grant execute on function public.read_my_lpg_driver_earnings_explanations(uuid, integer)
to authenticated;

comment on function public.read_my_lpg_driver_earnings_explanations(uuid, integer) is
  'Returns only the signed-in assigned driver own locked LPG payout explanation and canonical commission execution status. AI cannot estimate or post earnings.';

commit;
