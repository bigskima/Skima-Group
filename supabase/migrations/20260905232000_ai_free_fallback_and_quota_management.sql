begin;

-- Admin-governed free fallback routes and AI quota policy changes.
-- Automatic paid fallback remains impossible.

create table if not exists public.ai_usage_policy_events (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.ai_usage_policies(id) on delete cascade,
  previous_state jsonb not null default '{}'::jsonb,
  new_state jsonb not null default '{}'::jsonb,
  reason text not null,
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  check (jsonb_typeof(previous_state) = 'object'),
  check (jsonb_typeof(new_state) = 'object')
);

alter table public.ai_usage_policy_events enable row level security;

drop policy if exists ai_usage_policy_events_read_privileged on public.ai_usage_policy_events;
create policy ai_usage_policy_events_read_privileged
on public.ai_usage_policy_events
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
);

revoke all on public.ai_usage_policy_events from public, anon;
grant select on public.ai_usage_policy_events to authenticated;
grant all on public.ai_usage_policy_events to service_role;

update public.provider_adapters
set config = config || jsonb_build_object(
      'billing_tier',
      coalesce(config ->> 'billing_tier', 'free')
    ),
    updated_at = timezone('utc', now())
where provider_kind = 'ai'
  and key = 'provider.ai.google-gemini';

create or replace function public.validate_ai_provider_billing_metadata()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  billing_tier text;
begin
  if new.provider_kind <> 'ai' then
    return new;
  end if;

  billing_tier := nullif(btrim(new.config ->> 'billing_tier'), '');
  if billing_tier is not null and billing_tier not in ('free','paid','unknown') then
    raise exception 'AI provider billing_tier must be free, paid, or unknown';
  end if;

  return new;
end;
$$;

drop trigger if exists validate_ai_provider_billing_metadata
on public.provider_adapters;

create trigger validate_ai_provider_billing_metadata
before insert or update of provider_kind, config
on public.provider_adapters
for each row
execute function public.validate_ai_provider_billing_metadata();

create or replace function public.configure_ai_free_fallback_route(
  target_capability_key text,
  target_provider_adapter_key text,
  target_model_key text,
  target_priority integer,
  target_enabled boolean,
  target_reason text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  capability_record public.ai_capabilities%rowtype;
  provider_record public.provider_adapters%rowtype;
  route_record public.ai_provider_routes%rowtype;
  previous_state jsonb := '{}'::jsonb;
begin
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.ai.manage', null)
  ) then
    raise exception 'AI management permission is required';
  end if;

  if coalesce(btrim(target_capability_key), '') = ''
    or coalesce(btrim(target_provider_adapter_key), '') = ''
    or coalesce(btrim(target_model_key), '') = ''
    or target_priority not between 2 and 10000
    or target_enabled is null
    or coalesce(btrim(target_reason), '') = ''
    or coalesce(btrim(target_idempotency_key), '') = '' then
    raise exception 'free fallback route configuration is invalid';
  end if;

  select * into capability_record
  from public.ai_capabilities
  where key = target_capability_key
    and status <> 'retired';

  if capability_record.id is null then
    raise exception 'AI capability was not found';
  end if;

  select * into provider_record
  from public.provider_adapters
  where provider_kind = 'ai'
    and key = target_provider_adapter_key
    and status in ('active','degraded');

  if provider_record.id is null then
    raise exception 'AI fallback provider is not active';
  end if;

  if coalesce(provider_record.config ->> 'billing_tier', 'unknown') <> 'free' then
    raise exception 'automatic fallback is allowed only for providers marked free';
  end if;

  if not (
    coalesce(provider_record.config -> 'supports', '[]'::jsonb)
      ? capability_record.response_mode
  ) then
    raise exception 'AI fallback provider does not support the capability response mode';
  end if;

  select to_jsonb(route) into previous_state
  from public.ai_provider_routes route
  where route.capability_id = capability_record.id
    and route.provider_adapter_id = provider_record.id
    and route.model_key = btrim(target_model_key);

  insert into public.ai_provider_routes (
    capability_id,
    provider_adapter_id,
    model_key,
    priority,
    status,
    config,
    created_by,
    updated_by
  )
  values (
    capability_record.id,
    provider_record.id,
    btrim(target_model_key),
    target_priority,
    case when target_enabled then 'active' else 'paused' end,
    jsonb_build_object(
      'cost_tier', 'free',
      'automatic_failover_eligible', true,
      'fallback_only', true
    ),
    auth.uid(),
    auth.uid()
  )
  on conflict (capability_id, provider_adapter_id, model_key)
  do update set
    priority = excluded.priority,
    status = excluded.status,
    config = public.ai_provider_routes.config || excluded.config,
    effective_from = null,
    effective_until = null,
    updated_by = auth.uid(),
    updated_at = timezone('utc', now()),
    version = public.ai_provider_routes.version + 1
  returning * into route_record;

  insert into public.ai_provider_route_events (
    capability_id,
    provider_route_id,
    event_type,
    previous_state,
    new_state,
    reason,
    actor_user_id,
    idempotency_key
  )
  values (
    capability_record.id,
    route_record.id,
    case when target_enabled then 'configured' else 'paused' end,
    coalesce(previous_state, '{}'::jsonb),
    to_jsonb(route_record),
    btrim(target_reason),
    auth.uid(),
    target_idempotency_key
  )
  on conflict (idempotency_key) do nothing;

  return to_jsonb(route_record);
end;
$$;

revoke all on function public.configure_ai_free_fallback_route(
  text,text,text,integer,boolean,text,text
) from public, anon;
grant execute on function public.configure_ai_free_fallback_route(
  text,text,text,integer,boolean,text,text
) to authenticated, service_role;

create or replace function public.set_ai_usage_policy_limits(
  target_policy_key text,
  target_daily_request_limit integer,
  target_per_user_daily_request_limit integer,
  target_daily_input_unit_limit bigint,
  target_daily_output_unit_limit bigint,
  target_automatic_free_failover boolean,
  target_reason text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  policy_record public.ai_usage_policies%rowtype;
  previous_state jsonb;
begin
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.ai.manage', null)
  ) then
    raise exception 'AI management permission is required';
  end if;

  if coalesce(btrim(target_policy_key), '') = ''
    or target_daily_request_limit is null
    or target_daily_request_limit not between 1 and 1000000
    or target_per_user_daily_request_limit is null
    or target_per_user_daily_request_limit not between 1 and target_daily_request_limit
    or (target_daily_input_unit_limit is not null and target_daily_input_unit_limit <= 0)
    or (target_daily_output_unit_limit is not null and target_daily_output_unit_limit <= 0)
    or target_automatic_free_failover is null
    or coalesce(btrim(target_reason), '') = ''
    or coalesce(btrim(target_idempotency_key), '') = '' then
    raise exception 'AI usage policy limits are invalid';
  end if;

  select * into policy_record
  from public.ai_usage_policies
  where key = target_policy_key
  for update;

  if policy_record.id is null then
    raise exception 'AI usage policy was not found';
  end if;

  if exists (
    select 1
    from public.ai_usage_policy_events event
    where event.idempotency_key = target_idempotency_key
  ) then
    return to_jsonb(policy_record);
  end if;

  previous_state := to_jsonb(policy_record);

  update public.ai_usage_policies
  set daily_request_limit = target_daily_request_limit,
      per_user_daily_request_limit = target_per_user_daily_request_limit,
      daily_input_unit_limit = target_daily_input_unit_limit,
      daily_output_unit_limit = target_daily_output_unit_limit,
      automatic_free_failover = target_automatic_free_failover,
      automatic_paid_fallback = false,
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where id = policy_record.id
  returning * into policy_record;

  insert into public.ai_usage_policy_events (
    policy_id,
    previous_state,
    new_state,
    reason,
    actor_user_id,
    idempotency_key
  )
  values (
    policy_record.id,
    previous_state,
    to_jsonb(policy_record),
    btrim(target_reason),
    auth.uid(),
    target_idempotency_key
  );

  return to_jsonb(policy_record);
end;
$$;

revoke all on function public.set_ai_usage_policy_limits(
  text,integer,integer,bigint,bigint,boolean,text,text
) from public, anon;
grant execute on function public.set_ai_usage_policy_limits(
  text,integer,integer,bigint,bigint,boolean,text,text
) to authenticated, service_role;

commit;
