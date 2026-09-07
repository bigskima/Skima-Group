begin;

create or replace function public.set_active_financial_policy_configuration(
  target_policy_key text,
  target_configuration jsonb,
  target_reason text,
  target_idempotency_key text,
  target_currency_code text default 'NGN',
  target_module_key text default null,
  target_service_key text default null,
  target_organization_id uuid default null,
  target_geography_type text default 'global',
  target_geography_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  definition_record public.financial_policy_definitions%rowtype;
  current_version public.financial_policy_versions%rowtype;
  target_module_id uuid;
  next_version integer;
  new_version_id uuid;
  now_at timestamptz := timezone('utc', now());
  validation jsonb;
  prior_result jsonb;
begin
  if auth.role() <> 'service_role' and not public.is_platform_super_admin() then
    raise exception using
      errcode = '42501',
      message = 'only an active Super Admin can apply an immediate financial pricing change';
  end if;

  if target_policy_key is null or btrim(target_policy_key) = ''
    or target_configuration is null
    or jsonb_typeof(target_configuration) <> 'object'
    or nullif(btrim(target_reason), '') is null
    or nullif(btrim(target_idempotency_key), '') is null then
    raise exception using
      errcode = '22023',
      message = 'policy key, configuration, reason, and idempotency key are required';
  end if;

  if target_geography_type not in ('global', 'country', 'region', 'city', 'service_area', 'organization', 'branch') then
    raise exception using
      errcode = '22023',
      message = 'target_geography_type is not supported';
  end if;

  if (target_geography_type = 'global' and target_geography_key is not null)
    or (target_geography_type <> 'global' and nullif(btrim(target_geography_key), '') is null) then
    raise exception using
      errcode = '22023',
      message = 'geography key must match the geography type';
  end if;

  select *
    into definition_record
  from public.financial_policy_definitions
  where key = btrim(target_policy_key)
    and status = 'active'
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'active financial policy definition was not found';
  end if;

  if target_module_key is not null then
    select id into target_module_id
    from public.business_modules
    where key = target_module_key;

    if target_module_id is null then
      raise exception using
        errcode = '22023',
        message = 'target_module_key must reference a configured business module';
    end if;
  end if;

  select event.new_state
    into prior_result
  from public.financial_policy_events event
  join public.financial_policy_versions version
    on version.id = event.policy_version_id
  where version.policy_definition_id = definition_record.id
    and event.idempotency_key = target_idempotency_key || ':activated'
  order by event.created_at desc
  limit 1;

  if prior_result is not null then
    return prior_result;
  end if;

  validation := public.validate_financial_policy_configuration(
    definition_record.policy_family,
    target_configuration
  );

  select *
    into current_version
  from public.financial_policy_versions version
  where version.policy_definition_id = definition_record.id
    and version.currency_code = upper(coalesce(nullif(btrim(target_currency_code), ''), 'NGN'))
    and version.module_id is not distinct from target_module_id
    and version.organization_id is not distinct from target_organization_id
    and version.service_key is not distinct from target_service_key
    and version.geography_type = target_geography_type
    and version.geography_key is not distinct from target_geography_key
    and version.lifecycle_status = 'active'
    and version.effective_from <= now_at
    and (version.effective_until is null or version.effective_until > now_at)
  order by version.priority desc, version.effective_from desc, version.version desc
  limit 1
  for update;

  if current_version.id is null then
    raise exception using
      errcode = '23514',
      message = 'financial policy has no active version in the requested scope';
  end if;

  if current_version.configuration = target_configuration then
    return jsonb_build_object(
      'changed', false,
      'policyKey', definition_record.key,
      'policyVersionId', current_version.id,
      'version', current_version.version,
      'currencyCode', current_version.currency_code,
      'configuration', current_version.configuration,
      'effectiveFrom', current_version.effective_from
    );
  end if;

  select coalesce(max(version), 0) + 1
    into next_version
  from public.financial_policy_versions
  where policy_definition_id = definition_record.id;

  update public.financial_policy_versions
  set lifecycle_status = 'superseded',
      effective_until = now_at,
      updated_at = now_at
  where id = current_version.id;

  insert into public.financial_policy_versions(
    policy_definition_id,
    version,
    lifecycle_status,
    organization_id,
    module_id,
    service_key,
    geography_type,
    geography_key,
    currency_code,
    priority,
    configuration,
    effective_from,
    effective_until,
    change_reason,
    validation_snapshot,
    based_on_version_id,
    supersedes_version_id,
    submitted_by,
    submitted_at,
    approved_by,
    approved_at,
    activated_by,
    activated_at,
    created_by
  )
  values(
    definition_record.id,
    next_version,
    'active',
    current_version.organization_id,
    current_version.module_id,
    current_version.service_key,
    current_version.geography_type,
    current_version.geography_key,
    current_version.currency_code,
    current_version.priority,
    target_configuration,
    now_at,
    null,
    btrim(target_reason),
    validation,
    current_version.id,
    current_version.id,
    auth.uid(),
    now_at,
    auth.uid(),
    now_at,
    auth.uid(),
    now_at,
    auth.uid()
  )
  returning id into new_version_id;

  perform public.assert_financial_policy_no_conflict(new_version_id);

  insert into public.financial_policy_events(
    policy_version_id,
    event_type,
    actor_user_id,
    previous_state,
    new_state,
    reason,
    idempotency_key
  )
  values(
    current_version.id,
    'superseded',
    auth.uid(),
    to_jsonb(current_version),
    jsonb_build_object(
      'lifecycle_status', 'superseded',
      'effective_until', now_at,
      'supersededByPolicyVersionId', new_version_id
    ),
    btrim(target_reason),
    target_idempotency_key || ':superseded'
  )
  on conflict (policy_version_id, idempotency_key) do nothing;

  insert into public.financial_policy_events(
    policy_version_id,
    event_type,
    actor_user_id,
    previous_state,
    new_state,
    reason,
    idempotency_key
  )
  values(
    new_version_id,
    'activated',
    auth.uid(),
    null,
    jsonb_build_object(
      'changed', true,
      'policyKey', definition_record.key,
      'policyVersionId', new_version_id,
      'version', next_version,
      'currencyCode', current_version.currency_code,
      'configuration', target_configuration,
      'effectiveFrom', now_at
    ),
    btrim(target_reason),
    target_idempotency_key || ':activated'
  )
  on conflict (policy_version_id, idempotency_key) do nothing;

  return jsonb_build_object(
    'changed', true,
    'policyKey', definition_record.key,
    'policyVersionId', new_version_id,
    'version', next_version,
    'currencyCode', current_version.currency_code,
    'configuration', target_configuration,
    'effectiveFrom', now_at
  );
end;
$$;

revoke all on function public.set_active_financial_policy_configuration(
  text, jsonb, text, text, text, text, text, uuid, text, text
) from public, anon;

grant execute on function public.set_active_financial_policy_configuration(
  text, jsonb, text, text, text, text, text, uuid, text, text
) to authenticated, service_role;

comment on function public.set_active_financial_policy_configuration(
  text, jsonb, text, text, text, text, text, uuid, text, text
) is
  'Super Admin one-step audited replacement of an active financial pricing policy. The new version is active immediately and supersedes the previous live version atomically.';

notify pgrst, 'reload schema';

commit;
