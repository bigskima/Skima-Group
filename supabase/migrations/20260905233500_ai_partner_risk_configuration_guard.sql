begin;

-- Validate trust/risk rule configuration before the worker consumes it.
-- Risk remains an internal advisory signal; control may not be changed to automatic enforcement.

create or replace function public.validate_ai_risk_rule_config()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  lookback_days integer;
  valid_minutes integer;
  minimum_orders integer;
  medium_threshold numeric;
  high_threshold numeric;
  critical_threshold numeric;
  weight_entry record;
begin
  if new.subject_type not in ('driver','station') then
    raise exception 'risk subject type is not supported';
  end if;

  if jsonb_typeof(new.config) <> 'object' then
    raise exception 'risk rule configuration must be an object';
  end if;

  if coalesce(new.config ->> 'control', '') <> 'advisory_only' then
    raise exception 'partner risk control must remain advisory_only';
  end if;

  if coalesce(new.config ->> 'lookback_days', '') !~ '^[0-9]+$'
    or coalesce(new.config ->> 'valid_minutes', '') !~ '^[0-9]+$'
    or coalesce(new.config ->> 'minimum_orders_for_rate', '') !~ '^[0-9]+$' then
    raise exception 'risk lookback, validity and minimum order settings must be whole numbers';
  end if;

  lookback_days := (new.config ->> 'lookback_days')::integer;
  valid_minutes := (new.config ->> 'valid_minutes')::integer;
  minimum_orders := (new.config ->> 'minimum_orders_for_rate')::integer;

  if lookback_days not between 7 and 365 then
    raise exception 'risk lookback must be between 7 and 365 days';
  end if;

  if valid_minutes not between 15 and 1440 then
    raise exception 'risk assessment validity must be between 15 and 1440 minutes';
  end if;

  if minimum_orders not between 1 and 1000 then
    raise exception 'risk minimum order threshold must be between 1 and 1000';
  end if;

  if jsonb_typeof(new.config -> 'thresholds') <> 'object' then
    raise exception 'risk thresholds must be an object';
  end if;

  medium_threshold := (new.config #>> '{thresholds,medium}')::numeric;
  high_threshold := (new.config #>> '{thresholds,high}')::numeric;
  critical_threshold := (new.config #>> '{thresholds,critical}')::numeric;

  if medium_threshold < 0
    or high_threshold <= medium_threshold
    or critical_threshold <= high_threshold
    or critical_threshold > 100 then
    raise exception 'risk thresholds must increase from medium to high to critical within 0 to 100';
  end if;

  if jsonb_typeof(new.config -> 'weights') <> 'object' then
    raise exception 'risk weights must be an object';
  end if;

  for weight_entry in
    select key, value
    from jsonb_each_text(new.config -> 'weights')
  loop
    if weight_entry.value !~ '^[0-9]+([.][0-9]+)?$'
      or weight_entry.value::numeric < 0
      or weight_entry.value::numeric > 100 then
      raise exception 'risk weights must be numbers between 0 and 100';
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists validate_ai_risk_rule_config
on public.ai_risk_rules;

create trigger validate_ai_risk_rule_config
before insert or update of subject_type, config
on public.ai_risk_rules
for each row
execute function public.validate_ai_risk_rule_config();

update public.ai_risk_rules
set config = config,
    updated_at = updated_at
where key in ('ai.risk.lpg.driver.trust','ai.risk.lpg.station.trust');

revoke all on function public.validate_ai_risk_rule_config() from public, anon;
grant execute on function public.validate_ai_risk_rule_config()
to authenticated, service_role;

commit;
