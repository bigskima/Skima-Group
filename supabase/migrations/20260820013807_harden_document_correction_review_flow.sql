create or replace function public.review_document_submission(
  target_document_submission_id uuid,
  target_decision text,
  target_internal_notes text default null::text,
  target_applicant_message text default null::text,
  target_idempotency_key text default null::text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  document_record record;
  existing_event record;
  application_record record;
  requirement_record record;
  is_replacement_request boolean := false;
  resolved_message text;
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

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  is_replacement_request := lower(coalesce(
    target_metadata ->> 'replacementRequested',
    target_metadata ->> 'replacement_requested',
    'false'
  )) = 'true';

  resolved_message := nullif(btrim(coalesce(target_applicant_message, target_internal_notes, '')), '');

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

  select application.*
  into application_record
  from public.application_records application
  where application.id = document_record.application_id;

  select requirement.*
  into requirement_record
  from public.document_requirements requirement
  where requirement.id = document_record.requirement_id;

  update public.document_submissions as submission
  set status = target_decision,
      reviewed_at = case
        when target_decision in ('approved', 'rejected', 'correction_required', 'quarantined')
          then timezone('utc', now())
        else submission.reviewed_at
      end,
      reviewer_user_id = auth.uid(),
      decision_reason = coalesce(resolved_message, submission.decision_reason),
      replacement_requested = case
        when target_decision = 'correction_required' and is_replacement_request then true
        else submission.replacement_requested
      end,
      replacement_reason = case
        when target_decision = 'correction_required' and is_replacement_request
          then coalesce(resolved_message, submission.replacement_reason)
        else submission.replacement_reason
      end,
      metadata = submission.metadata
        || target_metadata
        || case
          when target_decision = 'correction_required' and is_replacement_request then
            jsonb_build_object(
              'replacement_requested_at', timezone('utc', now()),
              'replacement_reason', resolved_message
            )
          else '{}'::jsonb
        end,
      updated_at = timezone('utc', now())
  where submission.id = target_document_submission_id;

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

  if target_decision = 'correction_required'
    and application_record.id is not null
    and application_record.status = 'under_review'
    and resolved_message is not null then
    perform public.request_application_correction(
      application_record.id,
      case
        when is_replacement_request then
          'A replacement was requested for ' || coalesce(requirement_record.display_name, requirement_record.key, 'a submitted document')
        else
          'A document update was requested for ' || coalesce(requirement_record.display_name, requirement_record.key, 'a submitted document')
      end,
      resolved_message,
      target_idempotency_key || ':application',
      target_metadata || jsonb_build_object(
        'document_submission_id', target_document_submission_id,
        'requirement_key', requirement_record.key,
        'replacement_requested', is_replacement_request
      )
    );
  end if;

  return target_document_submission_id;
end;
$function$;;
