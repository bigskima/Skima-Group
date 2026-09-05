begin;

-- Validate configuration before it reaches the deterministic forecast worker.
-- This keeps forecast behavior database-configurable without allowing malformed configuration
-- to break background processing.

create or replace function public.validate_ai_forecast_definition_config()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  short_days integer;
  long_days integer;
  refresh_minutes integer;
  medium_orders integer;
  high_orders integer;
  short_weight numeric;
begin
  if new.domain <> 'lpg_station_demand' then
    return new;
  end if;

  if new.method <> 'weighted_moving_average' then
    raise exception 'LPG station demand forecast method is not supported';
  end if;

  if jsonb_typeof(new.config) <> 'object' then
    raise exception 'forecast configuration must be an object';
  end if;

  if coalesce(new.config ->> 'short_window_days', '') !~ '^[0-9]+$'
    or coalesce(new.config ->> 'long_window_days', '') !~ '^[0-9]+$'
    or coalesce(new.config ->> 'refresh_minutes', '') !~ '^[0-9]+$'
    or coalesce(new.config ->> 'medium_confidence_orders', '') !~ '^[0-9]+$'
    or coalesce(new.config ->> 'high_confidence_orders', '') !~ '^[0-9]+$' then
    raise exception 'forecast window, refresh and confidence thresholds must be whole numbers';
  end if;

  short_days := (new.config ->> 'short_window_days')::integer;
  long_days := (new.config ->> 'long_window_days')::integer;
  refresh_minutes := (new.config ->> 'refresh_minutes')::integer;
  medium_orders := (new.config ->> 'medium_confidence_orders')::integer;
  high_orders := (new.config ->> 'high_confidence_orders')::integer;

  if short_days not between 1 and 30 then
    raise exception 'short forecast window must be between 1 and 30 days';
  end if;
  if long_days not between short_days and 180 then
    raise exception 'long forecast window must be between short window and 180 days';
  end if;
  if refresh_minutes not between 15 and 1440 then
    raise exception 'forecast refresh must be between 15 and 1440 minutes';
  end if;
  if medium_orders < 1 or high_orders < medium_orders then
    raise exception 'forecast confidence order thresholds are invalid';
  end if;

  if coalesce(new.config ->> 'short_weight', '') !~ '^(0([.][0-9]+)?|1([.]0+)?)$' then
    raise exception 'short forecast weight must be between 0 and 1';
  end if;
  short_weight := (new.config ->> 'short_weight')::numeric;
  if short_weight < 0 or short_weight > 1 then
    raise exception 'short forecast weight must be between 0 and 1';
  end if;

  if jsonb_typeof(new.config -> 'horizons_days') <> 'array'
    or jsonb_array_length(new.config -> 'horizons_days') < 1 then
    raise exception 'forecast horizons must be a non-empty array';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(new.config -> 'horizons_days') horizon
    where jsonb_typeof(horizon) <> 'number'
      or (horizon #>> '{}') !~ '^[0-9]+$'
      or (horizon #>> '{}')::integer not between 1 and 90
  ) then
    raise exception 'each forecast horizon must be a whole number between 1 and 90 days';
  end if;

  if jsonb_typeof(new.config -> 'valid_order_statuses') <> 'array'
    or jsonb_array_length(new.config -> 'valid_order_statuses') < 1 then
    raise exception 'valid forecast order statuses must be a non-empty array';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(new.config -> 'valid_order_statuses') status_value
    where jsonb_typeof(status_value) <> 'string'
      or (status_value #>> '{}') not in (
        'awaiting_payment',
        'payment_reserved',
        'matching_station',
        'matching_driver',
        'driver_offered',
        'driver_accepted',
        'pickup_en_route',
        'pickup_verified',
        'station_en_route',
        'station_verified',
        'refill_in_progress',
        'refill_confirmed',
        'station_settled',
        'return_en_route',
        'delivery_verification_pending',
        'delivered',
        'completed',
        'disputed'
      )
  ) then
    raise exception 'forecast order statuses must use canonical non-failed LPG lifecycle states';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_ai_forecast_definition_config
on public.ai_forecast_definitions;

create trigger validate_ai_forecast_definition_config
before insert or update of domain, method, config
on public.ai_forecast_definitions
for each row
execute function public.validate_ai_forecast_definition_config();

-- Revalidate the seeded active definition against the guard immediately.
update public.ai_forecast_definitions
set config = config,
    updated_at = updated_at
where key = 'ai.forecast.lpg.station_demand';

revoke all on function public.validate_ai_forecast_definition_config() from public, anon;
grant execute on function public.validate_ai_forecast_definition_config() to authenticated, service_role;

commit;
