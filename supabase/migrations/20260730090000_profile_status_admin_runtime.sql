begin;

insert into public.event_types (key, description, schema, status)
values
  (
    'event.profile.status.changed',
    'A platform user profile status was changed through governed administration.',
    '{"category":"identity","payload":{"from_status":"text","to_status":"text","reason":"text"}}'::jsonb,
    'active'
  )
on conflict (key) do update
set description = excluded.description,
    schema = excluded.schema,
    status = excluded.status,
    updated_at = timezone('utc', now());

create or replace function public.set_profile_status(
  target_user_id uuid,
  target_status text,
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
  profile_record record;
  existing_event record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.users.manage', null) then
    raise exception 'platform user management permission is required';
  end if;

  if target_user_id is null then
    raise exception 'target_user_id is required';
  end if;

  if target_status not in ('active', 'disabled', 'pending') then
    raise exception 'target_status is not supported';
  end if;

  if target_reason is null or btrim(target_reason) = '' then
    raise exception 'target_reason is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select event_log.*
  into existing_event
  from public.event_log
  where event_log.source = 'platform.identity_engine'
    and event_log.idempotency_key = target_idempotency_key;

  if found then
    return target_user_id;
  end if;

  select profile.*
  into profile_record
  from public.profiles profile
  where profile.id = target_user_id
  for update;

  if not found then
    raise exception 'target_user_id must reference an existing profile';
  end if;

  update public.profiles
  set status = target_status,
      metadata = metadata || target_metadata || jsonb_build_object(
        'last_status_reason',
        target_reason,
        'last_status_changed_at',
        timezone('utc', now())
      ),
      updated_at = timezone('utc', now())
  where id = target_user_id;

  insert into public.event_log (
    event_type_key,
    source,
    subject_type,
    subject_id,
    actor_user_id,
    idempotency_key,
    payload,
    status,
    processed_at
  )
  values (
    'event.profile.status.changed',
    'platform.identity_engine',
    'profile',
    target_user_id,
    auth.uid(),
    target_idempotency_key,
    jsonb_build_object(
      'from_status',
      profile_record.status,
      'to_status',
      target_status,
      'reason',
      target_reason
    ) || target_metadata,
    'processed',
    timezone('utc', now())
  );

  return target_user_id;
end;
$$;

revoke all on function public.set_profile_status(uuid, text, text, text, jsonb) from public;
grant execute on function public.set_profile_status(uuid, text, text, text, jsonb)
to authenticated, service_role;

commit;
