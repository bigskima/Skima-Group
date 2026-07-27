begin;

alter table public.workflow_instances
add column if not exists source text not null default 'platform.workflow_engine'
  check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$');

alter table public.workflow_instances
add column if not exists idempotency_key text;

create unique index if not exists workflow_instances_source_idempotency_unique
on public.workflow_instances (source, idempotency_key)
where idempotency_key is not null;

create table if not exists public.workflow_instance_events (
  id uuid primary key default gen_random_uuid(),
  workflow_instance_id uuid not null references public.workflow_instances(id) on delete cascade,
  event_id uuid not null references public.event_log(id) on delete restrict,
  from_state_key text not null,
  to_state_key text not null,
  idempotency_key text not null,
  action_policy_keys text[] not null default '{}',
  status text not null default 'processed'
    check (status in ('processed', 'ignored', 'failed')),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (workflow_instance_id, event_id),
  unique (workflow_instance_id, idempotency_key)
);

create or replace function public.record_platform_event(
  target_event_type_key text,
  target_source text,
  target_subject_type text,
  target_subject_id uuid,
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
  event_record_id uuid;
  existing_event record;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_event_type_key is null
    or target_event_type_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_event_type_key must be a valid platform key';
  end if;

  if not exists (
    select 1
    from public.event_types event_type_record
    where event_type_record.key = target_event_type_key
      and event_type_record.status = 'active'
  ) then
    raise exception 'target_event_type_key must reference an active event type';
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

  if target_payload is null
    or jsonb_typeof(target_payload) <> 'object' then
    raise exception 'target_payload must be a JSON object';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  insert into public.event_log (
    event_type_key,
    source,
    subject_type,
    subject_id,
    actor_user_id,
    idempotency_key,
    payload,
    status,
    occurred_at
  )
  values (
    target_event_type_key,
    target_source,
    target_subject_type,
    target_subject_id,
    auth.uid(),
    target_idempotency_key,
    target_payload,
    'received',
    coalesce(target_occurred_at, timezone('utc', now()))
  )
  on conflict (source, idempotency_key)
  where idempotency_key is not null
  do nothing
  returning id into event_record_id;

  if event_record_id is null then
    select existing_record.*
    into existing_event
    from public.event_log existing_record
    where existing_record.source = target_source
      and existing_record.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'event idempotency lookup failed';
    end if;

    if existing_event.event_type_key <> target_event_type_key
      or existing_event.subject_type <> target_subject_type
      or existing_event.subject_id <> target_subject_id
      or existing_event.actor_user_id is distinct from auth.uid()
      or existing_event.payload <> target_payload then
      raise exception 'target_idempotency_key has already been used with different event details';
    end if;

    return existing_event.id;
  end if;

  return event_record_id;
end;
$$;

create or replace function public.start_workflow_instance(
  target_workflow_key text,
  target_source text,
  target_subject_type text,
  target_subject_id uuid,
  target_context jsonb default '{}'::jsonb,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_workflow_version_id uuid;
  initial_state_count integer;
  initial_state_key text;
  instance_id uuid;
  existing_instance record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.workflows.manage', null) then
    raise exception 'platform workflow management permission is required';
  end if;

  if target_workflow_key is null
    or target_workflow_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_workflow_key must be a valid platform key';
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

  if target_context is null
    or jsonb_typeof(target_context) <> 'object' then
    raise exception 'target_context must be a JSON object';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select workflow_version_record.id
  into target_workflow_version_id
  from public.workflow_definitions workflow_record
  join public.workflow_versions workflow_version_record
    on workflow_version_record.workflow_id = workflow_record.id
  where workflow_record.key = target_workflow_key
    and workflow_record.status = 'active'
    and workflow_version_record.status = 'active'
  order by workflow_version_record.version desc
  limit 1;

  if not found then
    raise exception 'target_workflow_key must reference an active workflow version';
  end if;

  select count(*), min(workflow_state.key)
  into initial_state_count, initial_state_key
  from public.workflow_states workflow_state
  where workflow_state.workflow_version_id = target_workflow_version_id
    and workflow_state.state_type = 'initial';

  if initial_state_count <> 1 then
    raise exception 'active workflow version must define exactly one initial state';
  end if;

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
    target_workflow_version_id,
    initial_state_key,
    target_subject_type,
    target_subject_id,
    'running',
    target_context,
    auth.uid(),
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key)
  where idempotency_key is not null
  do nothing
  returning id into instance_id;

  if instance_id is null then
    select existing_record.*
    into existing_instance
    from public.workflow_instances existing_record
    where existing_record.source = target_source
      and existing_record.idempotency_key = target_idempotency_key;

    if not found then
      raise exception 'workflow instance idempotency lookup failed';
    end if;

    if existing_instance.workflow_version_id <> target_workflow_version_id
      or existing_instance.subject_type <> target_subject_type
      or existing_instance.subject_id <> target_subject_id
      or existing_instance.context <> target_context then
      raise exception 'target_idempotency_key has already been used with different workflow details';
    end if;

    return existing_instance.id;
  end if;

  return instance_id;
end;
$$;

create or replace function public.advance_workflow_instance(
  target_instance_id uuid,
  target_event_type_key text,
  target_event_id uuid default null,
  target_payload jsonb default '{}'::jsonb,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  workflow_instance record;
  transition_record record;
  existing_transition_event record;
  workflow_event_id uuid;
  next_status text;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.workflows.manage', null) then
    raise exception 'platform workflow management permission is required';
  end if;

  if target_instance_id is null then
    raise exception 'target_instance_id is required';
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

  select
    workflow_event_record.event_id,
    event_record.event_type_key,
    event_record.payload
  into existing_transition_event
  from public.workflow_instance_events workflow_event_record
  join public.event_log event_record on event_record.id = workflow_event_record.event_id
  where workflow_event_record.workflow_instance_id = target_instance_id
    and workflow_event_record.idempotency_key = target_idempotency_key;

  if found then
    if existing_transition_event.event_type_key <> target_event_type_key
      or existing_transition_event.payload <> target_payload
      or target_event_id is not null
        and existing_transition_event.event_id <> target_event_id then
      raise exception 'target_idempotency_key has already been used with different workflow event details';
    end if;

    return existing_transition_event.event_id;
  end if;

  select instance_record.*
  into workflow_instance
  from public.workflow_instances instance_record
  where instance_record.id = target_instance_id
  for update;

  if not found then
    raise exception 'target_instance_id must reference an existing workflow instance';
  end if;

  if workflow_instance.status <> 'running' then
    raise exception 'only running workflow instances can be advanced';
  end if;

  select
    transition.to_state_key,
    transition.guard_policy_key,
    transition.action_policy_keys,
    target_state.state_type
  into transition_record
  from public.workflow_transitions transition
  join public.workflow_states target_state
    on target_state.workflow_version_id = transition.workflow_version_id
    and target_state.key = transition.to_state_key
  where transition.workflow_version_id = workflow_instance.workflow_version_id
    and transition.from_state_key = workflow_instance.current_state_key
    and transition.event_type_key = target_event_type_key;

  if not found then
    raise exception 'no configured workflow transition matches this event';
  end if;

  if transition_record.guard_policy_key is not null then
    raise exception 'guarded workflow transitions require policy evaluation before advancement';
  end if;

  if target_event_id is null then
    workflow_event_id := public.record_platform_event(
      target_event_type_key,
      'platform.workflow_engine',
      workflow_instance.subject_type,
      workflow_instance.subject_id,
      target_payload,
      target_idempotency_key,
      timezone('utc', now())
    );
  else
    select existing_event.id
    into workflow_event_id
    from public.event_log existing_event
    where existing_event.id = target_event_id
      and existing_event.event_type_key = target_event_type_key
      and existing_event.subject_type = workflow_instance.subject_type
      and existing_event.subject_id = workflow_instance.subject_id;

    if not found then
      raise exception 'target_event_id must reference a matching workflow event';
    end if;
  end if;

  next_status := case
    when transition_record.state_type = 'terminal' then 'completed'
    when transition_record.state_type = 'failure' then 'failed'
    else 'running'
  end;

  update public.workflow_instances
  set current_state_key = transition_record.to_state_key,
      status = next_status,
      completed_at = case
        when next_status in ('completed', 'failed') then timezone('utc', now())
        else completed_at
      end,
      updated_at = timezone('utc', now())
  where id = workflow_instance.id;

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
    workflow_instance.id,
    workflow_event_id,
    workflow_instance.current_state_key,
    transition_record.to_state_key,
    target_idempotency_key,
    transition_record.action_policy_keys,
    'processed',
    jsonb_build_object('event_type_key', target_event_type_key)
  );

  return workflow_event_id;
end;
$$;

alter table public.workflow_instance_events enable row level security;

drop policy if exists event_log_insert_actor on public.event_log;
drop policy if exists event_log_no_direct_insert on public.event_log;
drop policy if exists workflow_instances_manage_privileged on public.workflow_instances;
drop policy if exists workflow_instances_no_direct_insert on public.workflow_instances;
drop policy if exists workflow_instances_no_direct_update on public.workflow_instances;
drop policy if exists workflow_instances_no_direct_delete on public.workflow_instances;
drop policy if exists workflow_instance_events_select_actor_or_privileged
on public.workflow_instance_events;
drop policy if exists workflow_instance_events_no_direct_insert on public.workflow_instance_events;
drop policy if exists workflow_instance_events_no_direct_update on public.workflow_instance_events;
drop policy if exists workflow_instance_events_no_direct_delete on public.workflow_instance_events;

create policy event_log_no_direct_insert on public.event_log
for insert to authenticated
with check (false);

create policy workflow_instances_no_direct_insert on public.workflow_instances
for insert to authenticated
with check (false);

create policy workflow_instances_no_direct_update on public.workflow_instances
for update to authenticated
using (false)
with check (false);

create policy workflow_instances_no_direct_delete on public.workflow_instances
for delete to authenticated
using (false);

create policy workflow_instance_events_select_actor_or_privileged
on public.workflow_instance_events
for select to authenticated
using (
  exists (
    select 1
    from public.workflow_instances instance_record
    where instance_record.id = workflow_instance_events.workflow_instance_id
      and instance_record.started_by = auth.uid()
  )
  or public.has_permission('platform.workflows.read', null)
  or public.has_permission('platform.workflows.manage', null)
  or public.has_permission('platform.events.read', null)
);

create policy workflow_instance_events_no_direct_insert
on public.workflow_instance_events
for insert to authenticated
with check (false);

create policy workflow_instance_events_no_direct_update
on public.workflow_instance_events
for update to authenticated
using (false)
with check (false);

create policy workflow_instance_events_no_direct_delete
on public.workflow_instance_events
for delete to authenticated
using (false);

grant select, insert, update, delete on public.workflow_instance_events to authenticated;
grant select, insert, update, delete on public.workflow_instance_events to service_role;

revoke all on function public.record_platform_event(
  text,
  text,
  text,
  uuid,
  jsonb,
  text,
  timestamptz
) from public;

revoke all on function public.start_workflow_instance(
  text,
  text,
  text,
  uuid,
  jsonb,
  text
) from public;

revoke all on function public.advance_workflow_instance(
  uuid,
  text,
  uuid,
  jsonb,
  text
) from public;

revoke all on function public.record_platform_event(
  text,
  text,
  text,
  uuid,
  jsonb,
  text,
  timestamptz
) from anon;

revoke all on function public.start_workflow_instance(
  text,
  text,
  text,
  uuid,
  jsonb,
  text
) from anon;

revoke all on function public.advance_workflow_instance(
  uuid,
  text,
  uuid,
  jsonb,
  text
) from anon;

grant execute on function public.record_platform_event(
  text,
  text,
  text,
  uuid,
  jsonb,
  text,
  timestamptz
) to authenticated;

grant execute on function public.start_workflow_instance(
  text,
  text,
  text,
  uuid,
  jsonb,
  text
) to authenticated;

grant execute on function public.advance_workflow_instance(
  uuid,
  text,
  uuid,
  jsonb,
  text
) to authenticated;

grant execute on function public.record_platform_event(
  text,
  text,
  text,
  uuid,
  jsonb,
  text,
  timestamptz
) to service_role;

grant execute on function public.start_workflow_instance(
  text,
  text,
  text,
  uuid,
  jsonb,
  text
) to service_role;

grant execute on function public.advance_workflow_instance(
  uuid,
  text,
  uuid,
  jsonb,
  text
) to service_role;

commit;
