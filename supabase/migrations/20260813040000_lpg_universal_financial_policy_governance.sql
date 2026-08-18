begin;

insert into public.permissions (key, description, risk_level)
values
  ('platform.financial_policy.read', 'Read company financial policy definitions, versions, and history.', 'high'),
  ('platform.financial_policy.draft', 'Create immutable draft financial policy versions.', 'critical'),
  ('platform.financial_policy.approve', 'Approve submitted financial policy versions.', 'critical'),
  ('platform.financial_policy.activate', 'Schedule, activate, or deactivate approved financial policy versions.', 'critical'),
  ('platform.financial_policy.rollback', 'Create a governed superseding rollback version.', 'critical'),
  ('platform.partner_price.manage', 'Manage a delegated partner selling price within an assigned organization and branch.', 'high')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

create table if not exists public.financial_policy_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 160),
  policy_family text not null check (policy_family in (
    'pricing', 'commission', 'payout', 'settlement', 'withdrawal_fee', 'payment_fee',
    'refund', 'adjustment', 'cancellation', 'discount', 'referral', 'affiliate',
    'marketplace_fee', 'service_fee', 'pricing_guardrail', 'promotion', 'other'
  )),
  value_schema jsonb not null default '{}'::jsonb check (jsonb_typeof(value_schema) = 'object'),
  approval_required boolean not null default true,
  allow_partner_delegation boolean not null default false,
  status text not null default 'active' check (status in ('active', 'retired')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.financial_policy_versions (
  id uuid primary key default gen_random_uuid(),
  policy_definition_id uuid not null references public.financial_policy_definitions(id) on delete restrict,
  version integer not null check (version > 0),
  lifecycle_status text not null default 'draft' check (lifecycle_status in (
    'draft', 'submitted', 'approved', 'scheduled', 'active', 'inactive', 'rejected', 'superseded'
  )),
  organization_id uuid references public.organizations(id) on delete restrict,
  module_id uuid references public.business_modules(id) on delete restrict,
  service_key text check (service_key is null or service_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  geography_type text not null default 'global' check (geography_type in (
    'global', 'country', 'region', 'city', 'service_area', 'organization', 'branch'
  )),
  geography_key text,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  priority integer not null default 100 check (priority between 0 and 10000),
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  effective_from timestamptz not null,
  effective_until timestamptz,
  change_reason text not null check (char_length(btrim(change_reason)) between 3 and 1000),
  validation_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(validation_snapshot) = 'object'),
  based_on_version_id uuid references public.financial_policy_versions(id) on delete restrict,
  supersedes_version_id uuid references public.financial_policy_versions(id) on delete restrict,
  rollback_of_version_id uuid references public.financial_policy_versions(id) on delete restrict,
  submitted_by uuid references public.profiles(id) on delete set null,
  submitted_at timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  activated_by uuid references public.profiles(id) on delete set null,
  activated_at timestamptz,
  deactivated_by uuid references public.profiles(id) on delete set null,
  deactivated_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (policy_definition_id, version),
  check (effective_until is null or effective_until > effective_from),
  check ((geography_type = 'global' and geography_key is null) or (geography_type <> 'global' and geography_key is not null)),
  check (lifecycle_status not in ('approved', 'scheduled', 'active', 'inactive', 'superseded') or approved_at is not null),
  check (lifecycle_status <> 'active' or activated_at is not null)
);

create table if not exists public.financial_policy_events (
  id uuid primary key default gen_random_uuid(),
  policy_version_id uuid not null references public.financial_policy_versions(id) on delete restrict,
  event_type text not null check (event_type in (
    'drafted', 'submitted', 'approved', 'rejected', 'scheduled', 'activated',
    'deactivated', 'superseded', 'rollback_created'
  )),
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  previous_state jsonb,
  new_state jsonb not null check (jsonb_typeof(new_state) = 'object'),
  reason text,
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  unique (policy_version_id, idempotency_key)
);

create index if not exists financial_policy_versions_resolution_idx
on public.financial_policy_versions (
  policy_definition_id,
  currency_code,
  module_id,
  organization_id,
  service_key,
  geography_type,
  geography_key,
  lifecycle_status,
  effective_from,
  effective_until,
  priority
);

create index if not exists financial_policy_events_history_idx
on public.financial_policy_events (policy_version_id, created_at desc);

create or replace function public.financial_policy_scope_matches(
  policy public.financial_policy_versions,
  target_module_id uuid,
  target_organization_id uuid,
  target_service_key text,
  target_geography_type text,
  target_geography_key text
)
returns boolean
language sql
immutable
as $$
  select (policy.module_id is null or policy.module_id = target_module_id)
    and (policy.organization_id is null or policy.organization_id = target_organization_id)
    and (policy.service_key is null or policy.service_key = target_service_key)
    and (
      policy.geography_type = 'global'
      or (
        policy.geography_type = target_geography_type
        and policy.geography_key = target_geography_key
      )
    );
$$;

create or replace function public.validate_financial_policy_configuration(
  target_policy_family text,
  target_configuration jsonb
)
returns jsonb
language plpgsql
immutable
as $$
declare
  pair record;
begin
  if target_configuration is null or jsonb_typeof(target_configuration) <> 'object' then
    raise exception 'financial policy configuration must be a JSON object';
  end if;

  if target_configuration = '{}'::jsonb then
    raise exception 'financial policy configuration cannot be empty';
  end if;

  if target_policy_family in ('pricing', 'commission', 'payout', 'settlement', 'withdrawal_fee', 'payment_fee',
      'refund', 'adjustment', 'cancellation', 'discount', 'referral', 'affiliate', 'marketplace_fee',
      'service_fee', 'pricing_guardrail', 'promotion') then
    for pair in select key, value from jsonb_each(target_configuration)
    loop
      if pair.key ~ '(amount|rate|fee|price|markup|margin|minimum|maximum|floor|ceiling|per_km|per_kg|percent|percentage)$'
        and jsonb_typeof(pair.value) = 'number'
        and (pair.value #>> '{}')::numeric < 0 then
        raise exception 'financial policy numeric values cannot be negative: %', pair.key;
      end if;
    end loop;
  end if;

  return jsonb_build_object(
    'valid', true,
    'policy_family', target_policy_family,
    'validated_at', timezone('utc', now())
  );
end;
$$;

create or replace function public.assert_financial_policy_no_conflict(
  target_version_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  candidate public.financial_policy_versions%rowtype;
  conflict_id uuid;
begin
  select * into candidate
  from public.financial_policy_versions
  where id = target_version_id;

  if not found then
    raise exception 'financial policy version was not found';
  end if;

  select other.id into conflict_id
  from public.financial_policy_versions other
  where other.id <> candidate.id
    and other.policy_definition_id = candidate.policy_definition_id
    and other.currency_code = candidate.currency_code
    and other.module_id is not distinct from candidate.module_id
    and other.organization_id is not distinct from candidate.organization_id
    and other.service_key is not distinct from candidate.service_key
    and other.geography_type = candidate.geography_type
    and other.geography_key is not distinct from candidate.geography_key
    and other.priority = candidate.priority
    and other.lifecycle_status in ('scheduled', 'active')
    and tstzrange(other.effective_from, other.effective_until, '[)') &&
      tstzrange(candidate.effective_from, candidate.effective_until, '[)')
  limit 1;

  if conflict_id is not null then
    raise exception 'financial policy scope and effective window conflict with version %', conflict_id;
  end if;
end;
$$;

create or replace function public.resolve_financial_policy(
  target_policy_key text,
  target_currency_code text,
  target_at timestamptz default timezone('utc', now()),
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
    select id into target_module_id from public.business_modules where key = target_module_key;
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
    select version.*
    from public.financial_policy_versions version
    where version.policy_definition_id = definition_record.id
      and version.lifecycle_status in ('active', 'scheduled')
      and version.currency_code = target_currency_code
      and version.effective_from <= target_at
      and (version.effective_until is null or version.effective_until > target_at)
      and public.financial_policy_scope_matches(
        version,
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
    select max(specificity) as specificity, min(priority) as priority from ranked
  )
  select count(*), min(ranked.id)
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

  select * into resolved from public.financial_policy_versions where id = resolved_id;

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

create or replace function public.create_financial_policy_version(
  target_policy_key text,
  target_display_name text,
  target_policy_family text,
  target_currency_code text,
  target_configuration jsonb,
  target_effective_from timestamptz,
  target_change_reason text,
  target_idempotency_key text,
  target_module_key text default null,
  target_organization_id uuid default null,
  target_service_key text default null,
  target_geography_type text default 'global',
  target_geography_key text default null,
  target_effective_until timestamptz default null,
  target_priority integer default 100,
  target_approval_required boolean default true,
  target_allow_partner_delegation boolean default false,
  target_based_on_version_id uuid default null,
  target_supersedes_version_id uuid default null,
  target_rollback_of_version_id uuid default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  definition_record public.financial_policy_definitions%rowtype;
  module_id uuid;
  next_version integer;
  version_id uuid;
  validation jsonb;
begin
  if auth.role() <> 'service_role' and not public.has_permission('platform.financial_policy.draft', null) then
    raise exception 'financial policy draft permission is required';
  end if;

  if target_policy_key is null or target_policy_key !~ '^[a-z][a-z0-9_.:-]{2,120}$'
    or target_display_name is null or btrim(target_display_name) = ''
    or target_change_reason is null or char_length(btrim(target_change_reason)) < 3
    or target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'valid policy key, display name, change reason, and idempotency key are required';
  end if;

  if target_effective_from is null or (target_effective_until is not null and target_effective_until <= target_effective_from) then
    raise exception 'a valid effective window is required';
  end if;

  if target_geography_type not in ('global', 'country', 'region', 'city', 'service_area', 'organization', 'branch') then
    raise exception 'target_geography_type is not supported';
  end if;

  if (target_geography_type = 'global' and target_geography_key is not null)
    or (target_geography_type <> 'global' and (target_geography_key is null or btrim(target_geography_key) = '')) then
    raise exception 'geography key must match the geography type';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if target_module_key is not null then
    select id into module_id from public.business_modules where key = target_module_key;
    if module_id is null then
      raise exception 'target_module_key must reference a configured business module';
    end if;
  end if;

  validation := public.validate_financial_policy_configuration(target_policy_family, target_configuration);

  insert into public.financial_policy_definitions (
    key, display_name, policy_family, approval_required, allow_partner_delegation, metadata
  ) values (
    target_policy_key, btrim(target_display_name), target_policy_family,
    target_approval_required, target_allow_partner_delegation, target_metadata
  )
  on conflict (key) do nothing;

  select * into definition_record
  from public.financial_policy_definitions
  where key = target_policy_key
  for update;

  if definition_record.policy_family <> target_policy_family then
    raise exception 'policy family cannot change between versions';
  end if;

  select event.policy_version_id into version_id
  from public.financial_policy_events event
  join public.financial_policy_versions version on version.id = event.policy_version_id
  where event.idempotency_key = target_idempotency_key
    and version.policy_definition_id = definition_record.id
  limit 1;

  if version_id is not null then
    return version_id;
  end if;

  select coalesce(max(version), 0) + 1 into next_version
  from public.financial_policy_versions
  where policy_definition_id = definition_record.id;

  insert into public.financial_policy_versions (
    policy_definition_id, version, organization_id, module_id, service_key,
    geography_type, geography_key, currency_code, priority, configuration,
    effective_from, effective_until, change_reason, validation_snapshot,
    based_on_version_id, supersedes_version_id, rollback_of_version_id, created_by
  ) values (
    definition_record.id, next_version, target_organization_id, module_id, target_service_key,
    target_geography_type, target_geography_key, target_currency_code, coalesce(target_priority, 100),
    target_configuration, target_effective_from, target_effective_until, btrim(target_change_reason),
    validation, target_based_on_version_id, target_supersedes_version_id,
    target_rollback_of_version_id, auth.uid()
  ) returning id into version_id;

  insert into public.financial_policy_events (
    policy_version_id, event_type, actor_user_id, previous_state, new_state, reason, idempotency_key
  ) values (
    version_id, case when target_rollback_of_version_id is null then 'drafted' else 'rollback_created' end,
    auth.uid(), null, (select to_jsonb(version.*) from public.financial_policy_versions version where version.id = version_id),
    target_change_reason, target_idempotency_key
  );

  return version_id;
end;
$$;

create or replace function public.submit_financial_policy_version(
  target_policy_version_id uuid,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  before_record public.financial_policy_versions%rowtype;
begin
  if auth.role() <> 'service_role' and not public.has_permission('platform.financial_policy.draft', null) then
    raise exception 'financial policy draft permission is required';
  end if;

  select * into before_record from public.financial_policy_versions where id = target_policy_version_id for update;
  if not found or before_record.lifecycle_status <> 'draft' then
    raise exception 'only a draft financial policy version can be submitted';
  end if;

  update public.financial_policy_versions
  set lifecycle_status = 'submitted', submitted_by = auth.uid(), submitted_at = timezone('utc', now()), updated_at = timezone('utc', now())
  where id = target_policy_version_id;

  insert into public.financial_policy_events (policy_version_id, event_type, actor_user_id, previous_state, new_state, reason, idempotency_key)
  values (target_policy_version_id, 'submitted', auth.uid(), to_jsonb(before_record),
    (select to_jsonb(version.*) from public.financial_policy_versions version where version.id = target_policy_version_id),
    target_reason, target_idempotency_key)
  on conflict (policy_version_id, idempotency_key) do nothing;

  return target_policy_version_id;
end;
$$;

create or replace function public.review_financial_policy_version(
  target_policy_version_id uuid,
  target_decision text,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  before_record public.financial_policy_versions%rowtype;
begin
  if auth.role() <> 'service_role' and not public.has_permission('platform.financial_policy.approve', null) then
    raise exception 'financial policy approval permission is required';
  end if;

  if target_decision not in ('approved', 'rejected') then
    raise exception 'target_decision must be approved or rejected';
  end if;

  select * into before_record from public.financial_policy_versions where id = target_policy_version_id for update;
  if not found or before_record.lifecycle_status <> 'submitted' then
    raise exception 'only a submitted financial policy version can be reviewed';
  end if;

  if auth.role() <> 'service_role' and before_record.created_by = auth.uid() then
    raise exception 'financial policy creators cannot approve or reject their own version';
  end if;

  update public.financial_policy_versions
  set lifecycle_status = target_decision,
      approved_by = case when target_decision = 'approved' then auth.uid() else null end,
      approved_at = case when target_decision = 'approved' then timezone('utc', now()) else null end,
      updated_at = timezone('utc', now())
  where id = target_policy_version_id;

  insert into public.financial_policy_events (policy_version_id, event_type, actor_user_id, previous_state, new_state, reason, idempotency_key)
  values (target_policy_version_id, target_decision, auth.uid(), to_jsonb(before_record),
    (select to_jsonb(version.*) from public.financial_policy_versions version where version.id = target_policy_version_id),
    target_reason, target_idempotency_key)
  on conflict (policy_version_id, idempotency_key) do nothing;

  return target_policy_version_id;
end;
$$;

create or replace function public.activate_financial_policy_version(
  target_policy_version_id uuid,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  before_record public.financial_policy_versions%rowtype;
  next_status text;
begin
  if auth.role() <> 'service_role' and not public.has_permission('platform.financial_policy.activate', null) then
    raise exception 'financial policy activation permission is required';
  end if;

  select * into before_record from public.financial_policy_versions where id = target_policy_version_id for update;
  if not found or before_record.lifecycle_status <> 'approved' then
    raise exception 'only an approved financial policy version can be activated';
  end if;

  perform public.assert_financial_policy_no_conflict(target_policy_version_id);
  next_status := case when before_record.effective_from > timezone('utc', now()) then 'scheduled' else 'active' end;

  update public.financial_policy_versions
  set lifecycle_status = next_status,
      activated_by = auth.uid(),
      activated_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = target_policy_version_id;

  insert into public.financial_policy_events (policy_version_id, event_type, actor_user_id, previous_state, new_state, reason, idempotency_key)
  values (target_policy_version_id, case when next_status = 'active' then 'activated' else 'scheduled' end,
    auth.uid(), to_jsonb(before_record),
    (select to_jsonb(version.*) from public.financial_policy_versions version where version.id = target_policy_version_id),
    target_reason, target_idempotency_key)
  on conflict (policy_version_id, idempotency_key) do nothing;

  return target_policy_version_id;
end;
$$;

create or replace function public.deactivate_financial_policy_version(
  target_policy_version_id uuid,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  before_record public.financial_policy_versions%rowtype;
begin
  if auth.role() <> 'service_role' and not public.has_permission('platform.financial_policy.activate', null) then
    raise exception 'financial policy activation permission is required';
  end if;

  select * into before_record from public.financial_policy_versions where id = target_policy_version_id for update;
  if not found or before_record.lifecycle_status not in ('active', 'scheduled') then
    raise exception 'only an active or scheduled financial policy version can be deactivated';
  end if;

  update public.financial_policy_versions
  set lifecycle_status = 'inactive', effective_until = least(coalesce(effective_until, timezone('utc', now())), timezone('utc', now())),
      deactivated_by = auth.uid(), deactivated_at = timezone('utc', now()), updated_at = timezone('utc', now())
  where id = target_policy_version_id;

  insert into public.financial_policy_events (policy_version_id, event_type, actor_user_id, previous_state, new_state, reason, idempotency_key)
  values (target_policy_version_id, 'deactivated', auth.uid(), to_jsonb(before_record),
    (select to_jsonb(version.*) from public.financial_policy_versions version where version.id = target_policy_version_id),
    target_reason, target_idempotency_key)
  on conflict (policy_version_id, idempotency_key) do nothing;

  return target_policy_version_id;
end;
$$;

create or replace function public.rollback_financial_policy_version(
  target_active_version_id uuid,
  target_restore_version_id uuid,
  target_effective_from timestamptz,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  active_record public.financial_policy_versions%rowtype;
  restore_record public.financial_policy_versions%rowtype;
  definition_record public.financial_policy_definitions%rowtype;
  module_key text;
begin
  if auth.role() <> 'service_role' and not public.has_permission('platform.financial_policy.rollback', null) then
    raise exception 'financial policy rollback permission is required';
  end if;

  select * into active_record from public.financial_policy_versions where id = target_active_version_id;
  select * into restore_record from public.financial_policy_versions where id = target_restore_version_id;
  if active_record.id is null or restore_record.id is null or active_record.policy_definition_id <> restore_record.policy_definition_id then
    raise exception 'rollback versions must exist and belong to the same financial policy';
  end if;

  select * into definition_record from public.financial_policy_definitions where id = restore_record.policy_definition_id;
  select key into module_key from public.business_modules where id = restore_record.module_id;

  return public.create_financial_policy_version(
    definition_record.key,
    definition_record.display_name,
    definition_record.policy_family,
    restore_record.currency_code,
    restore_record.configuration,
    target_effective_from,
    target_reason,
    target_idempotency_key,
    module_key,
    restore_record.organization_id,
    restore_record.service_key,
    restore_record.geography_type,
    restore_record.geography_key,
    restore_record.effective_until,
    restore_record.priority,
    definition_record.approval_required,
    definition_record.allow_partner_delegation,
    restore_record.id,
    active_record.id,
    active_record.id,
    jsonb_build_object('rollback_restore_version_id', restore_record.id)
  );
end;
$$;

create or replace function public.prevent_financial_policy_version_mutation()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'financial policy versions are immutable and cannot be deleted';
  end if;

  if old.policy_definition_id <> new.policy_definition_id
    or old.version <> new.version
    or old.organization_id is distinct from new.organization_id
    or old.module_id is distinct from new.module_id
    or old.service_key is distinct from new.service_key
    or old.geography_type <> new.geography_type
    or old.geography_key is distinct from new.geography_key
    or old.currency_code <> new.currency_code
    or old.priority <> new.priority
    or old.configuration <> new.configuration
    or old.effective_from <> new.effective_from
    or (
      old.effective_until is distinct from new.effective_until
      and not (
        new.lifecycle_status = 'inactive'
        and new.effective_until is not null
        and new.effective_until <= timezone('utc', now())
      )
    )
    or old.change_reason <> new.change_reason
    or old.created_by is distinct from new.created_by
    or old.created_at <> new.created_at then
    raise exception 'financial policy version business fields are immutable; create a new version';
  end if;

  if old.lifecycle_status not in ('draft', 'submitted', 'approved', 'scheduled', 'active')
    and old.lifecycle_status <> new.lifecycle_status then
    raise exception 'terminal financial policy lifecycle state cannot be changed';
  end if;

  return new;
end;
$$;

create or replace function public.prevent_financial_policy_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'financial policy events are append-only';
end;
$$;

drop trigger if exists prevent_financial_policy_version_mutation on public.financial_policy_versions;
create trigger prevent_financial_policy_version_mutation
before update or delete on public.financial_policy_versions
for each row execute function public.prevent_financial_policy_version_mutation();

drop trigger if exists prevent_financial_policy_event_update on public.financial_policy_events;
create trigger prevent_financial_policy_event_update
before update on public.financial_policy_events
for each row execute function public.prevent_financial_policy_event_mutation();

drop trigger if exists prevent_financial_policy_event_delete on public.financial_policy_events;
create trigger prevent_financial_policy_event_delete
before delete on public.financial_policy_events
for each row execute function public.prevent_financial_policy_event_mutation();

drop trigger if exists set_financial_policy_definitions_updated_at on public.financial_policy_definitions;
create trigger set_financial_policy_definitions_updated_at before update on public.financial_policy_definitions
for each row execute function public.set_updated_at();

drop trigger if exists audit_financial_policy_definitions_mutations on public.financial_policy_definitions;
create trigger audit_financial_policy_definitions_mutations after insert or update or delete on public.financial_policy_definitions
for each row execute function public.record_table_audit();

drop trigger if exists audit_financial_policy_versions_mutations on public.financial_policy_versions;
create trigger audit_financial_policy_versions_mutations after insert or update or delete on public.financial_policy_versions
for each row execute function public.record_table_audit();

do $$
declare
  target_table text;
begin
  foreach target_table in array array['commission_policies', 'lpg_operation_policies', 'lpg_refill_pricing']
  loop
    execute format('drop trigger if exists audit_%I_governance_mutations on public.%I', target_table, target_table);
    execute format(
      'create trigger audit_%I_governance_mutations after insert or update or delete on public.%I for each row execute function public.record_table_audit()',
      target_table,
      target_table
    );
  end loop;
end $$;

alter table public.financial_policy_definitions enable row level security;
alter table public.financial_policy_versions enable row level security;
alter table public.financial_policy_events enable row level security;

create policy financial_policy_definitions_read_authorized on public.financial_policy_definitions
for select to authenticated using (public.has_permission('platform.financial_policy.read', null));
create policy financial_policy_versions_read_authorized on public.financial_policy_versions
for select to authenticated using (public.has_permission('platform.financial_policy.read', null));
create policy financial_policy_events_read_authorized on public.financial_policy_events
for select to authenticated using (public.has_permission('platform.financial_policy.read', null));

create policy financial_policy_definitions_no_direct_insert on public.financial_policy_definitions for insert to authenticated with check (false);
create policy financial_policy_definitions_no_direct_update on public.financial_policy_definitions for update to authenticated using (false) with check (false);
create policy financial_policy_definitions_no_direct_delete on public.financial_policy_definitions for delete to authenticated using (false);
create policy financial_policy_versions_no_direct_insert on public.financial_policy_versions for insert to authenticated with check (false);
create policy financial_policy_versions_no_direct_update on public.financial_policy_versions for update to authenticated using (false) with check (false);
create policy financial_policy_versions_no_direct_delete on public.financial_policy_versions for delete to authenticated using (false);
create policy financial_policy_events_no_direct_insert on public.financial_policy_events for insert to authenticated with check (false);
create policy financial_policy_events_no_direct_update on public.financial_policy_events for update to authenticated using (false) with check (false);
create policy financial_policy_events_no_direct_delete on public.financial_policy_events for delete to authenticated using (false);

drop policy if exists pricing_policies_select_active_or_privileged on public.pricing_policies;
create policy pricing_policies_select_privileged on public.pricing_policies
for select to authenticated using (
  public.has_permission('platform.pricing.read', null)
  or public.has_permission('platform.financial_policy.read', null)
);

drop policy if exists settlement_policies_select_active_or_privileged on public.settlement_policies;
create policy settlement_policies_select_privileged on public.settlement_policies
for select to authenticated using (
  public.has_permission('platform.settlement.read', null)
  or public.has_permission('platform.financial_policy.read', null)
);

drop policy if exists commission_policies_select_authenticated on public.commission_policies;
create policy commission_policies_select_privileged on public.commission_policies
for select to authenticated using (
  public.has_permission('platform.financial_policy.read', null)
  or public.has_permission('platform.commissions.execute', null)
);

drop policy if exists lpg_refill_pricing_manage_privileged on public.lpg_refill_pricing;
drop policy if exists lpg_refill_pricing_no_direct_insert on public.lpg_refill_pricing;
drop policy if exists lpg_refill_pricing_no_direct_update on public.lpg_refill_pricing;
drop policy if exists lpg_refill_pricing_no_direct_delete on public.lpg_refill_pricing;
create policy lpg_refill_pricing_no_direct_insert on public.lpg_refill_pricing for insert to authenticated with check (false);
create policy lpg_refill_pricing_no_direct_update on public.lpg_refill_pricing for update to authenticated using (false) with check (false);
create policy lpg_refill_pricing_no_direct_delete on public.lpg_refill_pricing for delete to authenticated using (false);

create or replace function public.can_manage_delegated_lpg_station_price(target_station_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.can_manage_lpg_operations()
    or exists (
      select 1
      from public.lpg_station_branches station
      where station.id = target_station_branch_id
        and public.has_permission_for_branch(
          'platform.partner_price.manage',
          station.organization_id,
          station.branch_id
        )
    );
$$;

create or replace function public.configure_lpg_station_price(
  target_station_branch_id uuid,
  target_price_per_kg numeric,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.station_price'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  baseline record;
begin
  if not public.can_manage_delegated_lpg_station_price(target_station_branch_id) then
    raise exception 'delegated branch price management permission is required';
  end if;

  if target_price_per_kg is null or target_price_per_kg <= 0 then
    raise exception 'target_price_per_kg must be greater than zero';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = ''
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'valid idempotency key and metadata are required';
  end if;

  select pricing.* into baseline
  from public.lpg_refill_pricing pricing
  where pricing.status = 'active'
    and (pricing.station_branch_id = target_station_branch_id or pricing.station_branch_id is null)
    and pricing.effective_from <= timezone('utc', now())
    and (pricing.effective_until is null or pricing.effective_until > timezone('utc', now()))
  order by (pricing.station_branch_id = target_station_branch_id) desc, pricing.effective_from desc
  limit 1;

  if not found then
    raise exception 'active platform pricing configuration is required before a station price can be changed';
  end if;

  return public.configure_lpg_refill_pricing(
    target_station_branch_id, baseline.currency_code, target_price_per_kg,
    baseline.delivery_base_fee, baseline.platform_fee_amount, baseline.tax_rate_percent,
    baseline.driver_commission_amount, baseline.min_kg, baseline.max_kg,
    target_idempotency_key, timezone('utc', now()), null,
    target_metadata || jsonb_build_object('managed_field', 'price_per_kg'), target_source
  );
end;
$$;

create or replace function public.execute_driver_commission_from_order(
  target_order_id uuid,
  target_escrow_hold_id uuid,
  target_driver_wallet_id uuid,
  target_source text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.order_records%rowtype;
  resolved_policy jsonb;
  configuration jsonb;
  calculation_mode text;
  base_amount numeric(28, 8);
  fixed_amount numeric(28, 8);
  percentage_rate numeric(10, 6);
  commission_amount numeric(28, 8);
  release_transaction_id uuid;
  execution_id uuid;
begin
  if not public.can_execute_financial_runtime() then
    raise exception 'commission execution permission is required';
  end if;

  select * into order_record from public.order_records where id = target_order_id;
  if not found then raise exception 'target_order_id must reference an existing order'; end if;

  resolved_policy := coalesce(
    order_record.metadata -> 'financial_policy_snapshot' -> 'driver_payout',
    order_record.order_payload -> 'financial_policy_snapshot' -> 'driver_payout'
  );

  if resolved_policy is null or jsonb_typeof(resolved_policy) <> 'object' then
    raise exception 'accepted order is missing a locked driver payout policy snapshot';
  end if;

  configuration := resolved_policy -> 'configuration';
  calculation_mode := configuration ->> 'calculation_mode';
  base_amount := nullif(configuration ->> 'locked_base_amount', '')::numeric;
  fixed_amount := coalesce(nullif(configuration ->> 'fixed_amount', '')::numeric, 0);
  percentage_rate := coalesce(nullif(configuration ->> 'percentage_rate', '')::numeric, 0);

  if calculation_mode not in ('fixed', 'percentage', 'hybrid') then
    raise exception 'locked driver payout policy has an unsupported calculation mode';
  end if;

  if calculation_mode in ('percentage', 'hybrid') and base_amount is null then
    raise exception 'locked driver payout policy must include locked_base_amount';
  end if;

  commission_amount := round(
    case calculation_mode
      when 'fixed' then fixed_amount
      when 'percentage' then base_amount * percentage_rate / 100
      else fixed_amount + base_amount * percentage_rate / 100
    end,
    2
  );

  if commission_amount <= 0 then raise exception 'locked driver payout must be greater than zero'; end if;

  release_transaction_id := public.release_escrow_hold(
    target_escrow_hold_id,
    jsonb_build_array(jsonb_build_object(
      'wallet_id', target_driver_wallet_id,
      'amount', commission_amount,
      'entry_type', 'commission',
      'metadata', jsonb_build_object('role', 'driver_payout')
    )),
    target_idempotency_key || ':release',
    target_source,
    target_metadata || jsonb_build_object('financial_policy_snapshot', resolved_policy)
  );

  insert into public.commission_executions (
    service_request_id, order_id, escrow_hold_id, driver_wallet_id, transaction_id,
    currency_code, amount, status, policy_snapshot, source, idempotency_key, metadata, created_by
  ) values (
    order_record.service_request_id, order_record.id, target_escrow_hold_id, target_driver_wallet_id,
    release_transaction_id, order_record.currency_code, commission_amount, 'posted', resolved_policy,
    target_source, target_idempotency_key, target_metadata, auth.uid()
  ) on conflict (source, idempotency_key) do nothing
  returning id into execution_id;

  if execution_id is null then
    select id into execution_id from public.commission_executions
    where source = target_source and idempotency_key = target_idempotency_key;
  end if;

  return execution_id;
end;
$$;

create or replace function public.calculate_withdrawal_fee_from_policy(
  target_wallet_id uuid,
  target_amount numeric,
  target_at timestamptz default timezone('utc', now())
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  wallet_record public.wallet_accounts%rowtype;
  resolved_policy jsonb;
  configuration jsonb;
  fee_amount numeric(28, 8);
begin
  select * into wallet_record from public.wallet_accounts where id = target_wallet_id;
  if not found then raise exception 'target_wallet_id must reference an existing wallet'; end if;

  resolved_policy := public.resolve_financial_policy(
    'fees.withdrawal.default', wallet_record.currency_code, target_at,
    null, null, 'wallet.withdrawal', 'global', null
  );
  configuration := resolved_policy -> 'configuration';
  fee_amount := round(
    coalesce(nullif(configuration ->> 'fixed_amount', '')::numeric, 0)
    + target_amount * coalesce(nullif(configuration ->> 'percentage_rate', '')::numeric, 0) / 100,
    2
  );

  if fee_amount < 0 then raise exception 'resolved withdrawal fee cannot be negative'; end if;

  return resolved_policy || jsonb_build_object('calculatedFeeAmount', fee_amount, 'withdrawalAmount', target_amount);
end;
$$;

insert into public.financial_policy_definitions (
  key, display_name, policy_family, approval_required, allow_partner_delegation, metadata
)
values
  ('pricing.lpg.platform_markup_per_kg', 'LPG platform markup per kilogram', 'service_fee', true, false,
    '{"module":"lpg","component":"lpg_platform_markup_per_kg"}'::jsonb),
  ('pricing.lpg.delivery', 'LPG delivery pricing', 'pricing', true, false,
    '{"module":"lpg","component":"customer_delivery_fee","requires_route_provider":true}'::jsonb),
  ('payout.lpg.driver', 'LPG driver logistics payout', 'payout', true, false,
    '{"module":"lpg","component":"driver_payout","value_independent":true}'::jsonb),
  ('settlement.lpg.beneficiaries', 'LPG beneficiary settlement', 'settlement', true, false,
    '{"module":"lpg"}'::jsonb),
  ('fees.withdrawal.default', 'Default withdrawal fee', 'withdrawal_fee', true, false,
    '{"component":"withdrawal_fee","safe_default":true}'::jsonb)
on conflict (key) do nothing;

do $$
declare
  lpg_module_id uuid;
  definition_id uuid;
  version_id uuid;
begin
  select id into lpg_module_id from public.business_modules where key = 'lpg';
  select id into definition_id from public.financial_policy_definitions where key = 'pricing.lpg.platform_markup_per_kg';

  if lpg_module_id is not null and definition_id is not null and not exists (
    select 1 from public.financial_policy_versions where policy_definition_id = definition_id
  ) then
    insert into public.financial_policy_versions (
      policy_definition_id, version, lifecycle_status, module_id, service_key, geography_type,
      currency_code, configuration, effective_from, change_reason, validation_snapshot,
      submitted_at, approved_at, activated_at, created_at, updated_at
    ) values (
      definition_id, 1, 'active', lpg_module_id, 'lpg.refill', 'global', 'NGN',
      '{"amount_per_kg":50,"component_key":"lpg_platform_markup_per_kg","quantity_sensitive":true}'::jsonb,
      timezone('utc', now()), 'Approved initial SKIMA LPG markup of NGN 50 per kilogram.',
      public.validate_financial_policy_configuration('service_fee', '{"amount_per_kg":50}'::jsonb),
      timezone('utc', now()), timezone('utc', now()), timezone('utc', now()),
      timezone('utc', now()), timezone('utc', now())
    ) returning id into version_id;

    insert into public.financial_policy_events (
      policy_version_id, event_type, previous_state, new_state, reason, idempotency_key
    ) values (
      version_id, 'activated', null,
      (select to_jsonb(version.*) from public.financial_policy_versions version where version.id = version_id),
      'Approved initial SKIMA LPG markup of NGN 50 per kilogram.',
      'seed:lpg-platform-markup-per-kg:v1'
    );
  end if;
end $$;

do $$
declare
  definition_id uuid;
  version_id uuid;
begin
  select id into definition_id from public.financial_policy_definitions where key = 'fees.withdrawal.default';

  if definition_id is not null and not exists (
    select 1 from public.financial_policy_versions where policy_definition_id = definition_id
  ) then
    insert into public.financial_policy_versions (
      policy_definition_id, version, lifecycle_status, geography_type, currency_code,
      configuration, effective_from, change_reason, validation_snapshot,
      submitted_at, approved_at, activated_at, created_at, updated_at
    ) values (
      definition_id, 1, 'active', 'global', 'NGN',
      '{"fixed_amount":0,"percentage_rate":0,"explicit_zero":true}'::jsonb,
      timezone('utc', now()),
      'Initial explicit zero withdrawal fee until an approved company rate is configured.',
      public.validate_financial_policy_configuration('withdrawal_fee', '{"fixed_amount":0,"percentage_rate":0,"explicit_zero":true}'::jsonb),
      timezone('utc', now()), timezone('utc', now()), timezone('utc', now()),
      timezone('utc', now()), timezone('utc', now())
    ) returning id into version_id;

    insert into public.financial_policy_events (
      policy_version_id, event_type, previous_state, new_state, reason, idempotency_key
    ) values (
      version_id, 'activated', null,
      (select to_jsonb(version.*) from public.financial_policy_versions version where version.id = version_id),
      'Initial explicit zero withdrawal fee until an approved company rate is configured.',
      'seed:withdrawal-fee-ngn:v1'
    );
  end if;
end $$;

select public.configure_platform_admin_role(
  'platform.finance_policy_author',
  'Finance Policy Author',
  'Drafts and submits company financial policy versions without approval authority.',
  array[
    'platform.financial.read', 'platform.financial_policy.read', 'platform.financial_policy.draft',
    'platform.pricing.read', 'platform.settlement.read', 'platform.audit.read'
  ],
  '{"system_role":true,"admin_area":"finance_policy","approval_boundary":"maker"}'::jsonb,
  'active'
);

select public.configure_platform_admin_role(
  'platform.finance_policy_approver',
  'Finance Policy Approver',
  'Reviews and approves submitted company financial policy versions without draft authority.',
  array[
    'platform.financial.read', 'platform.financial_policy.read', 'platform.financial_policy.approve',
    'platform.pricing.read', 'platform.settlement.read', 'platform.audit.read'
  ],
  '{"system_role":true,"admin_area":"finance_policy","approval_boundary":"checker"}'::jsonb,
  'active'
);

select public.configure_platform_admin_role(
  'platform.finance_admin',
  'Finance Admin',
  'Manages financial operations and approved policy activation with full audit visibility.',
  array[
    'platform.financial.read', 'platform.financial.manage', 'platform.financial_policy.read',
    'platform.financial_policy.activate', 'platform.financial_policy.rollback',
    'platform.pricing.read', 'platform.pricing.manage', 'platform.pricing.execute',
    'platform.wallets.read', 'platform.wallets.manage', 'platform.payments.read',
    'platform.escrow.read', 'platform.escrow.manage', 'platform.settlement.read',
    'platform.settlement.manage', 'platform.settlement.execute', 'platform.commissions.execute',
    'platform.withdrawals.read', 'platform.withdrawals.execute', 'platform.reconciliation.execute',
    'platform.audit.read'
  ],
  '{"system_role":true,"admin_area":"finance","approval_boundary":"activator"}'::jsonb,
  'active'
);

revoke all on function public.create_financial_policy_version(text, text, text, text, jsonb, timestamptz, text, text, text, uuid, text, text, text, timestamptz, integer, boolean, boolean, uuid, uuid, uuid, jsonb) from public;
revoke all on function public.submit_financial_policy_version(uuid, text, text) from public;
revoke all on function public.review_financial_policy_version(uuid, text, text, text) from public;
revoke all on function public.activate_financial_policy_version(uuid, text, text) from public;
revoke all on function public.deactivate_financial_policy_version(uuid, text, text) from public;
revoke all on function public.rollback_financial_policy_version(uuid, uuid, timestamptz, text, text) from public;
revoke all on function public.resolve_financial_policy(text, text, timestamptz, text, uuid, text, text, text) from public;

grant execute on function public.create_financial_policy_version(text, text, text, text, jsonb, timestamptz, text, text, text, uuid, text, text, text, timestamptz, integer, boolean, boolean, uuid, uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.submit_financial_policy_version(uuid, text, text) to authenticated, service_role;
grant execute on function public.review_financial_policy_version(uuid, text, text, text) to authenticated, service_role;
grant execute on function public.activate_financial_policy_version(uuid, text, text) to authenticated, service_role;
grant execute on function public.deactivate_financial_policy_version(uuid, text, text) to authenticated, service_role;
grant execute on function public.rollback_financial_policy_version(uuid, uuid, timestamptz, text, text) to authenticated, service_role;
grant execute on function public.resolve_financial_policy(text, text, timestamptz, text, uuid, text, text, text) to authenticated, service_role;
grant execute on function public.execute_driver_commission_from_order(uuid, uuid, uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.calculate_withdrawal_fee_from_policy(uuid, numeric, timestamptz) to authenticated, service_role;

commit;
