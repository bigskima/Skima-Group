begin;

-- Deterministic pricing intelligence for SKIMA.
-- This runtime observes current governed station prices and the current platform markup,
-- then produces review/simulation data only. It never changes a station price, financial
-- policy, quote, order, wallet, ledger entry, settlement, or dispatch decision.

create table if not exists public.ai_pricing_intelligence_rules (
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

create table if not exists public.ai_pricing_intelligence_snapshots (
  id uuid primary key default gen_random_uuid(),
  snapshot_key text not null unique
    check (snapshot_key ~ '^[a-z][a-z0-9_.:-]{2,160}$'),
  rule_id uuid not null references public.ai_pricing_intelligence_rules(id) on delete restrict,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  current_platform_markup_per_kg numeric(28,8) not null check (current_platform_markup_per_kg >= 0),
  approved_station_count integer not null default 0 check (approved_station_count >= 0),
  priced_station_count integer not null default 0 check (priced_station_count >= 0),
  minimum_station_price_per_kg numeric(28,8),
  median_station_price_per_kg numeric(28,8),
  average_station_price_per_kg numeric(28,8),
  maximum_station_price_per_kg numeric(28,8),
  historical_order_count integer not null default 0 check (historical_order_count >= 0),
  historical_kg numeric(28,8) not null default 0 check (historical_kg >= 0),
  scenario_projections jsonb not null default '[]'::jsonb
    check (jsonb_typeof(scenario_projections) = 'array'),
  station_price_reviews jsonb not null default '[]'::jsonb
    check (jsonb_typeof(station_price_reviews) = 'array'),
  assumptions jsonb not null default '{}'::jsonb
    check (jsonb_typeof(assumptions) = 'object'),
  generated_at timestamptz not null default timezone('utc', now()),
  valid_until timestamptz not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_pricing_intelligence_snapshots_generated_idx
on public.ai_pricing_intelligence_snapshots (currency_code, generated_at desc);

alter table public.ai_pricing_intelligence_rules enable row level security;
alter table public.ai_pricing_intelligence_snapshots enable row level security;

drop policy if exists ai_pricing_rules_read_privileged on public.ai_pricing_intelligence_rules;
create policy ai_pricing_rules_read_privileged
on public.ai_pricing_intelligence_rules
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.has_permission('platform.pricing.read', null)
  or public.has_permission('platform.revenue.read', null)
);

drop policy if exists ai_pricing_rules_manage_privileged on public.ai_pricing_intelligence_rules;
create policy ai_pricing_rules_manage_privileged
on public.ai_pricing_intelligence_rules
for all to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
)
with check (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_pricing_snapshots_read_privileged on public.ai_pricing_intelligence_snapshots;
create policy ai_pricing_snapshots_read_privileged
on public.ai_pricing_intelligence_snapshots
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.has_permission('platform.pricing.read', null)
  or public.has_permission('platform.revenue.read', null)
);

drop policy if exists ai_pricing_snapshots_no_direct_insert on public.ai_pricing_intelligence_snapshots;
create policy ai_pricing_snapshots_no_direct_insert
on public.ai_pricing_intelligence_snapshots
for insert to authenticated
with check (false);

drop policy if exists ai_pricing_snapshots_no_direct_update on public.ai_pricing_intelligence_snapshots;
create policy ai_pricing_snapshots_no_direct_update
on public.ai_pricing_intelligence_snapshots
for update to authenticated
using (false)
with check (false);

drop policy if exists ai_pricing_snapshots_no_direct_delete on public.ai_pricing_intelligence_snapshots;
create policy ai_pricing_snapshots_no_direct_delete
on public.ai_pricing_intelligence_snapshots
for delete to authenticated
using (false);

grant select on public.ai_pricing_intelligence_rules to authenticated;
grant select on public.ai_pricing_intelligence_snapshots to authenticated;
grant all on public.ai_pricing_intelligence_rules, public.ai_pricing_intelligence_snapshots to service_role;

insert into public.ai_pricing_intelligence_rules (
  key, display_name, status, config
)
values (
  'ai.pricing.lpg.review',
  'LPG pricing review and simulation',
  'active',
  '{
    "control": "simulation_only",
    "currency_code": "NGN",
    "lookback_days": 30,
    "snapshot_valid_minutes": 60,
    "station_review_deviation_percent": 20,
    "scenario_multipliers": [0.8, 0.9, 1.0, 1.1, 1.2],
    "volume_assumption": "constant_historical_volume"
  }'::jsonb
)
on conflict (key) do update
set display_name = excluded.display_name,
    config = public.ai_pricing_intelligence_rules.config || excluded.config,
    updated_at = timezone('utc', now());

create or replace function public.validate_ai_pricing_intelligence_rule_config()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  lookback_days integer;
  valid_minutes integer;
  review_percent numeric;
  multiplier numeric;
begin
  if jsonb_typeof(new.config) <> 'object' then
    raise exception 'pricing intelligence configuration must be an object';
  end if;

  if coalesce(new.config ->> 'control', '') <> 'simulation_only' then
    raise exception 'pricing intelligence control must remain simulation_only';
  end if;

  if coalesce(new.config ->> 'volume_assumption', '') <> 'constant_historical_volume' then
    raise exception 'pricing intelligence must not claim demand elasticity without an approved forecasting model';
  end if;

  if coalesce(new.config ->> 'currency_code', '') !~ '^[A-Z]{3}$' then
    raise exception 'pricing intelligence currency_code must be a three-letter currency code';
  end if;

  if coalesce(new.config ->> 'lookback_days', '') !~ '^[0-9]+$' then
    raise exception 'pricing intelligence lookback_days must be a whole number';
  end if;
  lookback_days := (new.config ->> 'lookback_days')::integer;
  if lookback_days not between 1 and 365 then
    raise exception 'pricing intelligence lookback_days must be between 1 and 365';
  end if;

  if coalesce(new.config ->> 'snapshot_valid_minutes', '') !~ '^[0-9]+$' then
    raise exception 'pricing intelligence snapshot_valid_minutes must be a whole number';
  end if;
  valid_minutes := (new.config ->> 'snapshot_valid_minutes')::integer;
  if valid_minutes not between 5 and 1440 then
    raise exception 'pricing intelligence snapshot_valid_minutes must be between 5 and 1440';
  end if;

  if coalesce(new.config ->> 'station_review_deviation_percent', '') !~ '^[0-9]+([.][0-9]+)?$' then
    raise exception 'pricing intelligence station review deviation must be numeric';
  end if;
  review_percent := (new.config ->> 'station_review_deviation_percent')::numeric;
  if review_percent < 1 or review_percent > 200 then
    raise exception 'pricing intelligence station review deviation must be between 1 and 200 percent';
  end if;

  if jsonb_typeof(new.config -> 'scenario_multipliers') <> 'array'
    or jsonb_array_length(new.config -> 'scenario_multipliers') < 1
    or jsonb_array_length(new.config -> 'scenario_multipliers') > 9 then
    raise exception 'pricing intelligence scenario_multipliers must contain between 1 and 9 values';
  end if;

  for multiplier in
    select value::numeric
    from jsonb_array_elements_text(new.config -> 'scenario_multipliers') value
  loop
    if multiplier < 0 or multiplier > 5 then
      raise exception 'pricing intelligence scenario multipliers must be between 0 and 5';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists validate_ai_pricing_intelligence_rule_config
on public.ai_pricing_intelligence_rules;

create trigger validate_ai_pricing_intelligence_rule_config
before insert or update of config
on public.ai_pricing_intelligence_rules
for each row
execute function public.validate_ai_pricing_intelligence_rule_config();

update public.ai_pricing_intelligence_rules
set config = config,
    updated_at = updated_at
where key = 'ai.pricing.lpg.review';

create or replace function public.refresh_ai_pricing_intelligence()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  rule_record public.ai_pricing_intelligence_rules%rowtype;
  currency_value text;
  lookback_days integer;
  valid_minutes integer;
  review_percent numeric;
  current_markup numeric(28,8) := 0;
  approved_station_count integer := 0;
  priced_station_count integer := 0;
  min_station_price numeric(28,8);
  median_station_price numeric(28,8);
  avg_station_price numeric(28,8);
  max_station_price numeric(28,8);
  historical_order_count integer := 0;
  historical_kg numeric(28,8) := 0;
  scenario_rows jsonb := '[]'::jsonb;
  review_rows jsonb := '[]'::jsonb;
  now_at timestamptz := timezone('utc', now());
  result_record public.ai_pricing_intelligence_snapshots%rowtype;
begin
  select * into rule_record
  from public.ai_pricing_intelligence_rules
  where key = 'ai.pricing.lpg.review'
    and status = 'active';

  if rule_record.id is null then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'pricing_intelligence_rule_inactive',
      'control', 'simulation_only',
      'refreshedAt', now_at
    );
  end if;

  currency_value := rule_record.config ->> 'currency_code';
  lookback_days := (rule_record.config ->> 'lookback_days')::integer;
  valid_minutes := (rule_record.config ->> 'snapshot_valid_minutes')::integer;
  review_percent := (rule_record.config ->> 'station_review_deviation_percent')::numeric;

  select coalesce(nullif(version.configuration ->> 'amount_per_kg', '')::numeric, 0)
  into current_markup
  from public.financial_policy_versions version
  join public.financial_policy_definitions definition
    on definition.id = version.policy_definition_id
  where definition.key = 'pricing.lpg.platform_markup_per_kg'
    and definition.status = 'active'
    and version.currency_code = currency_value
    and version.organization_id is null
    and version.service_key = 'lpg.refill'
    and version.geography_type = 'global'
    and version.geography_key is null
    and version.lifecycle_status = 'active'
    and version.effective_from <= now_at
    and (version.effective_until is null or version.effective_until > now_at)
  order by version.priority desc, version.effective_from desc, version.version desc
  limit 1;

  current_markup := coalesce(current_markup, 0);

  select count(*)::integer
  into approved_station_count
  from public.lpg_station_branches station
  where station.approval_status = 'approved';

  with current_prices as (
    select
      station.id as station_branch_id,
      station.display_name,
      avg(price.amount)::numeric(28,8) as station_price_per_kg
    from public.lpg_station_branches station
    join public.catalog_prices price
      on price.organization_id = station.organization_id
     and price.branch_id is not distinct from station.branch_id
    join public.catalog_items item
      on item.id = price.item_id
     and item.organization_id = station.organization_id
     and item.branch_id is not distinct from station.branch_id
    where station.approval_status = 'approved'
      and price.currency_code = currency_value
      and price.status = 'active'
      and coalesce(price.effective_from, now_at) <= now_at
      and (price.effective_until is null or price.effective_until > now_at)
      and price.metadata ->> 'price_basis' = 'per_kg'
      and item.status = 'active'
      and item.metadata ->> 'price_basis' = 'per_kg'
    group by station.id, station.display_name
  )
  select
    count(*)::integer,
    min(station_price_per_kg)::numeric(28,8),
    percentile_cont(0.5) within group (order by station_price_per_kg)::numeric(28,8),
    avg(station_price_per_kg)::numeric(28,8),
    max(station_price_per_kg)::numeric(28,8)
  into
    priced_station_count,
    min_station_price,
    median_station_price,
    avg_station_price,
    max_station_price
  from current_prices;

  select
    count(*)::integer,
    coalesce(sum(coalesce(order_record.actual_kg, order_record.quoted_kg, order_record.requested_kg)), 0)::numeric(28,8)
  into historical_order_count, historical_kg
  from public.lpg_refill_orders order_record
  where order_record.status in ('delivered','completed')
    and order_record.created_at >= now_at - make_interval(days => lookback_days);

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'multiplier', scenario.multiplier,
        'proposedPlatformMarkupPerKg', round(current_markup * scenario.multiplier, 2),
        'historicalKg', historical_kg,
        'projectedPlatformRevenue', round(current_markup * scenario.multiplier * historical_kg, 2),
        'currentVolumeRevenueReference', round(current_markup * historical_kg, 2),
        'differenceFromCurrent', round(
          (current_markup * scenario.multiplier * historical_kg) - (current_markup * historical_kg),
          2
        ),
        'assumption', 'constant_historical_volume',
        'changesPolicy', false
      )
      order by scenario.multiplier
    ),
    '[]'::jsonb
  )
  into scenario_rows
  from (
    select value::numeric as multiplier
    from jsonb_array_elements_text(rule_record.config -> 'scenario_multipliers') value
  ) scenario;

  if median_station_price is not null and median_station_price > 0 then
    with current_prices as (
      select
        station.id as station_branch_id,
        station.display_name,
        avg(price.amount)::numeric(28,8) as station_price_per_kg
      from public.lpg_station_branches station
      join public.catalog_prices price
        on price.organization_id = station.organization_id
       and price.branch_id is not distinct from station.branch_id
      join public.catalog_items item
        on item.id = price.item_id
       and item.organization_id = station.organization_id
       and item.branch_id is not distinct from station.branch_id
      where station.approval_status = 'approved'
        and price.currency_code = currency_value
        and price.status = 'active'
        and coalesce(price.effective_from, now_at) <= now_at
        and (price.effective_until is null or price.effective_until > now_at)
        and price.metadata ->> 'price_basis' = 'per_kg'
        and item.status = 'active'
        and item.metadata ->> 'price_basis' = 'per_kg'
      group by station.id, station.display_name
    )
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'stationBranchId', price.station_branch_id,
          'stationDisplayName', price.display_name,
          'pricePerKg', price.station_price_per_kg,
          'medianStationPricePerKg', median_station_price,
          'deviationPercent', round(
            abs(price.station_price_per_kg - median_station_price) / median_station_price * 100,
            2
          ),
          'direction', case
            when price.station_price_per_kg > median_station_price then 'above_median'
            else 'below_median'
          end,
          'reviewOnly', true
        )
        order by abs(price.station_price_per_kg - median_station_price) desc
      ),
      '[]'::jsonb
    )
    into review_rows
    from current_prices price
    where abs(price.station_price_per_kg - median_station_price) / median_station_price * 100
      >= review_percent;
  end if;

  insert into public.ai_pricing_intelligence_snapshots (
    snapshot_key,
    rule_id,
    currency_code,
    current_platform_markup_per_kg,
    approved_station_count,
    priced_station_count,
    minimum_station_price_per_kg,
    median_station_price_per_kg,
    average_station_price_per_kg,
    maximum_station_price_per_kg,
    historical_order_count,
    historical_kg,
    scenario_projections,
    station_price_reviews,
    assumptions,
    generated_at,
    valid_until,
    version
  )
  values (
    'lpg.global.' || lower(currency_value),
    rule_record.id,
    currency_value,
    current_markup,
    approved_station_count,
    priced_station_count,
    min_station_price,
    median_station_price,
    avg_station_price,
    max_station_price,
    historical_order_count,
    historical_kg,
    scenario_rows,
    review_rows,
    jsonb_build_object(
      'control', 'simulation_only',
      'source', 'current_governed_skima_prices',
      'lookbackDays', lookback_days,
      'stationReviewDeviationPercent', review_percent,
      'volumeAssumption', 'constant_historical_volume',
      'modelsDemandElasticity', false,
      'setsStationPrice', false,
      'changesPlatformMarkup', false,
      'changesQuotes', false,
      'changesDispatch', false
    ),
    now_at,
    now_at + make_interval(mins => valid_minutes),
    1
  )
  on conflict (snapshot_key) do update
  set rule_id = excluded.rule_id,
      currency_code = excluded.currency_code,
      current_platform_markup_per_kg = excluded.current_platform_markup_per_kg,
      approved_station_count = excluded.approved_station_count,
      priced_station_count = excluded.priced_station_count,
      minimum_station_price_per_kg = excluded.minimum_station_price_per_kg,
      median_station_price_per_kg = excluded.median_station_price_per_kg,
      average_station_price_per_kg = excluded.average_station_price_per_kg,
      maximum_station_price_per_kg = excluded.maximum_station_price_per_kg,
      historical_order_count = excluded.historical_order_count,
      historical_kg = excluded.historical_kg,
      scenario_projections = excluded.scenario_projections,
      station_price_reviews = excluded.station_price_reviews,
      assumptions = excluded.assumptions,
      generated_at = excluded.generated_at,
      valid_until = excluded.valid_until,
      version = public.ai_pricing_intelligence_snapshots.version + 1,
      updated_at = timezone('utc', now())
  returning * into result_record;

  return jsonb_build_object(
    'status', 'completed',
    'snapshotKey', result_record.snapshot_key,
    'pricedStationCount', result_record.priced_station_count,
    'stationReviewCount', jsonb_array_length(result_record.station_price_reviews),
    'scenarioCount', jsonb_array_length(result_record.scenario_projections),
    'generatedAt', result_record.generated_at,
    'control', 'simulation_only'
  );
end;
$$;

revoke all on function public.refresh_ai_pricing_intelligence()
from public, anon, authenticated;
grant execute on function public.refresh_ai_pricing_intelligence()
to service_role;

create or replace function public.read_ai_pricing_intelligence(
  target_currency_code text default 'NGN'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  snapshot_record public.ai_pricing_intelligence_snapshots%rowtype;
begin
  if not (
    auth.role() = 'service_role'
    or public.is_platform_super_admin()
    or public.has_permission('platform.ai.read', null)
    or public.has_permission('platform.ai.manage', null)
    or public.has_permission('platform.pricing.read', null)
    or public.has_permission('platform.revenue.read', null)
  ) then
    raise exception using errcode = '42501', message = 'pricing intelligence read permission is required';
  end if;

  select * into snapshot_record
  from public.ai_pricing_intelligence_snapshots snapshot
  where snapshot.snapshot_key = 'lpg.global.' || lower(upper(target_currency_code))
  limit 1;

  if snapshot_record.id is null then
    return jsonb_build_object(
      'available', false,
      'currencyCode', upper(target_currency_code),
      'control', 'simulation_only'
    );
  end if;

  return jsonb_build_object(
    'available', true,
    'currencyCode', snapshot_record.currency_code,
    'currentPlatformMarkupPerKg', snapshot_record.current_platform_markup_per_kg,
    'approvedStationCount', snapshot_record.approved_station_count,
    'pricedStationCount', snapshot_record.priced_station_count,
    'stationPriceDistribution', jsonb_build_object(
      'minimumPerKg', snapshot_record.minimum_station_price_per_kg,
      'medianPerKg', snapshot_record.median_station_price_per_kg,
      'averagePerKg', snapshot_record.average_station_price_per_kg,
      'maximumPerKg', snapshot_record.maximum_station_price_per_kg
    ),
    'historicalVolume', jsonb_build_object(
      'orderCount', snapshot_record.historical_order_count,
      'kg', snapshot_record.historical_kg
    ),
    'scenarioProjections', snapshot_record.scenario_projections,
    'stationPriceReviews', snapshot_record.station_price_reviews,
    'assumptions', snapshot_record.assumptions,
    'generatedAt', snapshot_record.generated_at,
    'validUntil', snapshot_record.valid_until,
    'version', snapshot_record.version
  );
end;
$$;

revoke all on function public.read_ai_pricing_intelligence(text)
from public, anon;
grant execute on function public.read_ai_pricing_intelligence(text)
to authenticated, service_role;

commit;
