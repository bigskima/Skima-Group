begin;

-- SKIMA Station Inventory Outlook.
-- Deterministic decision support that combines canonical inventory state, the existing
-- demand forecast, and operational-capacity state. It is read-only and never changes
-- stock, reservations, availability, dispatch, provider configuration, or station capacity.
--
-- A depletion estimate is intentionally withheld when live inventory evidence is not
-- trustworthy enough (stale/untrusted/offline/setup-required/unknown).

create table if not exists public.ai_station_inventory_outlook_rules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  status text not null default 'active'
    check (status in ('draft','active','paused','retired')),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.ai_station_inventory_outlook_rules enable row level security;

drop policy if exists ai_station_inventory_outlook_rules_read_privileged
on public.ai_station_inventory_outlook_rules;
create policy ai_station_inventory_outlook_rules_read_privileged
on public.ai_station_inventory_outlook_rules
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.has_permission('platform.inventory.manage', null)
);

drop policy if exists ai_station_inventory_outlook_rules_manage_privileged
on public.ai_station_inventory_outlook_rules;
create policy ai_station_inventory_outlook_rules_manage_privileged
on public.ai_station_inventory_outlook_rules
for all to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
)
with check (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
);

grant select, insert, update, delete
on public.ai_station_inventory_outlook_rules
to authenticated;
grant all
on public.ai_station_inventory_outlook_rules
to service_role;

insert into public.ai_station_inventory_outlook_rules (
  key,
  display_name,
  status,
  config
)
values (
  'ai.inventory.lpg.station.outlook',
  'LPG station inventory outlook',
  'active',
  '{
    "control": "advisory_only",
    "critical_coverage_days": 1.5,
    "urgent_coverage_days": 3,
    "elevated_coverage_days": 7,
    "trusted_source_confidence": ["HIGH","MEDIUM"],
    "trusted_freshness_status": ["FRESH","AGING"],
    "allowed_source_health": ["healthy","degraded"],
    "preferred_forecast_horizons_days": [1,7],
    "assume_no_replenishment": true
  }'::jsonb
)
on conflict (key) do update
set display_name = excluded.display_name,
    config = public.ai_station_inventory_outlook_rules.config || excluded.config,
    updated_at = timezone('utc', now());

create or replace function public.validate_ai_station_inventory_outlook_rule_config()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  critical_days numeric;
  urgent_days numeric;
  elevated_days numeric;
begin
  if jsonb_typeof(new.config) <> 'object' then
    raise exception 'station inventory outlook configuration must be an object';
  end if;

  if coalesce(new.config ->> 'control', '') <> 'advisory_only' then
    raise exception 'station inventory outlook control must remain advisory_only';
  end if;

  if coalesce((new.config ->> 'assume_no_replenishment')::boolean, false) <> true then
    raise exception 'station inventory outlook must retain the no-replenishment assumption';
  end if;

  if coalesce(new.config ->> 'critical_coverage_days', '') !~ '^[0-9]+([.][0-9]+)?$'
    or coalesce(new.config ->> 'urgent_coverage_days', '') !~ '^[0-9]+([.][0-9]+)?$'
    or coalesce(new.config ->> 'elevated_coverage_days', '') !~ '^[0-9]+([.][0-9]+)?$' then
    raise exception 'station inventory coverage thresholds must be non-negative numbers';
  end if;

  critical_days := (new.config ->> 'critical_coverage_days')::numeric;
  urgent_days := (new.config ->> 'urgent_coverage_days')::numeric;
  elevated_days := (new.config ->> 'elevated_coverage_days')::numeric;

  if critical_days <= 0
    or urgent_days <= critical_days
    or elevated_days <= urgent_days
    or elevated_days > 90 then
    raise exception 'station inventory coverage thresholds must increase from critical to urgent to elevated within 90 days';
  end if;

  if jsonb_typeof(new.config -> 'trusted_source_confidence') <> 'array'
    or jsonb_array_length(new.config -> 'trusted_source_confidence') = 0
    or exists (
      select 1
      from jsonb_array_elements_text(new.config -> 'trusted_source_confidence') value
      where value not in ('HIGH','MEDIUM','LOW','STALE','UNTRUSTED')
    ) then
    raise exception 'station inventory trusted_source_confidence contains an unsupported state';
  end if;

  if jsonb_typeof(new.config -> 'trusted_freshness_status') <> 'array'
    or jsonb_array_length(new.config -> 'trusted_freshness_status') = 0
    or exists (
      select 1
      from jsonb_array_elements_text(new.config -> 'trusted_freshness_status') value
      where value not in ('FRESH','AGING','LOW','STALE','UNKNOWN')
    ) then
    raise exception 'station inventory trusted_freshness_status contains an unsupported state';
  end if;

  if jsonb_typeof(new.config -> 'allowed_source_health') <> 'array'
    or jsonb_array_length(new.config -> 'allowed_source_health') = 0
    or exists (
      select 1
      from jsonb_array_elements_text(new.config -> 'allowed_source_health') value
      where value not in ('healthy','degraded','offline','unknown')
    ) then
    raise exception 'station inventory allowed_source_health contains an unsupported state';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_ai_station_inventory_outlook_rule_config
on public.ai_station_inventory_outlook_rules;

create trigger validate_ai_station_inventory_outlook_rule_config
before insert or update of config
on public.ai_station_inventory_outlook_rules
for each row
execute function public.validate_ai_station_inventory_outlook_rule_config();

update public.ai_station_inventory_outlook_rules
set config = config,
    updated_at = updated_at
where key = 'ai.inventory.lpg.station.outlook';

create or replace function public.read_ai_station_inventory_outlook(
  target_station_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  rule_config jsonb;
  critical_days numeric;
  urgent_days numeric;
  elevated_days numeric;
  result jsonb;
begin
  select rule.config
  into rule_config
  from public.ai_station_inventory_outlook_rules rule
  where rule.key = 'ai.inventory.lpg.station.outlook'
    and rule.status = 'active'
  limit 1;

  if rule_config is null then
    return '[]'::jsonb;
  end if;

  critical_days := (rule_config ->> 'critical_coverage_days')::numeric;
  urgent_days := (rule_config ->> 'urgent_coverage_days')::numeric;
  elevated_days := (rule_config ->> 'elevated_coverage_days')::numeric;

  select coalesce(
    jsonb_agg(row_data order by station_name, station_branch_id),
    '[]'::jsonb
  )
  into result
  from (
    select
      branch.id as station_branch_id,
      branch.display_name as station_name,
      jsonb_build_object(
        'stationBranchId', branch.id,
        'stationDisplayName', branch.display_name,
        'inventory', jsonb_build_object(
          'physicalStockKg', inventory.physical_stock_kg,
          'safetyReserveKg', inventory.safe_stock_kg,
          'skimaAllocationKg', inventory.skima_allocation_kg,
          'reservedKg', inventory.reserved_kg,
          'dispatchableKg', inventory.dispatchable_kg,
          'inventoryStatus', inventory.inventory_status,
          'sourceConfidence', inventory.source_confidence,
          'freshnessStatus', inventory.freshness_status,
          'sourceHealth', inventory.source_health,
          'reconciliationStatus', inventory.reconciliation_status,
          'rolloutStatus', inventory.rollout_status,
          'lastSourceUpdateAt', inventory.last_source_update_at,
          'lastVerifiedAt', inventory.last_verified_at,
          'dispatchBlockedUntil', inventory.dispatch_blocked_until,
          'dispatchBlockReason', inventory.dispatch_block_reason
        ),
        'demand', jsonb_build_object(
          'predictedDailyKg', outlook.predicted_daily_kg,
          'predicted1DayKg', outlook.predicted_1_day_kg,
          'predicted7DayKg', outlook.predicted_7_day_kg,
          'forecastConfidence', outlook.forecast_confidence,
          'forecastGeneratedAt', outlook.forecast_generated_at,
          'forecastValidUntil', outlook.forecast_valid_until
        ),
        'capacity', jsonb_build_object(
          'activeJobs', workload.active_jobs,
          'maximumConcurrentJobs', capacity.maximum_concurrent_jobs,
          'fillingPoints', capacity.filling_points,
          'estimatedProcessingMinutes', capacity.estimated_processing_minutes,
          'congestionStatus', capacity.congestion_status,
          'pausedUntil', capacity.paused_until,
          'queueUtilization', case
            when capacity.maximum_concurrent_jobs > 0
              then round(workload.active_jobs::numeric / capacity.maximum_concurrent_jobs::numeric, 3)
            else null
          end
        ),
        'inventoryTrustworthy', outlook.inventory_trustworthy,
        'depletionEstimateAvailable', outlook.depletion_estimate_available,
        'coverageDays', outlook.coverage_days,
        'estimatedDepletionAt', outlook.estimated_depletion_at,
        'projectedShortfall1DayKg', outlook.projected_shortfall_1_day_kg,
        'projectedShortfall7DayKg', outlook.projected_shortfall_7_day_kg,
        'pressureLevel', case
          when inventory.inventory_status in ('OUT_OF_STOCK','CRITICAL') then 'critical'
          when not outlook.inventory_trustworthy then 'attention'
          when outlook.coverage_days is not null and outlook.coverage_days <= critical_days then 'critical'
          when outlook.coverage_days is not null and outlook.coverage_days <= urgent_days then 'urgent'
          when outlook.coverage_days is not null and outlook.coverage_days <= elevated_days then 'elevated'
          when capacity.congestion_status in ('paused','congested') then 'elevated'
          else 'normal'
        end,
        'recommendedAction', case
          when inventory.rollout_status <> 'active'
            or inventory.physical_stock_kg is null
            then 'Confirm real station LPG stock before using a stock-pressure estimate.'
          when inventory.reconciliation_status <> 'current'
            then 'Review the open inventory reconciliation evidence before relying on the stock outlook.'
          when not outlook.inventory_trustworthy
            then 'Refresh or verify the inventory source before relying on a depletion estimate.'
          when inventory.dispatch_blocked_until is not null
            and inventory.dispatch_blocked_until > timezone('utc', now())
            then 'Review the existing inventory dispatch pause and its authoritative reason before planning new orders.'
          when inventory.inventory_status = 'OUT_OF_STOCK'
            then 'Plan stock replenishment and confirm the new physical stock through the canonical inventory workflow.'
          when outlook.coverage_days is not null and outlook.coverage_days <= critical_days
            then 'Current dispatchable stock may cover about one day or less of estimated demand if no replenishment arrives. Review replenishment and active reservations now.'
          when outlook.coverage_days is not null and outlook.coverage_days <= urgent_days
            then 'Current dispatchable stock may cover only a few days of estimated demand if no replenishment arrives. Review replenishment timing and reservations.'
          when outlook.coverage_days is not null and outlook.coverage_days <= elevated_days
            then 'Stock pressure is elevated against recent demand. Monitor inventory freshness, reservations and replenishment planning.'
          when capacity.congestion_status in ('paused','congested')
            then 'Inventory may be sufficient, but processing capacity is constrained. Review the canonical station capacity state.'
          else 'No immediate stock-pressure action is suggested from the current inventory and demand estimate.'
        end,
        'limits', jsonb_build_object(
          'estimateOnly', true,
          'assumesNoReplenishment', true,
          'doesNotPredictSupplierDelivery', true,
          'doesNotChangeInventory', true,
          'doesNotChangeReservations', true,
          'doesNotChangeAvailability', true,
          'doesNotChangeDispatch', true,
          'doesNotChangeCapacity', true,
          'doesNotCertifySafety', true
        )
      ) as row_data
    from public.lpg_station_branches branch
    join public.station_lpg_inventory_state inventory
      on inventory.station_branch_id = branch.id
    join public.station_inventory_operational_capacity capacity
      on capacity.station_branch_id = branch.id
    left join lateral (
      select count(*)::integer as active_jobs
      from public.lpg_refill_orders active_order
      where active_order.station_branch_id = branch.id
        and active_order.status not in ('completed','cancelled','refunded','failed')
    ) workload on true
    left join lateral (
      select
        coalesce(
          day_one.predicted_kg,
          case
            when week_seven.predicted_kg is not null then week_seven.predicted_kg / 7.0
            else null
          end
        )::numeric(16,3) as predicted_1_day_kg,
        coalesce(
          week_seven.predicted_kg,
          case
            when day_one.predicted_kg is not null then day_one.predicted_kg * 7.0
            else null
          end
        )::numeric(16,3) as predicted_7_day_kg,
        coalesce(
          day_one.predicted_kg,
          case
            when week_seven.predicted_kg is not null then week_seven.predicted_kg / 7.0
            else null
          end
        )::numeric(16,3) as predicted_daily_kg,
        coalesce(day_one.confidence, week_seven.confidence) as forecast_confidence,
        coalesce(day_one.generated_at, week_seven.generated_at) as forecast_generated_at,
        least(
          coalesce(day_one.valid_until, 'infinity'::timestamptz),
          coalesce(week_seven.valid_until, 'infinity'::timestamptz)
        ) as forecast_valid_until
      from (
        select
          snapshot.predicted_kg,
          snapshot.confidence,
          snapshot.generated_at,
          snapshot.valid_until
        from public.ai_forecast_snapshots snapshot
        where snapshot.subject_type = 'lpg_station_branch'
          and snapshot.subject_id = branch.id
          and snapshot.horizon_days = 1
          and snapshot.valid_until > timezone('utc', now())
        order by snapshot.generated_at desc
        limit 1
      ) day_one
      full join (
        select
          snapshot.predicted_kg,
          snapshot.confidence,
          snapshot.generated_at,
          snapshot.valid_until
        from public.ai_forecast_snapshots snapshot
        where snapshot.subject_type = 'lpg_station_branch'
          and snapshot.subject_id = branch.id
          and snapshot.horizon_days = 7
          and snapshot.valid_until > timezone('utc', now())
        order by snapshot.generated_at desc
        limit 1
      ) week_seven on true
    ) demand on true
    cross join lateral (
      select
        (
          inventory.rollout_status = 'active'
          and inventory.physical_stock_kg is not null
          and inventory.inventory_status not in ('UNKNOWN','STALE')
          and inventory.source_confidence in (
            select value
            from jsonb_array_elements_text(rule_config -> 'trusted_source_confidence')
          )
          and inventory.freshness_status in (
            select value
            from jsonb_array_elements_text(rule_config -> 'trusted_freshness_status')
          )
          and inventory.source_health in (
            select value
            from jsonb_array_elements_text(rule_config -> 'allowed_source_health')
          )
        ) as inventory_trustworthy,
        demand.predicted_daily_kg,
        demand.predicted_1_day_kg,
        demand.predicted_7_day_kg,
        demand.forecast_confidence,
        demand.forecast_generated_at,
        case
          when demand.forecast_valid_until = 'infinity'::timestamptz then null
          else demand.forecast_valid_until
        end as forecast_valid_until,
        (
          inventory.rollout_status = 'active'
          and inventory.physical_stock_kg is not null
          and inventory.inventory_status not in ('UNKNOWN','STALE')
          and inventory.source_confidence in (
            select value
            from jsonb_array_elements_text(rule_config -> 'trusted_source_confidence')
          )
          and inventory.freshness_status in (
            select value
            from jsonb_array_elements_text(rule_config -> 'trusted_freshness_status')
          )
          and inventory.source_health in (
            select value
            from jsonb_array_elements_text(rule_config -> 'allowed_source_health')
          )
          and coalesce(demand.predicted_daily_kg, 0) > 0
        ) as depletion_estimate_available,
        case
          when (
            inventory.rollout_status = 'active'
            and inventory.physical_stock_kg is not null
            and inventory.inventory_status not in ('UNKNOWN','STALE')
            and inventory.source_confidence in (
              select value
              from jsonb_array_elements_text(rule_config -> 'trusted_source_confidence')
            )
            and inventory.freshness_status in (
              select value
              from jsonb_array_elements_text(rule_config -> 'trusted_freshness_status')
            )
            and inventory.source_health in (
              select value
              from jsonb_array_elements_text(rule_config -> 'allowed_source_health')
            )
            and coalesce(demand.predicted_daily_kg, 0) > 0
          )
            then round(inventory.dispatchable_kg / demand.predicted_daily_kg, 2)
          else null
        end as coverage_days,
        case
          when (
            inventory.rollout_status = 'active'
            and inventory.physical_stock_kg is not null
            and inventory.inventory_status not in ('UNKNOWN','STALE')
            and inventory.source_confidence in (
              select value
              from jsonb_array_elements_text(rule_config -> 'trusted_source_confidence')
            )
            and inventory.freshness_status in (
              select value
              from jsonb_array_elements_text(rule_config -> 'trusted_freshness_status')
            )
            and inventory.source_health in (
              select value
              from jsonb_array_elements_text(rule_config -> 'allowed_source_health')
            )
            and coalesce(demand.predicted_daily_kg, 0) > 0
          )
            then timezone('utc', now())
              + ((inventory.dispatchable_kg / demand.predicted_daily_kg)::double precision * interval '1 day')
          else null
        end as estimated_depletion_at,
        case
          when demand.predicted_1_day_kg is null then null
          else round(greatest(demand.predicted_1_day_kg - inventory.dispatchable_kg, 0), 3)
        end as projected_shortfall_1_day_kg,
        case
          when demand.predicted_7_day_kg is null then null
          else round(greatest(demand.predicted_7_day_kg - inventory.dispatchable_kg, 0), 3)
        end as projected_shortfall_7_day_kg
    ) outlook
    where (target_station_branch_id is null or branch.id = target_station_branch_id)
      and public.can_read_lpg_station_inventory(branch.id)
  ) station_rows;

  return result;
end;
$$;

revoke all on function public.read_ai_station_inventory_outlook(uuid)
from public, anon;
grant execute on function public.read_ai_station_inventory_outlook(uuid)
to authenticated, service_role;

comment on function public.read_ai_station_inventory_outlook(uuid) is
  'Read-only station stock-pressure outlook from canonical inventory plus deterministic demand forecast. Depletion estimate is withheld when inventory evidence is stale/untrusted and assumes no replenishment.';

commit;
