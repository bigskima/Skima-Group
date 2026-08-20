begin;

create or replace function public.resolve_financial_policy(
  target_policy_key text,
  target_currency_code text,
  target_at timestamp with time zone default timezone('utc', now()),
  target_module_key text default null,
  target_organization_id uuid default null,
  target_service_key text default null,
  target_geography_type text default 'global',
  target_geography_key text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  target_module_id uuid;
  resolved public.financial_policy_versions%rowtype;
  match_count integer;
  resolved_id uuid;
  definition_record public.financial_policy_definitions%rowtype;
begin
  if target_policy_key is null or target_policy_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_policy_key must be a valid platform key';
  end if;
  if target_currency_code is null or target_currency_code !~ '^[A-Z0-9]{3,12}$' then
    raise exception 'target_currency_code must be valid';
  end if;
  if target_module_key is not null then
    select module.id into target_module_id
    from public.business_modules module
    where module.key = target_module_key;
    if target_module_id is null then
      raise exception 'target_module_key must reference a configured business module';
    end if;
  end if;

  select definition.* into definition_record
  from public.financial_policy_definitions definition
  where definition.key = target_policy_key
    and definition.status = 'active';
  if not found then
    raise exception 'active financial policy definition is required: %', target_policy_key;
  end if;

  with candidates as (
    select policy_version.*
    from public.financial_policy_versions policy_version
    where policy_version.policy_definition_id = definition_record.id
      and policy_version.lifecycle_status in ('active', 'scheduled')
      and policy_version.currency_code = target_currency_code
      and policy_version.effective_from <= target_at
      and (policy_version.effective_until is null or policy_version.effective_until > target_at)
      and public.financial_policy_scope_matches(
        policy_version,
        target_module_id,
        target_organization_id,
        target_service_key,
        target_geography_type,
        target_geography_key
      )
  ), ranked as (
    select candidates.*,
      (case when organization_id is null then 0 else 8 end
       + case when module_id is null then 0 else 4 end
       + case when service_key is null then 0 else 2 end
       + case when geography_type = 'global' then 0 else 1 end) as specificity
    from candidates
  ), best as (
    select max(specificity) as specificity, min(priority) as priority
    from ranked
  )
  select count(*), (array_agg(ranked.id order by ranked.id))[1]
  into match_count, resolved_id
  from ranked, best
  where ranked.specificity = best.specificity
    and ranked.priority = best.priority;

  if match_count = 0 or resolved_id is null then
    raise exception 'no approved active financial policy version matches %', target_policy_key;
  end if;
  if match_count > 1 then
    raise exception 'ambiguous active financial policy versions match %', target_policy_key;
  end if;

  select policy_version.* into resolved
  from public.financial_policy_versions policy_version
  where policy_version.id = resolved_id;

  return jsonb_build_object(
    'definitionId', definition_record.id,
    'policyKey', definition_record.key,
    'policyFamily', definition_record.policy_family,
    'policyVersionId', resolved.id,
    'version', resolved.version,
    'currencyCode', resolved.currency_code,
    'configuration', resolved.configuration,
    'effectiveFrom', resolved.effective_from,
    'effectiveUntil', resolved.effective_until,
    'moduleId', resolved.module_id,
    'organizationId', resolved.organization_id,
    'serviceKey', resolved.service_key,
    'geographyType', resolved.geography_type,
    'geographyKey', resolved.geography_key,
    'priority', resolved.priority
  );
end;
$$;

notify pgrst, 'reload schema';
commit;
