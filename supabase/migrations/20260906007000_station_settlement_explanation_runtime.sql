begin;

-- Station-facing LPG settlement explanation projection.
-- Returns only branches where the signed-in operator has branch finance permission.
-- It exposes station principal and its quantity adjustment, but never platform margin,
-- driver payout, escrow internals, or unrelated station financial records.

create or replace function public.read_my_lpg_station_settlement_explanations(
  target_lpg_order_id uuid default null,
  target_station_branch_id uuid default null,
  target_limit integer default 10
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

  if target_station_branch_id is not null
    and not public.can_operate_lpg_station_branch(
      target_station_branch_id,
      'lpg.orders.finance'
    ) then
    raise exception using errcode = '42501', message = 'branch finance access is required';
  end if;

  if target_lpg_order_id is not null
    and not exists (
      select 1
      from public.lpg_refill_orders accessible_order
      where accessible_order.id = target_lpg_order_id
        and accessible_order.station_branch_id is not null
        and public.can_operate_lpg_station_branch(
          accessible_order.station_branch_id,
          'lpg.orders.finance'
        )
    ) then
    raise exception using errcode = '42501', message = 'accessible LPG station order was not found';
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
        'stationBranchId', target_order.station_branch_id,
        'stationName', station.display_name,
        'currencyCode', target_order.currency_code,
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
                coalesce(
                  nullif(target_order.financial_policy_snapshot #>> '{acceptedQuote,stationAmount}', '')::numeric,
                  target_order.station_amount
                )
                / coalesce(target_order.quoted_kg, target_order.requested_kg),
                8
              )
            else null
          end
        ),
        'acceptedStationAmount', coalesce(
          nullif(target_order.financial_policy_snapshot #>> '{acceptedQuote,stationAmount}', '')::numeric,
          target_order.station_amount
        ),
        'fulfilledStationAmount', target_order.station_amount,
        'stationPrincipalReduction', greatest(
          coalesce(
            nullif(target_order.financial_policy_snapshot #>> '{acceptedQuote,stationAmount}', '')::numeric,
            target_order.station_amount
          ) - target_order.station_amount,
          0
        ),
        'settlementStatementStatus', statement.status,
        'settlementExecutionStatus', execution.status,
        'settledStationAmount', statement.net_amount,
        'walletPostingRecorded', (
          execution.status = 'posted'
          and execution.transaction_id is not null
          and statement.status = 'posted'
        ),
        'settledAt', statement.created_at,
        'releaseCondition', 'confirmed_refill',
        'snapshotSource', case
          when target_order.financial_policy_snapshot -> 'acceptedQuote' is not null
            then 'immutable_accepted_order_snapshot'
          else 'order_station_amount'
        end,
        'authoritative', true,
        'estimatedByAi', false,
        'mutableByAi', false
      ) as row_data
    from public.lpg_refill_orders target_order
    join public.lpg_station_branches station
      on station.id = target_order.station_branch_id
    left join public.settlement_statements statement
      on statement.id = target_order.station_settlement_statement_id
    left join public.settlement_executions execution
      on execution.id = target_order.station_settlement_execution_id
    where target_order.station_branch_id is not null
      and public.can_operate_lpg_station_branch(
        target_order.station_branch_id,
        'lpg.orders.finance'
      )
      and (
        target_lpg_order_id is null
        or target_order.id = target_lpg_order_id
      )
      and (
        target_station_branch_id is null
        or target_order.station_branch_id = target_station_branch_id
      )
    order by target_order.created_at desc
    limit target_limit
  ) station_settlements;

  return result;
end;
$$;

revoke all on function public.read_my_lpg_station_settlement_explanations(uuid, uuid, integer)
from public, anon;
grant execute on function public.read_my_lpg_station_settlement_explanations(uuid, uuid, integer)
to authenticated;

comment on function public.read_my_lpg_station_settlement_explanations(uuid, uuid, integer) is
  'Returns branch-finance-scoped station principal and canonical settlement posting status for LPG orders. Excludes platform margin, driver payout and escrow internals.';

commit;
