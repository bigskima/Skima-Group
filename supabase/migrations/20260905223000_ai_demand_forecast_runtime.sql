begin;

-- Deterministic, configuration-driven demand forecasting for SKIMA Intelligence.
-- This engine predicts demand only. It never changes dispatch, pricing, inventory, settlement,
-- payments, permissions, applications, or any authoritative LPG workflow state.

create table if not exists public.ai_forecast_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  domain text not null check (domain in ('lpg_station_demand','custom')),
  method text not null check (method in ('weighted_moving_average')),
  status text not null default 'active'
    check (status in ('draft','active','paused','retired')),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_forecast_snapshots (
  id uuid primary key default gen_random_uuid(),
  definition_id uuid not null references public.ai_forecast_definitions(id) on delete restrict,
  subject_type text not null check (subject_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  subject_id uuid not null,
  horizon_days integer not null check (horizon_days between 1 and 90),
  method text not null check (method in ('weighted_moving_average')),
  confidence text not null check (confidence in ('low','medium','high')),
  predicted_orders numeric(14, 2) not null check (predicted_orders >= 0),
  predicted_kg numeric(16, 3) not null check (predicted_kg >= 0),
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  generated_at timestamptz not null default timezone('utc', now()),
  valid_until timestamptz not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (definition_id, subject_type, subject_id, horizon_days)
);

create index if not exists ai_forecast_snapshots_subject_idx
on public.ai_forecast_snapshots (subject_type, subject_id, horizon_days);

create index if not exists ai_forecast_snapshots_validity_idx
on public.ai_forecast_snapshots (valid_until desc, generated_at desc);

alter table public.ai_forecast_definitions enable row level security;
alter table public.ai_forecast_snapshots enable row level security;

drop policy if exists ai_forecast_definitions_read_privileged on public.ai_forecast_definitions;
create policy ai_forecast_definitions_read_privileged
on public.ai_forecast_definitions
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_forecast_definitions_manage_privileged on public.ai_forecast_definitions;
create policy ai_forecast_definitions_manage_privileged
on public.ai_forecast_definitions
for all to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
)
with check (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_forecast_snapshots_read_authorized on public.ai_forecast_snapshots;
create policy ai_forecast_snapshots_read_authorized
on public.ai_forecast_snapshots
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or (
    subject_type = 'lpg_station_branch'
    and (
      public.can_operate_lpg_station_branch(subject_id, 'lpg.stations.read')
      or public.can_operate_lpg_station_branch(subject_id, 'lpg.orders.read')
      or public.can_operate_lpg_station_branch(subject_id, 'station.inventory.read')
    )
  )
);

drop policy if exists ai_forecast_snapshots_no_direct_insert on public.ai_forecast_snapshots;
create policy ai_forecast_snapshots_no_direct_insert
on public.ai_forecast_snapshots
for insert to authenticated
with check (false);

drop policy if exists ai_forecast_snapshots_no_direct_update on public.ai_forecast_snapshots;
create policy ai_forecast_snapshots_no_direct_update
on public.ai_forecast_snapshots
for update to authenticated
using (false)
with check (false);

drop policy if exists ai_forecast_snapshots_no_direct_delete on public.ai_forecast_snapshots;
create policy ai_forecast_snapshots_no_direct_delete
on public.ai_forecast_snapshots
for delete to authenticated
using (false);

grant select on public.ai_forecast_definitions to authenticated;
grant select on public.ai_forecast_snapshots to authenticated;
grant all on public.ai_forecast_definitions, public.ai_forecast_snapshots to service_role;

insert into public.ai_forecast_definitions (
  key, display_name, domain, method, status, config
)
values (
  'ai.forecast.lpg.station_demand',
  'LPG station demand outlook',
  'lpg_station_demand',
  'weighted_moving_average',
  'active',
  '{
    "short_window_days": 7,
    "long_window_days": 28,
    "short_weight": 0.65,
    "horizons_days": [1, 7],
    "medium_confidence_orders": 10,
    "high_confidence_orders": 30,
    "refresh_minutes": 360,
    "valid_order_statuses": [
      "awaiting_payment",
      "payment_reserved",
      "matching_station",
      "matching_driver",
      "driver_offered",
      "driver_accepted",
      "pickup_en_route",
      "pickup_verified",
      "station_en_route",
      "station_verified",
      "refill_in_progress",
      "refill_confirmed",
      "station_settled",
      "return_en_route",
      "delivery_verification_pending",
      "delivered",
      "completed",
      "disputed"
    ]
  }'::jsonb
)
on conflict (key) do update
set display_name = excluded.display_name,
    domain = excluded.domain,
    method = excluded.method,
    config = public.ai_forecast_definitions.config || excluded.config,
    updated_at = timezone('utc', now());

create or replace function public.refresh_ai_demand_forecasts()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  definition_record public.ai_forecast_definitions%rowtype;
  station_record record;
  horizon_value jsonb;
  horizon_days_value integer;
  short_window_days integer;
  long_window_days integer;
  medium_confidence_orders integer;
  high_confidence_orders integer;
  refresh_minutes integer;
  short_weight numeric;
  long_weight numeric;
  short_order_count integer;
  long_order_count integer;
  short_kg numeric;
  long_kg numeric;
  predicted_daily_orders numeric;
  predicted_daily_kg numeric;
  confidence_value text;
  refreshed_count integer := 0;
  now_at timestamptz := timezone('utc', now());
begin
  select * into definition_record
  from public.ai_forecast_definitions
  where key = 'ai.forecast.lpg.station_demand'
    and status = 'active';

  if definition_record.id is null then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'forecast_definition_inactive',
      'refreshedCount', 0,
      'refreshedAt', now_at
    );
  end if;

  short_window_days := greatest(
    1,
    least(
      30,
      case
        when coalesce(definition_record.config ->> 'short_window_days', '') ~ '^[0-9]+$'
          then (definition_record.config ->> 'short_window_days')::integer
        else 7
      end
    )
  );

  long_window_days := greatest(
    short_window_days,
    least(
      180,
      case
        when coalesce(definition_record.config ->> 'long_window_days', '') ~ '^[0-9]+$'
          then (definition_record.config ->> 'long_window_days')::integer
        else 28
      end
    )
  );

  short_weight := case
    when coalesce(definition_record.config ->> 'short_weight', '') ~ '^[0-9]+([.][0-9]+)?$'
      then least(1::numeric, greatest(0::numeric, (definition_record.config ->> 'short_weight')::numeric))
    else 0.65::numeric
  end;
  long_weight := 1::numeric - short_weight;

  medium_confidence_orders := greatest(
    1,
    case
      when coalesce(definition_record.config ->> 'medium_confidence_orders', '') ~ '^[0-9]+$'
        then (definition_record.config ->> 'medium_confidence_orders')::integer
      else 10
    end
  );
  high_confidence_orders := greatest(
    medium_confidence_orders,
    case
      when coalesce(definition_record.config ->> 'high_confidence_orders', '') ~ '^[0-9]+$'
        then (definition_record.config ->> 'high_confidence_orders')::integer
      else 30
    end
  );
  refresh_minutes := greatest(
    15,
    least(
      1440,
      case
        when coalesce(definition_record.config ->> 'refresh_minutes', '') ~ '^[0-9]+$'
          then (definition_record.config ->> 'refresh_minutes')::integer
        else 360
      end
    )
  );

  for station_record in
    select station.id, station.display_name
    from public.lpg_station_branches station
    where station.approval_status = 'approved'
      and station.compliance_status <> 'suspended'
    order by station.id
  loop
    select
      count(*) filter (
        where orders.created_at >= now_at - make_interval(days => short_window_days)
      )::integer,
      count(*)::integer,
      coalesce(sum(
        case
          when orders.created_at >= now_at - make_interval(days => short_window_days)
            then coalesce(orders.actual_kg, orders.quoted_kg, orders.requested_kg, 0)
          else 0
        end
      ), 0),
      coalesce(sum(coalesce(orders.actual_kg, orders.quoted_kg, orders.requested_kg, 0)), 0)
    into short_order_count, long_order_count, short_kg, long_kg
    from public.lpg_refill_orders orders
    where orders.station_branch_id = station_record.id
      and orders.created_at >= now_at - make_interval(days => long_window_days)
      and exists (
        select 1
        from jsonb_array_elements_text(
          coalesce(definition_record.config -> 'valid_order_statuses', '[]'::jsonb)
        ) allowed_status
        where allowed_status = orders.status
      );

    predicted_daily_orders :=
      short_weight * (short_order_count::numeric / short_window_days::numeric)
      + long_weight * (long_order_count::numeric / long_window_days::numeric);

    predicted_daily_kg :=
      short_weight * (short_kg / short_window_days::numeric)
      + long_weight * (long_kg / long_window_days::numeric);

    confidence_value := case
      when long_order_count >= high_confidence_orders then 'high'
      when long_order_count >= medium_confidence_orders then 'medium'
      else 'low'
    end;

    for horizon_value in
      select value
      from jsonb_array_elements(
        coalesce(definition_record.config -> 'horizons_days', '[1,7]'::jsonb)
      )
    loop
      if jsonb_typeof(horizon_value) <> 'number' then
        continue;
      end if;

      horizon_days_value := greatest(1, least(90, (horizon_value #>> '{}')::integer));

      insert into public.ai_forecast_snapshots (
        definition_id,
        subject_type,
        subject_id,
        horizon_days,
        method,
        confidence,
        predicted_orders,
        predicted_kg,
        evidence,
        generated_at,
        valid_until,
        version
      )
      values (
        definition_record.id,
        'lpg_station_branch',
        station_record.id,
        horizon_days_value,
        definition_record.method,
        confidence_value,
        round(greatest(predicted_daily_orders * horizon_days_value, 0), 2),
        round(greatest(predicted_daily_kg * horizon_days_value, 0), 3),
        jsonb_build_object(
          'estimateOnly', true,
          'stationDisplayName', station_record.display_name,
          'shortWindowDays', short_window_days,
          'longWindowDays', long_window_days,
          'shortWeight', short_weight,
          'shortWindowOrders', short_order_count,
          'longWindowOrders', long_order_count,
          'shortWindowKg', round(short_kg, 3),
          'longWindowKg', round(long_kg, 3),
          'predictedDailyOrders', round(greatest(predicted_daily_orders, 0), 3),
          'predictedDailyKg', round(greatest(predicted_daily_kg, 0), 3),
          'validOrderStatuses', definition_record.config -> 'valid_order_statuses'
        ),
        now_at,
        now_at + make_interval(mins => refresh_minutes),
        1
      )
      on conflict (definition_id, subject_type, subject_id, horizon_days)
      do update set
        method = excluded.method,
        confidence = excluded.confidence,
        predicted_orders = excluded.predicted_orders,
        predicted_kg = excluded.predicted_kg,
        evidence = excluded.evidence,
        generated_at = excluded.generated_at,
        valid_until = excluded.valid_until,
        version = public.ai_forecast_snapshots.version + 1,
        updated_at = timezone('utc', now());

      refreshed_count := refreshed_count + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'status', 'completed',
    'method', definition_record.method,
    'refreshedCount', refreshed_count,
    'refreshedAt', now_at
  );
end;
$$;

revoke all on function public.refresh_ai_demand_forecasts() from public, anon, authenticated;
grant execute on function public.refresh_ai_demand_forecasts() to service_role;

create or replace function public.read_ai_demand_forecasts(
  target_station_branch_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', snapshot.id,
        'subjectType', snapshot.subject_type,
        'subjectId', snapshot.subject_id,
        'horizonDays', snapshot.horizon_days,
        'method', snapshot.method,
        'confidence', snapshot.confidence,
        'predictedOrders', snapshot.predicted_orders,
        'predictedKg', snapshot.predicted_kg,
        'evidence', snapshot.evidence,
        'generatedAt', snapshot.generated_at,
        'validUntil', snapshot.valid_until,
        'version', snapshot.version
      )
      order by snapshot.subject_id, snapshot.horizon_days
    ),
    '[]'::jsonb
  )
  from public.ai_forecast_snapshots snapshot
  where snapshot.subject_type = 'lpg_station_branch'
    and (target_station_branch_id is null or snapshot.subject_id = target_station_branch_id);
$$;

revoke all on function public.read_ai_demand_forecasts(uuid) from public, anon;
grant execute on function public.read_ai_demand_forecasts(uuid) to authenticated, service_role;

commit;
