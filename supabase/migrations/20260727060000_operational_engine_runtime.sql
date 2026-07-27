begin;

alter table public.verification_events
add column if not exists source text not null default 'platform.verification_engine'
  check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$');

alter table public.verification_events
add column if not exists idempotency_key text;

create unique index if not exists verification_events_source_idempotency_unique
on public.verification_events (source, idempotency_key)
where idempotency_key is not null;

alter table public.dispatch_requests
add column if not exists source text not null default 'platform.dispatch_engine'
  check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$');

alter table public.dispatch_requests
add column if not exists idempotency_key text;

create unique index if not exists dispatch_requests_source_idempotency_unique
on public.dispatch_requests (source, idempotency_key)
where idempotency_key is not null;

alter table public.dispatch_candidates
add column if not exists idempotency_key text;

create unique index if not exists dispatch_candidates_request_idempotency_unique
on public.dispatch_candidates (dispatch_request_id, idempotency_key)
where idempotency_key is not null;

alter table public.tracking_sessions
add column if not exists source text not null default 'platform.tracking_engine'
  check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$');

alter table public.tracking_sessions
add column if not exists idempotency_key text;

create unique index if not exists tracking_sessions_source_idempotency_unique
on public.tracking_sessions (source, idempotency_key)
where idempotency_key is not null;

alter table public.tracking_points
add column if not exists idempotency_key text;

create unique index if not exists tracking_points_session_idempotency_unique
on public.tracking_points (tracking_session_id, idempotency_key)
where idempotency_key is not null;

alter table public.notification_messages
add column if not exists source text not null default 'platform.notification_engine'
  check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$');

alter table public.notification_messages
add column if not exists idempotency_key text;

create unique index if not exists notification_messages_source_idempotency_unique
on public.notification_messages (source, idempotency_key)
where idempotency_key is not null;

alter table public.ai_task_runs
add column if not exists source text not null default 'platform.ai_engine'
  check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$');

alter table public.ai_task_runs
add column if not exists idempotency_key text;

create unique index if not exists ai_task_runs_source_idempotency_unique
on public.ai_task_runs (source, idempotency_key)
where idempotency_key is not null;

alter table public.map_service_requests
add column if not exists source text not null default 'platform.maps_engine'
  check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$');

alter table public.map_service_requests
add column if not exists idempotency_key text;

create unique index if not exists map_service_requests_source_idempotency_unique
on public.map_service_requests (source, idempotency_key)
where idempotency_key is not null;

create table if not exists public.dispatch_request_events (
  id uuid primary key default gen_random_uuid(),
  dispatch_request_id uuid not null references public.dispatch_requests(id) on delete cascade,
  status text not null
    check (status in ('pending', 'matching', 'assigned', 'cancelled', 'expired', 'completed')),
  assigned_entity_type text
    check (assigned_entity_type is null or assigned_entity_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  assigned_entity_id uuid,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  check (
    (status = 'assigned' and assigned_entity_type is not null and assigned_entity_id is not null)
    or status <> 'assigned'
  ),
  unique (dispatch_request_id, idempotency_key)
);

create table if not exists public.tracking_session_events (
  id uuid primary key default gen_random_uuid(),
  tracking_session_id uuid not null references public.tracking_sessions(id) on delete cascade,
  status text not null
    check (status in ('active', 'paused', 'completed', 'cancelled')),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  unique (tracking_session_id, idempotency_key)
);

create table if not exists public.notification_message_events (
  id uuid primary key default gen_random_uuid(),
  notification_message_id uuid not null references public.notification_messages(id) on delete cascade,
  status text not null
    check (status in ('queued', 'sent', 'delivered', 'failed', 'cancelled')),
  provider_message_id text,
  error_message text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  unique (notification_message_id, idempotency_key)
);

create table if not exists public.ai_task_run_events (
  id uuid primary key default gen_random_uuid(),
  ai_task_run_id uuid not null references public.ai_task_runs(id) on delete cascade,
  status text not null
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  output jsonb not null default '{}'::jsonb
    check (jsonb_typeof(output) = 'object'),
  model_info jsonb not null default '{}'::jsonb
    check (jsonb_typeof(model_info) = 'object'),
  error_message text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  unique (ai_task_run_id, idempotency_key)
);

create or replace function public.record_verification_event(
  target_definition_key text,
  target_source text,
  target_scanned_entity_type text,
  target_scanned_entity_id uuid default null,
  target_purpose text default null,
  target_location jsonb default '{}'::jsonb,
  target_result text default 'pending',
  target_payload jsonb default '{}'::jsonb,
  target_idempotency_key text default null,
  target_occurred_at timestamptz default timezone('utc', now())
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  definition_record record;
  existing_record record;
  triggered_event_id uuid;
  verification_event_id uuid;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_definition_key is null
    or target_definition_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_definition_key must be a valid platform key';
  end if;

  select definition.id, definition.event_type_key
  into definition_record
  from public.verification_definitions definition
  where definition.key = target_definition_key
    and definition.status = 'active';

  if not found then
    raise exception 'target_definition_key must reference an active verification definition';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_scanned_entity_type is null
    or target_scanned_entity_type !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_scanned_entity_type must be a valid platform key';
  end if;

  if target_purpose is null
    or target_purpose !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_purpose must be a valid platform key';
  end if;

  if target_result is null
    or target_result not in ('pending', 'passed', 'failed', 'flagged', 'cancelled') then
    raise exception 'target_result is not supported';
  end if;

  if target_location is null
    or jsonb_typeof(target_location) <> 'object' then
    raise exception 'target_location must be a JSON object';
  end if;

  if target_payload is null
    or jsonb_typeof(target_payload) <> 'object' then
    raise exception 'target_payload must be a JSON object';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select existing.*
  into existing_record
  from public.verification_events existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    if existing_record.definition_id <> definition_record.id
      or existing_record.scanned_entity_type <> target_scanned_entity_type
      or existing_record.scanned_entity_id is distinct from target_scanned_entity_id
      or existing_record.purpose <> target_purpose
      or existing_record.location <> target_location
      or existing_record.result <> target_result
      or existing_record.payload <> target_payload then
      raise exception 'target_idempotency_key has already been used with different verification details';
    end if;

    return existing_record.id;
  end if;

  if definition_record.event_type_key is not null then
    if target_scanned_entity_id is null then
      raise exception 'target_scanned_entity_id is required when a verification triggers an event';
    end if;

    triggered_event_id := public.record_platform_event(
      definition_record.event_type_key,
      target_source,
      target_scanned_entity_type,
      target_scanned_entity_id,
      target_payload || jsonb_build_object(
        'verification_definition_key',
        target_definition_key,
        'verification_purpose',
        target_purpose,
        'verification_result',
        target_result
      ),
      target_idempotency_key || ':event',
      coalesce(target_occurred_at, timezone('utc', now()))
    );
  end if;

  insert into public.verification_events (
    definition_id,
    scanned_by,
    scanned_entity_type,
    scanned_entity_id,
    purpose,
    location,
    result,
    payload,
    triggered_event_id,
    occurred_at,
    source,
    idempotency_key
  )
  values (
    definition_record.id,
    auth.uid(),
    target_scanned_entity_type,
    target_scanned_entity_id,
    target_purpose,
    target_location,
    target_result,
    target_payload,
    triggered_event_id,
    coalesce(target_occurred_at, timezone('utc', now())),
    target_source,
    target_idempotency_key
  )
  returning id into verification_event_id;

  return verification_event_id;
end;
$$;

create or replace function public.create_dispatch_request(
  target_policy_key text default null,
  target_source text default null,
  target_subject_type text default null,
  target_subject_id uuid default null,
  target_required_capabilities jsonb default '{}'::jsonb,
  target_pickup_location jsonb default '{}'::jsonb,
  target_dropoff_location jsonb default '{}'::jsonb,
  target_priority integer default 100,
  target_metadata jsonb default '{}'::jsonb,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_policy_id uuid;
  dispatch_request_id uuid;
  existing_record record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.dispatch.manage', null) then
    raise exception 'platform dispatch management permission is required';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_subject_type is null
    or target_subject_type !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_subject_type must be a valid platform key';
  end if;

  if target_subject_id is null then
    raise exception 'target_subject_id is required';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_required_capabilities is null
    or jsonb_typeof(target_required_capabilities) <> 'object'
    or target_pickup_location is null
    or jsonb_typeof(target_pickup_location) <> 'object'
    or target_dropoff_location is null
    or jsonb_typeof(target_dropoff_location) <> 'object'
    or target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'dispatch request JSON inputs must be objects';
  end if;

  if target_policy_key is not null then
    if target_policy_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
      raise exception 'target_policy_key must be a valid platform key';
    end if;

    select policy.id
    into target_policy_id
    from public.dispatch_policies policy
    where policy.key = target_policy_key
      and policy.status = 'active';

    if not found then
      raise exception 'target_policy_key must reference an active dispatch policy';
    end if;
  end if;

  insert into public.dispatch_requests (
    policy_id,
    subject_type,
    subject_id,
    requester_user_id,
    required_capabilities,
    pickup_location,
    dropoff_location,
    priority,
    status,
    metadata,
    source,
    idempotency_key
  )
  values (
    target_policy_id,
    target_subject_type,
    target_subject_id,
    auth.uid(),
    target_required_capabilities,
    target_pickup_location,
    target_dropoff_location,
    target_priority,
    'pending',
    target_metadata,
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key)
  where idempotency_key is not null
  do nothing
  returning id into dispatch_request_id;

  if dispatch_request_id is null then
    select existing.*
    into existing_record
    from public.dispatch_requests existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'dispatch request idempotency lookup failed';
    end if;

    if existing_record.policy_id is distinct from target_policy_id
      or existing_record.subject_type <> target_subject_type
      or existing_record.subject_id <> target_subject_id
      or existing_record.required_capabilities <> target_required_capabilities
      or existing_record.pickup_location <> target_pickup_location
      or existing_record.dropoff_location <> target_dropoff_location
      or existing_record.priority <> target_priority
      or existing_record.metadata <> target_metadata then
      raise exception 'target_idempotency_key has already been used with different dispatch details';
    end if;

    return existing_record.id;
  end if;

  insert into public.dispatch_request_events (
    dispatch_request_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    dispatch_request_id,
    'pending',
    target_idempotency_key || ':created',
    jsonb_build_object('source', target_source)
  )
  on conflict do nothing;

  return dispatch_request_id;
end;
$$;

create or replace function public.upsert_dispatch_candidate(
  target_dispatch_request_id uuid default null,
  target_candidate_entity_type text default null,
  target_candidate_entity_id uuid default null,
  target_score numeric default 0,
  target_rank integer default null,
  target_rationale jsonb default '{}'::jsonb,
  target_status text default 'suggested',
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record record;
  candidate_id uuid;
  existing_record record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.dispatch.manage', null) then
    raise exception 'platform dispatch management permission is required';
  end if;

  if target_dispatch_request_id is null then
    raise exception 'target_dispatch_request_id is required';
  end if;

  if target_candidate_entity_type is null
    or target_candidate_entity_type !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_candidate_entity_type must be a valid platform key';
  end if;

  if target_candidate_entity_id is null then
    raise exception 'target_candidate_entity_id is required';
  end if;

  if target_status is null
    or target_status not in ('suggested', 'offered', 'accepted', 'rejected', 'expired') then
    raise exception 'target_status is not supported';
  end if;

  if target_rationale is null
    or jsonb_typeof(target_rationale) <> 'object' then
    raise exception 'target_rationale must be a JSON object';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select request.id, request.status
  into request_record
  from public.dispatch_requests request
  where request.id = target_dispatch_request_id
  for update;

  if not found then
    raise exception 'target_dispatch_request_id must reference an existing dispatch request';
  end if;

  if request_record.status not in ('pending', 'matching') then
    raise exception 'dispatch candidates can only be changed while a request is pending or matching';
  end if;

  select existing.*
  into existing_record
  from public.dispatch_candidates existing
  where existing.dispatch_request_id = target_dispatch_request_id
    and existing.idempotency_key = target_idempotency_key;

  if found then
    if existing_record.candidate_entity_type <> target_candidate_entity_type
      or existing_record.candidate_entity_id <> target_candidate_entity_id
      or existing_record.score <> target_score
      or existing_record.rank is distinct from target_rank
      or existing_record.rationale <> target_rationale
      or existing_record.status <> target_status then
      raise exception 'target_idempotency_key has already been used with different candidate details';
    end if;

    return existing_record.id;
  end if;

  insert into public.dispatch_candidates (
    dispatch_request_id,
    candidate_entity_type,
    candidate_entity_id,
    score,
    rank,
    rationale,
    status,
    idempotency_key
  )
  values (
    target_dispatch_request_id,
    target_candidate_entity_type,
    target_candidate_entity_id,
    target_score,
    target_rank,
    target_rationale,
    target_status,
    target_idempotency_key
  )
  on conflict (dispatch_request_id, candidate_entity_type, candidate_entity_id)
  do nothing
  returning id into candidate_id;

  if candidate_id is null then
    select existing.*
    into existing_record
    from public.dispatch_candidates existing
    where existing.dispatch_request_id = target_dispatch_request_id
      and existing.candidate_entity_type = target_candidate_entity_type
      and existing.candidate_entity_id = target_candidate_entity_id;

    if not found then
      raise exception 'dispatch candidate idempotency lookup failed';
    end if;

    if existing_record.score <> target_score
      or existing_record.rank is distinct from target_rank
      or existing_record.rationale <> target_rationale
      or existing_record.status <> target_status then
      raise exception 'dispatch candidate already exists with different details';
    end if;

    return existing_record.id;
  end if;

  update public.dispatch_requests
  set status = case when status = 'pending' then 'matching' else status end,
      updated_at = timezone('utc', now())
  where id = target_dispatch_request_id;

  return candidate_id;
end;
$$;

create or replace function public.assign_dispatch_request(
  target_dispatch_request_id uuid default null,
  target_assigned_entity_type text default null,
  target_assigned_entity_id uuid default null,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  request_record record;
  existing_event record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.dispatch.manage', null) then
    raise exception 'platform dispatch management permission is required';
  end if;

  if target_dispatch_request_id is null then
    raise exception 'target_dispatch_request_id is required';
  end if;

  if target_assigned_entity_type is null
    or target_assigned_entity_type !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_assigned_entity_type must be a valid platform key';
  end if;

  if target_assigned_entity_id is null then
    raise exception 'target_assigned_entity_id is required';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select event.*
  into existing_event
  from public.dispatch_request_events event
  where event.dispatch_request_id = target_dispatch_request_id
    and event.idempotency_key = target_idempotency_key;

  if found then
    if existing_event.status <> 'assigned'
      or existing_event.assigned_entity_type <> target_assigned_entity_type
      or existing_event.assigned_entity_id <> target_assigned_entity_id
      or existing_event.metadata <> target_metadata then
      raise exception 'target_idempotency_key has already been used with different dispatch assignment details';
    end if;

    return target_dispatch_request_id;
  end if;

  select request.*
  into request_record
  from public.dispatch_requests request
  where request.id = target_dispatch_request_id
  for update;

  if not found then
    raise exception 'target_dispatch_request_id must reference an existing dispatch request';
  end if;

  if request_record.status not in ('pending', 'matching') then
    if request_record.status = 'assigned'
      and request_record.assigned_entity_type = target_assigned_entity_type
      and request_record.assigned_entity_id = target_assigned_entity_id then
      return target_dispatch_request_id;
    end if;

    raise exception 'dispatch request is not assignable from its current status';
  end if;

  update public.dispatch_requests
  set status = 'assigned',
      assigned_entity_type = target_assigned_entity_type,
      assigned_entity_id = target_assigned_entity_id,
      metadata = metadata || target_metadata,
      updated_at = timezone('utc', now())
  where id = target_dispatch_request_id;

  insert into public.dispatch_request_events (
    dispatch_request_id,
    status,
    assigned_entity_type,
    assigned_entity_id,
    idempotency_key,
    metadata
  )
  values (
    target_dispatch_request_id,
    'assigned',
    target_assigned_entity_type,
    target_assigned_entity_id,
    target_idempotency_key,
    target_metadata
  );

  return target_dispatch_request_id;
end;
$$;

create or replace function public.start_tracking_session(
  target_source text default null,
  target_subject_type text default null,
  target_subject_id uuid default null,
  target_provider_adapter_id uuid default null,
  target_metadata jsonb default '{}'::jsonb,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tracking_session_id uuid;
  existing_record record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.tracking.manage', null) then
    raise exception 'platform tracking management permission is required';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_subject_type is null
    or target_subject_type !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_subject_type must be a valid platform key';
  end if;

  if target_subject_id is null then
    raise exception 'target_subject_id is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_provider_adapter_id is not null
    and not exists (
      select 1
      from public.provider_adapters provider
      where provider.id = target_provider_adapter_id
        and provider.provider_kind = 'maps'
        and provider.status = 'active'
    ) then
    raise exception 'target_provider_adapter_id must reference an active maps provider adapter';
  end if;

  insert into public.tracking_sessions (
    subject_type,
    subject_id,
    provider_adapter_id,
    status,
    started_by,
    metadata,
    source,
    idempotency_key
  )
  values (
    target_subject_type,
    target_subject_id,
    target_provider_adapter_id,
    'active',
    auth.uid(),
    target_metadata,
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key)
  where idempotency_key is not null
  do nothing
  returning id into tracking_session_id;

  if tracking_session_id is null then
    select existing.*
    into existing_record
    from public.tracking_sessions existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'tracking session idempotency lookup failed';
    end if;

    if existing_record.subject_type <> target_subject_type
      or existing_record.subject_id <> target_subject_id
      or existing_record.provider_adapter_id is distinct from target_provider_adapter_id
      or existing_record.metadata <> target_metadata then
      raise exception 'target_idempotency_key has already been used with different tracking session details';
    end if;

    return existing_record.id;
  end if;

  insert into public.tracking_session_events (
    tracking_session_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    tracking_session_id,
    'active',
    target_idempotency_key || ':started',
    jsonb_build_object('source', target_source)
  )
  on conflict do nothing;

  return tracking_session_id;
end;
$$;

create or replace function public.record_tracking_point(
  target_tracking_session_id uuid default null,
  target_latitude numeric default null,
  target_longitude numeric default null,
  target_accuracy_meters numeric default null,
  target_speed_meters_per_second numeric default null,
  target_heading_degrees numeric default null,
  target_metadata jsonb default '{}'::jsonb,
  target_recorded_at timestamptz default timezone('utc', now()),
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tracking_session record;
  tracking_point_id uuid;
  existing_record record;
begin
  if target_tracking_session_id is null then
    raise exception 'target_tracking_session_id is required';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select session.*
  into tracking_session
  from public.tracking_sessions session
  where session.id = target_tracking_session_id
  for update;

  if not found then
    raise exception 'target_tracking_session_id must reference an existing tracking session';
  end if;

  if auth.role() <> 'service_role'
    and tracking_session.started_by is distinct from auth.uid()
    and not public.has_permission('platform.tracking.manage', null) then
    raise exception 'platform tracking management permission is required';
  end if;

  if tracking_session.status <> 'active' then
    raise exception 'tracking points can only be recorded for active sessions';
  end if;

  if target_latitude is null or target_latitude < -90 or target_latitude > 90 then
    raise exception 'target_latitude must be between -90 and 90';
  end if;

  if target_longitude is null or target_longitude < -180 or target_longitude > 180 then
    raise exception 'target_longitude must be between -180 and 180';
  end if;

  if target_accuracy_meters is not null and target_accuracy_meters < 0 then
    raise exception 'target_accuracy_meters must be greater than or equal to zero';
  end if;

  if target_speed_meters_per_second is not null and target_speed_meters_per_second < 0 then
    raise exception 'target_speed_meters_per_second must be greater than or equal to zero';
  end if;

  if target_heading_degrees is not null
    and (target_heading_degrees < 0 or target_heading_degrees >= 360) then
    raise exception 'target_heading_degrees must be greater than or equal to zero and less than 360';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  insert into public.tracking_points (
    tracking_session_id,
    recorded_by,
    latitude,
    longitude,
    accuracy_meters,
    speed_meters_per_second,
    heading_degrees,
    metadata,
    recorded_at,
    idempotency_key
  )
  values (
    target_tracking_session_id,
    auth.uid(),
    target_latitude,
    target_longitude,
    target_accuracy_meters,
    target_speed_meters_per_second,
    target_heading_degrees,
    target_metadata,
    coalesce(target_recorded_at, timezone('utc', now())),
    target_idempotency_key
  )
  on conflict (tracking_session_id, idempotency_key)
  where idempotency_key is not null
  do nothing
  returning id into tracking_point_id;

  if tracking_point_id is null then
    select existing.*
    into existing_record
    from public.tracking_points existing
    where existing.tracking_session_id = target_tracking_session_id
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'tracking point idempotency lookup failed';
    end if;

    if existing_record.latitude <> target_latitude
      or existing_record.longitude <> target_longitude
      or existing_record.accuracy_meters is distinct from target_accuracy_meters
      or existing_record.speed_meters_per_second is distinct from target_speed_meters_per_second
      or existing_record.heading_degrees is distinct from target_heading_degrees
      or existing_record.metadata <> target_metadata then
      raise exception 'target_idempotency_key has already been used with different tracking point details';
    end if;

    return existing_record.id;
  end if;

  return tracking_point_id;
end;
$$;

create or replace function public.update_tracking_session_status(
  target_tracking_session_id uuid default null,
  target_status text default null,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  tracking_session record;
  existing_event record;
begin
  if target_tracking_session_id is null then
    raise exception 'target_tracking_session_id is required';
  end if;

  if target_status is null
    or target_status not in ('active', 'paused', 'completed', 'cancelled') then
    raise exception 'target_status is not supported';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select event.*
  into existing_event
  from public.tracking_session_events event
  where event.tracking_session_id = target_tracking_session_id
    and event.idempotency_key = target_idempotency_key;

  if found then
    if existing_event.status <> target_status
      or existing_event.metadata <> target_metadata then
      raise exception 'target_idempotency_key has already been used with different tracking status details';
    end if;

    return target_tracking_session_id;
  end if;

  select session.*
  into tracking_session
  from public.tracking_sessions session
  where session.id = target_tracking_session_id
  for update;

  if not found then
    raise exception 'target_tracking_session_id must reference an existing tracking session';
  end if;

  if auth.role() <> 'service_role'
    and tracking_session.started_by is distinct from auth.uid()
    and not public.has_permission('platform.tracking.manage', null) then
    raise exception 'platform tracking management permission is required';
  end if;

  if tracking_session.status in ('completed', 'cancelled')
    and tracking_session.status <> target_status then
    raise exception 'terminal tracking sessions cannot change status';
  end if;

  update public.tracking_sessions
  set status = target_status,
      ended_at = case
        when target_status in ('completed', 'cancelled') then timezone('utc', now())
        else ended_at
      end,
      metadata = metadata || target_metadata,
      updated_at = timezone('utc', now())
  where id = target_tracking_session_id;

  insert into public.tracking_session_events (
    tracking_session_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    target_tracking_session_id,
    target_status,
    target_idempotency_key,
    target_metadata
  );

  return target_tracking_session_id;
end;
$$;

create or replace function public.queue_notification_message(
  target_template_key text default null,
  target_channel text default null,
  target_recipient_entity_type text default null,
  target_recipient_entity_id uuid default null,
  target_recipient_address text default null,
  target_provider_adapter_id uuid default null,
  target_payload jsonb default '{}'::jsonb,
  target_source text default null,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_template_channel text;
  target_template_id uuid;
  notification_message_id uuid;
  existing_record record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.notifications.manage', null) then
    raise exception 'platform notification management permission is required';
  end if;

  if target_channel is null
    or target_channel not in ('push', 'sms', 'email', 'whatsapp', 'voice', 'in_app', 'future') then
    raise exception 'target_channel is not supported';
  end if;

  if target_recipient_entity_type is null
    or target_recipient_entity_type !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_recipient_entity_type must be a valid platform key';
  end if;

  if target_recipient_entity_id is null
    and (target_recipient_address is null or btrim(target_recipient_address) = '') then
    raise exception 'target_recipient_entity_id or target_recipient_address is required';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_payload is null
    or jsonb_typeof(target_payload) <> 'object' then
    raise exception 'target_payload must be a JSON object';
  end if;

  if target_template_key is not null then
    if target_template_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
      raise exception 'target_template_key must be a valid platform key';
    end if;

    select template.id, template.channel
    into target_template_id, target_template_channel
    from public.notification_templates template
    where template.key = target_template_key
      and template.status = 'active';

    if not found then
      raise exception 'target_template_key must reference an active notification template';
    end if;

    if target_template_channel <> target_channel then
      raise exception 'target_channel must match the notification template channel';
    end if;
  end if;

  if target_provider_adapter_id is not null
    and not exists (
      select 1
      from public.provider_adapters provider
      where provider.id = target_provider_adapter_id
        and provider.provider_kind = 'notification'
        and provider.status = 'active'
    ) then
    raise exception 'target_provider_adapter_id must reference an active notification provider adapter';
  end if;

  insert into public.notification_messages (
    template_id,
    channel,
    recipient_entity_type,
    recipient_entity_id,
    recipient_address,
    status,
    provider_adapter_id,
    payload,
    created_by,
    source,
    idempotency_key
  )
  values (
    target_template_id,
    target_channel,
    target_recipient_entity_type,
    target_recipient_entity_id,
    target_recipient_address,
    'queued',
    target_provider_adapter_id,
    target_payload,
    auth.uid(),
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key)
  where idempotency_key is not null
  do nothing
  returning id into notification_message_id;

  if notification_message_id is null then
    select existing.*
    into existing_record
    from public.notification_messages existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'notification message idempotency lookup failed';
    end if;

    if existing_record.template_id is distinct from target_template_id
      or existing_record.channel <> target_channel
      or existing_record.recipient_entity_type <> target_recipient_entity_type
      or existing_record.recipient_entity_id is distinct from target_recipient_entity_id
      or existing_record.recipient_address is distinct from target_recipient_address
      or existing_record.provider_adapter_id is distinct from target_provider_adapter_id
      or existing_record.payload <> target_payload then
      raise exception 'target_idempotency_key has already been used with different notification details';
    end if;

    return existing_record.id;
  end if;

  insert into public.notification_message_events (
    notification_message_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    notification_message_id,
    'queued',
    target_idempotency_key || ':queued',
    jsonb_build_object('source', target_source)
  )
  on conflict do nothing;

  return notification_message_id;
end;
$$;

create or replace function public.update_notification_message_status(
  target_notification_message_id uuid default null,
  target_status text default null,
  target_provider_message_id text default null,
  target_error_message text default null,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  message_record record;
  existing_event record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.notifications.manage', null) then
    raise exception 'platform notification management permission is required';
  end if;

  if target_notification_message_id is null then
    raise exception 'target_notification_message_id is required';
  end if;

  if target_status is null
    or target_status not in ('queued', 'sent', 'delivered', 'failed', 'cancelled') then
    raise exception 'target_status is not supported';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select event.*
  into existing_event
  from public.notification_message_events event
  where event.notification_message_id = target_notification_message_id
    and event.idempotency_key = target_idempotency_key;

  if found then
    if existing_event.status <> target_status
      or existing_event.provider_message_id is distinct from target_provider_message_id
      or existing_event.error_message is distinct from target_error_message
      or existing_event.metadata <> target_metadata then
      raise exception 'target_idempotency_key has already been used with different notification status details';
    end if;

    return target_notification_message_id;
  end if;

  select message.*
  into message_record
  from public.notification_messages message
  where message.id = target_notification_message_id
  for update;

  if not found then
    raise exception 'target_notification_message_id must reference an existing notification message';
  end if;

  if message_record.status in ('delivered', 'failed', 'cancelled')
    and message_record.status <> target_status then
    raise exception 'terminal notification messages cannot change status';
  end if;

  if message_record.status = 'queued'
    and target_status not in ('queued', 'sent', 'failed', 'cancelled') then
    raise exception 'queued notification messages cannot move to target_status';
  end if;

  if message_record.status = 'sent'
    and target_status not in ('sent', 'delivered', 'failed', 'cancelled') then
    raise exception 'sent notification messages cannot move to target_status';
  end if;

  update public.notification_messages
  set status = target_status,
      provider_message_id = coalesce(target_provider_message_id, provider_message_id),
      error_message = target_error_message,
      sent_at = case
        when target_status = 'sent' and sent_at is null then timezone('utc', now())
        else sent_at
      end,
      delivered_at = case
        when target_status = 'delivered' and delivered_at is null then timezone('utc', now())
        else delivered_at
      end,
      updated_at = timezone('utc', now())
  where id = target_notification_message_id;

  insert into public.notification_message_events (
    notification_message_id,
    status,
    provider_message_id,
    error_message,
    idempotency_key,
    metadata
  )
  values (
    target_notification_message_id,
    target_status,
    target_provider_message_id,
    target_error_message,
    target_idempotency_key,
    target_metadata
  );

  return target_notification_message_id;
end;
$$;

create or replace function public.queue_ai_task_run(
  target_task_key text default null,
  target_source text default null,
  target_subject_type text default null,
  target_subject_id uuid default null,
  target_input jsonb default '{}'::jsonb,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  task_definition record;
  ai_task_run_id uuid;
  existing_record record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.ai.manage', null) then
    raise exception 'platform AI management permission is required';
  end if;

  if target_task_key is null
    or target_task_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_task_key must be a valid platform key';
  end if;

  select definition.id, definition.provider_adapter_id
  into task_definition
  from public.ai_task_definitions definition
  where definition.key = target_task_key
    and definition.status = 'active';

  if not found then
    raise exception 'target_task_key must reference an active AI task definition';
  end if;

  if task_definition.provider_adapter_id is not null
    and not exists (
      select 1
      from public.provider_adapters provider
      where provider.id = task_definition.provider_adapter_id
        and provider.provider_kind = 'ai'
        and provider.status = 'active'
    ) then
    raise exception 'AI task definition must reference an active AI provider adapter';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_subject_type is null
    or target_subject_type !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_subject_type must be a valid platform key';
  end if;

  if target_input is null
    or jsonb_typeof(target_input) <> 'object' then
    raise exception 'target_input must be a JSON object';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  insert into public.ai_task_runs (
    task_definition_id,
    subject_type,
    subject_id,
    status,
    input,
    requested_by,
    source,
    idempotency_key
  )
  values (
    task_definition.id,
    target_subject_type,
    target_subject_id,
    'queued',
    target_input,
    auth.uid(),
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key)
  where idempotency_key is not null
  do nothing
  returning id into ai_task_run_id;

  if ai_task_run_id is null then
    select existing.*
    into existing_record
    from public.ai_task_runs existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'AI task run idempotency lookup failed';
    end if;

    if existing_record.task_definition_id <> task_definition.id
      or existing_record.subject_type <> target_subject_type
      or existing_record.subject_id is distinct from target_subject_id
      or existing_record.input <> target_input then
      raise exception 'target_idempotency_key has already been used with different AI task details';
    end if;

    return existing_record.id;
  end if;

  insert into public.ai_task_run_events (
    ai_task_run_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    ai_task_run_id,
    'queued',
    target_idempotency_key || ':queued',
    jsonb_build_object('source', target_source)
  )
  on conflict do nothing;

  return ai_task_run_id;
end;
$$;

create or replace function public.update_ai_task_run_status(
  target_ai_task_run_id uuid default null,
  target_status text default null,
  target_output jsonb default '{}'::jsonb,
  target_model_info jsonb default '{}'::jsonb,
  target_error_message text default null,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  task_run_record record;
  existing_event record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.ai.manage', null) then
    raise exception 'platform AI management permission is required';
  end if;

  if target_ai_task_run_id is null then
    raise exception 'target_ai_task_run_id is required';
  end if;

  if target_status is null
    or target_status not in ('queued', 'running', 'completed', 'failed', 'cancelled') then
    raise exception 'target_status is not supported';
  end if;

  if target_output is null
    or jsonb_typeof(target_output) <> 'object'
    or target_model_info is null
    or jsonb_typeof(target_model_info) <> 'object'
    or target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'AI task runtime JSON inputs must be objects';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select event.*
  into existing_event
  from public.ai_task_run_events event
  where event.ai_task_run_id = target_ai_task_run_id
    and event.idempotency_key = target_idempotency_key;

  if found then
    if existing_event.status <> target_status
      or existing_event.output <> target_output
      or existing_event.model_info <> target_model_info
      or existing_event.error_message is distinct from target_error_message
      or existing_event.metadata <> target_metadata then
      raise exception 'target_idempotency_key has already been used with different AI task status details';
    end if;

    return target_ai_task_run_id;
  end if;

  select task_run.*
  into task_run_record
  from public.ai_task_runs task_run
  where task_run.id = target_ai_task_run_id
  for update;

  if not found then
    raise exception 'target_ai_task_run_id must reference an existing AI task run';
  end if;

  if task_run_record.status in ('completed', 'failed', 'cancelled')
    and task_run_record.status <> target_status then
    raise exception 'terminal AI task runs cannot change status';
  end if;

  if task_run_record.status = 'queued'
    and target_status not in ('queued', 'running', 'failed', 'cancelled') then
    raise exception 'queued AI task runs cannot move to target_status';
  end if;

  if task_run_record.status = 'running'
    and target_status not in ('running', 'completed', 'failed', 'cancelled') then
    raise exception 'running AI task runs cannot move to target_status';
  end if;

  update public.ai_task_runs
  set status = target_status,
      output = case
        when target_status in ('completed', 'failed') then target_output
        else output
      end,
      model_info = case
        when target_status in ('running', 'completed', 'failed') then target_model_info
        else model_info
      end,
      error_message = target_error_message,
      started_at = case
        when target_status = 'running' and started_at is null then timezone('utc', now())
        else started_at
      end,
      completed_at = case
        when target_status in ('completed', 'failed', 'cancelled') then timezone('utc', now())
        else completed_at
      end,
      updated_at = timezone('utc', now())
  where id = target_ai_task_run_id;

  insert into public.ai_task_run_events (
    ai_task_run_id,
    status,
    output,
    model_info,
    error_message,
    idempotency_key,
    metadata
  )
  values (
    target_ai_task_run_id,
    target_status,
    target_output,
    target_model_info,
    target_error_message,
    target_idempotency_key,
    target_metadata
  );

  return target_ai_task_run_id;
end;
$$;

create or replace function public.queue_map_service_request(
  target_provider_adapter_id uuid default null,
  target_request_type text default null,
  target_subject_type text default null,
  target_subject_id uuid default null,
  target_request_payload jsonb default '{}'::jsonb,
  target_source text default null,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  map_request_id uuid;
  existing_record record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.maps.manage', null) then
    raise exception 'platform maps management permission is required';
  end if;

  if target_request_type is null
    or target_request_type not in (
      'geocode',
      'reverse_geocode',
      'route',
      'distance_matrix',
      'eta',
      'geofence'
    ) then
    raise exception 'target_request_type is not supported';
  end if;

  if target_subject_type is not null
    and target_subject_type !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_subject_type must be a valid platform key';
  end if;

  if target_request_payload is null
    or jsonb_typeof(target_request_payload) <> 'object' then
    raise exception 'target_request_payload must be a JSON object';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_provider_adapter_id is not null
    and not exists (
      select 1
      from public.provider_adapters provider
      where provider.id = target_provider_adapter_id
        and provider.provider_kind = 'maps'
        and provider.status = 'active'
    ) then
    raise exception 'target_provider_adapter_id must reference an active maps provider adapter';
  end if;

  insert into public.map_service_requests (
    provider_adapter_id,
    request_type,
    subject_type,
    subject_id,
    request_payload,
    status,
    requested_by,
    source,
    idempotency_key
  )
  values (
    target_provider_adapter_id,
    target_request_type,
    target_subject_type,
    target_subject_id,
    target_request_payload,
    'queued',
    auth.uid(),
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key)
  where idempotency_key is not null
  do nothing
  returning id into map_request_id;

  if map_request_id is null then
    select existing.*
    into existing_record
    from public.map_service_requests existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'map service request idempotency lookup failed';
    end if;

    if existing_record.provider_adapter_id is distinct from target_provider_adapter_id
      or existing_record.request_type <> target_request_type
      or existing_record.subject_type is distinct from target_subject_type
      or existing_record.subject_id is distinct from target_subject_id
      or existing_record.request_payload <> target_request_payload then
      raise exception 'target_idempotency_key has already been used with different map request details';
    end if;

    return existing_record.id;
  end if;

  return map_request_id;
end;
$$;

create or replace function public.prevent_operational_runtime_event_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'operational runtime event records are append-only';
end;
$$;

do $$
declare
  target_table text;
begin
  foreach target_table in array array[
    'verification_events',
    'tracking_points',
    'dispatch_request_events',
    'tracking_session_events',
    'notification_message_events',
    'ai_task_run_events'
  ] loop
    execute format(
      'drop trigger if exists prevent_%I_update on public.%I',
      target_table,
      target_table
    );
    execute format(
      'create trigger prevent_%I_update before update on public.%I for each row execute function public.prevent_operational_runtime_event_mutation()',
      target_table,
      target_table
    );
    execute format(
      'drop trigger if exists prevent_%I_delete on public.%I',
      target_table,
      target_table
    );
    execute format(
      'create trigger prevent_%I_delete before delete on public.%I for each row execute function public.prevent_operational_runtime_event_mutation()',
      target_table,
      target_table
    );
  end loop;
end $$;

alter table public.dispatch_request_events enable row level security;
alter table public.tracking_session_events enable row level security;
alter table public.notification_message_events enable row level security;
alter table public.ai_task_run_events enable row level security;

drop policy if exists verification_events_insert_actor_or_privileged on public.verification_events;
drop policy if exists verification_events_no_direct_insert on public.verification_events;
drop policy if exists dispatch_requests_manage_privileged on public.dispatch_requests;
drop policy if exists dispatch_requests_no_direct_insert on public.dispatch_requests;
drop policy if exists dispatch_requests_no_direct_update on public.dispatch_requests;
drop policy if exists dispatch_requests_no_direct_delete on public.dispatch_requests;
drop policy if exists dispatch_candidates_manage_privileged on public.dispatch_candidates;
drop policy if exists dispatch_candidates_no_direct_insert on public.dispatch_candidates;
drop policy if exists dispatch_candidates_no_direct_update on public.dispatch_candidates;
drop policy if exists dispatch_candidates_no_direct_delete on public.dispatch_candidates;
drop policy if exists tracking_sessions_manage_actor_or_privileged on public.tracking_sessions;
drop policy if exists tracking_sessions_no_direct_insert on public.tracking_sessions;
drop policy if exists tracking_sessions_no_direct_update on public.tracking_sessions;
drop policy if exists tracking_sessions_no_direct_delete on public.tracking_sessions;
drop policy if exists tracking_points_insert_actor_or_privileged on public.tracking_points;
drop policy if exists tracking_points_no_direct_insert on public.tracking_points;
drop policy if exists notification_messages_manage_privileged on public.notification_messages;
drop policy if exists notification_messages_no_direct_insert on public.notification_messages;
drop policy if exists notification_messages_no_direct_update on public.notification_messages;
drop policy if exists notification_messages_no_direct_delete on public.notification_messages;
drop policy if exists ai_task_runs_manage_privileged on public.ai_task_runs;
drop policy if exists ai_task_runs_no_direct_insert on public.ai_task_runs;
drop policy if exists ai_task_runs_no_direct_update on public.ai_task_runs;
drop policy if exists ai_task_runs_no_direct_delete on public.ai_task_runs;
drop policy if exists map_service_requests_manage_privileged on public.map_service_requests;
drop policy if exists map_service_requests_no_direct_insert on public.map_service_requests;
drop policy if exists map_service_requests_no_direct_update on public.map_service_requests;
drop policy if exists map_service_requests_no_direct_delete on public.map_service_requests;

create policy verification_events_no_direct_insert on public.verification_events
for insert to authenticated
with check (false);

create policy dispatch_requests_no_direct_insert on public.dispatch_requests
for insert to authenticated
with check (false);

create policy dispatch_requests_no_direct_update on public.dispatch_requests
for update to authenticated
using (false)
with check (false);

create policy dispatch_requests_no_direct_delete on public.dispatch_requests
for delete to authenticated
using (false);

create policy dispatch_candidates_no_direct_insert on public.dispatch_candidates
for insert to authenticated
with check (false);

create policy dispatch_candidates_no_direct_update on public.dispatch_candidates
for update to authenticated
using (false)
with check (false);

create policy dispatch_candidates_no_direct_delete on public.dispatch_candidates
for delete to authenticated
using (false);

create policy tracking_sessions_no_direct_insert on public.tracking_sessions
for insert to authenticated
with check (false);

create policy tracking_sessions_no_direct_update on public.tracking_sessions
for update to authenticated
using (false)
with check (false);

create policy tracking_sessions_no_direct_delete on public.tracking_sessions
for delete to authenticated
using (false);

create policy tracking_points_no_direct_insert on public.tracking_points
for insert to authenticated
with check (false);

create policy notification_messages_no_direct_insert on public.notification_messages
for insert to authenticated
with check (false);

create policy notification_messages_no_direct_update on public.notification_messages
for update to authenticated
using (false)
with check (false);

create policy notification_messages_no_direct_delete on public.notification_messages
for delete to authenticated
using (false);

create policy ai_task_runs_no_direct_insert on public.ai_task_runs
for insert to authenticated
with check (false);

create policy ai_task_runs_no_direct_update on public.ai_task_runs
for update to authenticated
using (false)
with check (false);

create policy ai_task_runs_no_direct_delete on public.ai_task_runs
for delete to authenticated
using (false);

create policy map_service_requests_no_direct_insert on public.map_service_requests
for insert to authenticated
with check (false);

create policy map_service_requests_no_direct_update on public.map_service_requests
for update to authenticated
using (false)
with check (false);

create policy map_service_requests_no_direct_delete on public.map_service_requests
for delete to authenticated
using (false);

create policy dispatch_request_events_select_privileged
on public.dispatch_request_events
for select to authenticated
using (
  public.has_permission('platform.dispatch.read', null)
  or public.has_permission('platform.dispatch.manage', null)
);

create policy dispatch_request_events_no_direct_insert
on public.dispatch_request_events
for insert to authenticated
with check (false);

create policy dispatch_request_events_no_direct_update
on public.dispatch_request_events
for update to authenticated
using (false)
with check (false);

create policy dispatch_request_events_no_direct_delete
on public.dispatch_request_events
for delete to authenticated
using (false);

create policy tracking_session_events_select_actor_or_privileged
on public.tracking_session_events
for select to authenticated
using (
  exists (
    select 1
    from public.tracking_sessions session
    where session.id = tracking_session_events.tracking_session_id
      and session.started_by = auth.uid()
  )
  or public.has_permission('platform.tracking.read', null)
  or public.has_permission('platform.tracking.manage', null)
);

create policy tracking_session_events_no_direct_insert
on public.tracking_session_events
for insert to authenticated
with check (false);

create policy tracking_session_events_no_direct_update
on public.tracking_session_events
for update to authenticated
using (false)
with check (false);

create policy tracking_session_events_no_direct_delete
on public.tracking_session_events
for delete to authenticated
using (false);

create policy notification_message_events_select_recipient_or_privileged
on public.notification_message_events
for select to authenticated
using (
  exists (
    select 1
    from public.notification_messages message
    where message.id = notification_message_events.notification_message_id
      and message.recipient_entity_type = 'user'
      and message.recipient_entity_id = auth.uid()
  )
  or public.has_permission('platform.notifications.read', null)
  or public.has_permission('platform.notifications.manage', null)
);

create policy notification_message_events_no_direct_insert
on public.notification_message_events
for insert to authenticated
with check (false);

create policy notification_message_events_no_direct_update
on public.notification_message_events
for update to authenticated
using (false)
with check (false);

create policy notification_message_events_no_direct_delete
on public.notification_message_events
for delete to authenticated
using (false);

create policy ai_task_run_events_select_actor_or_privileged
on public.ai_task_run_events
for select to authenticated
using (
  exists (
    select 1
    from public.ai_task_runs run
    where run.id = ai_task_run_events.ai_task_run_id
      and run.requested_by = auth.uid()
  )
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
);

create policy ai_task_run_events_no_direct_insert
on public.ai_task_run_events
for insert to authenticated
with check (false);

create policy ai_task_run_events_no_direct_update
on public.ai_task_run_events
for update to authenticated
using (false)
with check (false);

create policy ai_task_run_events_no_direct_delete
on public.ai_task_run_events
for delete to authenticated
using (false);

grant select, insert, update, delete on
  public.dispatch_request_events,
  public.tracking_session_events,
  public.notification_message_events,
  public.ai_task_run_events
to authenticated;

grant select, insert, update, delete on
  public.dispatch_request_events,
  public.tracking_session_events,
  public.notification_message_events,
  public.ai_task_run_events
to service_role;

revoke all on function public.record_verification_event(text, text, text, uuid, text, jsonb, text, jsonb, text, timestamptz) from public;
revoke all on function public.create_dispatch_request(text, text, text, uuid, jsonb, jsonb, jsonb, integer, jsonb, text) from public;
revoke all on function public.upsert_dispatch_candidate(uuid, text, uuid, numeric, integer, jsonb, text, text) from public;
revoke all on function public.assign_dispatch_request(uuid, text, uuid, text, jsonb) from public;
revoke all on function public.start_tracking_session(text, text, uuid, uuid, jsonb, text) from public;
revoke all on function public.record_tracking_point(uuid, numeric, numeric, numeric, numeric, numeric, jsonb, timestamptz, text) from public;
revoke all on function public.update_tracking_session_status(uuid, text, text, jsonb) from public;
revoke all on function public.queue_notification_message(text, text, text, uuid, text, uuid, jsonb, text, text) from public;
revoke all on function public.update_notification_message_status(uuid, text, text, text, text, jsonb) from public;
revoke all on function public.queue_ai_task_run(text, text, text, uuid, jsonb, text) from public;
revoke all on function public.update_ai_task_run_status(uuid, text, jsonb, jsonb, text, text, jsonb) from public;
revoke all on function public.queue_map_service_request(uuid, text, text, uuid, jsonb, text, text) from public;

revoke all on function public.record_verification_event(text, text, text, uuid, text, jsonb, text, jsonb, text, timestamptz) from anon;
revoke all on function public.create_dispatch_request(text, text, text, uuid, jsonb, jsonb, jsonb, integer, jsonb, text) from anon;
revoke all on function public.upsert_dispatch_candidate(uuid, text, uuid, numeric, integer, jsonb, text, text) from anon;
revoke all on function public.assign_dispatch_request(uuid, text, uuid, text, jsonb) from anon;
revoke all on function public.start_tracking_session(text, text, uuid, uuid, jsonb, text) from anon;
revoke all on function public.record_tracking_point(uuid, numeric, numeric, numeric, numeric, numeric, jsonb, timestamptz, text) from anon;
revoke all on function public.update_tracking_session_status(uuid, text, text, jsonb) from anon;
revoke all on function public.queue_notification_message(text, text, text, uuid, text, uuid, jsonb, text, text) from anon;
revoke all on function public.update_notification_message_status(uuid, text, text, text, text, jsonb) from anon;
revoke all on function public.queue_ai_task_run(text, text, text, uuid, jsonb, text) from anon;
revoke all on function public.update_ai_task_run_status(uuid, text, jsonb, jsonb, text, text, jsonb) from anon;
revoke all on function public.queue_map_service_request(uuid, text, text, uuid, jsonb, text, text) from anon;

grant execute on function public.record_verification_event(text, text, text, uuid, text, jsonb, text, jsonb, text, timestamptz) to authenticated, service_role;
grant execute on function public.create_dispatch_request(text, text, text, uuid, jsonb, jsonb, jsonb, integer, jsonb, text) to authenticated, service_role;
grant execute on function public.upsert_dispatch_candidate(uuid, text, uuid, numeric, integer, jsonb, text, text) to authenticated, service_role;
grant execute on function public.assign_dispatch_request(uuid, text, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.start_tracking_session(text, text, uuid, uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.record_tracking_point(uuid, numeric, numeric, numeric, numeric, numeric, jsonb, timestamptz, text) to authenticated, service_role;
grant execute on function public.update_tracking_session_status(uuid, text, text, jsonb) to authenticated, service_role;
grant execute on function public.queue_notification_message(text, text, text, uuid, text, uuid, jsonb, text, text) to authenticated, service_role;
grant execute on function public.update_notification_message_status(uuid, text, text, text, text, jsonb) to authenticated, service_role;
grant execute on function public.queue_ai_task_run(text, text, text, uuid, jsonb, text) to authenticated, service_role;
grant execute on function public.update_ai_task_run_status(uuid, text, jsonb, jsonb, text, text, jsonb) to authenticated, service_role;
grant execute on function public.queue_map_service_request(uuid, text, text, uuid, jsonb, text, text) to authenticated, service_role;

commit;
