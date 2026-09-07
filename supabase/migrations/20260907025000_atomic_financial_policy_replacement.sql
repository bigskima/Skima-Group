begin;

create or replace function public.activate_financial_policy_replacement(
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
  candidate public.financial_policy_versions%rowtype;
  predecessor public.financial_policy_versions%rowtype;
  candidate_before jsonb;
  predecessor_before jsonb;
  now_at timestamptz := timezone('utc', now());
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.financial_policy.activate', null) then
    raise exception 'financial policy activation permission is required';
  end if;

  if target_policy_version_id is null
    or target_reason is null
    or char_length(btrim(target_reason)) < 3
    or target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'policy version, activation reason, and idempotency key are required';
  end if;

  select *
  into candidate
  from public.financial_policy_versions
  where id = target_policy_version_id
  for update;

  if not found then
    raise exception 'financial policy version was not found';
  end if;

  if exists (
    select 1
    from public.financial_policy_events event
    where event.policy_version_id = candidate.id
      and event.idempotency_key = target_idempotency_key
  ) then
    return candidate.id;
  end if;

  if candidate.lifecycle_status <> 'approved' then
    raise exception 'only an approved financial policy version can replace the live version';
  end if;

  if candidate.supersedes_version_id is null then
    raise exception 'approved replacement must reference the live policy version it supersedes';
  end if;

  select *
  into predecessor
  from public.financial_policy_versions
  where id = candidate.supersedes_version_id
  for update;

  if not found then
    raise exception 'the financial policy version being replaced was not found';
  end if;

  if predecessor.lifecycle_status <> 'active' then
    raise exception 'the financial policy version being replaced is no longer active; refresh before activating';
  end if;

  if predecessor.policy_definition_id <> candidate.policy_definition_id
    or predecessor.currency_code <> candidate.currency_code
    or predecessor.module_id is distinct from candidate.module_id
    or predecessor.organization_id is distinct from candidate.organization_id
    or predecessor.service_key is distinct from candidate.service_key
    or predecessor.geography_type <> candidate.geography_type
    or predecessor.geography_key is distinct from candidate.geography_key
    or predecessor.priority <> candidate.priority then
    raise exception 'replacement policy scope must exactly match the live policy scope';
  end if;

  if predecessor.effective_from >= now_at then
    raise exception 'the live policy effective window cannot be closed safely yet';
  end if;

  if candidate.effective_until is not null and candidate.effective_until <= now_at then
    raise exception 'the approved replacement has already expired';
  end if;

  predecessor_before := to_jsonb(predecessor);
  candidate_before := to_jsonb(candidate);

  update public.financial_policy_versions
  set lifecycle_status = 'superseded',
      effective_until = now_at,
      deactivated_by = auth.uid(),
      deactivated_at = now_at,
      updated_at = now_at
  where id = predecessor.id;

  update public.financial_policy_versions
  set lifecycle_status = 'active',
      effective_from = now_at,
      activated_by = auth.uid(),
      activated_at = now_at,
      updated_at = now_at
  where id = candidate.id;

  perform public.assert_financial_policy_no_conflict(candidate.id);

  insert into public.financial_policy_events (
    policy_version_id,
    event_type,
    actor_user_id,
    previous_state,
    new_state,
    reason,
    idempotency_key
  ) values (
    predecessor.id,
    'superseded',
    auth.uid(),
    predecessor_before,
    (select to_jsonb(version.*) from public.financial_policy_versions version where version.id = predecessor.id),
    btrim(target_reason),
    target_idempotency_key || ':superseded'
  )
  on conflict (policy_version_id, idempotency_key) do nothing;

  insert into public.financial_policy_events (
    policy_version_id,
    event_type,
    actor_user_id,
    previous_state,
    new_state,
    reason,
    idempotency_key
  ) values (
    candidate.id,
    'activated',
    auth.uid(),
    candidate_before,
    (select to_jsonb(version.*) from public.financial_policy_versions version where version.id = candidate.id),
    btrim(target_reason),
    target_idempotency_key
  )
  on conflict (policy_version_id, idempotency_key) do nothing;

  return candidate.id;
end;
$$;

revoke all on function public.activate_financial_policy_replacement(uuid, text, text) from public;
grant execute on function public.activate_financial_policy_replacement(uuid, text, text)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
