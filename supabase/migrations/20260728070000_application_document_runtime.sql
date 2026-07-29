begin;

insert into public.permissions (key, description, risk_level)
values
  ('platform.applications.read', 'Read governed platform application records.', 'high'),
  ('platform.applications.manage', 'Manage application runtime configuration and escalations.', 'critical'),
  ('platform.applications.review', 'Review submitted applications and approve or reject them.', 'critical'),
  ('platform.documents.read', 'Read governed document submission records.', 'high'),
  ('platform.documents.manage', 'Manage document requirement configuration.', 'critical'),
  ('platform.documents.review', 'Review uploaded documents and request corrections.', 'critical'),
  ('business.applications.manage', 'Manage organization applications for a business account.', 'high'),
  ('business.documents.manage', 'Manage organization document submissions.', 'high'),
  ('business.staff.manage', 'Manage organization staff invitations and access.', 'critical'),
  ('business.catalog.manage', 'Manage organization products, services, prices, and availability.', 'high'),
  ('business.orders.manage', 'Manage organization order operations.', 'high'),
  ('business.finance.read', 'Read organization financial and settlement records.', 'critical'),
  ('business.settlements.read', 'Read organization settlement statements.', 'critical')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
join public.permissions permission_record on permission_record.key in (
  'platform.applications.read',
  'platform.applications.review',
  'platform.documents.read',
  'platform.documents.review'
)
where role_record.key = 'platform.support_admin'
  and role_record.organization_id is null
on conflict do nothing;

update public.platform_admin_role_templates template
set permission_keys = (
      select coalesce(array_agg(distinct permission_key order by permission_key), '{}')
      from unnest(
        template.permission_keys || array[
          'platform.applications.read',
          'platform.applications.review',
          'platform.documents.read',
          'platform.documents.review'
        ]
      ) as permission_input(permission_key)
    ),
    updated_at = timezone('utc', now())
where template.key = 'platform.support_admin';

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  (
    'skima-platform-documents',
    'skima-platform-documents',
    false,
    52428800,
    array[
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp'
    ]
  ),
  (
    'skima-platform-media',
    'skima-platform-media',
    false,
    52428800,
    array[
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp'
    ]
  )
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

insert into public.provider_adapters (
  provider_kind,
  key,
  display_name,
  status,
  config,
  secret_ref
)
values (
  'storage',
  'provider.storage.supabase',
  'Supabase Storage',
  'active',
  jsonb_build_object(
    'buckets',
    jsonb_build_array('skima-platform-documents', 'skima-platform-media'),
    'access_model',
    'private-owner-path-or-document-admin'
  ),
  null
)
on conflict (provider_kind, key) do update
set display_name = excluded.display_name,
    status = excluded.status,
    config = excluded.config,
    secret_ref = excluded.secret_ref,
    updated_at = timezone('utc', now());

drop policy if exists storage_objects_skima_documents_select on storage.objects;
drop policy if exists storage_objects_skima_documents_insert on storage.objects;
drop policy if exists storage_objects_skima_documents_update on storage.objects;
drop policy if exists storage_objects_skima_documents_delete on storage.objects;

create policy storage_objects_skima_documents_select
on storage.objects
for select to authenticated
using (
  bucket_id in ('skima-platform-documents', 'skima-platform-media')
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.has_permission('platform.documents.read', null)
    or public.has_permission('platform.documents.review', null)
    or public.has_permission('platform.documents.manage', null)
  )
);

create policy storage_objects_skima_documents_insert
on storage.objects
for insert to authenticated
with check (
  bucket_id in ('skima-platform-documents', 'skima-platform-media')
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy storage_objects_skima_documents_update
on storage.objects
for update to authenticated
using (
  bucket_id in ('skima-platform-documents', 'skima-platform-media')
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.has_permission('platform.documents.manage', null)
  )
)
with check (
  bucket_id in ('skima-platform-documents', 'skima-platform-media')
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.has_permission('platform.documents.manage', null)
  )
);

create policy storage_objects_skima_documents_delete
on storage.objects
for delete to authenticated
using (
  bucket_id in ('skima-platform-documents', 'skima-platform-media')
  and public.has_permission('platform.documents.manage', null)
);

create table if not exists public.document_requirement_sets (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  subject_category text not null
    check (subject_category in ('business', 'driver', 'vehicle', 'organization', 'user', 'asset', 'generic')),
  module_id uuid references public.business_modules(id) on delete set null,
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.document_requirements (
  id uuid primary key default gen_random_uuid(),
  requirement_set_id uuid not null references public.document_requirement_sets(id) on delete cascade,
  key text not null
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  description text,
  is_required boolean not null default true,
  review_required boolean not null default true,
  min_count integer not null default 1 check (min_count >= 0),
  max_count integer check (max_count is null or max_count >= min_count),
  allowed_content_types text[] not null default '{}',
  max_byte_size bigint check (max_byte_size is null or max_byte_size > 0),
  expires_after_days integer check (expires_after_days is null or expires_after_days > 0),
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (requirement_set_id, key)
);

create table if not exists public.application_type_definitions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique
    check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  application_category text not null
    check (application_category in ('business', 'driver', 'vehicle', 'organization', 'user', 'asset', 'generic')),
  module_id uuid references public.business_modules(id) on delete set null,
  workflow_key text not null references public.workflow_definitions(key) on delete restrict,
  document_requirement_set_id uuid references public.document_requirement_sets(id) on delete set null,
  review_policy jsonb not null default '{}'::jsonb
    check (jsonb_typeof(review_policy) = 'object'),
  activation_policy jsonb not null default '{}'::jsonb
    check (jsonb_typeof(activation_policy) = 'object'),
  status text not null default 'active'
    check (status in ('draft', 'active', 'retired')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.application_records (
  id uuid primary key default gen_random_uuid(),
  application_type_id uuid not null references public.application_type_definitions(id) on delete restrict,
  applicant_user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  workflow_instance_id uuid references public.workflow_instances(id) on delete set null,
  assigned_reviewer_user_id uuid references public.profiles(id) on delete set null,
  active_version integer not null default 1 check (active_version > 0),
  status text not null default 'draft'
    check (status in (
      'draft',
      'incomplete',
      'submitted',
      'under_review',
      'additional_info_required',
      'resubmitted',
      'approved',
      'rejected',
      'suspended',
      'expired',
      'withdrawn'
    )),
  locked_at timestamptz,
  submitted_at timestamptz,
  decided_at timestamptz,
  approved_at timestamptz,
  rejected_at timestamptz,
  suspended_at timestamptz,
  withdrawn_at timestamptz,
  activated_subject_type text
    check (activated_subject_type is null or activated_subject_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  activated_subject_id uuid,
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key)
);

create table if not exists public.application_versions (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.application_records(id) on delete cascade,
  version integer not null check (version > 0),
  payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(payload) = 'object'),
  status text not null default 'draft'
    check (status in ('draft', 'submitted', 'superseded', 'archived')),
  locked_at timestamptz,
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (application_id, version),
  unique (application_id, idempotency_key)
);

create table if not exists public.application_review_tasks (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.application_records(id) on delete cascade,
  assigned_reviewer_user_id uuid references public.profiles(id) on delete set null,
  status text not null default 'open'
    check (status in ('open', 'assigned', 'correction_requested', 'approved', 'rejected', 'cancelled')),
  priority integer not null default 100 check (priority between 0 and 1000),
  due_at timestamptz,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (application_id, idempotency_key)
);

create table if not exists public.application_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.application_records(id) on delete cascade,
  event_type_key text references public.event_types(key) on delete set null,
  event_id uuid references public.event_log(id) on delete set null,
  from_status text,
  to_status text not null,
  actor_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  idempotency_key text not null,
  notes text,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (application_id, idempotency_key)
);

create table if not exists public.application_review_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.application_records(id) on delete cascade,
  review_task_id uuid references public.application_review_tasks(id) on delete set null,
  reviewer_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  decision text not null
    check (decision in ('assigned', 'correction_requested', 'approved', 'rejected', 'suspended', 'reactivated')),
  internal_notes text,
  applicant_message text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (application_id, idempotency_key)
);

create table if not exists public.document_submissions (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references public.document_requirements(id) on delete restrict,
  application_id uuid references public.application_records(id) on delete cascade,
  subject_type text not null
    check (subject_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  subject_id uuid not null,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  media_asset_id uuid not null references public.media_assets(id) on delete restrict,
  status text not null default 'uploaded'
    check (status in (
      'draft',
      'uploaded',
      'submitted',
      'under_review',
      'approved',
      'rejected',
      'correction_required',
      'expired',
      'withdrawn',
      'quarantined'
    )),
  storage_bucket text not null,
  storage_path text not null,
  content_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  checksum text,
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reviewer_user_id uuid references public.profiles(id) on delete set null,
  expires_at timestamptz,
  decision_reason text,
  source text not null
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, idempotency_key),
  unique (storage_bucket, storage_path)
);

create table if not exists public.document_review_events (
  id uuid primary key default gen_random_uuid(),
  document_submission_id uuid not null references public.document_submissions(id) on delete cascade,
  reviewer_user_id uuid references public.profiles(id) on delete set null default auth.uid(),
  decision text not null
    check (decision in ('under_review', 'approved', 'rejected', 'correction_required', 'quarantined')),
  internal_notes text,
  applicant_message text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (document_submission_id, idempotency_key)
);

create index if not exists document_requirements_set_idx
on public.document_requirements (requirement_set_id, status);

create index if not exists application_type_definitions_category_idx
on public.application_type_definitions (application_category, status);

create index if not exists application_records_applicant_idx
on public.application_records (applicant_user_id, status, created_at desc);

create index if not exists application_records_review_idx
on public.application_records (assigned_reviewer_user_id, status, created_at desc);

create index if not exists application_versions_application_idx
on public.application_versions (application_id, version desc);

create index if not exists application_review_tasks_reviewer_idx
on public.application_review_tasks (assigned_reviewer_user_id, status, created_at desc);

create index if not exists document_submissions_application_idx
on public.document_submissions (application_id, status, created_at desc);

create index if not exists document_submissions_owner_idx
on public.document_submissions (owner_user_id, status, created_at desc);

create or replace function public.can_review_applications()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.has_permission('platform.admin', null)
    or public.has_permission('platform.applications.review', null)
    or public.has_permission('platform.applications.manage', null)
    or public.has_permission('platform.documents.review', null)
    or public.has_permission('platform.support.manage', null);
$$;

create or replace function public.can_manage_applications()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.role() = 'service_role'
    or public.has_permission('platform.admin', null)
    or public.has_permission('platform.applications.manage', null);
$$;

create or replace function public.can_read_application_record(target_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.application_records application_record
    where application_record.id = target_application_id
      and (
        application_record.applicant_user_id = auth.uid()
        or application_record.assigned_reviewer_user_id = auth.uid()
        or (
          application_record.organization_id is not null
          and public.is_organization_member(application_record.organization_id)
        )
        or public.has_permission('platform.applications.read', null)
        or public.can_review_applications()
      )
  );
$$;

create or replace function public.can_read_document_submission(target_document_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.document_submissions document_record
    where document_record.id = target_document_submission_id
      and (
        document_record.owner_user_id = auth.uid()
        or (
          document_record.organization_id is not null
          and public.is_organization_member(document_record.organization_id)
        )
        or (
          document_record.application_id is not null
          and public.can_read_application_record(document_record.application_id)
        )
        or public.has_permission('platform.documents.read', null)
        or public.can_review_applications()
      )
  );
$$;

create or replace function public.prevent_application_runtime_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'application engine event records are append-only';
end;
$$;

create or replace function public.create_application_record(
  target_application_type_key text,
  target_payload jsonb,
  target_source text,
  target_idempotency_key text,
  target_applicant_user_id uuid default null,
  target_organization_id uuid default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  application_type_record record;
  workflow_record record;
  initial_state_count integer;
  initial_state_key text;
  actor_user_id uuid;
  application_id uuid;
  created_workflow_instance_id uuid;
  created_event_id uuid;
  existing_record record;
  existing_payload jsonb;
begin
  actor_user_id := coalesce(target_applicant_user_id, auth.uid());

  if auth.role() <> 'service_role'
    and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if actor_user_id is null then
    raise exception 'target_applicant_user_id is required';
  end if;

  if auth.role() <> 'service_role'
    and target_applicant_user_id is not null
    and target_applicant_user_id <> auth.uid()
    and not public.can_manage_applications() then
    raise exception 'applications can only be created for the current user';
  end if;

  if target_application_type_key is null
    or target_application_type_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_application_type_key must be a valid platform key';
  end if;

  if target_payload is null
    or jsonb_typeof(target_payload) <> 'object'
    or target_payload = '{}'::jsonb then
    raise exception 'target_payload must be a non-empty JSON object';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select application_type.*
  into application_type_record
  from public.application_type_definitions application_type
  where application_type.key = target_application_type_key
    and application_type.status = 'active';

  if not found then
    raise exception 'target_application_type_key must reference an active application type';
  end if;

  select existing.*
  into existing_record
  from public.application_records existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    select application_version.payload
    into existing_payload
    from public.application_versions application_version
    where application_version.application_id = existing_record.id
      and application_version.version = existing_record.active_version;

    if existing_record.application_type_id <> application_type_record.id
      or existing_record.applicant_user_id <> actor_user_id
      or existing_record.organization_id is distinct from target_organization_id
      or existing_payload <> target_payload then
      raise exception 'target_idempotency_key has already been used with different application details';
    end if;

    return existing_record.id;
  end if;

  select workflow_version.id as workflow_version_id
  into workflow_record
  from public.workflow_definitions workflow_definition
  join public.workflow_versions workflow_version on workflow_version.workflow_id = workflow_definition.id
  where workflow_definition.key = application_type_record.workflow_key
    and workflow_definition.status = 'active'
    and workflow_version.status = 'active'
  order by workflow_version.version desc
  limit 1;

  if not found then
    raise exception 'application type workflow must reference an active workflow version';
  end if;

  select count(*), min(workflow_state.key)
  into initial_state_count, initial_state_key
  from public.workflow_states workflow_state
  where workflow_state.workflow_version_id = workflow_record.workflow_version_id
    and workflow_state.state_type = 'initial';

  if initial_state_count <> 1 then
    raise exception 'application workflow must define exactly one initial state';
  end if;

  insert into public.application_records (
    application_type_id,
    applicant_user_id,
    organization_id,
    active_version,
    status,
    source,
    idempotency_key,
    metadata,
    created_by
  )
  values (
    application_type_record.id,
    actor_user_id,
    target_organization_id,
    1,
    initial_state_key,
    target_source,
    target_idempotency_key,
    target_metadata,
    auth.uid()
  )
  returning id into application_id;

  insert into public.application_versions (
    application_id,
    version,
    payload,
    status,
    idempotency_key,
    created_by
  )
  values (
    application_id,
    1,
    target_payload,
    'draft',
    target_idempotency_key || ':version:1',
    auth.uid()
  );

  insert into public.workflow_instances (
    workflow_version_id,
    current_state_key,
    subject_type,
    subject_id,
    status,
    context,
    started_by,
    source,
    idempotency_key
  )
  values (
    workflow_record.workflow_version_id,
    initial_state_key,
    'application',
    application_id,
    'running',
    target_metadata || jsonb_build_object('application_type_key', target_application_type_key),
    auth.uid(),
    'platform.application_engine',
    target_idempotency_key || ':workflow'
  )
  returning id into created_workflow_instance_id;

  update public.application_records
  set workflow_instance_id = created_workflow_instance_id,
      updated_at = timezone('utc', now())
  where id = application_id;

  created_event_id := public.record_platform_event(
    'event.application.created',
    'platform.application_engine',
    'application',
    application_id,
    target_metadata || jsonb_build_object('application_type_key', target_application_type_key),
    target_idempotency_key || ':created',
    timezone('utc', now())
  );

  insert into public.application_events (
    application_id,
    event_type_key,
    event_id,
    from_status,
    to_status,
    actor_user_id,
    idempotency_key,
    metadata
  )
  values (
    application_id,
    'event.application.created',
    created_event_id,
    null,
    initial_state_key,
    auth.uid(),
    target_idempotency_key || ':created',
    target_metadata
  );

  return application_id;
end;
$$;

create or replace function public.update_application_payload(
  target_application_id uuid,
  target_payload jsonb,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record record;
  next_version integer;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  if target_payload is null
    or jsonb_typeof(target_payload) <> 'object'
    or target_payload = '{}'::jsonb then
    raise exception 'target_payload must be a non-empty JSON object';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select application_record_table.*
  into application_record
  from public.application_records application_record_table
  where application_record_table.id = target_application_id
  for update;

  if not found then
    raise exception 'target_application_id must reference an existing application';
  end if;

  if auth.role() <> 'service_role'
    and application_record.applicant_user_id <> auth.uid()
    and not public.can_manage_applications() then
    raise exception 'only the applicant can update this application payload';
  end if;

  if application_record.status not in (
    'draft',
    'incomplete',
    'additional_info_required',
    'resubmitted'
  ) then
    raise exception 'application payload cannot be updated in the current state';
  end if;

  if exists (
    select 1
    from public.application_versions application_version
    where application_version.application_id = target_application_id
      and application_version.idempotency_key = target_idempotency_key
  ) then
    return target_application_id;
  end if;

  if application_record.locked_at is null then
    update public.application_versions
    set payload = target_payload,
        updated_at = timezone('utc', now())
    where application_id = target_application_id
      and version = application_record.active_version;
  else
    update public.application_versions
    set status = 'superseded',
        updated_at = timezone('utc', now())
    where application_id = target_application_id
      and version = application_record.active_version;

    next_version := application_record.active_version + 1;

    insert into public.application_versions (
      application_id,
      version,
      payload,
      status,
      idempotency_key,
      created_by
    )
    values (
      target_application_id,
      next_version,
      target_payload,
      'draft',
      target_idempotency_key,
      auth.uid()
    );

    update public.application_records
    set active_version = next_version,
        locked_at = null,
        updated_at = timezone('utc', now())
    where id = target_application_id;
  end if;

  insert into public.application_events (
    application_id,
    event_type_key,
    from_status,
    to_status,
    actor_user_id,
    idempotency_key,
    metadata
  )
  values (
    target_application_id,
    'event.application.updated',
    application_record.status,
    application_record.status,
    auth.uid(),
    target_idempotency_key || ':updated',
    target_metadata
  )
  on conflict do nothing;

  return target_application_id;
end;
$$;

create or replace function public.advance_application_record_state(
  target_application_id uuid,
  target_event_type_key text,
  target_payload jsonb default '{}'::jsonb,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record record;
  workflow_instance_record record;
  transition_record record;
  existing_application_event record;
  workflow_event_id uuid;
  next_workflow_status text;
  actor_scope text;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  if target_event_type_key is null
    or target_event_type_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_event_type_key must be a valid platform key';
  end if;

  if target_payload is null
    or jsonb_typeof(target_payload) <> 'object' then
    raise exception 'target_payload must be a JSON object';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select application_event.*
  into existing_application_event
  from public.application_events application_event
  where application_event.application_id = target_application_id
    and application_event.idempotency_key = target_idempotency_key;

  if found then
    if existing_application_event.event_type_key <> target_event_type_key then
      raise exception 'target_idempotency_key has already been used with a different application event';
    end if;

    return existing_application_event.event_id;
  end if;

  select application_record_table.*
  into application_record
  from public.application_records application_record_table
  where application_record_table.id = target_application_id
  for update;

  if not found then
    raise exception 'target_application_id must reference an existing application';
  end if;

  if application_record.workflow_instance_id is null then
    raise exception 'application workflow instance is missing';
  end if;

  select workflow_instance.*
  into workflow_instance_record
  from public.workflow_instances workflow_instance
  where workflow_instance.id = application_record.workflow_instance_id
  for update;

  if not found then
    raise exception 'application workflow instance must exist';
  end if;

  select
    transition.to_state_key,
    transition.action_policy_keys,
    transition.metadata,
    target_state.state_type
  into transition_record
  from public.workflow_transitions transition
  join public.workflow_states target_state
    on target_state.workflow_version_id = transition.workflow_version_id
    and target_state.key = transition.to_state_key
  where transition.workflow_version_id = workflow_instance_record.workflow_version_id
    and transition.from_state_key = workflow_instance_record.current_state_key
    and transition.event_type_key = target_event_type_key;

  if not found then
    raise exception 'no configured application workflow transition matches this event';
  end if;

  actor_scope := coalesce(transition_record.metadata ->> 'actor_scope', 'admin');

  if actor_scope = 'applicant'
    and auth.role() <> 'service_role'
    and application_record.applicant_user_id <> auth.uid()
    and not public.can_manage_applications() then
    raise exception 'only the applicant can perform this application transition';
  end if;

  if actor_scope = 'reviewer'
    and auth.role() <> 'service_role'
    and application_record.assigned_reviewer_user_id is distinct from auth.uid()
    and not public.can_review_applications() then
    raise exception 'application review permission is required';
  end if;

  if actor_scope = 'admin'
    and auth.role() <> 'service_role'
    and not public.can_manage_applications() then
    raise exception 'application management permission is required';
  end if;

  if actor_scope = 'system' and auth.role() <> 'service_role' then
    raise exception 'service-role execution is required for this application transition';
  end if;

  workflow_event_id := public.record_platform_event(
    target_event_type_key,
    'platform.application_engine',
    'application',
    target_application_id,
    target_payload,
    target_idempotency_key,
    timezone('utc', now())
  );

  next_workflow_status := case
    when transition_record.state_type = 'terminal' then 'completed'
    when transition_record.state_type = 'failure' then 'failed'
    else 'running'
  end;

  update public.workflow_instances
  set current_state_key = transition_record.to_state_key,
      status = next_workflow_status,
      completed_at = case
        when next_workflow_status in ('completed', 'failed') then timezone('utc', now())
        else completed_at
      end,
      updated_at = timezone('utc', now())
  where id = workflow_instance_record.id;

  update public.event_log
  set status = 'processed',
      processed_at = timezone('utc', now())
  where id = workflow_event_id
    and status in ('received', 'validated', 'processing');

  insert into public.workflow_instance_events (
    workflow_instance_id,
    event_id,
    from_state_key,
    to_state_key,
    idempotency_key,
    action_policy_keys,
    status,
    metadata
  )
  values (
    workflow_instance_record.id,
    workflow_event_id,
    workflow_instance_record.current_state_key,
    transition_record.to_state_key,
    target_idempotency_key,
    transition_record.action_policy_keys,
    'processed',
    transition_record.metadata || target_payload
  );

  update public.application_records
  set status = transition_record.to_state_key,
      updated_at = timezone('utc', now()),
      decided_at = case
        when transition_record.to_state_key in ('approved', 'rejected') then timezone('utc', now())
        else decided_at
      end,
      approved_at = case
        when transition_record.to_state_key = 'approved' then timezone('utc', now())
        else approved_at
      end,
      rejected_at = case
        when transition_record.to_state_key = 'rejected' then timezone('utc', now())
        else rejected_at
      end,
      suspended_at = case
        when transition_record.to_state_key = 'suspended' then timezone('utc', now())
        else suspended_at
      end,
      withdrawn_at = case
        when transition_record.to_state_key = 'withdrawn' then timezone('utc', now())
        else withdrawn_at
      end
  where id = target_application_id;

  insert into public.application_events (
    application_id,
    event_type_key,
    event_id,
    from_status,
    to_status,
    actor_user_id,
    idempotency_key,
    metadata
  )
  values (
    target_application_id,
    target_event_type_key,
    workflow_event_id,
    workflow_instance_record.current_state_key,
    transition_record.to_state_key,
    auth.uid(),
    target_idempotency_key,
    target_payload
  );

  return workflow_event_id;
end;
$$;

create or replace function public.register_document_submission(
  target_application_id uuid,
  target_requirement_key text,
  target_storage_bucket text,
  target_storage_path text,
  target_content_type text,
  target_byte_size bigint,
  target_checksum text,
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
  application_record record;
  application_type_record record;
  requirement_record record;
  media_asset_id uuid;
  document_submission_id uuid;
  existing_record record;
  expected_owner_prefix text;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  if target_requirement_key is null
    or target_requirement_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_requirement_key must be a valid platform key';
  end if;

  if target_storage_bucket not in ('skima-platform-documents', 'skima-platform-media') then
    raise exception 'target_storage_bucket must reference an approved platform storage bucket';
  end if;

  if target_storage_path is null
    or btrim(target_storage_path) = ''
    or target_storage_path like '%..%' then
    raise exception 'target_storage_path is required and must be normalized';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select existing.*
  into existing_record
  from public.document_submissions existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    if existing_record.application_id <> target_application_id
      or existing_record.storage_bucket <> target_storage_bucket
      or existing_record.storage_path <> target_storage_path then
      raise exception 'target_idempotency_key has already been used with different document details';
    end if;

    return existing_record.id;
  end if;

  select application_record_table.*
  into application_record
  from public.application_records application_record_table
  where application_record_table.id = target_application_id;

  if not found then
    raise exception 'target_application_id must reference an existing application';
  end if;

  if auth.role() <> 'service_role'
    and application_record.applicant_user_id <> auth.uid()
    and not public.can_review_applications()
    and not public.can_manage_applications() then
    raise exception 'only the applicant or reviewer can register application documents';
  end if;

  if application_record.status not in (
    'draft',
    'incomplete',
    'additional_info_required',
    'resubmitted'
  ) then
    raise exception 'documents cannot be added in the current application state';
  end if;

  select application_type.*
  into application_type_record
  from public.application_type_definitions application_type
  where application_type.id = application_record.application_type_id;

  select requirement.*
  into requirement_record
  from public.document_requirements requirement
  where requirement.requirement_set_id = application_type_record.document_requirement_set_id
    and requirement.key = target_requirement_key
    and requirement.status = 'active';

  if not found then
    raise exception 'target_requirement_key must be active for this application type';
  end if;

  if target_content_type is not null
    and cardinality(requirement_record.allowed_content_types) > 0
    and target_content_type <> all(requirement_record.allowed_content_types) then
    raise exception 'target_content_type is not allowed for this document requirement';
  end if;

  if requirement_record.max_byte_size is not null
    and target_byte_size is not null
    and target_byte_size > requirement_record.max_byte_size then
    raise exception 'target_byte_size exceeds the configured document requirement limit';
  end if;

  expected_owner_prefix := application_record.applicant_user_id::text || '/';

  if left(target_storage_path, length(expected_owner_prefix)) <> expected_owner_prefix
    and not public.can_review_applications()
    and auth.role() <> 'service_role' then
    raise exception 'target_storage_path must be scoped to the applicant user id';
  end if;

  insert into public.media_assets (
    organization_id,
    owner_user_id,
    storage_bucket,
    storage_path,
    content_type,
    byte_size,
    checksum,
    status,
    metadata,
    created_by
  )
  values (
    application_record.organization_id,
    application_record.applicant_user_id,
    target_storage_bucket,
    target_storage_path,
    target_content_type,
    target_byte_size,
    target_checksum,
    'active',
    target_metadata || jsonb_build_object('application_id', target_application_id),
    auth.uid()
  )
  on conflict (storage_bucket, storage_path) do update
  set content_type = excluded.content_type,
      byte_size = excluded.byte_size,
      checksum = excluded.checksum,
      status = excluded.status,
      metadata = public.media_assets.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into media_asset_id;

  insert into public.document_submissions (
    requirement_id,
    application_id,
    subject_type,
    subject_id,
    owner_user_id,
    organization_id,
    media_asset_id,
    status,
    storage_bucket,
    storage_path,
    content_type,
    byte_size,
    checksum,
    expires_at,
    source,
    idempotency_key,
    metadata,
    created_by
  )
  values (
    requirement_record.id,
    target_application_id,
    'application',
    target_application_id,
    application_record.applicant_user_id,
    application_record.organization_id,
    media_asset_id,
    'uploaded',
    target_storage_bucket,
    target_storage_path,
    target_content_type,
    target_byte_size,
    target_checksum,
    case
      when requirement_record.expires_after_days is null then null
      else timezone('utc', now()) + make_interval(days => requirement_record.expires_after_days)
    end,
    target_source,
    target_idempotency_key,
    target_metadata,
    auth.uid()
  )
  returning id into document_submission_id;

  insert into public.application_events (
    application_id,
    event_type_key,
    from_status,
    to_status,
    actor_user_id,
    idempotency_key,
    metadata
  )
  values (
    target_application_id,
    'event.application.document.registered',
    application_record.status,
    application_record.status,
    auth.uid(),
    target_idempotency_key || ':document',
    target_metadata || jsonb_build_object('document_submission_id', document_submission_id)
  )
  on conflict do nothing;

  return document_submission_id;
end;
$$;

create or replace function public.review_document_submission(
  target_document_submission_id uuid,
  target_decision text,
  target_internal_notes text default null,
  target_applicant_message text default null,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  document_record record;
  existing_event record;
begin
  if auth.role() <> 'service_role'
    and not public.can_review_applications()
    and not public.has_permission('platform.documents.review', null) then
    raise exception 'document review permission is required';
  end if;

  if target_document_submission_id is null then
    raise exception 'target_document_submission_id is required';
  end if;

  if target_decision not in ('under_review', 'approved', 'rejected', 'correction_required', 'quarantined') then
    raise exception 'target_decision is not supported';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select document_submission.*
  into document_record
  from public.document_submissions document_submission
  where document_submission.id = target_document_submission_id
  for update;

  if not found then
    raise exception 'target_document_submission_id must reference an existing document submission';
  end if;

  select document_event.*
  into existing_event
  from public.document_review_events document_event
  where document_event.document_submission_id = target_document_submission_id
    and document_event.idempotency_key = target_idempotency_key;

  if found then
    if existing_event.decision <> target_decision then
      raise exception 'target_idempotency_key has already been used with a different document decision';
    end if;

    return target_document_submission_id;
  end if;

  update public.document_submissions
  set status = target_decision,
      reviewed_at = case
        when target_decision in ('approved', 'rejected', 'correction_required', 'quarantined')
          then timezone('utc', now())
        else reviewed_at
      end,
      reviewer_user_id = auth.uid(),
      decision_reason = coalesce(target_applicant_message, target_internal_notes, decision_reason),
      metadata = metadata || target_metadata,
      updated_at = timezone('utc', now())
  where id = target_document_submission_id;

  insert into public.document_review_events (
    document_submission_id,
    reviewer_user_id,
    decision,
    internal_notes,
    applicant_message,
    idempotency_key,
    metadata
  )
  values (
    target_document_submission_id,
    auth.uid(),
    target_decision,
    target_internal_notes,
    target_applicant_message,
    target_idempotency_key,
    target_metadata
  );

  return target_document_submission_id;
end;
$$;

create or replace function public.submit_application(
  target_application_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record record;
  application_type_record record;
  missing_required_count integer;
  submit_event_key text;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select application_record_table.*
  into application_record
  from public.application_records application_record_table
  where application_record_table.id = target_application_id
  for update;

  if not found then
    raise exception 'target_application_id must reference an existing application';
  end if;

  if auth.role() <> 'service_role'
    and application_record.applicant_user_id <> auth.uid()
    and not public.can_manage_applications() then
    raise exception 'only the applicant can submit this application';
  end if;

  if application_record.status not in ('draft', 'incomplete', 'additional_info_required') then
    raise exception 'application cannot be submitted in the current state';
  end if;

  select application_type.*
  into application_type_record
  from public.application_type_definitions application_type
  where application_type.id = application_record.application_type_id;

  select count(*)
  into missing_required_count
  from public.document_requirements requirement
  where requirement.requirement_set_id = application_type_record.document_requirement_set_id
    and requirement.status = 'active'
    and requirement.is_required
    and (
      select count(*)
      from public.document_submissions document_submission
      where document_submission.application_id = target_application_id
        and document_submission.requirement_id = requirement.id
        and document_submission.status in ('uploaded', 'submitted', 'under_review', 'approved')
    ) < requirement.min_count;

  if missing_required_count > 0 then
    raise exception 'required documents are missing';
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
    when application_record.status = 'additional_info_required' then 'event.application.resubmitted'
    else 'event.application.submitted'
  end;

  perform public.advance_application_record_state(
    target_application_id,
    submit_event_key,
    target_metadata,
    target_idempotency_key
  );

  update public.application_records
  set locked_at = timezone('utc', now()),
      submitted_at = coalesce(submitted_at, timezone('utc', now())),
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
    target_metadata
  )
  on conflict do nothing;

  return target_application_id;
end;
$$;

create or replace function public.assign_application_reviewer(
  target_application_id uuid,
  target_reviewer_user_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record record;
  review_task_id uuid;
begin
  if auth.role() <> 'service_role' and not public.can_review_applications() then
    raise exception 'application review permission is required';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  if target_reviewer_user_id is null then
    raise exception 'target_reviewer_user_id is required';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if not exists (select 1 from public.profiles profile where profile.id = target_reviewer_user_id) then
    raise exception 'target_reviewer_user_id must reference an existing profile';
  end if;

  select application_record_table.*
  into application_record
  from public.application_records application_record_table
  where application_record_table.id = target_application_id
  for update;

  if not found then
    raise exception 'target_application_id must reference an existing application';
  end if;

  if application_record.status in ('submitted', 'resubmitted') then
    perform public.advance_application_record_state(
      target_application_id,
      'event.application.review.started',
      target_metadata || jsonb_build_object('reviewer_user_id', target_reviewer_user_id),
      target_idempotency_key || ':workflow'
    );
  elsif application_record.status <> 'under_review' then
    raise exception 'application cannot be assigned for review in the current state';
  end if;

  update public.application_records
  set assigned_reviewer_user_id = target_reviewer_user_id,
      updated_at = timezone('utc', now())
  where id = target_application_id;

  insert into public.application_review_tasks (
    application_id,
    assigned_reviewer_user_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    target_application_id,
    target_reviewer_user_id,
    'assigned',
    target_idempotency_key,
    target_metadata
  )
  on conflict (application_id, idempotency_key) do update
  set assigned_reviewer_user_id = excluded.assigned_reviewer_user_id,
      status = excluded.status,
      metadata = public.application_review_tasks.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into review_task_id;

  insert into public.application_review_events (
    application_id,
    review_task_id,
    reviewer_user_id,
    decision,
    idempotency_key,
    metadata
  )
  values (
    target_application_id,
    review_task_id,
    target_reviewer_user_id,
    'assigned',
    target_idempotency_key || ':review-event',
    target_metadata
  )
  on conflict do nothing;

  return target_application_id;
end;
$$;

create or replace function public.request_application_correction(
  target_application_id uuid,
  target_internal_notes text,
  target_applicant_message text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  review_task_id uuid;
begin
  if auth.role() <> 'service_role' and not public.can_review_applications() then
    raise exception 'application review permission is required';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  perform public.advance_application_record_state(
    target_application_id,
    'event.application.correction.requested',
    target_metadata || jsonb_build_object(
      'has_internal_notes',
      target_internal_notes is not null,
      'has_applicant_message',
      target_applicant_message is not null
    ),
    target_idempotency_key || ':workflow'
  );

  update public.application_records
  set locked_at = null,
      updated_at = timezone('utc', now())
  where id = target_application_id;

  select task.id
  into review_task_id
  from public.application_review_tasks task
  where task.application_id = target_application_id
    and task.status in ('open', 'assigned')
  order by task.created_at desc
  limit 1;

  if review_task_id is not null then
    update public.application_review_tasks
    set status = 'correction_requested',
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
    'correction_requested',
    target_internal_notes,
    target_applicant_message,
    target_idempotency_key,
    target_metadata
  )
  on conflict do nothing;

  return target_application_id;
end;
$$;

create or replace function public.activate_approved_application(target_application_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record record;
  application_type_record record;
  version_record record;
  organization_payload jsonb;
  vehicle_payload jsonb;
  slug_value text;
  display_name_value text;
  legal_name_value text;
  partner_type_key_value text;
  vehicle_type_key_value text;
  vehicle_type_id uuid;
  target_organization_id uuid;
  target_partner_id uuid;
  target_driver_id uuid;
  target_vehicle_id uuid;
  owner_role_id uuid;
  requested_capability_key text;
begin
  select application_record_table.*
  into application_record
  from public.application_records application_record_table
  where application_record_table.id = target_application_id
  for update;

  if not found then
    raise exception 'target_application_id must reference an existing application';
  end if;

  if application_record.status <> 'approved' then
    raise exception 'only approved applications can be activated';
  end if;

  select application_type.*
  into application_type_record
  from public.application_type_definitions application_type
  where application_type.id = application_record.application_type_id;

  select application_version.*
  into version_record
  from public.application_versions application_version
  where application_version.application_id = target_application_id
    and application_version.version = application_record.active_version;

  if application_type_record.application_category = 'business' then
    organization_payload := coalesce(version_record.payload -> 'organization', version_record.payload -> 'business', '{}'::jsonb);
    slug_value := nullif(organization_payload ->> 'slug', '');
    display_name_value := coalesce(
      nullif(organization_payload ->> 'displayName', ''),
      nullif(organization_payload ->> 'display_name', ''),
      nullif(version_record.payload ->> 'displayName', '')
    );
    legal_name_value := coalesce(
      nullif(organization_payload ->> 'legalName', ''),
      nullif(organization_payload ->> 'legal_name', ''),
      display_name_value
    );
    partner_type_key_value := coalesce(
      nullif(organization_payload ->> 'partnerTypeKey', ''),
      nullif(organization_payload ->> 'partner_type_key', ''),
      application_type_record.key
    );

    if slug_value is null or display_name_value is null then
      raise exception 'approved business applications require organization slug and display name';
    end if;

    if application_record.organization_id is null then
      insert into public.organizations (
        slug,
        legal_name,
        display_name,
        status,
        metadata,
        created_by
      )
      values (
        slug_value,
        legal_name_value,
        display_name_value,
        'active',
        jsonb_build_object('application_id', target_application_id),
        application_record.applicant_user_id
      )
      returning id into target_organization_id;
    else
      target_organization_id := application_record.organization_id;

      update public.organizations
      set legal_name = legal_name_value,
          display_name = display_name_value,
          status = 'active',
          metadata = metadata || jsonb_build_object('application_id', target_application_id),
          updated_at = timezone('utc', now())
      where id = target_organization_id;
    end if;

    insert into public.organization_memberships (
      organization_id,
      user_id,
      membership_type,
      status,
      metadata,
      created_by
    )
    values (
      target_organization_id,
      application_record.applicant_user_id,
      'owner',
      'active',
      jsonb_build_object('source_application_id', target_application_id),
      auth.uid()
    )
    on conflict (organization_id, user_id) do update
    set membership_type = 'owner',
        status = 'active',
        metadata = public.organization_memberships.metadata || excluded.metadata,
        updated_at = timezone('utc', now());

    insert into public.roles (
      organization_id,
      key,
      display_name,
      description,
      status,
      metadata,
      created_by
    )
    values (
      target_organization_id,
      'business.owner',
      'Business Owner',
      'Organization owner role created by the application approval engine.',
      'active',
      jsonb_build_object('source_application_id', target_application_id),
      auth.uid()
    )
    on conflict do nothing;

    select role_record.id
    into owner_role_id
    from public.roles role_record
    where role_record.organization_id = target_organization_id
      and role_record.key = 'business.owner';

    insert into public.role_permissions (role_id, permission_id)
    select owner_role_id, permission_record.id
    from public.permissions permission_record
    where permission_record.key in (
      'business.applications.manage',
      'business.documents.manage',
      'business.staff.manage',
      'business.catalog.manage',
      'business.orders.manage',
      'business.finance.read',
      'business.settlements.read'
    )
    on conflict do nothing;

    insert into public.user_roles (
      organization_id,
      user_id,
      role_id,
      status,
      created_by
    )
    values (
      target_organization_id,
      application_record.applicant_user_id,
      owner_role_id,
      'active',
      auth.uid()
    )
    on conflict (organization_id, user_id, role_id) do update
    set status = 'active',
        updated_at = timezone('utc', now());

    insert into public.partner_profiles (
      organization_id,
      partner_type_key,
      status,
      behavior_config,
      metadata,
      created_by
    )
    values (
      target_organization_id,
      partner_type_key_value,
      'active',
      coalesce(application_type_record.activation_policy -> 'partner_behavior', '{}'::jsonb),
      jsonb_build_object('source_application_id', target_application_id),
      application_record.applicant_user_id
    )
    on conflict (organization_id) do update
    set partner_type_key = excluded.partner_type_key,
        status = 'active',
        behavior_config = public.partner_profiles.behavior_config || excluded.behavior_config,
        metadata = public.partner_profiles.metadata || excluded.metadata,
        updated_at = timezone('utc', now())
    returning id into target_partner_id;

    update public.application_records
    set organization_id = target_organization_id,
        activated_subject_type = 'partner',
        activated_subject_id = target_partner_id,
        updated_at = timezone('utc', now())
    where id = target_application_id;

    return jsonb_build_object(
      'activated_subject_type',
      'partner',
      'activated_subject_id',
      target_partner_id,
      'organization_id',
      target_organization_id
    );
  end if;

  if application_type_record.application_category = 'driver' then
    insert into public.driver_profiles (
      user_id,
      organization_id,
      operational_status,
      verification_status,
      metadata,
      created_by
    )
    values (
      application_record.applicant_user_id,
      application_record.organization_id,
      'offline',
      'approved',
      jsonb_build_object('source_application_id', target_application_id),
      auth.uid()
    )
    on conflict (user_id) do update
    set verification_status = 'approved',
        metadata = public.driver_profiles.metadata || excluded.metadata,
        updated_at = timezone('utc', now())
    returning id into target_driver_id;

    if jsonb_typeof(version_record.payload -> 'capabilityKeys') = 'array' then
      for requested_capability_key in
        select jsonb_array_elements_text(version_record.payload -> 'capabilityKeys')
      loop
        if not exists (
          select 1
          from public.capability_definitions capability
          where capability.key = requested_capability_key
            and capability.status = 'active'
        ) then
          raise exception 'approved driver capability is not configured: %', requested_capability_key;
        end if;

        insert into public.entity_capabilities (
          entity_type,
          entity_id,
          capability_key,
          constraints,
          status,
          verified_at,
          created_by
        )
        values (
          'driver',
          target_driver_id,
          requested_capability_key,
          jsonb_build_object('source_application_id', target_application_id),
          'active',
          timezone('utc', now()),
          auth.uid()
        )
        on conflict (entity_type, entity_id, capability_key) do update
        set status = 'active',
            verified_at = timezone('utc', now()),
            constraints = public.entity_capabilities.constraints || excluded.constraints,
            updated_at = timezone('utc', now());
      end loop;
    end if;

    update public.application_records
    set activated_subject_type = 'driver',
        activated_subject_id = target_driver_id,
        updated_at = timezone('utc', now())
    where id = target_application_id;

    return jsonb_build_object(
      'activated_subject_type',
      'driver',
      'activated_subject_id',
      target_driver_id
    );
  end if;

  if application_type_record.application_category = 'vehicle' then
    vehicle_payload := coalesce(version_record.payload -> 'vehicle', '{}'::jsonb);
    vehicle_type_key_value := coalesce(nullif(vehicle_payload ->> 'vehicleTypeKey', ''), nullif(vehicle_payload ->> 'vehicle_type_key', ''));

    if vehicle_type_key_value is null then
      raise exception 'approved vehicle applications require vehicle type key';
    end if;

    select vehicle_type.id
    into vehicle_type_id
    from public.vehicle_types vehicle_type
    where vehicle_type.key = vehicle_type_key_value
      and vehicle_type.status = 'active';

    if not found then
      raise exception 'approved vehicle type is not configured';
    end if;

    insert into public.vehicles (
      organization_id,
      owner_user_id,
      vehicle_type_id,
      status,
      capacity_profile,
      metadata,
      created_by
    )
    values (
      application_record.organization_id,
      application_record.applicant_user_id,
      vehicle_type_id,
      'active',
      coalesce(vehicle_payload -> 'capacityProfile', vehicle_payload -> 'capacity_profile', '{}'::jsonb),
      coalesce(vehicle_payload -> 'metadata', '{}'::jsonb) || jsonb_build_object('source_application_id', target_application_id),
      auth.uid()
    )
    returning id into target_vehicle_id;

    if jsonb_typeof(vehicle_payload -> 'capabilityKeys') = 'array' then
      for requested_capability_key in
        select jsonb_array_elements_text(vehicle_payload -> 'capabilityKeys')
      loop
        if not exists (
          select 1
          from public.capability_definitions capability
          where capability.key = requested_capability_key
            and capability.status = 'active'
        ) then
          raise exception 'approved vehicle capability is not configured: %', requested_capability_key;
        end if;

        insert into public.entity_capabilities (
          entity_type,
          entity_id,
          capability_key,
          constraints,
          status,
          verified_at,
          created_by
        )
        values (
          'vehicle',
          target_vehicle_id,
          requested_capability_key,
          jsonb_build_object('source_application_id', target_application_id),
          'active',
          timezone('utc', now()),
          auth.uid()
        )
        on conflict (entity_type, entity_id, capability_key) do update
        set status = 'active',
            verified_at = timezone('utc', now()),
            constraints = public.entity_capabilities.constraints || excluded.constraints,
            updated_at = timezone('utc', now());
      end loop;
    end if;

    update public.application_records
    set activated_subject_type = 'vehicle',
        activated_subject_id = target_vehicle_id,
        updated_at = timezone('utc', now())
    where id = target_application_id;

    return jsonb_build_object(
      'activated_subject_type',
      'vehicle',
      'activated_subject_id',
      target_vehicle_id
    );
  end if;

  update public.application_records
  set activated_subject_type = application_type_record.application_category,
      activated_subject_id = target_application_id,
      updated_at = timezone('utc', now())
  where id = target_application_id;

  return jsonb_build_object(
    'activated_subject_type',
    application_type_record.application_category,
    'activated_subject_id',
    target_application_id
  );
end;
$$;

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
set search_path = public
as $$
declare
  application_record record;
  application_type_record record;
  missing_review_count integer;
  event_type_key text;
  review_task_id uuid;
begin
  if auth.role() <> 'service_role' and not public.can_review_applications() then
    raise exception 'application review permission is required';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  if target_decision not in ('approved', 'rejected', 'suspended', 'reactivated') then
    raise exception 'target_decision is not supported';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select application_record_table.*
  into application_record
  from public.application_records application_record_table
  where application_record_table.id = target_application_id
  for update;

  if not found then
    raise exception 'target_application_id must reference an existing application';
  end if;

  if target_decision in ('approved', 'rejected') and application_record.status <> 'under_review' then
    raise exception 'application approval decisions require under_review state';
  end if;

  if target_decision = 'suspended' and application_record.status <> 'approved' then
    raise exception 'only approved applications can be suspended';
  end if;

  if target_decision = 'reactivated' and application_record.status <> 'suspended' then
    raise exception 'only suspended applications can be reactivated';
  end if;

  if target_decision = 'approved' then
    select application_type.*
    into application_type_record
    from public.application_type_definitions application_type
    where application_type.id = application_record.application_type_id;

    select count(*)
    into missing_review_count
    from public.document_requirements requirement
    where requirement.requirement_set_id = application_type_record.document_requirement_set_id
      and requirement.status = 'active'
      and requirement.review_required
      and (
        select count(*)
        from public.document_submissions document_submission
        where document_submission.application_id = target_application_id
          and document_submission.requirement_id = requirement.id
          and document_submission.status = 'approved'
      ) < requirement.min_count;

    if missing_review_count > 0 then
      raise exception 'required documents must be approved before application approval';
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

  select task.id
  into review_task_id
  from public.application_review_tasks task
  where task.application_id = target_application_id
    and task.status in ('open', 'assigned', 'correction_requested')
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
    case when target_decision in ('approved', 'rejected') then target_reason else null end,
    target_idempotency_key,
    target_metadata
  )
  on conflict do nothing;

  if target_decision in ('approved', 'reactivated') then
    perform public.activate_approved_application(target_application_id);
  end if;

  return target_application_id;
end;
$$;

create or replace function public.withdraw_application(
  target_application_id uuid,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record record;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select application_record_table.*
  into application_record
  from public.application_records application_record_table
  where application_record_table.id = target_application_id;

  if not found then
    raise exception 'target_application_id must reference an existing application';
  end if;

  if auth.role() <> 'service_role'
    and application_record.applicant_user_id <> auth.uid()
    and not public.can_manage_applications() then
    raise exception 'only the applicant can withdraw this application';
  end if;

  perform public.advance_application_record_state(
    target_application_id,
    'event.application.withdrawn',
    target_metadata || jsonb_build_object('reason', target_reason),
    target_idempotency_key
  );

  return target_application_id;
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'document_requirement_sets',
    'document_requirements',
    'application_type_definitions',
    'application_records',
    'application_versions',
    'application_review_tasks',
    'application_events',
    'application_review_events',
    'document_submissions',
    'document_review_events'
  ]
  loop
    execute format(
      'drop trigger if exists set_updated_at on public.%I',
      target_table
    );

    execute format(
      'create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',
      target_table
    );

    execute format(
      'drop trigger if exists audit_changes on public.%I',
      target_table
    );

    execute format(
      'create trigger audit_changes after insert or update or delete on public.%I for each row execute function public.record_table_audit()',
      target_table
    );
  end loop;
end $$;

drop trigger if exists prevent_application_events_update on public.application_events;
create trigger prevent_application_events_update
before update on public.application_events
for each row execute function public.prevent_application_runtime_event_mutation();

drop trigger if exists prevent_application_events_delete on public.application_events;
create trigger prevent_application_events_delete
before delete on public.application_events
for each row execute function public.prevent_application_runtime_event_mutation();

drop trigger if exists prevent_application_review_events_update on public.application_review_events;
create trigger prevent_application_review_events_update
before update on public.application_review_events
for each row execute function public.prevent_application_runtime_event_mutation();

drop trigger if exists prevent_application_review_events_delete on public.application_review_events;
create trigger prevent_application_review_events_delete
before delete on public.application_review_events
for each row execute function public.prevent_application_runtime_event_mutation();

drop trigger if exists prevent_document_review_events_update on public.document_review_events;
create trigger prevent_document_review_events_update
before update on public.document_review_events
for each row execute function public.prevent_application_runtime_event_mutation();

drop trigger if exists prevent_document_review_events_delete on public.document_review_events;
create trigger prevent_document_review_events_delete
before delete on public.document_review_events
for each row execute function public.prevent_application_runtime_event_mutation();

alter table public.document_requirement_sets enable row level security;
alter table public.document_requirements enable row level security;
alter table public.application_type_definitions enable row level security;
alter table public.application_records enable row level security;
alter table public.application_versions enable row level security;
alter table public.application_review_tasks enable row level security;
alter table public.application_events enable row level security;
alter table public.application_review_events enable row level security;
alter table public.document_submissions enable row level security;
alter table public.document_review_events enable row level security;

drop policy if exists document_requirement_sets_select_active_or_privileged on public.document_requirement_sets;
drop policy if exists document_requirement_sets_manage_privileged on public.document_requirement_sets;
drop policy if exists document_requirements_select_active_or_privileged on public.document_requirements;
drop policy if exists document_requirements_manage_privileged on public.document_requirements;
drop policy if exists application_type_definitions_select_active_or_privileged on public.application_type_definitions;
drop policy if exists application_type_definitions_manage_privileged on public.application_type_definitions;
drop policy if exists application_records_select_actor_or_privileged on public.application_records;
drop policy if exists application_records_no_direct_insert on public.application_records;
drop policy if exists application_records_no_direct_update on public.application_records;
drop policy if exists application_records_no_direct_delete on public.application_records;
drop policy if exists application_versions_select_actor_or_privileged on public.application_versions;
drop policy if exists application_versions_no_direct_insert on public.application_versions;
drop policy if exists application_versions_no_direct_update on public.application_versions;
drop policy if exists application_versions_no_direct_delete on public.application_versions;
drop policy if exists application_review_tasks_select_reviewer_or_privileged on public.application_review_tasks;
drop policy if exists application_review_tasks_no_direct_insert on public.application_review_tasks;
drop policy if exists application_review_tasks_no_direct_update on public.application_review_tasks;
drop policy if exists application_review_tasks_no_direct_delete on public.application_review_tasks;
drop policy if exists application_events_select_actor_or_privileged on public.application_events;
drop policy if exists application_events_no_direct_insert on public.application_events;
drop policy if exists application_events_no_direct_update on public.application_events;
drop policy if exists application_events_no_direct_delete on public.application_events;
drop policy if exists application_review_events_select_actor_or_privileged on public.application_review_events;
drop policy if exists application_review_events_no_direct_insert on public.application_review_events;
drop policy if exists application_review_events_no_direct_update on public.application_review_events;
drop policy if exists application_review_events_no_direct_delete on public.application_review_events;
drop policy if exists document_submissions_select_actor_or_privileged on public.document_submissions;
drop policy if exists document_submissions_no_direct_insert on public.document_submissions;
drop policy if exists document_submissions_no_direct_update on public.document_submissions;
drop policy if exists document_submissions_no_direct_delete on public.document_submissions;
drop policy if exists document_review_events_select_actor_or_privileged on public.document_review_events;
drop policy if exists document_review_events_no_direct_insert on public.document_review_events;
drop policy if exists document_review_events_no_direct_update on public.document_review_events;
drop policy if exists document_review_events_no_direct_delete on public.document_review_events;

create policy document_requirement_sets_select_active_or_privileged on public.document_requirement_sets
for select to authenticated
using (status = 'active' or public.has_permission('platform.documents.read', null));

create policy document_requirement_sets_manage_privileged on public.document_requirement_sets
for all to authenticated
using (public.has_permission('platform.documents.manage', null))
with check (public.has_permission('platform.documents.manage', null));

create policy document_requirements_select_active_or_privileged on public.document_requirements
for select to authenticated
using (
  status = 'active'
  or public.has_permission('platform.documents.read', null)
  or public.has_permission('platform.documents.manage', null)
);

create policy document_requirements_manage_privileged on public.document_requirements
for all to authenticated
using (public.has_permission('platform.documents.manage', null))
with check (public.has_permission('platform.documents.manage', null));

create policy application_type_definitions_select_active_or_privileged on public.application_type_definitions
for select to authenticated
using (
  status = 'active'
  or public.has_permission('platform.applications.read', null)
  or public.has_permission('platform.applications.manage', null)
);

create policy application_type_definitions_manage_privileged on public.application_type_definitions
for all to authenticated
using (public.has_permission('platform.applications.manage', null))
with check (public.has_permission('platform.applications.manage', null));

create policy application_records_select_actor_or_privileged on public.application_records
for select to authenticated
using (
  applicant_user_id = auth.uid()
  or assigned_reviewer_user_id = auth.uid()
  or (organization_id is not null and public.is_organization_member(organization_id))
  or public.has_permission('platform.applications.read', null)
  or public.can_review_applications()
);

create policy application_records_no_direct_insert on public.application_records
for insert to authenticated
with check (false);

create policy application_records_no_direct_update on public.application_records
for update to authenticated
using (false)
with check (false);

create policy application_records_no_direct_delete on public.application_records
for delete to authenticated
using (false);

create policy application_versions_select_actor_or_privileged on public.application_versions
for select to authenticated
using (public.can_read_application_record(application_id));

create policy application_versions_no_direct_insert on public.application_versions
for insert to authenticated
with check (false);

create policy application_versions_no_direct_update on public.application_versions
for update to authenticated
using (false)
with check (false);

create policy application_versions_no_direct_delete on public.application_versions
for delete to authenticated
using (false);

create policy application_review_tasks_select_reviewer_or_privileged on public.application_review_tasks
for select to authenticated
using (
  assigned_reviewer_user_id = auth.uid()
  or public.can_read_application_record(application_id)
  or public.can_review_applications()
);

create policy application_review_tasks_no_direct_insert on public.application_review_tasks
for insert to authenticated
with check (false);

create policy application_review_tasks_no_direct_update on public.application_review_tasks
for update to authenticated
using (false)
with check (false);

create policy application_review_tasks_no_direct_delete on public.application_review_tasks
for delete to authenticated
using (false);

create policy application_events_select_actor_or_privileged on public.application_events
for select to authenticated
using (public.can_read_application_record(application_id));

create policy application_events_no_direct_insert on public.application_events
for insert to authenticated
with check (false);

create policy application_events_no_direct_update on public.application_events
for update to authenticated
using (false)
with check (false);

create policy application_events_no_direct_delete on public.application_events
for delete to authenticated
using (false);

create policy application_review_events_select_actor_or_privileged on public.application_review_events
for select to authenticated
using (public.can_read_application_record(application_id));

create policy application_review_events_no_direct_insert on public.application_review_events
for insert to authenticated
with check (false);

create policy application_review_events_no_direct_update on public.application_review_events
for update to authenticated
using (false)
with check (false);

create policy application_review_events_no_direct_delete on public.application_review_events
for delete to authenticated
using (false);

create policy document_submissions_select_actor_or_privileged on public.document_submissions
for select to authenticated
using (public.can_read_document_submission(id));

create policy document_submissions_no_direct_insert on public.document_submissions
for insert to authenticated
with check (false);

create policy document_submissions_no_direct_update on public.document_submissions
for update to authenticated
using (false)
with check (false);

create policy document_submissions_no_direct_delete on public.document_submissions
for delete to authenticated
using (false);

create policy document_review_events_select_actor_or_privileged on public.document_review_events
for select to authenticated
using (
  exists (
    select 1
    from public.document_submissions document_submission
    where document_submission.id = document_review_events.document_submission_id
      and public.can_read_document_submission(document_submission.id)
  )
);

create policy document_review_events_no_direct_insert on public.document_review_events
for insert to authenticated
with check (false);

create policy document_review_events_no_direct_update on public.document_review_events
for update to authenticated
using (false)
with check (false);

create policy document_review_events_no_direct_delete on public.document_review_events
for delete to authenticated
using (false);

insert into public.event_types (key, description, schema, status)
values
  ('event.application.created', 'Application draft was created.', '{}'::jsonb, 'active'),
  ('event.application.updated', 'Application draft payload was updated.', '{}'::jsonb, 'active'),
  ('event.application.document.registered', 'Application document metadata was registered.', '{}'::jsonb, 'active'),
  ('event.application.submitted', 'Application was submitted for review.', '{}'::jsonb, 'active'),
  ('event.application.review.started', 'Application review was started.', '{}'::jsonb, 'active'),
  ('event.application.correction.requested', 'Reviewer requested application correction.', '{}'::jsonb, 'active'),
  ('event.application.resubmitted', 'Applicant resubmitted after correction.', '{}'::jsonb, 'active'),
  ('event.application.approved', 'Application was approved.', '{}'::jsonb, 'active'),
  ('event.application.rejected', 'Application was rejected.', '{}'::jsonb, 'active'),
  ('event.application.suspended', 'Approved application was suspended.', '{}'::jsonb, 'active'),
  ('event.application.reactivated', 'Suspended application was reactivated.', '{}'::jsonb, 'active'),
  ('event.application.expired', 'Application expired.', '{}'::jsonb, 'active'),
  ('event.application.withdrawn', 'Application was withdrawn by applicant.', '{}'::jsonb, 'active')
on conflict (key) do update
set description = excluded.description,
    schema = excluded.schema,
    status = excluded.status,
    updated_at = timezone('utc', now());

do $$
declare
  application_workflow_id uuid;
  application_workflow_version_id uuid;
begin
  insert into public.workflow_definitions (
    key,
    display_name,
    description,
    status,
    metadata
  )
  values (
    'workflow.application.review.default',
    'Default Application Review',
    'Reusable workflow for business, driver, vehicle, and future application review.',
    'active',
    '{"engine":"application_review"}'::jsonb
  )
  on conflict (key) do update
  set display_name = excluded.display_name,
      description = excluded.description,
      status = excluded.status,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into application_workflow_id;

  insert into public.workflow_versions (
    workflow_id,
    version,
    status,
    definition,
    activated_at
  )
  values (
    application_workflow_id,
    1,
    'active',
    '{"states":["draft","submitted","under_review","additional_info_required","resubmitted","approved","rejected","suspended","expired","withdrawn"]}'::jsonb,
    timezone('utc', now())
  )
  on conflict (workflow_id, version) do update
  set status = excluded.status,
      definition = excluded.definition,
      activated_at = coalesce(public.workflow_versions.activated_at, excluded.activated_at),
      updated_at = timezone('utc', now())
  returning id into application_workflow_version_id;

  insert into public.workflow_states (
    workflow_version_id,
    key,
    display_name,
    state_type,
    metadata
  )
  values
    (application_workflow_version_id, 'draft', 'Draft', 'initial', '{}'::jsonb),
    (application_workflow_version_id, 'incomplete', 'Incomplete', 'normal', '{}'::jsonb),
    (application_workflow_version_id, 'submitted', 'Submitted', 'normal', '{}'::jsonb),
    (application_workflow_version_id, 'under_review', 'Under Review', 'normal', '{}'::jsonb),
    (application_workflow_version_id, 'additional_info_required', 'Additional Information Required', 'normal', '{}'::jsonb),
    (application_workflow_version_id, 'resubmitted', 'Resubmitted', 'normal', '{}'::jsonb),
    (application_workflow_version_id, 'approved', 'Approved', 'normal', '{}'::jsonb),
    (application_workflow_version_id, 'rejected', 'Rejected', 'failure', '{}'::jsonb),
    (application_workflow_version_id, 'suspended', 'Suspended', 'normal', '{}'::jsonb),
    (application_workflow_version_id, 'expired', 'Expired', 'failure', '{}'::jsonb),
    (application_workflow_version_id, 'withdrawn', 'Withdrawn', 'terminal', '{}'::jsonb)
  on conflict (workflow_version_id, key) do update
  set display_name = excluded.display_name,
      state_type = excluded.state_type,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now());

  insert into public.workflow_transitions (
    workflow_version_id,
    from_state_key,
    to_state_key,
    event_type_key,
    action_policy_keys,
    metadata
  )
  values
    (application_workflow_version_id, 'draft', 'submitted', 'event.application.submitted', '{}', '{"actor_scope":"applicant"}'::jsonb),
    (application_workflow_version_id, 'incomplete', 'submitted', 'event.application.submitted', '{}', '{"actor_scope":"applicant"}'::jsonb),
    (application_workflow_version_id, 'submitted', 'under_review', 'event.application.review.started', '{}', '{"actor_scope":"reviewer"}'::jsonb),
    (application_workflow_version_id, 'under_review', 'additional_info_required', 'event.application.correction.requested', '{}', '{"actor_scope":"reviewer"}'::jsonb),
    (application_workflow_version_id, 'additional_info_required', 'resubmitted', 'event.application.resubmitted', '{}', '{"actor_scope":"applicant"}'::jsonb),
    (application_workflow_version_id, 'resubmitted', 'under_review', 'event.application.review.started', '{}', '{"actor_scope":"reviewer"}'::jsonb),
    (application_workflow_version_id, 'under_review', 'approved', 'event.application.approved', '{}', '{"actor_scope":"reviewer"}'::jsonb),
    (application_workflow_version_id, 'under_review', 'rejected', 'event.application.rejected', '{}', '{"actor_scope":"reviewer"}'::jsonb),
    (application_workflow_version_id, 'approved', 'suspended', 'event.application.suspended', '{}', '{"actor_scope":"admin"}'::jsonb),
    (application_workflow_version_id, 'suspended', 'approved', 'event.application.reactivated', '{}', '{"actor_scope":"admin"}'::jsonb),
    (application_workflow_version_id, 'draft', 'withdrawn', 'event.application.withdrawn', '{}', '{"actor_scope":"applicant"}'::jsonb),
    (application_workflow_version_id, 'submitted', 'withdrawn', 'event.application.withdrawn', '{}', '{"actor_scope":"applicant"}'::jsonb),
    (application_workflow_version_id, 'additional_info_required', 'withdrawn', 'event.application.withdrawn', '{}', '{"actor_scope":"applicant"}'::jsonb),
    (application_workflow_version_id, 'submitted', 'expired', 'event.application.expired', '{}', '{"actor_scope":"system"}'::jsonb),
    (application_workflow_version_id, 'under_review', 'expired', 'event.application.expired', '{}', '{"actor_scope":"system"}'::jsonb),
    (application_workflow_version_id, 'additional_info_required', 'expired', 'event.application.expired', '{}', '{"actor_scope":"system"}'::jsonb),
    (application_workflow_version_id, 'resubmitted', 'expired', 'event.application.expired', '{}', '{"actor_scope":"system"}'::jsonb)
  on conflict (workflow_version_id, from_state_key, event_type_key) do update
  set to_state_key = excluded.to_state_key,
      action_policy_keys = excluded.action_policy_keys,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now());
end $$;

insert into public.document_requirement_sets (
  key,
  display_name,
  subject_category,
  status,
  metadata
)
values
  (
    'documents.business.onboarding.default',
    'Default Business Onboarding Documents',
    'business',
    'active',
    '{"configurable":true}'::jsonb
  ),
  (
    'documents.driver.onboarding.default',
    'Default Driver Onboarding Documents',
    'driver',
    'active',
    '{"configurable":true}'::jsonb
  ),
  (
    'documents.vehicle.onboarding.default',
    'Default Vehicle Onboarding Documents',
    'vehicle',
    'active',
    '{"configurable":true}'::jsonb
  )
on conflict (key) do update
set display_name = excluded.display_name,
    subject_category = excluded.subject_category,
    status = excluded.status,
    metadata = excluded.metadata,
    updated_at = timezone('utc', now());

with requirement_seed(set_key, requirement_key, display_name, is_required, review_required) as (
  values
    ('documents.business.onboarding.default', 'business.registration', 'Business Registration Document', true, true),
    ('documents.business.onboarding.default', 'business.owner-identity', 'Owner Identity Document', true, true),
    ('documents.business.onboarding.default', 'business.proof-of-address', 'Proof Of Address', true, true),
    ('documents.business.onboarding.default', 'business.settlement-details', 'Settlement Details Evidence', true, true),
    ('documents.driver.onboarding.default', 'driver.identity', 'Driver Identity Document', true, true),
    ('documents.driver.onboarding.default', 'driver.licence', 'Driver Licence', true, true),
    ('documents.driver.onboarding.default', 'driver.address-evidence', 'Driver Address Evidence', true, true),
    ('documents.vehicle.onboarding.default', 'vehicle.registration', 'Vehicle Registration Document', true, true),
    ('documents.vehicle.onboarding.default', 'vehicle.ownership-authorization', 'Vehicle Ownership Or Authorization', true, true),
    ('documents.vehicle.onboarding.default', 'vehicle.insurance', 'Vehicle Insurance Evidence', true, true)
)
insert into public.document_requirements (
  requirement_set_id,
  key,
  display_name,
  is_required,
  review_required,
  min_count,
  max_count,
  allowed_content_types,
  max_byte_size,
  status,
  metadata
)
select
  requirement_set.id,
  requirement_seed.requirement_key,
  requirement_seed.display_name,
  requirement_seed.is_required,
  requirement_seed.review_required,
  1,
  5,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  52428800,
  'active',
  '{"configurable":true}'::jsonb
from requirement_seed
join public.document_requirement_sets requirement_set on requirement_set.key = requirement_seed.set_key
on conflict (requirement_set_id, key) do update
set display_name = excluded.display_name,
    is_required = excluded.is_required,
    review_required = excluded.review_required,
    min_count = excluded.min_count,
    max_count = excluded.max_count,
    allowed_content_types = excluded.allowed_content_types,
    max_byte_size = excluded.max_byte_size,
    status = excluded.status,
    metadata = excluded.metadata,
    updated_at = timezone('utc', now());

with application_type_seed(application_key, display_name, application_category, requirement_set_key) as (
  values
    ('application.business.default', 'Default Business Application', 'business', 'documents.business.onboarding.default'),
    ('application.driver.default', 'Default Driver Application', 'driver', 'documents.driver.onboarding.default'),
    ('application.vehicle.default', 'Default Vehicle Application', 'vehicle', 'documents.vehicle.onboarding.default')
)
insert into public.application_type_definitions (
  key,
  display_name,
  application_category,
  workflow_key,
  document_requirement_set_id,
  review_policy,
  activation_policy,
  status,
  metadata
)
select
  application_type_seed.application_key,
  application_type_seed.display_name,
  application_type_seed.application_category,
  'workflow.application.review.default',
  requirement_set.id,
  '{"requires_admin_review":true}'::jsonb,
  '{"configurable":true}'::jsonb,
  'active',
  '{"configurable":true}'::jsonb
from application_type_seed
join public.document_requirement_sets requirement_set on requirement_set.key = application_type_seed.requirement_set_key
on conflict (key) do update
set display_name = excluded.display_name,
    application_category = excluded.application_category,
    workflow_key = excluded.workflow_key,
    document_requirement_set_id = excluded.document_requirement_set_id,
    review_policy = excluded.review_policy,
    activation_policy = excluded.activation_policy,
    status = excluded.status,
    metadata = excluded.metadata,
    updated_at = timezone('utc', now());

grant select, insert, update, delete on
  public.document_requirement_sets,
  public.document_requirements,
  public.application_type_definitions,
  public.application_records,
  public.application_versions,
  public.application_review_tasks,
  public.application_events,
  public.application_review_events,
  public.document_submissions,
  public.document_review_events
to authenticated;

grant select, insert, update, delete on
  public.document_requirement_sets,
  public.document_requirements,
  public.application_type_definitions,
  public.application_records,
  public.application_versions,
  public.application_review_tasks,
  public.application_events,
  public.application_review_events,
  public.document_submissions,
  public.document_review_events
to service_role;

revoke all on function public.can_review_applications() from public;
revoke all on function public.can_manage_applications() from public;
revoke all on function public.can_read_application_record(uuid) from public;
revoke all on function public.can_read_document_submission(uuid) from public;
revoke all on function public.prevent_application_runtime_event_mutation() from public;
revoke all on function public.create_application_record(text, jsonb, text, text, uuid, uuid, jsonb) from public;
revoke all on function public.update_application_payload(uuid, jsonb, text, jsonb) from public;
revoke all on function public.advance_application_record_state(uuid, text, jsonb, text) from public;
revoke all on function public.register_document_submission(uuid, text, text, text, text, bigint, text, text, text, jsonb) from public;
revoke all on function public.review_document_submission(uuid, text, text, text, text, jsonb) from public;
revoke all on function public.submit_application(uuid, text, jsonb) from public;
revoke all on function public.assign_application_reviewer(uuid, uuid, text, jsonb) from public;
revoke all on function public.request_application_correction(uuid, text, text, text, jsonb) from public;
revoke all on function public.activate_approved_application(uuid) from public;
revoke all on function public.decide_application_review(uuid, text, text, text, jsonb) from public;
revoke all on function public.withdraw_application(uuid, text, text, jsonb) from public;

grant execute on function public.can_review_applications() to authenticated, service_role;
grant execute on function public.can_manage_applications() to authenticated, service_role;
grant execute on function public.can_read_application_record(uuid) to authenticated, service_role;
grant execute on function public.can_read_document_submission(uuid) to authenticated, service_role;
grant execute on function public.create_application_record(text, jsonb, text, text, uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.update_application_payload(uuid, jsonb, text, jsonb) to authenticated, service_role;
grant execute on function public.advance_application_record_state(uuid, text, jsonb, text) to authenticated, service_role;
grant execute on function public.register_document_submission(uuid, text, text, text, text, bigint, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.review_document_submission(uuid, text, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.submit_application(uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.assign_application_reviewer(uuid, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.request_application_correction(uuid, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.decide_application_review(uuid, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.withdraw_application(uuid, text, text, jsonb) to authenticated, service_role;

grant execute on function public.activate_approved_application(uuid) to service_role;

commit;
