begin;

-- Enforce fallback invariants at the table boundary, not only through admin RPCs.
-- This prevents direct privileged writes from bypassing free-only automatic failover rules.

-- Earlier free-tier metadata marked the initial Gemini route as eligible before the runtime
-- distinguished primary versus fallback routes. Normalize every non-fallback route first.
update public.ai_provider_routes
set config = config || jsonb_build_object(
      'fallback_only', false,
      'automatic_failover_eligible', false
    ),
    updated_at = timezone('utc', now())
where coalesce((config ->> 'fallback_only')::boolean, false) = false;

create or replace function public.validate_ai_provider_route_fallback_integrity()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  fallback_only boolean :=
    coalesce((new.config ->> 'fallback_only')::boolean, false);
  automatic_failover_eligible boolean :=
    coalesce((new.config ->> 'automatic_failover_eligible')::boolean, false);
  provider_record public.provider_adapters%rowtype;
  capability_record public.ai_capabilities%rowtype;
begin
  if not fallback_only then
    if automatic_failover_eligible then
      raise exception 'only fallback routes may be automatic-failover eligible';
    end if;
    return new;
  end if;

  if new.priority < 2 then
    raise exception 'AI fallback route priority must be 2 or greater';
  end if;

  if not automatic_failover_eligible then
    raise exception 'AI fallback route must be explicitly failover eligible';
  end if;

  select * into provider_record
  from public.provider_adapters
  where id = new.provider_adapter_id;

  if provider_record.id is null
    or provider_record.provider_kind <> 'ai' then
    raise exception 'AI fallback provider was not found';
  end if;

  if coalesce(provider_record.config ->> 'billing_tier', 'unknown') <> 'free' then
    raise exception 'automatic AI fallback requires a provider marked free';
  end if;

  select * into capability_record
  from public.ai_capabilities
  where id = new.capability_id;

  if capability_record.id is null then
    raise exception 'AI fallback capability was not found';
  end if;

  if not (
    coalesce(provider_record.config -> 'supports', '[]'::jsonb)
      ? capability_record.response_mode
  ) then
    raise exception 'AI fallback provider does not support the capability response mode';
  end if;

  if tg_op = 'UPDATE'
    and old.status = 'active'
    and coalesce((old.config ->> 'fallback_only')::boolean, false) = false
    and new.status = 'active' then
    raise exception
      'cannot convert the active primary AI route into a fallback route; configure a different provider/model or change the primary first';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_ai_provider_route_fallback_integrity
on public.ai_provider_routes;

create trigger validate_ai_provider_route_fallback_integrity
before insert or update of provider_adapter_id, capability_id, priority, status, config
on public.ai_provider_routes
for each row
execute function public.validate_ai_provider_route_fallback_integrity();

-- Revalidate all currently active routes against the new invariant.
update public.ai_provider_routes
set config = config,
    updated_at = updated_at
where status = 'active';

revoke all on function public.validate_ai_provider_route_fallback_integrity()
from public, anon;
grant execute on function public.validate_ai_provider_route_fallback_integrity()
to authenticated, service_role;

commit;
