begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- ---------------------------------------------------------------------------
-- SKIMA partner verification engine
-- Automatic verification is the primary onboarding path. Uploaded documents
-- remain a controlled fallback for checks that have no trusted provider route
-- or that genuinely require regulatory/safety evidence.
-- ---------------------------------------------------------------------------

alter table public.provider_adapters
  drop constraint if exists provider_adapters_provider_kind_check;
alter table public.provider_adapters
  add constraint provider_adapters_provider_kind_check
  check (provider_kind in (
    'payment','storage','maps','notification','ai','queue','cache','observability','verification'
  ));

alter table public.provider_execution_logs
  drop constraint if exists provider_execution_logs_provider_kind_check;
alter table public.provider_execution_logs
  add constraint provider_execution_logs_provider_kind_check
  check (provider_kind in (
    'payment','storage','maps','notification','ai','queue','cache','observability','verification'
  ));

insert into public.provider_adapters (
  provider_kind,
  key,
  display_name,
  status,
  config,
  secret_ref
)
values (
  'verification',
  'provider.verification.didit',
  'Didit Verification',
  'inactive',
  jsonb_build_object(
    'base_url', 'https://verification.didit.me',
    'hosted_flow', true,
    'capabilities', jsonb_build_array(
      'identity_document',
      'passive_liveness',
      'face_match',
      'business_verification'
    ),
    'activation_note',
    'Set DIDIT_API_KEY as a Supabase function secret, configure workflow_ref values, then activate the desired route.'
  ),
  'SUPABASE_SECRET:DIDIT_API_KEY'
)
on conflict (provider_kind, key) do update
set display_name = excluded.display_name,
    config = public.provider_adapters.config || excluded.config,
    secret_ref = excluded.secret_ref,
    updated_at = timezone('utc', now());

insert into public.verification_definitions (
  key,
  display_name,
  verification_mode,
  schema,
  status
)
values
  (
    'verification.person.identity',
    'Identity and liveness',
    'biometric',
    '{"purpose":"identity_and_liveness","privacy":"PRIVATE_KYC","provider_agnostic":true}'::jsonb,
    'active'
  ),
  (
    'verification.driver.licence',
    'Driver licence verification',
    'document',
    '{"purpose":"driver_licence","privacy":"PRIVATE_KYC","provider_agnostic":true}'::jsonb,
    'active'
  ),
  (
    'verification.business.registry',
    'Business registration verification',
    'system',
    '{"purpose":"business_registry","privacy":"PRIVATE_VERIFICATION","provider_agnostic":true}'::jsonb,
    'active'
  ),
  (
    'verification.station.authority',
    'Representative authority verification',
    'system',
    '{"purpose":"representative_authority","privacy":"PRIVATE_KYC","provider_agnostic":true}'::jsonb,
    'active'
  ),
  (
    'verification.vehicle.registration',
    'Vehicle registration verification',
    'system',
    '{"purpose":"vehicle_registration","privacy":"PRIVATE_VERIFICATION","provider_agnostic":true}'::jsonb,
    'active'
  ),
  (
    'verification.vehicle.insurance',
    'Vehicle insurance verification',
    'system',
    '{"purpose":"vehicle_insurance","privacy":"PRIVATE_VERIFICATION","provider_agnostic":true}'::jsonb,
    'active'
  ),
  (
    'verification.vehicle.roadworthiness',
    'Vehicle roadworthiness verification',
    'system',
    '{"purpose":"vehicle_roadworthiness","privacy":"PRIVATE_VERIFICATION","provider_agnostic":true}'::jsonb,
    'active'
  )
on conflict (key) do update
set display_name = excluded.display_name,
    verification_mode = excluded.verification_mode,
    schema = public.verification_definitions.schema || excluded.schema,
    status = 'active',
    updated_at = timezone('utc', now());

create table if not exists public.verification_provider_routes (
  id uuid primary key default gen_random_uuid(),
  verification_definition_id uuid not null
    references public.verification_definitions(id) on delete cascade,
  provider_adapter_id uuid not null
    references public.provider_adapters(id) on delete restrict,
  workflow_ref text,
  priority integer not null default 100 check (priority between 0 and 10000),
  status text not null default 'inactive'
    check (status in ('inactive','active','paused','retired')),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (verification_definition_id, provider_adapter_id)
);

create index if not exists verification_provider_routes_active_idx
  on public.verification_provider_routes (verification_definition_id, status, priority);

create table if not exists public.application_verification_requirements (
  id uuid primary key default gen_random_uuid(),
  application_type_id uuid not null
    references public.application_type_definitions(id) on delete cascade,
  verification_definition_id uuid not null
    references public.verification_definitions(id) on delete restrict,
  is_required boolean not null default true,
  manual_fallback_allowed boolean not null default true,
  satisfies_document_keys text[] not null default '{}',
  priority integer not null default 100 check (priority between 0 and 10000),
  status text not null default 'active'
    check (status in ('draft','active','retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (application_type_id, verification_definition_id)
);

create index if not exists application_verification_requirements_type_idx
  on public.application_verification_requirements (application_type_id, status, priority);

create table if not exists public.application_verification_sessions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null
    references public.application_records(id) on delete cascade,
  application_verification_requirement_id uuid not null
    references public.application_verification_requirements(id) on delete restrict,
  applicant_user_id uuid not null references public.profiles(id) on delete cascade,
  provider_adapter_id uuid references public.provider_adapters(id) on delete set null,
  provider_session_id text,
  verification_url text,
  status text not null default 'created'
    check (status in (
      'created','pending','in_progress','passed','failed','manual_review','expired','cancelled'
    )),
  provider_status text,
  result_summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(result_summary) = 'object'),
  failure_code text,
  failure_message text,
  started_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  source text not null default 'skima.verification_runtime'
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create index if not exists application_verification_sessions_application_idx
  on public.application_verification_sessions (application_id, status, created_at desc);
create index if not exists application_verification_sessions_provider_idx
  on public.application_verification_sessions (provider_adapter_id, provider_session_id)
  where provider_session_id is not null;

-- Only the applicant and authorized application/verification administrators can
-- read normalized session state. Provider raw responses and secrets never live here.
alter table public.verification_provider_routes enable row level security;
alter table public.application_verification_requirements enable row level security;
alter table public.application_verification_sessions enable row level security;

drop policy if exists verification_provider_routes_read_admin on public.verification_provider_routes;
create policy verification_provider_routes_read_admin
on public.verification_provider_routes
for select to authenticated
using (
  public.has_permission('platform.verification.read', null)
  or public.has_permission('platform.verification.manage', null)
  or public.can_review_applications()
);

drop policy if exists application_verification_requirements_read_authenticated
  on public.application_verification_requirements;
create policy application_verification_requirements_read_authenticated
on public.application_verification_requirements
for select to authenticated
using (true);

drop policy if exists application_verification_sessions_read_owner_or_admin
  on public.application_verification_sessions;
create policy application_verification_sessions_read_owner_or_admin
on public.application_verification_sessions
for select to authenticated
using (
  applicant_user_id = auth.uid()
  or public.can_review_applications()
  or public.has_permission('platform.verification.read', null)
  or public.has_permission('platform.verification.manage', null)
);

-- Sessions are created/updated only by the verification runtime (service role).
revoke insert, update, delete on public.application_verification_sessions from authenticated;
revoke insert, update, delete on public.verification_provider_routes from authenticated;
revoke insert, update, delete on public.application_verification_requirements from authenticated;

-- Initial Didit routes are deliberately inactive. Activation is configuration,
-- not a mobile deployment. workflow_ref is a non-secret hosted workflow id.
insert into public.verification_provider_routes (
  verification_definition_id,
  provider_adapter_id,
  workflow_ref,
  priority,
  status,
  config
)
select
  definition.id,
  provider.id,
  null,
  route_seed.priority,
  'inactive',
  jsonb_build_object(
    'provider_operation', route_seed.provider_operation,
    'manual_fallback_when_unavailable', true
  )
from (
  values
    ('verification.person.identity', 10, 'identity'),
    ('verification.business.registry', 20, 'business')
) as route_seed(verification_key, priority, provider_operation)
join public.verification_definitions definition
  on definition.key = route_seed.verification_key
join public.provider_adapters provider
  on provider.key = 'provider.verification.didit'
 and provider.provider_kind = 'verification'
on conflict (verification_definition_id, provider_adapter_id) do nothing;

-- Map verification checks to existing LPG application types. A passed verification
-- can satisfy the listed document requirement without fabricating a document.
with mapping_seed(
  application_type_key,
  verification_key,
  is_required,
  manual_fallback_allowed,
  satisfies_document_keys,
  priority,
  metadata
) as (
  values
    (
      'application.lpg.driver.phase-one',
      'verification.person.identity',
      true,
      true,
      array['driver.identity']::text[],
      10,
      '{"step":"identity","customer_copy":"Verify your identity and liveness"}'::jsonb
    ),
    (
      'application.lpg.driver.phase-one',
      'verification.driver.licence',
      true,
      true,
      array['driver.licence']::text[],
      20,
      '{"step":"licence","customer_copy":"Verify your driver licence"}'::jsonb
    ),
    (
      'application.lpg.station.phase-one',
      'verification.person.identity',
      true,
      true,
      array['station.owner-identity','station.representative-identity']::text[],
      10,
      '{"step":"representative","customer_copy":"Verify the person registering this station"}'::jsonb
    ),
    (
      'application.lpg.station.phase-one',
      'verification.business.registry',
      true,
      true,
      array['station.business-registration']::text[],
      20,
      '{"step":"business","customer_copy":"Verify the registered business"}'::jsonb
    ),
    (
      'application.lpg.station.phase-one',
      'verification.station.authority',
      true,
      true,
      array['station.authority-evidence']::text[],
      30,
      '{"step":"authority","required_when":{"path":"authority.role","operator":"not_equals","value":"owner"},"customer_copy":"Confirm authority to register this station"}'::jsonb
    ),
    (
      'application.lpg.vehicle.phase-one',
      'verification.vehicle.registration',
      true,
      true,
      array['vehicle.registration']::text[],
      10,
      '{"step":"vehicle","customer_copy":"Verify vehicle registration"}'::jsonb
    ),
    (
      'application.lpg.vehicle.phase-one',
      'verification.vehicle.insurance',
      true,
      true,
      array['vehicle.insurance']::text[],
      20,
      '{"step":"vehicle","customer_copy":"Verify vehicle insurance"}'::jsonb
    ),
    (
      'application.lpg.vehicle.phase-one',
      'verification.vehicle.roadworthiness',
      true,
      true,
      array['vehicle.roadworthiness']::text[],
      30,
      '{"step":"vehicle","customer_copy":"Verify roadworthiness"}'::jsonb
    )
)
insert into public.application_verification_requirements (
  application_type_id,
  verification_definition_id,
  is_required,
  manual_fallback_allowed,
  satisfies_document_keys,
  priority,
  status,
  metadata
)
select
  application_type.id,
  definition.id,
  seed.is_required,
  seed.manual_fallback_allowed,
  seed.satisfies_document_keys,
  seed.priority,
  'active',
  seed.metadata
from mapping_seed seed
join public.application_type_definitions application_type
  on application_type.key = seed.application_type_key
join public.verification_definitions definition
  on definition.key = seed.verification_key
on conflict (application_type_id, verification_definition_id) do update
set is_required = excluded.is_required,
    manual_fallback_allowed = excluded.manual_fallback_allowed,
    satisfies_document_keys = excluded.satisfies_document_keys,
    priority = excluded.priority,
    status = 'active',
    metadata = public.application_verification_requirements.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

-- Reduce redundant evidence. These changes remove duplicate paperwork; they do not
-- relax vehicle or LPG facility safety/regulatory requirements.
update public.document_requirements requirement
set is_required = false,
    review_required = false,
    min_count = 0,
    metadata = requirement.metadata || jsonb_build_object(
      'replaced_by', 'identity_location_runtime',
      'minimal_onboarding', true
    ),
    updated_at = timezone('utc', now())
where requirement.key = 'driver.address-evidence'
  and requirement.requirement_set_id = (
    select id from public.document_requirement_sets
    where key = 'documents.lpg.driver.phase-one'
  );

update public.document_requirements requirement
set review_required = false,
    metadata = requirement.metadata || jsonb_build_object(
      'review_mode', 'profile_media_runtime',
      'minimal_onboarding', true
    ),
    updated_at = timezone('utc', now())
where requirement.key = 'driver.profile-photo'
  and requirement.requirement_set_id = (
    select id from public.document_requirement_sets
    where key = 'documents.lpg.driver.phase-one'
  );

update public.document_requirements requirement
set is_required = false,
    review_required = false,
    min_count = 0,
    metadata = requirement.metadata || jsonb_build_object(
      'replaced_by', 'verified_payout_beneficiary',
      'minimal_onboarding', true
    ),
    updated_at = timezone('utc', now())
where requirement.key = 'station.settlement-evidence'
  and requirement.requirement_set_id = (
    select id from public.document_requirement_sets
    where key = 'documents.lpg.station.phase-one'
  );

update public.document_requirements requirement
set is_required = false,
    review_required = false,
    min_count = 0,
    metadata = requirement.metadata || jsonb_build_object(
      'replaced_by', 'identity_liveness_verification',
      'minimal_onboarding', true
    ),
    updated_at = timezone('utc', now())
where requirement.key = 'station.representative-photo'
  and requirement.requirement_set_id = (
    select id from public.document_requirement_sets
    where key = 'documents.lpg.station.phase-one'
  );

-- Three operational station views remain mandatory: front, dispensing area and
-- tank/infrastructure. Entrance, compound and signboard become useful optional media.
update public.document_requirements requirement
set is_required = false,
    review_required = false,
    min_count = 0,
    metadata = requirement.metadata || jsonb_build_object(
      'minimal_onboarding_optional', true
    ),
    updated_at = timezone('utc', now())
where requirement.key in (
  'station.photo.entrance',
  'station.photo.compound',
  'station.photo.signboard'
)
  and requirement.requirement_set_id = (
    select id from public.document_requirement_sets
    where key = 'documents.lpg.station.phase-one'
  );

-- Customer ordering remains low-friction. Verification is step-up/configuration
-- driven for future high-risk capabilities rather than imposed on every LPG customer.
insert into public.configuration_entries (
  namespace,
  key,
  scope_type,
  scope_id,
  value,
  is_secret,
  status,
  version,
  effective_from
)
select
  'platform.verification',
  'customer_risk_policy',
  'global',
  null,
  jsonb_build_object(
    'require_identity_for_lpg_order', false,
    'require_identity_for_standard_customer_account', false,
    'step_up_for_regulated_or_high_risk_capabilities', true,
    'withdrawal_identity_policy', 'provider_and_risk_driven'
  ),
  false,
  'active',
  1,
  timezone('utc', now())
where not exists (
  select 1
  from public.configuration_entries entry
  where entry.namespace = 'platform.verification'
    and entry.key = 'customer_risk_policy'
    and entry.scope_type = 'global'
    and entry.scope_id is null
);

create or replace function public.application_verification_mapping_applies(
  target_mapping_id uuid,
  target_application_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  mapping_record public.application_verification_requirements%rowtype;
  application_record public.application_records%rowtype;
  payload jsonb := '{}'::jsonb;
begin
  select * into mapping_record
  from public.application_verification_requirements
  where id = target_mapping_id
    and status = 'active';

  if not found then return false; end if;

  select * into application_record
  from public.application_records
  where id = target_application_id;

  if not found
     or application_record.application_type_id <> mapping_record.application_type_id then
    return false;
  end if;

  select coalesce(version.payload, '{}'::jsonb)
  into payload
  from public.application_versions version
  where version.application_id = target_application_id
    and version.version = application_record.active_version;

  return public.application_requirement_applies(mapping_record.metadata, coalesce(payload, '{}'::jsonb));
end;
$$;

create or replace function public.application_verification_has_passed(
  target_application_id uuid,
  target_mapping_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.application_verification_sessions session
    where session.application_id = target_application_id
      and session.application_verification_requirement_id = target_mapping_id
      and session.status = 'passed'
  );
$$;

create or replace function public.application_document_requirement_satisfied(
  target_application_id uuid,
  target_requirement_id uuid,
  require_approved boolean default false
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  requirement_record public.document_requirements%rowtype;
  application_record public.application_records%rowtype;
  application_payload jsonb := '{}'::jsonb;
  ready_document_count integer := 0;
begin
  select * into requirement_record
  from public.document_requirements
  where id = target_requirement_id
    and status = 'active';

  if not found then return false; end if;
  if requirement_record.min_count = 0 then return true; end if;

  select * into application_record
  from public.application_records
  where id = target_application_id;

  if not found then return false; end if;

  select coalesce(version.payload, '{}'::jsonb)
  into application_payload
  from public.application_versions version
  where version.application_id = target_application_id
    and version.version = application_record.active_version;

  if not public.application_requirement_applies(
    requirement_record.metadata,
    coalesce(application_payload, '{}'::jsonb)
  ) then
    return true;
  end if;

  select count(*)
  into ready_document_count
  from public.document_submissions document
  where document.application_id = target_application_id
    and document.requirement_id = target_requirement_id
    and (
      (require_approved and document.status = 'approved')
      or (
        not require_approved
        and document.status in ('uploaded','submitted','under_review','approved')
      )
    );

  if ready_document_count >= requirement_record.min_count then
    return true;
  end if;

  return exists (
    select 1
    from public.application_verification_requirements mapping
    where mapping.application_type_id = application_record.application_type_id
      and mapping.status = 'active'
      and requirement_record.key = any(mapping.satisfies_document_keys)
      and public.application_verification_mapping_applies(mapping.id, target_application_id)
      and public.application_verification_has_passed(target_application_id, mapping.id)
  );
end;
$$;

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
      true as active_route,
      provider.display_name as provider_display_name
    from public.verification_provider_routes provider_route
    join public.provider_adapters provider
      on provider.id = provider_route.provider_adapter_id
     and provider.provider_kind = 'verification'
     and provider.status = 'active'
    where provider_route.verification_definition_id = mapping.verification_definition_id
      and provider_route.status = 'active'
      and nullif(btrim(provider_route.workflow_ref), '') is not null
    order by provider_route.priority, provider_route.created_at
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

revoke all on function public.read_application_verification_status(uuid) from public, anon;
grant execute on function public.read_application_verification_status(uuid)
  to authenticated, service_role;

-- Required evidence at submission can now be satisfied either by a real uploaded
-- document or by a passed configured verification that explicitly replaces it.
create or replace function public.submit_application(
  target_application_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application_record record;
  application_type_record record;
  application_payload jsonb;
  missing_required_count integer;
  missing_required_field_count integer;
  missing_required_field_labels text;
  submit_event_key text;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;
  if target_application_id is null then raise exception 'target_application_id is required'; end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then raise exception 'target_idempotency_key is required'; end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then raise exception 'target_metadata must be a JSON object'; end if;

  select app.* into application_record
  from public.application_records app
  where app.id = target_application_id
  for update;
  if not found then raise exception 'target_application_id must reference an existing application'; end if;

  if auth.role() <> 'service_role'
    and application_record.applicant_user_id <> auth.uid()
    and not public.can_manage_applications() then
    raise exception 'only the applicant can submit this application';
  end if;

  if application_record.status not in ('draft','incomplete','additional_info_required') then
    raise exception 'application cannot be submitted in the current state';
  end if;

  select application_type.* into application_type_record
  from public.application_type_definitions application_type
  where application_type.id = application_record.application_type_id;

  if auth.role() <> 'service_role'
    and application_type_record.application_category in ('driver','business')
    and not public.link_current_policy_acceptance_to_application(
      'policy.partner.participation',
      target_application_id,
      application_type_record.key
    ) then
    raise exception using errcode = '55000',
      message = 'review and accept the current SKIMA Partner Participation Terms before submitting this application';
  end if;

  select coalesce(version.payload, '{}'::jsonb)
  into application_payload
  from public.application_versions version
  where version.application_id = target_application_id
    and version.version = application_record.active_version;
  application_payload := coalesce(application_payload, '{}'::jsonb);

  select count(*),
         string_agg(
           coalesce(field_definition ->> 'label', field_definition ->> 'path'),
           ', ' order by field_definition ->> 'path'
         )
  into missing_required_field_count, missing_required_field_labels
  from jsonb_array_elements(
    case
      when jsonb_typeof(application_type_record.metadata -> 'submission_required_fields') = 'array'
        then application_type_record.metadata -> 'submission_required_fields'
      else '[]'::jsonb
    end
  ) field_definition
  where nullif(
    btrim(coalesce(
      application_payload #>> string_to_array(field_definition ->> 'path', '.'),
      ''
    )),
    ''
  ) is null;

  if missing_required_field_count > 0 then
    raise exception 'required application fields are missing: %', missing_required_field_labels;
  end if;

  select count(*)
  into missing_required_count
  from public.document_requirements requirement
  where requirement.requirement_set_id = application_type_record.document_requirement_set_id
    and requirement.status = 'active'
    and requirement.is_required
    and public.application_requirement_applies(requirement.metadata, application_payload)
    and not public.application_document_requirement_satisfied(
      target_application_id,
      requirement.id,
      false
    );

  if missing_required_count > 0 then
    raise exception 'required verification or fallback evidence is missing';
  end if;

  update public.application_versions
  set status = 'submitted',
      locked_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where application_id = target_application_id
    and version = application_record.active_version;

  update public.document_submissions
  set status = case when status = 'uploaded' then 'submitted' else status end,
      submitted_at = coalesce(submitted_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where application_id = target_application_id;

  submit_event_key := case
    when application_record.status = 'additional_info_required'
      then 'event.application.resubmitted'
    else 'event.application.submitted'
  end;

  perform public.advance_application_record_state(
    target_application_id,
    submit_event_key,
    target_metadata || jsonb_build_object('verification_engine', 'automatic_first'),
    target_idempotency_key
  );

  update public.application_records
  set locked_at = timezone('utc', now()),
      submitted_at = coalesce(submitted_at, timezone('utc', now())),
      metadata = metadata || jsonb_build_object(
        'verification_engine', 'automatic_first',
        'verification_reconciliation_pending', true
      ),
      updated_at = timezone('utc', now())
  where id = target_application_id;

  insert into public.application_review_tasks (
    application_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    target_application_id,
    'open',
    target_idempotency_key || ':review-task',
    target_metadata || jsonb_build_object('exception_first', true)
  )
  on conflict do nothing;

  return target_application_id;
end;
$$;

-- Final approval also accepts a passed automatic verification in place of
-- manually approving a document that the verification explicitly satisfies.
create or replace function public.decide_application_review(
  target_application_id uuid,
  target_decision text,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application_record record;
  application_type_record record;
  application_payload jsonb;
  missing_review_count integer;
  missing_review_labels text;
  event_type_key text;
  review_task_id uuid;
begin
  if auth.role() <> 'service_role' and not public.can_review_applications() then
    raise exception 'application review permission is required';
  end if;
  if target_application_id is null then raise exception 'target_application_id is required'; end if;
  if target_decision not in ('approved','rejected','suspended','reactivated') then raise exception 'target_decision is not supported'; end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then raise exception 'target_idempotency_key is required'; end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then raise exception 'target_metadata must be a JSON object'; end if;

  select app.* into application_record
  from public.application_records app
  where app.id = target_application_id
  for update;
  if not found then raise exception 'target_application_id must reference an existing application'; end if;

  select app_type.* into application_type_record
  from public.application_type_definitions app_type
  where app_type.id = application_record.application_type_id;
  if not found then raise exception 'application type definition was not found'; end if;

  select coalesce(version.payload, '{}'::jsonb)
  into application_payload
  from public.application_versions version
  where version.application_id = target_application_id
    and version.version = application_record.active_version;
  application_payload := coalesce(application_payload, '{}'::jsonb);

  if target_decision in ('approved','rejected') and application_record.status <> 'under_review' then
    raise exception 'application approval decisions require under_review state';
  end if;
  if target_decision = 'suspended' and application_record.status <> 'approved' then
    raise exception 'only approved applications can be suspended';
  end if;
  if target_decision = 'reactivated' and application_record.status <> 'suspended' then
    raise exception 'only suspended applications can be reactivated';
  end if;

  if target_decision = 'approved' then
    select count(*),
           string_agg(requirement.display_name, ', ' order by requirement.display_name)
    into missing_review_count, missing_review_labels
    from public.document_requirements requirement
    where requirement.requirement_set_id = application_type_record.document_requirement_set_id
      and requirement.status = 'active'
      and requirement.review_required
      and public.application_requirement_applies(requirement.metadata, application_payload)
      and not public.application_document_requirement_satisfied(
        target_application_id,
        requirement.id,
        true
      );

    if missing_review_count > 0 then
      raise exception 'required manual checks are incomplete: %',
        coalesce(missing_review_labels, 'review incomplete');
    end if;
  end if;

  event_type_key := case target_decision
    when 'approved' then 'event.application.approved'
    when 'rejected' then 'event.application.rejected'
    when 'suspended' then 'event.application.suspended'
    when 'reactivated' then 'event.application.reactivated'
  end;

  perform public.advance_application_record_state(
    target_application_id,
    event_type_key,
    target_metadata || jsonb_build_object('reason', target_reason),
    target_idempotency_key || ':workflow'
  );

  select task.id into review_task_id
  from public.application_review_tasks task
  where task.application_id = target_application_id
    and task.status in ('open','assigned','correction_requested')
  order by task.created_at desc
  limit 1;

  if review_task_id is not null then
    update public.application_review_tasks
    set status = case
          when target_decision = 'approved' then 'approved'
          when target_decision = 'rejected' then 'rejected'
          else status
        end,
        metadata = metadata || target_metadata,
        updated_at = timezone('utc', now())
    where id = review_task_id;
  end if;

  insert into public.application_review_events (
    application_id,
    review_task_id,
    reviewer_user_id,
    decision,
    internal_notes,
    applicant_message,
    idempotency_key,
    metadata
  )
  values (
    target_application_id,
    review_task_id,
    auth.uid(),
    target_decision,
    target_reason,
    case when target_decision in ('approved','rejected') then target_reason else null end,
    target_idempotency_key,
    target_metadata
  )
  on conflict do nothing;

  if target_decision in ('approved','reactivated')
     and application_type_record.application_category = 'vehicle' then
    perform public.activate_approved_application(target_application_id);

    update public.application_records
    set operational_status = 'active',
        activated_at = coalesce(activated_at, timezone('utc', now())),
        activated_by = coalesce(activated_by, auth.uid()),
        metadata = metadata - 'verification_reconciliation_pending',
        updated_at = timezone('utc', now())
    where id = target_application_id;
  elsif target_decision = 'approved' then
    update public.application_records
    set operational_status = 'pending',
        activated_at = null,
        activated_by = null,
        metadata = (metadata - 'verification_reconciliation_pending')
          || jsonb_build_object(
            'verification_decision_source',
            coalesce(target_metadata ->> 'decision_source', 'admin')
          ),
        updated_at = timezone('utc', now())
    where id = target_application_id;
  elsif target_decision = 'suspended' then
    update public.application_records
    set operational_status = 'suspended',
        updated_at = timezone('utc', now())
    where id = target_application_id;
  elsif target_decision = 'reactivated' then
    update public.application_records
    set operational_status = case
          when application_type_record.application_category = 'vehicle' then 'active'
          else 'pending'
        end,
        updated_at = timezone('utc', now())
    where id = target_application_id;
  end if;

  return target_application_id;
end;
$$;

create or replace function public.reconcile_application_verification(
  target_application_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  application_record record;
  application_type_record record;
  application_payload jsonb := '{}'::jsonb;
  unresolved_verification_count integer := 0;
  manual_review_count integer := 0;
  auto_decided boolean := false;
begin
  if auth.role() <> 'service_role'
     and not public.has_permission('platform.verification.manage', null)
     and not public.can_review_applications() then
    raise exception using errcode = '42501',
      message = 'verification reconciliation permission is required';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select app.* into application_record
  from public.application_records app
  where app.id = target_application_id
  for update;
  if not found then raise exception 'application not found'; end if;

  select app_type.* into application_type_record
  from public.application_type_definitions app_type
  where app_type.id = application_record.application_type_id;

  select coalesce(version.payload, '{}'::jsonb)
  into application_payload
  from public.application_versions version
  where version.application_id = target_application_id
    and version.version = application_record.active_version;

  select count(*)
  into unresolved_verification_count
  from public.application_verification_requirements mapping
  where mapping.application_type_id = application_record.application_type_id
    and mapping.status = 'active'
    and mapping.is_required
    and public.application_verification_mapping_applies(mapping.id, target_application_id)
    and not public.application_verification_has_passed(target_application_id, mapping.id)
    and not (
      mapping.manual_fallback_allowed
      and exists (
        select 1
        from public.document_requirements requirement
        where requirement.requirement_set_id = application_type_record.document_requirement_set_id
          and requirement.status = 'active'
          and requirement.key = any(mapping.satisfies_document_keys)
          and public.application_requirement_applies(requirement.metadata, application_payload)
      )
      and not exists (
        select 1
        from public.document_requirements requirement
        where requirement.requirement_set_id = application_type_record.document_requirement_set_id
          and requirement.status = 'active'
          and requirement.key = any(mapping.satisfies_document_keys)
          and public.application_requirement_applies(requirement.metadata, application_payload)
          and not public.application_document_requirement_satisfied(
            target_application_id,
            requirement.id,
            true
          )
      )
    );

  select count(*)
  into manual_review_count
  from public.document_requirements requirement
  where requirement.requirement_set_id = application_type_record.document_requirement_set_id
    and requirement.status = 'active'
    and requirement.review_required
    and public.application_requirement_applies(requirement.metadata, application_payload)
    and not public.application_document_requirement_satisfied(
      target_application_id,
      requirement.id,
      true
    );

  if application_record.status in ('submitted','resubmitted','under_review')
     and unresolved_verification_count = 0
     and manual_review_count = 0 then

    if application_record.status in ('submitted','resubmitted') then
      perform public.advance_application_record_state(
        target_application_id,
        'event.application.review.started',
        jsonb_build_object(
          'decision_source', 'automated_verification',
          'system_review', true
        ),
        target_idempotency_key || ':review-start'
      );
    end if;

    perform public.decide_application_review(
      target_application_id,
      'approved',
      'Required SKIMA verification checks passed automatically.',
      target_idempotency_key || ':decision',
      jsonb_build_object(
        'decision_source', 'automated_verification',
        'system_review', true
      )
    );

    auto_decided := true;

    perform public.queue_communication_message(
      'in_app',
      'application.verified',
      'profile',
      application_record.applicant_user_id,
      null,
      jsonb_build_object(
        'title', 'Verification complete',
        'body', 'Your required SKIMA verification checks passed. Any separate operational activation steps will continue automatically or through SKIMA Operations.',
        'category', 'partner',
        'applicationId', target_application_id
      ),
      'provider.communication.sandbox',
      'skima.verification_runtime',
      target_idempotency_key || ':notification',
      jsonb_build_object('automated_verification', true)
    );
  else
    update public.application_records
    set metadata = metadata || jsonb_build_object(
          'verification_reconciliation_pending', true,
          'verification_unresolved_count', unresolved_verification_count,
          'verification_manual_review_count', manual_review_count
        ),
        updated_at = timezone('utc', now())
    where id = target_application_id;
  end if;

  return jsonb_build_object(
    'applicationId', target_application_id,
    'autoDecided', auto_decided,
    'unresolvedVerificationCount', unresolved_verification_count,
    'manualReviewCount', manual_review_count
  );
end;
$$;

revoke all on function public.reconcile_application_verification(uuid, text)
  from public, anon, authenticated;
grant execute on function public.reconcile_application_verification(uuid, text)
  to service_role;

create or replace function public.read_verification_provider_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role'
     and not public.has_permission('platform.verification.read', null)
     and not public.has_permission('platform.verification.manage', null)
     and not public.can_review_applications() then
    raise exception using errcode = '42501',
      message = 'verification configuration read permission is required';
  end if;

  select jsonb_build_object(
    'definitions',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', definition.id,
          'key', definition.key,
          'displayName', definition.display_name,
          'verificationMode', definition.verification_mode,
          'status', definition.status,
          'schema', definition.schema
        )
        order by definition.display_name
      )
      from public.verification_definitions definition
      where definition.status = 'active'
    ), '[]'::jsonb),
    'providers',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', provider.id,
          'key', provider.key,
          'displayName', provider.display_name,
          'status', provider.status,
          'secretRef', provider.secret_ref,
          'config', provider.config
        )
        order by provider.display_name
      )
      from public.provider_adapters provider
      where provider.provider_kind = 'verification'
    ), '[]'::jsonb),
    'routes',
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', route.id,
          'verificationKey', definition.key,
          'verificationDisplayName', definition.display_name,
          'verificationMode', definition.verification_mode,
          'providerKey', provider.key,
          'providerDisplayName', provider.display_name,
          'providerStatus', provider.status,
          'workflowRef', route.workflow_ref,
          'priority', route.priority,
          'status', route.status,
          'config', route.config
        )
        order by definition.display_name, route.priority
      )
      from public.verification_provider_routes route
      join public.verification_definitions definition
        on definition.id = route.verification_definition_id
      join public.provider_adapters provider
        on provider.id = route.provider_adapter_id
      where route.status <> 'retired'
    ), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

revoke all on function public.read_verification_provider_configuration()
  from public, anon;
grant execute on function public.read_verification_provider_configuration()
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
      config = public.verification_provider_routes.config || excluded.config,
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
      'priority', target_priority
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

create or replace function public.read_verification_exception_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role'
     and not public.can_review_applications()
     and not public.has_permission('platform.verification.read', null)
     and not public.has_permission('platform.verification.manage', null) then
    raise exception using errcode = '42501',
      message = 'verification review permission is required';
  end if;

  select coalesce(jsonb_agg(item order by item ->> 'updatedAt' desc), '[]'::jsonb)
  into result
  from (
    select jsonb_build_object(
      'applicationId', application.id,
      'publicReference', application.public_reference,
      'applicationStatus', application.status,
      'operationalStatus', application.operational_status,
      'applicationTypeKey', application_type.key,
      'applicationCategory', application_type.application_category,
      'applicantUserId', application.applicant_user_id,
      'applicantName', profile.display_name,
      'unresolvedVerificationCount',
        coalesce((application.metadata ->> 'verification_unresolved_count')::integer, 0),
      'manualReviewCount',
        coalesce((application.metadata ->> 'verification_manual_review_count')::integer, 0),
      'latestVerificationStatus', latest_verification.status,
      'latestVerificationKey', latest_verification.verification_key,
      'latestFailureMessage', latest_verification.failure_message,
      'updatedAt', application.updated_at
    ) as item
    from public.application_records application
    join public.application_type_definitions application_type
      on application_type.id = application.application_type_id
    left join public.profiles profile
      on profile.id = application.applicant_user_id
    left join lateral (
      select
        session.status,
        definition.key as verification_key,
        session.failure_message
      from public.application_verification_sessions session
      join public.application_verification_requirements mapping
        on mapping.id = session.application_verification_requirement_id
      join public.verification_definitions definition
        on definition.id = mapping.verification_definition_id
      where session.application_id = application.id
        and session.status in ('failed','manual_review','expired')
      order by session.updated_at desc
      limit 1
    ) latest_verification on true
    where application_type.key in (
      'application.lpg.driver.phase-one',
      'application.lpg.station.phase-one',
      'application.lpg.vehicle.phase-one'
    )
      and application.status in (
        'submitted','resubmitted','under_review','additional_info_required'
      )
      and (
        coalesce((application.metadata ->> 'verification_unresolved_count')::integer, 0) > 0
        or coalesce((application.metadata ->> 'verification_manual_review_count')::integer, 0) > 0
        or latest_verification.status is not null
      )
  ) queue;

  return result;
end;
$$;

revoke all on function public.read_verification_exception_queue()
  from public, anon;
grant execute on function public.read_verification_exception_queue()
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
