begin;

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
  endpoint_delivery_config jsonb := '{}'::jsonb;
  backoff_config jsonb := null;
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

  select
    delivery.*,
    endpoint.delivery_config as endpoint_delivery_config
  into delivery_record
  from public.webhook_deliveries delivery
  join public.webhook_endpoints endpoint
    on endpoint.id = delivery.endpoint_id
  where delivery.id = target_delivery_id
  for update of delivery;

  if not found then
    raise exception 'target_delivery_id must reference an existing webhook delivery';
  end if;

  if delivery_record.status not in ('pending', 'failed') then
    raise exception 'only pending or failed webhook deliveries can receive attempts';
  end if;

  endpoint_delivery_config := coalesce(delivery_record.endpoint_delivery_config, '{}'::jsonb);
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
    max_attempts := greatest(
      coalesce(
        (endpoint_delivery_config ->> 'max_attempts')::integer,
        (endpoint_delivery_config ->> 'maxAttempts')::integer,
        (retry_policy ->> 'max_attempts')::integer,
        (retry_policy ->> 'maxAttempts')::integer,
        5
      ),
      1
    );
  exception
    when invalid_text_representation then
      max_attempts := 5;
  end;

  backoff_config := coalesce(
    endpoint_delivery_config -> 'backoff_seconds',
    endpoint_delivery_config -> 'backoffSeconds',
    retry_policy -> 'backoff_seconds',
    retry_policy -> 'backoffSeconds'
  );

  if backoff_config is not null
    and jsonb_typeof(backoff_config) = 'array'
    and jsonb_array_length(backoff_config) > 0 then
    backoff_length := jsonb_array_length(backoff_config);
    retry_index := least(attempt_number, backoff_length) - 1;

    begin
      backoff_seconds := greatest(coalesce((backoff_config ->> retry_index)::integer, 60), 0);
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

comment on function public.record_webhook_delivery_attempt(
  uuid,
  text,
  jsonb,
  jsonb,
  integer,
  text,
  text,
  text,
  uuid
) is
'Records an append-only outbound webhook delivery attempt and applies configurable global or endpoint retry/dead-letter policy.';

commit;
