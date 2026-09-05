begin;

-- Primary provider changes must not erase an explicitly configured free fallback route.
-- The active primary remains priority 1; fallback routes stay separate and higher priority numbers.

create or replace function public.set_ai_capability_provider(
  target_capability_key text,
  target_provider_adapter_key text,
  target_model_key text,
  target_reason text,
  target_idempotency_key text,
  target_route_config jsonb default '{}'::jsonb
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
  previous_state jsonb;
  primary_route_config jsonb;
begin
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.ai.manage', null)
  ) then
    raise exception 'AI management permission is required';
  end if;

  if target_model_key is null or btrim(target_model_key) = ''
    or target_reason is null or btrim(target_reason) = ''
    or target_idempotency_key is null or btrim(target_idempotency_key) = ''
    or target_route_config is null or jsonb_typeof(target_route_config) <> 'object' then
    raise exception 'provider route configuration is invalid';
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
    raise exception 'AI provider is not active';
  end if;

  if not (
    coalesce(provider_record.config -> 'supports', '[]'::jsonb)
      ? capability_record.response_mode
  ) then
    raise exception 'AI provider does not support the capability response mode';
  end if;

  if exists (
    select 1
    from public.ai_provider_route_events
    where idempotency_key = target_idempotency_key
  ) then
    select route.* into route_record
    from public.ai_provider_routes route
    where route.capability_id = capability_record.id
      and route.provider_adapter_id = provider_record.id
      and route.model_key = btrim(target_model_key);

    return to_jsonb(route_record);
  end if;

  select coalesce(jsonb_agg(to_jsonb(route)), '[]'::jsonb)
  into previous_state
  from public.ai_provider_routes route
  where route.capability_id = capability_record.id
    and route.status = 'active'
    and coalesce((route.config ->> 'fallback_only')::boolean, false) = false;

  update public.ai_provider_routes
  set status = 'paused',
      updated_by = auth.uid(),
      updated_at = timezone('utc', now()),
      version = version + 1
  where capability_id = capability_record.id
    and status = 'active'
    and coalesce((config ->> 'fallback_only')::boolean, false) = false;

  primary_route_config :=
    target_route_config
    || jsonb_build_object(
      'fallback_only', false,
      'automatic_failover_eligible', false
    );

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
    1,
    'active',
    primary_route_config,
    auth.uid(),
    auth.uid()
  )
  on conflict (capability_id, provider_adapter_id, model_key)
  do update set
    priority = 1,
    status = 'active',
    effective_from = null,
    effective_until = null,
    config = primary_route_config,
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
    'activated',
    previous_state,
    to_jsonb(route_record),
    btrim(target_reason),
    auth.uid(),
    target_idempotency_key
  );

  return to_jsonb(route_record);
end;
$$;

revoke all on function public.set_ai_capability_provider(
  text,text,text,text,text,jsonb
) from public, anon;
grant execute on function public.set_ai_capability_provider(
  text,text,text,text,text,jsonb
) to authenticated, service_role;

commit;
