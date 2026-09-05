begin;

-- SKIMA AI usage governor.
-- Protects free-tier capacity before a provider rejects traffic and permits automatic failover
-- only to routes explicitly marked as free and failover-eligible.
-- Paid fallback is deliberately forbidden in this phase.

create table if not exists public.ai_usage_policies (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  capability_key text,
  provider_adapter_key text,
  workspace text check (workspace is null or workspace in ('customer','driver','station','admin')),
  status text not null default 'active'
    check (status in ('draft','active','paused','retired')),
  daily_request_limit integer check (daily_request_limit is null or daily_request_limit > 0),
  per_user_daily_request_limit integer
    check (per_user_daily_request_limit is null or per_user_daily_request_limit > 0),
  daily_input_unit_limit bigint check (daily_input_unit_limit is null or daily_input_unit_limit > 0),
  daily_output_unit_limit bigint check (daily_output_unit_limit is null or daily_output_unit_limit > 0),
  automatic_free_failover boolean not null default true,
  automatic_paid_fallback boolean not null default false
    check (automatic_paid_fallback = false),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_usage_policies_resolution_idx
on public.ai_usage_policies (
  status,
  capability_key,
  provider_adapter_key,
  workspace,
  updated_at desc
);

create table if not exists public.ai_quota_decisions (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid references public.ai_usage_policies(id) on delete set null,
  capability_key text not null,
  provider_adapter_key text not null,
  model_key text not null,
  user_id uuid references public.profiles(id) on delete set null,
  workspace text,
  bucket_date date not null default (timezone('utc', now()))::date,
  decision text not null check (decision in ('allowed','blocked')),
  reason text not null,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_quota_decisions_policy_day_idx
on public.ai_quota_decisions (policy_id, bucket_date, decision);

create index if not exists ai_quota_decisions_user_day_idx
on public.ai_quota_decisions (user_id, bucket_date, decision);

alter table public.ai_usage_policies enable row level security;
alter table public.ai_quota_decisions enable row level security;

drop policy if exists ai_usage_policies_read_privileged on public.ai_usage_policies;
create policy ai_usage_policies_read_privileged
on public.ai_usage_policies
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_usage_policies_manage_privileged on public.ai_usage_policies;
create policy ai_usage_policies_manage_privileged
on public.ai_usage_policies
for all to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
)
with check (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_quota_decisions_read_privileged on public.ai_quota_decisions;
create policy ai_quota_decisions_read_privileged
on public.ai_quota_decisions
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
);

revoke all on public.ai_usage_policies, public.ai_quota_decisions
from public, anon;

grant select, insert, update, delete on public.ai_usage_policies to authenticated;
grant select on public.ai_quota_decisions to authenticated;
grant all on public.ai_usage_policies, public.ai_quota_decisions to service_role;

insert into public.ai_usage_policies (
  key,
  display_name,
  status,
  daily_request_limit,
  per_user_daily_request_limit,
  daily_input_unit_limit,
  daily_output_unit_limit,
  automatic_free_failover,
  automatic_paid_fallback,
  config
)
values (
  'ai.usage.free-tier.default',
  'SKIMA free-tier AI guard',
  'active',
  500,
  40,
  null,
  null,
  true,
  false,
  '{
    "purpose": "startup_free_tier_protection",
    "limits_are_platform_guards_not_provider_promises": true,
    "provider_specific_limits_can_override_without_deploy": true
  }'::jsonb
)
on conflict (key) do update
set display_name = excluded.display_name,
    automatic_paid_fallback = false,
    config = public.ai_usage_policies.config || excluded.config,
    updated_at = timezone('utc', now());

-- The existing Gemini route is known to be intended as the initial free-tier route.
-- This is metadata, not a hardcoded runtime provider choice.
update public.ai_provider_routes route
set config = route.config || jsonb_build_object(
      'cost_tier', coalesce(route.config ->> 'cost_tier', 'free'),
      'automatic_failover_eligible',
        coalesce((route.config ->> 'automatic_failover_eligible')::boolean, true)
    ),
    updated_at = timezone('utc', now())
from public.ai_capabilities capability,
     public.provider_adapters provider
where capability.id = route.capability_id
  and provider.id = route.provider_adapter_id
  and provider.key = 'provider.ai.google-gemini'
  and capability.response_mode in ('text','json');

create or replace function public.reserve_ai_usage(
  target_capability_key text,
  target_provider_adapter_key text,
  target_model_key text,
  target_user_id uuid,
  target_workspace text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  policy_record public.ai_usage_policies%rowtype;
  existing_record public.ai_quota_decisions%rowtype;
  today_date date := (timezone('utc', now()))::date;
  total_requests integer := 0;
  user_requests integer := 0;
  input_units bigint := 0;
  output_units bigint := 0;
  blocked_reason text := null;
begin
  if auth.role() <> 'service_role' then
    raise exception 'AI quota reservation is backend-only';
  end if;

  if coalesce(btrim(target_capability_key), '') = ''
    or coalesce(btrim(target_provider_adapter_key), '') = ''
    or coalesce(btrim(target_model_key), '') = ''
    or target_user_id is null
    or target_workspace not in ('customer','driver','station','admin')
    or coalesce(btrim(target_idempotency_key), '') = '' then
    raise exception 'AI quota reservation arguments are invalid';
  end if;

  select * into existing_record
  from public.ai_quota_decisions
  where idempotency_key = target_idempotency_key;

  if existing_record.id is not null then
    return jsonb_build_object(
      'allowed', existing_record.decision = 'allowed',
      'reason', existing_record.reason,
      'decisionId', existing_record.id,
      'policyId', existing_record.policy_id,
      'existing', true
    );
  end if;

  select policy.*
  into policy_record
  from public.ai_usage_policies policy
  where policy.status = 'active'
    and (policy.capability_key is null or policy.capability_key = target_capability_key)
    and (policy.provider_adapter_key is null or policy.provider_adapter_key = target_provider_adapter_key)
    and (policy.workspace is null or policy.workspace = target_workspace)
  order by
    (
      case when policy.capability_key is not null then 4 else 0 end
      + case when policy.provider_adapter_key is not null then 2 else 0 end
      + case when policy.workspace is not null then 1 else 0 end
    ) desc,
    policy.updated_at desc
  limit 1
  for update;

  if policy_record.id is null then
    insert into public.ai_quota_decisions (
      policy_id,
      capability_key,
      provider_adapter_key,
      model_key,
      user_id,
      workspace,
      bucket_date,
      decision,
      reason,
      idempotency_key,
      metadata
    )
    values (
      null,
      target_capability_key,
      target_provider_adapter_key,
      target_model_key,
      target_user_id,
      target_workspace,
      today_date,
      'blocked',
      'quota_policy_missing',
      target_idempotency_key,
      '{"control":"fail_closed"}'::jsonb
    )
    returning * into existing_record;

    return jsonb_build_object(
      'allowed', false,
      'reason', 'quota_policy_missing',
      'decisionId', existing_record.id,
      'policyId', null,
      'automaticFreeFailover', false,
      'automaticPaidFallback', false
    );
  end if;

  select
    count(*) filter (where decision = 'allowed')::integer,
    count(*) filter (
      where decision = 'allowed'
        and user_id = target_user_id
    )::integer
  into total_requests, user_requests
  from public.ai_quota_decisions
  where policy_id = policy_record.id
    and bucket_date = today_date;

  select
    coalesce(sum(coalesce(event.input_units, 0)), 0),
    coalesce(sum(coalesce(event.output_units, 0)), 0)
  into input_units, output_units
  from public.ai_usage_events event
  where event.created_at >= today_date::timestamptz
    and event.created_at < (today_date + 1)::timestamptz
    and event.capability_key = target_capability_key
    and event.provider_adapter_key = target_provider_adapter_key
    and event.status = 'succeeded';

  if policy_record.daily_request_limit is not null
    and total_requests >= policy_record.daily_request_limit then
    blocked_reason := 'daily_request_limit_reached';
  elsif policy_record.per_user_daily_request_limit is not null
    and user_requests >= policy_record.per_user_daily_request_limit then
    blocked_reason := 'user_daily_request_limit_reached';
  elsif policy_record.daily_input_unit_limit is not null
    and input_units >= policy_record.daily_input_unit_limit then
    blocked_reason := 'daily_input_unit_limit_reached';
  elsif policy_record.daily_output_unit_limit is not null
    and output_units >= policy_record.daily_output_unit_limit then
    blocked_reason := 'daily_output_unit_limit_reached';
  end if;

  insert into public.ai_quota_decisions (
    policy_id,
    capability_key,
    provider_adapter_key,
    model_key,
    user_id,
    workspace,
    bucket_date,
    decision,
    reason,
    idempotency_key,
    metadata
  )
  values (
    policy_record.id,
    target_capability_key,
    target_provider_adapter_key,
    target_model_key,
    target_user_id,
    target_workspace,
    today_date,
    case when blocked_reason is null then 'allowed' else 'blocked' end,
    coalesce(blocked_reason, 'within_quota'),
    target_idempotency_key,
    jsonb_build_object(
      'dailyRequestLimit', policy_record.daily_request_limit,
      'perUserDailyRequestLimit', policy_record.per_user_daily_request_limit,
      'dailyInputUnitLimit', policy_record.daily_input_unit_limit,
      'dailyOutputUnitLimit', policy_record.daily_output_unit_limit,
      'requestsUsedBeforeDecision', total_requests,
      'userRequestsUsedBeforeDecision', user_requests,
      'inputUnitsUsed', input_units,
      'outputUnitsUsed', output_units
    )
  )
  returning * into existing_record;

  return jsonb_build_object(
    'allowed', blocked_reason is null,
    'reason', coalesce(blocked_reason, 'within_quota'),
    'decisionId', existing_record.id,
    'policyId', policy_record.id,
    'policyKey', policy_record.key,
    'automaticFreeFailover', policy_record.automatic_free_failover,
    'automaticPaidFallback', false,
    'usage', jsonb_build_object(
      'requests', total_requests,
      'userRequests', user_requests,
      'inputUnits', input_units,
      'outputUnits', output_units
    ),
    'limits', jsonb_build_object(
      'dailyRequests', policy_record.daily_request_limit,
      'perUserDailyRequests', policy_record.per_user_daily_request_limit,
      'dailyInputUnits', policy_record.daily_input_unit_limit,
      'dailyOutputUnits', policy_record.daily_output_unit_limit
    )
  );
end;
$$;

revoke all on function public.reserve_ai_usage(text,text,text,uuid,text,text)
from public, anon, authenticated;
grant execute on function public.reserve_ai_usage(text,text,text,uuid,text,text)
to service_role;

create or replace function public.resolve_ai_provider_routes(
  target_capability_key text
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'capabilityKey', capability.key,
        'responseMode', capability.response_mode,
        'controlMode', capability.control_mode,
        'capabilityConfig', capability.config,
        'routeId', route.id,
        'modelKey', route.model_key,
        'routeConfig', route.config,
        'providerAdapterId', provider.id,
        'providerAdapterKey', provider.key,
        'providerDisplayName', provider.display_name,
        'providerConfig', provider.config,
        'secretRef', provider.secret_ref
      )
      order by
        case provider.status when 'active' then 0 else 1 end,
        route.priority asc,
        route.updated_at desc
    ),
    '[]'::jsonb
  )
  from public.ai_capabilities capability
  join public.ai_provider_routes route
    on route.capability_id = capability.id
  join public.provider_adapters provider
    on provider.id = route.provider_adapter_id
  where capability.key = target_capability_key
    and capability.status = 'active'
    and route.status = 'active'
    and provider.provider_kind = 'ai'
    and provider.status in ('active','degraded')
    and (route.effective_from is null or route.effective_from <= timezone('utc', now()))
    and (route.effective_until is null or route.effective_until > timezone('utc', now()));
$$;

revoke all on function public.resolve_ai_provider_routes(text)
from public, anon, authenticated;
grant execute on function public.resolve_ai_provider_routes(text)
to service_role;

create or replace function public.read_ai_usage_governor_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  today_date date := (timezone('utc', now()))::date;
begin
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.ai.read', null)
    or public.has_permission('platform.ai.manage', null)
  ) then
    raise exception 'AI read permission is required';
  end if;

  return jsonb_build_object(
    'date', today_date,
    'automaticPaidFallback', false,
    'policies', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', policy.id,
          'key', policy.key,
          'displayName', policy.display_name,
          'capabilityKey', policy.capability_key,
          'providerAdapterKey', policy.provider_adapter_key,
          'workspace', policy.workspace,
          'status', policy.status,
          'dailyRequestLimit', policy.daily_request_limit,
          'perUserDailyRequestLimit', policy.per_user_daily_request_limit,
          'dailyInputUnitLimit', policy.daily_input_unit_limit,
          'dailyOutputUnitLimit', policy.daily_output_unit_limit,
          'automaticFreeFailover', policy.automatic_free_failover,
          'automaticPaidFallback', false
        )
        order by policy.key
      )
      from public.ai_usage_policies policy
      where policy.status in ('active','paused')
    ), '[]'::jsonb),
    'usageByProvider', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'providerAdapterKey', grouped.provider_adapter_key,
          'capabilityKey', grouped.capability_key,
          'requests', grouped.requests,
          'inputUnits', grouped.input_units,
          'outputUnits', grouped.output_units,
          'rateLimited', grouped.rate_limited,
          'failed', grouped.failed
        )
        order by grouped.provider_adapter_key, grouped.capability_key
      )
      from (
        select
          event.provider_adapter_key,
          event.capability_key,
          sum(event.request_count)::bigint as requests,
          sum(coalesce(event.input_units, 0))::bigint as input_units,
          sum(coalesce(event.output_units, 0))::bigint as output_units,
          count(*) filter (where event.status = 'rate_limited')::bigint as rate_limited,
          count(*) filter (where event.status = 'failed')::bigint as failed
        from public.ai_usage_events event
        where event.created_at >= today_date::timestamptz
          and event.created_at < (today_date + 1)::timestamptz
        group by event.provider_adapter_key, event.capability_key
      ) grouped
    ), '[]'::jsonb),
    'blockedToday', (
      select count(*)
      from public.ai_quota_decisions decision
      where decision.bucket_date = today_date
        and decision.decision = 'blocked'
    )
  );
end;
$$;

revoke all on function public.read_ai_usage_governor_status()
from public, anon;
grant execute on function public.read_ai_usage_governor_status()
to authenticated, service_role;

commit;
