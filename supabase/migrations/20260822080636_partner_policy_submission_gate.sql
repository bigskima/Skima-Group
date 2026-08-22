begin;

create or replace function public.submit_application(
  target_application_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  if auth.role() <> 'service_role'
    and application_type_record.application_category in ('driver', 'business')
    and not public.has_accepted_current_policy(
      'policy.partner.participation',
      target_application_id
    ) then
    raise exception using
      errcode = '55000',
      message = 'review and accept the current SKIMA Partner Participation Terms before submitting this application';
  end if;

  select coalesce(application_version.payload, '{}'::jsonb)
  into application_payload
  from public.application_versions application_version
  where application_version.application_id = target_application_id
    and application_version.version = application_record.active_version;

  application_payload := coalesce(application_payload, '{}'::jsonb);

  select count(*), string_agg(
    coalesce(field_definition ->> 'label', field_definition ->> 'path'),
    ', '
    order by field_definition ->> 'path'
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
    btrim(
      coalesce(
        application_payload #>> string_to_array(field_definition ->> 'path', '.'),
        ''
      )
    ),
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
$function$;

comment on function public.submit_application(uuid, text, jsonb) is
  'Submits an application after required fields/documents and, for Driver/Station partner applications, acceptance of the current partner participation terms.';

commit;
