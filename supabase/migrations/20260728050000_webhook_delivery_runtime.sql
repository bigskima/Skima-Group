begin;

alter table public.webhook_endpoints
add column if not exists delivery_config jsonb not null default '{}'::jsonb
  check (jsonb_typeof(delivery_config) = 'object');

alter table public.webhook_deliveries
add column if not exists source text not null default 'platform.webhook_engine';

alter table public.webhook_deliveries
add column if not exists idempotency_key text;

alter table public.webhook_deliveries
add column if not exists locked_until timestamptz;

alter table public.webhook_deliveries
add column if not exists locked_by text;

alter table public.webhook_deliveries
add column if not exists last_error text;

alter table public.webhook_deliveries
add column if not exists delivered_at timestamptz;

alter table public.webhook_deliveries
add column if not exists failed_at timestamptz;

alter table public.webhook_deliveries
add column if not exists metadata jsonb not null default '{}'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'webhook_deliveries_source_key_check'
      and conrelid = 'public.webhook_deliveries'::regclass
  ) then
    alter table public.webhook_deliveries
    add constraint webhook_deliveries_source_key_check
    check (source ~ '^[a-z][a-z0-9_.:-]{2,120}$');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'webhook_deliveries_metadata_object_check'
      and conrelid = 'public.webhook_deliveries'::regclass
  ) then
    alter table public.webhook_deliveries
    add constraint webhook_deliveries_metadata_object_check
    check (jsonb_typeof(metadata) = 'object');
  end if;
end;
$$;

create unique index if not exists webhook_deliveries_source_idempotency_unique
on public.webhook_deliveries (source, idempotency_key)
where idempotency_key is not null;

create index if not exists webhook_deliveries_lock_idx
on public.webhook_deliveries (status, next_attempt_at, locked_until);

create table if not exists public.webhook_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references public.webhook_deliveries(id) on delete cascade,
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  event_id uuid not null references public.event_log(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  status text not null
    check (status in ('succeeded', 'failed', 'dead_lettered')),
  request_headers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(request_headers) = 'object'),
  request_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(request_payload) = 'object'),
  response_status integer check (response_status is null or response_status between 100 and 599),
  response_body text,
  error_message text,
  provider_execution_log_id uuid references public.provider_execution_logs(id) on delete set null,
  idempotency_key text not null,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  unique (delivery_id, attempt_number),
  unique (idempotency_key)
);

create index if not exists webhook_delivery_attempts_delivery_idx
on public.webhook_delivery_attempts (delivery_id, created_at desc);

insert into public.job_queues (key, status, concurrency_limit, retry_policy)
values (
  'platform.webhooks',
  'active',
  8,
  '{"max_attempts":5,"backoff_seconds":[30,120,300,900,1800]}'::jsonb
)
on conflict (key) do update
set status = excluded.status,
    concurrency_limit = excluded.concurrency_limit,
    retry_policy = excluded.retry_policy,
    updated_at = timezone('utc', now());

insert into public.configuration_entries (
  namespace,
  key,
  scope_type,
  scope_id,
  value,
  is_secret,
  status,
  version
)
values (
  'platform.webhooks',
  'delivery_retry_policy',
  'global',
  null,
  '{"max_attempts":5,"backoff_seconds":[30,120,300,900,1800],"request_timeout_ms":5000,"signature_algorithm":"hmac-sha256","require_https":true}'::jsonb,
  false,
  'active',
  1
)
on conflict do nothing;

insert into public.provider_adapters (provider_kind, key, display_name, status, config, secret_ref)
values (
  'queue',
  'provider.queue.webhook-delivery',
  'Webhook Delivery Queue Adapter',
  'active',
  '{"mode":"edge_worker","queue":"platform.webhooks","delivery_table":"webhook_deliveries","attempt_table":"webhook_delivery_attempts","signing":"hmac-sha256"}'::jsonb,
  null
)
on conflict (provider_kind, key) do update
set display_name = excluded.display_name,
    status = excluded.status,
    config = excluded.config,
    secret_ref = excluded.secret_ref,
    updated_at = timezone('utc', now());

create or replace function public.prevent_webhook_delivery_attempt_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'webhook delivery attempts are append-only';
end;
$$;

create or replace function public.create_webhook_deliveries_for_event(
  target_event_id uuid,
  target_source text default 'platform.webhook_engine',
  target_idempotency_prefix text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  event_record record;
  event_organization_id uuid;
  delivery_count integer := 0;
  target_queue_id uuid;
  effective_idempotency_prefix text;
begin
  if target_event_id is null then
    raise exception 'target_event_id is required';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  effective_idempotency_prefix := coalesce(
    nullif(btrim(target_idempotency_prefix), ''),
    'event:' || target_event_id::text
  );

  select event_record_source.*
  into event_record
  from public.event_log event_record_source
  where event_record_source.id = target_event_id;

  if not found then
    raise exception 'target_event_id must reference an existing event';
  end if;

  if event_record.subject_type = 'service_request' then
    select request.organization_id
    into event_organization_id
    from public.service_requests request
    where request.id = event_record.subject_id;
  elsif event_record.payload ? 'organization_id' then
    begin
      event_organization_id := (event_record.payload ->> 'organization_id')::uuid;
    exception
      when invalid_text_representation then
        event_organization_id := null;
    end;
  elsif event_record.payload ? 'organizationId' then
    begin
      event_organization_id := (event_record.payload ->> 'organizationId')::uuid;
    exception
      when invalid_text_representation then
        event_organization_id := null;
    end;
  end if;

  with eligible_endpoints as (
    select endpoint.id
    from public.webhook_endpoints endpoint
    where endpoint.status = 'active'
      and (
        cardinality(endpoint.event_type_keys) = 0
        or event_record.event_type_key = any(endpoint.event_type_keys)
      )
      and (
        endpoint.organization_id is null
        or endpoint.organization_id = event_organization_id
      )
  ),
  inserted_deliveries as (
    insert into public.webhook_deliveries (
      endpoint_id,
      event_id,
      status,
      next_attempt_at,
      source,
      idempotency_key,
      metadata
    )
    select
      endpoint.id,
      event_record.id,
      'pending',
      timezone('utc', now()),
      target_source,
      effective_idempotency_prefix || ':' || endpoint.id::text,
      jsonb_build_object(
        'event_type_key',
        event_record.event_type_key,
        'event_source',
        event_record.source
      )
    from eligible_endpoints endpoint
    on conflict (endpoint_id, event_id)
    do nothing
    returning id
  )
  select count(*)
  into delivery_count
  from inserted_deliveries;

  if delivery_count > 0 then
    select queue.id
    into target_queue_id
    from public.job_queues queue
    where queue.key = 'platform.webhooks'
      and queue.status = 'active';

    if target_queue_id is not null then
      insert into public.background_jobs (
        queue_id,
        job_type_key,
        status,
        payload,
        max_attempts,
        run_at,
        source,
        idempotency_key
      )
      values (
        target_queue_id,
        'platform.webhook.delivery',
        'queued',
        jsonb_build_object(
          'eventId',
          event_record.id,
          'eventTypeKey',
          event_record.event_type_key,
          'queuedDeliveryCount',
          delivery_count
        ),
        3,
        timezone('utc', now()),
        'platform.webhook_engine',
        effective_idempotency_prefix || ':job'
      )
      on conflict (source, idempotency_key)
      where idempotency_key is not null
      do nothing;
    end if;
  end if;

  return delivery_count;
end;
$$;

create or replace function public.queue_webhook_deliveries(
  target_event_id uuid,
  target_idempotency_key text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.webhooks.manage', null) then
    raise exception 'platform webhook management permission is required';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  return public.create_webhook_deliveries_for_event(
    target_event_id,
    'platform.webhook_engine',
    target_idempotency_key
  );
end;
$$;

create or replace function public.enqueue_webhook_deliveries_on_event_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.create_webhook_deliveries_for_event(
    new.id,
    'platform.webhook_engine',
    'event:' || new.id::text
  );

  return new;
end;
$$;

create or replace function public.claim_pending_webhook_deliveries(
  target_limit integer default 10,
  target_worker_id text default 'runtime-worker'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  claimed_deliveries jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required to claim webhook deliveries';
  end if;

  if target_limit is null or target_limit <= 0 or target_limit > 100 then
    raise exception 'target_limit must be between 1 and 100';
  end if;

  if target_worker_id is null or btrim(target_worker_id) = '' then
    raise exception 'target_worker_id is required';
  end if;

  with candidates as (
    select
      delivery.id as delivery_id,
      delivery.endpoint_id,
      delivery.event_id,
      delivery.attempt_count + 1 as attempt_number,
      endpoint.url,
      endpoint.signing_secret_ref,
      endpoint.delivery_config,
      event_record.event_type_key,
      event_record.source as event_source,
      event_record.subject_type,
      event_record.subject_id,
      event_record.payload,
      event_record.occurred_at
    from public.webhook_deliveries delivery
    join public.webhook_endpoints endpoint
      on endpoint.id = delivery.endpoint_id
    join public.event_log event_record
      on event_record.id = delivery.event_id
    where delivery.status = 'pending'
      and endpoint.status = 'active'
      and coalesce(delivery.next_attempt_at, delivery.created_at) <= timezone('utc', now())
      and (
        delivery.locked_until is null
        or delivery.locked_until <= timezone('utc', now())
      )
    order by coalesce(delivery.next_attempt_at, delivery.created_at), delivery.created_at
    limit target_limit
    for update of delivery skip locked
  ),
  locked_deliveries as (
    update public.webhook_deliveries delivery
    set locked_by = target_worker_id,
        locked_until = timezone('utc', now()) + interval '2 minutes',
        updated_at = timezone('utc', now())
    from candidates
    where delivery.id = candidates.delivery_id
    returning
      candidates.delivery_id,
      candidates.endpoint_id,
      candidates.event_id,
      candidates.attempt_number,
      candidates.url,
      candidates.signing_secret_ref,
      candidates.delivery_config,
      candidates.event_type_key,
      candidates.event_source,
      candidates.subject_type,
      candidates.subject_id,
      candidates.payload,
      candidates.occurred_at
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'deliveryId', delivery_id,
        'endpointId', endpoint_id,
        'eventId', event_id,
        'attemptNumber', attempt_number,
        'url', url,
        'signingSecretRef', signing_secret_ref,
        'deliveryConfig', delivery_config,
        'eventTypeKey', event_type_key,
        'eventSource', event_source,
        'subjectType', subject_type,
        'subjectId', subject_id,
        'payload', payload,
        'occurredAt', occurred_at
      )
      order by occurred_at, delivery_id
    ),
    '[]'::jsonb
  )
  into claimed_deliveries
  from locked_deliveries;

  return claimed_deliveries;
end;
$$;

create or replace function public.record_webhook_delivery_attempt(
  target_delivery_id uuid,
  target_status text,
  target_request_headers jsonb default '{}'::jsonb,
  target_request_payload jsonb default '{}'::jsonb,
  target_response_status integer default null,
  target_response_body text default null,
  target_error_message text default null,
  target_idempotency_key text default null,
  target_provider_execution_log_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  delivery_record record;
  retry_policy jsonb := '{}'::jsonb;
  max_attempts integer := 5;
  backoff_seconds integer := 60;
  backoff_length integer := 0;
  retry_index integer := 0;
  attempt_number integer;
  attempt_status text;
  attempt_id uuid;
  existing_attempt_id uuid;
  dead_letter_queue_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.webhooks.manage', null) then
    raise exception 'platform webhook management permission is required';
  end if;

  if target_delivery_id is null then
    raise exception 'target_delivery_id is required';
  end if;

  if target_status is null
    or target_status not in ('delivered', 'failed') then
    raise exception 'target_status must be delivered or failed';
  end if;

  if target_request_headers is null
    or jsonb_typeof(target_request_headers) <> 'object'
    or target_request_payload is null
    or jsonb_typeof(target_request_payload) <> 'object' then
    raise exception 'webhook attempt request fields must be JSON objects';
  end if;

  if target_response_status is not null
    and (target_response_status < 100 or target_response_status > 599) then
    raise exception 'target_response_status must be a valid HTTP status code';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select existing.id
  into existing_attempt_id
  from public.webhook_delivery_attempts existing
  where existing.idempotency_key = target_idempotency_key;

  if found then
    return existing_attempt_id;
  end if;

  select delivery.*
  into delivery_record
  from public.webhook_deliveries delivery
  where delivery.id = target_delivery_id
  for update;

  if not found then
    raise exception 'target_delivery_id must reference an existing webhook delivery';
  end if;

  if delivery_record.status not in ('pending', 'failed') then
    raise exception 'only pending or failed webhook deliveries can receive attempts';
  end if;

  attempt_number := delivery_record.attempt_count + 1;

  select config.value
  into retry_policy
  from public.configuration_entries config
  where config.namespace = 'platform.webhooks'
    and config.key = 'delivery_retry_policy'
    and config.status = 'active'
  order by config.version desc
  limit 1;

  if retry_policy is null then
    retry_policy := '{}'::jsonb;
  end if;

  begin
    max_attempts := greatest(coalesce((retry_policy ->> 'max_attempts')::integer, 5), 1);
  exception
    when invalid_text_representation then
      max_attempts := 5;
  end;

  if retry_policy ? 'backoff_seconds'
    and jsonb_typeof(retry_policy -> 'backoff_seconds') = 'array'
    and jsonb_array_length(retry_policy -> 'backoff_seconds') > 0 then
    backoff_length := jsonb_array_length(retry_policy -> 'backoff_seconds');
    retry_index := least(attempt_number, backoff_length) - 1;

    begin
      backoff_seconds := greatest(
        coalesce((retry_policy -> 'backoff_seconds' ->> retry_index)::integer, 60),
        0
      );
    exception
      when invalid_text_representation then
        backoff_seconds := 60;
    end;
  end if;

  attempt_status := case
    when target_status = 'delivered' then 'succeeded'
    when attempt_number >= max_attempts then 'dead_lettered'
    else 'failed'
  end;

  insert into public.webhook_delivery_attempts (
    delivery_id,
    endpoint_id,
    event_id,
    attempt_number,
    status,
    request_headers,
    request_payload,
    response_status,
    response_body,
    error_message,
    provider_execution_log_id,
    idempotency_key
  )
  values (
    delivery_record.id,
    delivery_record.endpoint_id,
    delivery_record.event_id,
    attempt_number,
    attempt_status,
    target_request_headers,
    target_request_payload,
    target_response_status,
    target_response_body,
    target_error_message,
    target_provider_execution_log_id,
    target_idempotency_key
  )
  returning id into attempt_id;

  if target_status = 'delivered' then
    update public.webhook_deliveries
    set status = 'delivered',
        attempt_count = attempt_number,
        response_status = target_response_status,
        response_body = target_response_body,
        next_attempt_at = null,
        locked_until = null,
        locked_by = null,
        last_error = null,
        delivered_at = timezone('utc', now()),
        failed_at = null,
        updated_at = timezone('utc', now())
    where id = delivery_record.id;
  elsif attempt_number >= max_attempts then
    update public.webhook_deliveries
    set status = 'failed',
        attempt_count = attempt_number,
        response_status = target_response_status,
        response_body = target_response_body,
        next_attempt_at = null,
        locked_until = null,
        locked_by = null,
        last_error = coalesce(target_error_message, 'webhook delivery failed'),
        failed_at = timezone('utc', now()),
        updated_at = timezone('utc', now())
    where id = delivery_record.id;

    select queue.id
    into dead_letter_queue_id
    from public.job_queues queue
    where queue.key = 'platform.dead_letters'
      and queue.status = 'active';

    if dead_letter_queue_id is not null then
      insert into public.background_jobs (
        queue_id,
        job_type_key,
        status,
        payload,
        max_attempts,
        run_at,
        source,
        idempotency_key
      )
      values (
        dead_letter_queue_id,
        'platform.dead_letter.record',
        'queued',
        jsonb_build_object(
          'failedDeliveryId',
          delivery_record.id,
          'eventId',
          delivery_record.event_id,
          'reason',
          coalesce(target_error_message, 'webhook delivery failed')
        ),
        1,
        timezone('utc', now()),
        'platform.webhook_engine',
        target_idempotency_key || ':dead-letter'
      )
      on conflict (source, idempotency_key)
      where idempotency_key is not null
      do nothing;
    end if;
  else
    update public.webhook_deliveries
    set status = 'pending',
        attempt_count = attempt_number,
        response_status = target_response_status,
        response_body = target_response_body,
        next_attempt_at = timezone('utc', now()) + make_interval(secs => backoff_seconds),
        locked_until = null,
        locked_by = null,
        last_error = coalesce(target_error_message, 'webhook delivery failed'),
        updated_at = timezone('utc', now())
    where id = delivery_record.id;
  end if;

  return attempt_id;
end;
$$;

drop trigger if exists enqueue_webhook_deliveries_after_event_insert on public.event_log;
create trigger enqueue_webhook_deliveries_after_event_insert
after insert on public.event_log
for each row execute function public.enqueue_webhook_deliveries_on_event_insert();

drop trigger if exists prevent_webhook_delivery_attempts_update
on public.webhook_delivery_attempts;
create trigger prevent_webhook_delivery_attempts_update
before update on public.webhook_delivery_attempts
for each row execute function public.prevent_webhook_delivery_attempt_mutation();

drop trigger if exists prevent_webhook_delivery_attempts_delete
on public.webhook_delivery_attempts;
create trigger prevent_webhook_delivery_attempts_delete
before delete on public.webhook_delivery_attempts
for each row execute function public.prevent_webhook_delivery_attempt_mutation();

drop trigger if exists audit_changes on public.webhook_delivery_attempts;
create trigger audit_changes
after insert or update or delete on public.webhook_delivery_attempts
for each row execute function public.record_table_audit();

alter table public.webhook_delivery_attempts enable row level security;

drop policy if exists webhook_delivery_attempts_select_privileged
on public.webhook_delivery_attempts;
drop policy if exists webhook_delivery_attempts_no_direct_insert
on public.webhook_delivery_attempts;
drop policy if exists webhook_delivery_attempts_no_direct_update
on public.webhook_delivery_attempts;
drop policy if exists webhook_delivery_attempts_no_direct_delete
on public.webhook_delivery_attempts;

create policy webhook_delivery_attempts_select_privileged
on public.webhook_delivery_attempts
for select to authenticated
using (public.has_permission('platform.webhooks.manage', null));

create policy webhook_delivery_attempts_no_direct_insert
on public.webhook_delivery_attempts
for insert to authenticated
with check (false);

create policy webhook_delivery_attempts_no_direct_update
on public.webhook_delivery_attempts
for update to authenticated
using (false)
with check (false);

create policy webhook_delivery_attempts_no_direct_delete
on public.webhook_delivery_attempts
for delete to authenticated
using (false);

grant select, insert, update, delete on public.webhook_delivery_attempts to authenticated;
grant select, insert, update, delete on public.webhook_delivery_attempts to service_role;

revoke all on function public.prevent_webhook_delivery_attempt_mutation() from public;
revoke all on function public.create_webhook_deliveries_for_event(uuid, text, text) from public;
revoke all on function public.queue_webhook_deliveries(uuid, text) from public;
revoke all on function public.enqueue_webhook_deliveries_on_event_insert() from public;
revoke all on function public.claim_pending_webhook_deliveries(integer, text) from public;
revoke all on function public.record_webhook_delivery_attempt(
  uuid,
  text,
  jsonb,
  jsonb,
  integer,
  text,
  text,
  text,
  uuid
) from public;

grant execute on function public.create_webhook_deliveries_for_event(uuid, text, text)
to service_role;

grant execute on function public.queue_webhook_deliveries(uuid, text)
to authenticated, service_role;

grant execute on function public.claim_pending_webhook_deliveries(integer, text)
to service_role;

grant execute on function public.record_webhook_delivery_attempt(
  uuid,
  text,
  jsonb,
  jsonb,
  integer,
  text,
  text,
  text,
  uuid
) to authenticated, service_role;

commit;
