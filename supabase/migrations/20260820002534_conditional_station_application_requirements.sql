create or replace function public.application_requirement_applies(
  target_requirement_metadata jsonb,
  target_application_payload jsonb
)
returns boolean
language plpgsql
immutable
set search_path = 'public'
as $$
declare
  condition jsonb;
  condition_path text;
  condition_operator text;
  actual_value text;
  expected_value text;
begin
  condition := coalesce(
    target_requirement_metadata -> 'required_when',
    target_requirement_metadata -> 'requiredWhen'
  );

  if condition is null or jsonb_typeof(condition) <> 'object' then
    return true;
  end if;

  condition_path := nullif(btrim(condition ->> 'path'), '');
  condition_operator := coalesce(nullif(btrim(condition ->> 'operator'), ''), 'equals');
  expected_value := condition ->> 'value';

  if condition_path is null then
    return true;
  end if;

  actual_value := coalesce(target_application_payload, '{}'::jsonb)
    #>> string_to_array(condition_path, '.');

  return case condition_operator
    when 'equals' then actual_value is not distinct from expected_value
    when 'not_equals' then actual_value is distinct from expected_value
    when 'exists' then actual_value is not null
    when 'not_exists' then actual_value is null
    when 'in' then coalesce((condition -> 'values') ? actual_value, false)
    when 'not_in' then not coalesce((condition -> 'values') ? actual_value, false)
    else true
  end;
end;
$$;

update public.document_requirements
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'required_when',
      jsonb_build_object(
        'path', 'authority.role',
        'operator', 'not_equals',
        'value', 'owner'
      )
    ),
    updated_at = timezone('utc', now())
where key in ('station.authority-evidence', 'station.representative-identity')
  and status = 'active';

create or replace function public.submit_application(
  target_application_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  application_record record;
  application_type_record record;
  application_payload jsonb;
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

  select coalesce(application_version.payload, '{}'::jsonb)
  into application_payload
  from public.application_versions application_version
  where application_version.application_id = target_application_id
    and application_version.version = application_record.active_version;

  application_payload := coalesce(application_payload, '{}'::jsonb);

  select count(*)
  into missing_required_count
  from public.document_requirements requirement
  where requirement.requirement_set_id = application_type_record.document_requirement_set_id
    and requirement.status = 'active'
    and requirement.is_required
    and public.application_requirement_applies(requirement.metadata, application_payload)
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
