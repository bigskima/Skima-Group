begin;

-- Launch verification policy:
--   * Drivers: automatic personal KYC.
--   * Station representatives: automatic personal KYC.
--   * Station business KYB: assisted/manual review for launch.
-- The existing KYB provider route is retained and can be enabled later from
-- the admin Verification dashboard without a mobile release.

update public.application_verification_requirements mapping
set
  satisfies_document_keys = array['station.representative-identity']::text[],
  metadata = (
    coalesce(mapping.metadata, '{}'::jsonb)
      - 'required_when'
  ) || jsonb_build_object(
    'step', 'representative',
    'customer_copy', 'Verify the station representative identity and liveness',
    'verification_scope', 'station_representative_only',
    'business_owner_or_ubo_scope', false,
    'required_when', jsonb_build_object(
      'path', 'authority.role',
      'operator', 'not_equals',
      'value', 'owner'
    )
  ),
  updated_at = timezone('utc', now())
from public.application_type_definitions application_type,
     public.verification_definitions definition
where mapping.application_type_id = application_type.id
  and mapping.verification_definition_id = definition.id
  and application_type.key = 'application.lpg.station.phase-one'
  and definition.key = 'verification.person.identity';

update public.application_verification_requirements mapping
set
  metadata = coalesce(mapping.metadata, '{}'::jsonb) || jsonb_build_object(
    'step', 'identity',
    'customer_copy', 'Verify your identity and liveness',
    'verification_scope', 'driver_applicant',
    'launch_mode', 'automatic_kyc'
  ),
  updated_at = timezone('utc', now())
from public.application_type_definitions application_type,
     public.verification_definitions definition
where mapping.application_type_id = application_type.id
  and mapping.verification_definition_id = definition.id
  and application_type.key = 'application.lpg.driver.phase-one'
  and definition.key = 'verification.person.identity';

update public.application_verification_requirements mapping
set
  metadata = coalesce(mapping.metadata, '{}'::jsonb) || jsonb_build_object(
    'step', 'business',
    'customer_copy', 'Upload CAC or business registration evidence for SKIMA review',
    'verification_scope', 'business_registration',
    'launch_mode', 'assisted_kyb',
    'manual_admin_review', true,
    'automatic_route_retained', true,
    'provider_workflow_kind', 'KYB'
  ),
  updated_at = timezone('utc', now())
from public.application_type_definitions application_type,
     public.verification_definitions definition
where mapping.application_type_id = application_type.id
  and mapping.verification_definition_id = definition.id
  and application_type.key = 'application.lpg.station.phase-one'
  and definition.key = 'verification.business.registry';

update public.verification_provider_routes route
set
  status = 'active',
  config = (
    coalesce(route.config, '{}'::jsonb)
      - 'runtimePauseReason'
      - 'runtimePausedAt'
  ) || jsonb_build_object(
    'launchMode', 'automatic_kyc',
    'audience', jsonb_build_array('driver', 'station_representative'),
    'businessOwnerOrUboScope', false,
    'manual_fallback_when_unavailable', true,
    'policySource', 'skima_launch_verification_policy'
  ),
  updated_at = timezone('utc', now())
from public.verification_definitions definition
where route.verification_definition_id = definition.id
  and definition.key = 'verification.person.identity'
  and route.status <> 'retired';

update public.verification_provider_routes route
set
  status = 'paused',
  config = (
    coalesce(route.config, '{}'::jsonb)
      - 'runtimePauseReason'
      - 'runtimePausedAt'
  ) || jsonb_build_object(
    'launchMode', 'assisted_kyb',
    'manualReviewPrimary', true,
    'automaticRouteRetained', true,
    'manual_fallback_when_unavailable', true,
    'policySource', 'skima_launch_verification_policy'
  ),
  updated_at = timezone('utc', now())
from public.verification_definitions definition
where route.verification_definition_id = definition.id
  and definition.key = 'verification.business.registry'
  and route.status <> 'retired';

create or replace function public.read_application_verification_status(
  target_application_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  application_record public.application_records%rowtype;
  result jsonb;
begin
  select * into application_record
  from public.application_records
  where id = target_application_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'application not found';
  end if;

  if auth.role() <> 'service_role'
     and application_record.applicant_user_id <> auth.uid()
     and not public.can_review_applications()
     and not public.has_permission('platform.verification.read', null)
     and not public.has_permission('platform.verification.manage', null) then
    raise exception using errcode = '42501', message = 'application verification access is required';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', mapping.id,
      'verificationKey', definition.key,
      'displayName', definition.display_name,
      'verificationMode', definition.verification_mode,
      'required', mapping.is_required,
      'manualFallbackAllowed', mapping.manual_fallback_allowed,
      'satisfiesDocumentKeys', to_jsonb(mapping.satisfies_document_keys),
      'priority', mapping.priority,
      'metadata', mapping.metadata,
      'automaticAvailable', coalesce(route.active_route, false),
      'providerDisplayName', route.provider_display_name,
      'routeStatus', route.route_status,
      'routeMode', route.route_mode,
      'routeConfigured', coalesce(route.route_configured, false),
      'routePauseReason', route.route_pause_reason,
      'sessionId', latest_session.id,
      'status', coalesce(
        latest_session.status,
        case when coalesce(route.active_route, false) then 'not_started' else 'manual_fallback' end
      ),
      'providerStatus', latest_session.provider_status,
      'failureCode', latest_session.failure_code,
      'failureMessage', latest_session.failure_message,
      'startedAt', latest_session.started_at,
      'completedAt', latest_session.completed_at
    )
    order by mapping.priority, definition.display_name
  ), '[]'::jsonb)
  into result
  from public.application_verification_requirements mapping
  join public.verification_definitions definition
    on definition.id = mapping.verification_definition_id
   and definition.status = 'active'
  left join lateral (
    select
      (
        provider_route.status = 'active'
        and provider.status = 'active'
        and nullif(btrim(provider_route.workflow_ref), '') is not null
      ) as active_route,
      provider.display_name as provider_display_name,
      provider_route.status as route_status,
      coalesce(
        nullif(provider_route.config ->> 'launchMode', ''),
        case
          when provider_route.status = 'active' then 'automatic'
          else 'manual_fallback'
        end
      ) as route_mode,
      (nullif(btrim(provider_route.workflow_ref), '') is not null) as route_configured,
      provider_route.config ->> 'runtimePauseReason' as route_pause_reason
    from public.verification_provider_routes provider_route
    join public.provider_adapters provider
      on provider.id = provider_route.provider_adapter_id
     and provider.provider_kind = 'verification'
    where provider_route.verification_definition_id = mapping.verification_definition_id
      and provider_route.status <> 'retired'
    order by
      case provider_route.status
        when 'active' then 0
        when 'paused' then 1
        when 'inactive' then 2
        else 3
      end,
      provider_route.priority,
      provider_route.created_at
    limit 1
  ) route on true
  left join lateral (
    select session.*
    from public.application_verification_sessions session
    where session.application_id = target_application_id
      and session.application_verification_requirement_id = mapping.id
    order by session.created_at desc
    limit 1
  ) latest_session on true
  where mapping.application_type_id = application_record.application_type_id
    and mapping.status = 'active'
    and public.application_verification_mapping_applies(mapping.id, target_application_id);

  return result;
end;
$$;

revoke all on function public.read_application_verification_status(uuid)
  from public, anon;
grant execute on function public.read_application_verification_status(uuid)
  to authenticated, service_role;

create or replace function public.configure_verification_provider_route(
  target_verification_key text,
  target_provider_key text,
  target_workflow_ref text,
  target_status text,
  target_priority integer default 100,
  target_config jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  definition_id uuid;
  provider_id uuid;
  route_id uuid;
begin
  if auth.role() <> 'service_role'
     and not public.has_permission('platform.verification.manage', null) then
    raise exception using errcode = '42501',
      message = 'verification management permission is required';
  end if;

  if target_verification_key is null
     or target_verification_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_verification_key is invalid';
  end if;
  if target_provider_key is null
     or target_provider_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_provider_key is invalid';
  end if;
  if target_status not in ('inactive','active','paused','retired') then
    raise exception 'target_status is not supported';
  end if;
  if target_status = 'active'
     and nullif(btrim(target_workflow_ref), '') is null then
    raise exception 'an active verification route requires a workflow reference';
  end if;
  if target_priority is null or target_priority < 0 or target_priority > 10000 then
    raise exception 'target_priority must be between 0 and 10000';
  end if;
  if target_config is null or jsonb_typeof(target_config) <> 'object' then
    raise exception 'target_config must be a JSON object';
  end if;

  select definition.id
  into definition_id
  from public.verification_definitions definition
  where definition.key = target_verification_key
    and definition.status = 'active';

  if definition_id is null then
    raise exception 'verification definition was not found';
  end if;

  select provider.id
  into provider_id
  from public.provider_adapters provider
  where provider.key = target_provider_key
    and provider.provider_kind = 'verification';

  if provider_id is null then
    raise exception 'verification provider was not found';
  end if;

  insert into public.verification_provider_routes (
    verification_definition_id,
    provider_adapter_id,
    workflow_ref,
    priority,
    status,
    config,
    created_by
  )
  values (
    definition_id,
    provider_id,
    nullif(btrim(target_workflow_ref), ''),
    target_priority,
    target_status,
    target_config,
    auth.uid()
  )
  on conflict (verification_definition_id, provider_adapter_id) do update
  set workflow_ref = excluded.workflow_ref,
      priority = excluded.priority,
      status = excluded.status,
      config = case
        when excluded.status = 'active' then
          (public.verification_provider_routes.config || excluded.config)
            - 'runtimePauseReason'
            - 'runtimePausedAt'
        else public.verification_provider_routes.config || excluded.config
      end,
      updated_at = timezone('utc', now())
  returning id into route_id;

  if target_status = 'active' then
    update public.provider_adapters
    set status = 'active',
        updated_at = timezone('utc', now())
    where id = provider_id
      and status <> 'disabled';
  end if;

  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    after_state,
    metadata
  )
  values (
    auth.uid(),
    'verification.provider_route.configured',
    'verification_provider_route',
    route_id,
    jsonb_build_object(
      'verificationKey', target_verification_key,
      'providerKey', target_provider_key,
      'workflowRefConfigured', nullif(btrim(target_workflow_ref), '') is not null,
      'status', target_status,
      'priority', target_priority,
      'launchMode', target_config ->> 'launchMode'
    ),
    jsonb_build_object('source', 'skima.admin.verification')
  );

  return route_id;
end;
$$;

revoke all on function public.configure_verification_provider_route(
  text, text, text, text, integer, jsonb
) from public, anon;
grant execute on function public.configure_verification_provider_route(
  text, text, text, text, integer, jsonb
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
