begin;

-- Customer-facing LPG price explanation projection.
-- This reads the immutable accepted order/quote snapshot and deliberately excludes
-- internal payout, logistics-margin, policy, wallet and admin simulation details.
-- AI may explain this projection but cannot change any price or financial state.

create or replace function public.read_my_lpg_price_explanations(
  target_lpg_order_id uuid default null,
  target_limit integer default 8
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if target_limit is null or target_limit < 1 or target_limit > 25 then
    raise exception using errcode = '22023', message = 'target_limit must be between 1 and 25';
  end if;

  if target_lpg_order_id is not null
    and not exists (
      select 1
      from public.lpg_refill_orders owned_order
      where owned_order.id = target_lpg_order_id
        and owned_order.customer_user_id = auth.uid()
    ) then
    raise exception using errcode = '42501', message = 'owned LPG order was not found';
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
        'paymentStatus', target_order.payment_status,
        'stationBranchId', target_order.station_branch_id,
        'stationName', station.display_name,
        'currencyCode', coalesce(
          nullif(target_order.financial_policy_snapshot #>> '{acceptedQuote,currencyCode}', ''),
          target_order.currency_code
        ),
        'quotedKg', coalesce(
          nullif(target_order.financial_policy_snapshot #>> '{acceptedQuote,quotedKg}', '')::numeric,
          target_order.quoted_kg,
          target_order.requested_kg
        ),
        'actualKg', target_order.actual_kg,
        'stationPricePerKg', coalesce(
          nullif(target_order.financial_policy_snapshot #>> '{commercialQuote,stationPricePerKg}', '')::numeric,
          case
            when coalesce(target_order.quoted_kg, target_order.requested_kg) > 0
              then round(
                target_order.station_amount
                / coalesce(target_order.quoted_kg, target_order.requested_kg),
                8
              )
            else null
          end
        ),
        'stationGasAmount', coalesce(
          nullif(target_order.financial_policy_snapshot #>> '{acceptedQuote,stationAmount}', '')::numeric,
          target_order.station_amount
        ),
        'skimaMarkupPerKg', coalesce(
          nullif(target_order.financial_policy_snapshot #>> '{commercialQuote,platformMarkupPerKg}', '')::numeric,
          case
            when coalesce(target_order.quoted_kg, target_order.requested_kg) > 0
              then round(
                target_order.platform_fee_amount
                / coalesce(target_order.quoted_kg, target_order.requested_kg),
                8
              )
            else null
          end
        ),
        'skimaMarkupAmount', coalesce(
          nullif(target_order.financial_policy_snapshot #>> '{acceptedQuote,platformMarkupAmount}', '')::numeric,
          target_order.platform_fee_amount
        ),
        'deliveryFeeAmount', coalesce(
          nullif(target_order.financial_policy_snapshot #>> '{acceptedQuote,deliveryFeeAmount}', '')::numeric,
          target_order.delivery_fee_amount
        ),
        'taxAmount', coalesce(
          nullif(target_order.financial_policy_snapshot #>> '{acceptedQuote,taxAmount}', '')::numeric,
          greatest(
            target_order.total_amount
            - target_order.station_amount
            - target_order.platform_fee_amount
            - target_order.delivery_fee_amount,
            0
          )
        ),
        'acceptedTotalAmount', coalesce(
          nullif(target_order.financial_policy_snapshot #>> '{acceptedQuote,totalAmount}', '')::numeric,
          target_order.total_amount
        ),
        'routeDistanceKm',
          nullif(target_order.financial_policy_snapshot #>> '{commercialQuote,route,distanceKilometers}', '')::numeric,
        'deliveryComponents', jsonb_build_object(
          'baseAmount',
            nullif(target_order.financial_policy_snapshot #>> '{commercialQuote,components,deliveryBaseAmount}', '')::numeric,
          'distanceAmount',
            nullif(target_order.financial_policy_snapshot #>> '{commercialQuote,components,distanceAmount}', '')::numeric,
          'loadAdjustment',
            nullif(target_order.financial_policy_snapshot #>> '{commercialQuote,components,loadAdjustment}', '')::numeric,
          'longDistanceSurcharge',
            nullif(target_order.financial_policy_snapshot #>> '{commercialQuote,components,longDistanceSurcharge}', '')::numeric
        ),
        'postedAdjustmentTotal', coalesce(adjustments.posted_adjustment_total, 0),
        'snapshotSource', case
          when target_order.financial_policy_snapshot -> 'acceptedQuote' is not null
            and target_order.financial_policy_snapshot -> 'commercialQuote' is not null
            then 'immutable_accepted_order_snapshot'
          else 'legacy_order_columns'
        end,
        'authoritative', true,
        'priceMutableByAi', false,
        'adminPricingSimulationUsed', false
      ) as row_data
    from public.lpg_refill_orders target_order
    left join public.lpg_station_branches station
      on station.id = target_order.station_branch_id
    left join lateral (
      select coalesce(sum(adjustment.amount), 0)::numeric(28,8) as posted_adjustment_total
      from public.lpg_order_financial_adjustments adjustment
      where adjustment.lpg_order_id = target_order.id
        and adjustment.status = 'posted'
    ) adjustments on true
    where target_order.customer_user_id = auth.uid()
      and (
        target_lpg_order_id is null
        or target_order.id = target_lpg_order_id
      )
    order by target_order.created_at desc
    limit target_limit
  ) customer_prices;

  return result;
end;
$$;

revoke all on function public.read_my_lpg_price_explanations(uuid, integer)
from public, anon;
grant execute on function public.read_my_lpg_price_explanations(uuid, integer)
to authenticated;

comment on function public.read_my_lpg_price_explanations(uuid, integer) is
  'Returns a customer-safe explanation projection of the signed-in customer own immutable LPG accepted price snapshot. Excludes internal payout, margin, policy and admin simulation data.';

commit;
