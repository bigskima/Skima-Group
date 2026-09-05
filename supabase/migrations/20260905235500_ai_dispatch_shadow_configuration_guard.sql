begin;

-- Keep dispatch intelligence in observation/shadow mode until a separately reviewed production
-- cutover is explicitly designed. Configuration cannot turn this runtime into an assignment engine.

create or replace function public.validate_ai_dispatch_rule_config()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  lookback_hours integer;
  request_limit integer;
  valid_minutes integer;
  recent_penalty numeric;
  maximum_penalty numeric;
begin
  if jsonb_typeof(new.config) <> 'object' then
    raise exception 'dispatch intelligence configuration must be an object';
  end if;

  if coalesce(new.config ->> 'control', '') <> 'shadow_only' then
    raise exception 'dispatch intelligence control must remain shadow_only';
  end if;

  if coalesce(new.config ->> 'risk_signal', '') <> 'review_only'
    or coalesce((new.config ->> 'risk_does_not_change_rank')::boolean, false) <> true then
    raise exception 'partner risk must remain review-only and must not change dispatch rank';
  end if;

  if coalesce(new.config ->> 'lookback_hours', '') !~ '^[0-9]+$'
    or coalesce(new.config ->> 'request_limit', '') !~ '^[0-9]+$'
    or coalesce(new.config ->> 'valid_minutes', '') !~ '^[0-9]+$' then
    raise exception 'dispatch intelligence time and request settings must be whole numbers';
  end if;

  lookback_hours := (new.config ->> 'lookback_hours')::integer;
  request_limit := (new.config ->> 'request_limit')::integer;
  valid_minutes := (new.config ->> 'valid_minutes')::integer;

  if lookback_hours not between 1 and 168 then
    raise exception 'dispatch intelligence lookback must be between 1 and 168 hours';
  end if;

  if request_limit not between 1 and 500 then
    raise exception 'dispatch intelligence request limit must be between 1 and 500';
  end if;

  if valid_minutes not between 15 and 1440 then
    raise exception 'dispatch intelligence validity must be between 15 and 1440 minutes';
  end if;

  if coalesce(new.config ->> 'recent_assignment_penalty_meters', '') !~ '^[0-9]+([.][0-9]+)?$'
    or coalesce(new.config ->> 'maximum_fairness_penalty_meters', '') !~ '^[0-9]+([.][0-9]+)?$' then
    raise exception 'dispatch fairness penalty settings must be non-negative numbers';
  end if;

  recent_penalty := (new.config ->> 'recent_assignment_penalty_meters')::numeric;
  maximum_penalty := (new.config ->> 'maximum_fairness_penalty_meters')::numeric;

  if recent_penalty < 0 or recent_penalty > 5000 then
    raise exception 'recent assignment fairness penalty must be between 0 and 5000 meters';
  end if;

  if maximum_penalty < 0 or maximum_penalty > 20000 then
    raise exception 'maximum dispatch fairness penalty must be between 0 and 20000 meters';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_ai_dispatch_rule_config
on public.ai_dispatch_rules;

create trigger validate_ai_dispatch_rule_config
before insert or update of config
on public.ai_dispatch_rules
for each row
execute function public.validate_ai_dispatch_rule_config();

update public.ai_dispatch_rules
set config = config,
    updated_at = updated_at
where key = 'ai.dispatch.lpg.shadow_fairness';

revoke all on function public.validate_ai_dispatch_rule_config() from public, anon;
grant execute on function public.validate_ai_dispatch_rule_config()
to authenticated, service_role;

commit;
