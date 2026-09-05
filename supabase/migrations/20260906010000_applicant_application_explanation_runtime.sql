begin;

-- Applicant-safe application explanation for Ask SKIMA.
-- This is a read-only projection over the canonical application/document runtime.
-- It intentionally excludes application_review_events.internal_notes,
-- document_review_events.internal_notes, reviewer identities, review-task priority,
-- private application-event notes, and application metadata.
--
-- Submission readiness mirrors the canonical submit_application gate:
-- applicable required documents count as ready only when enough submissions are in
-- uploaded/submitted/under_review/approved state.
-- Approval readiness mirrors the canonical final review gate:
-- review-required applicable documents need enough approved submissions.

create or replace function public.read_my_application_explanations(
  target_limit integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select coalesce(
    jsonb_agg(row_data order by created_at desc),
    '[]'::jsonb
  )
  into result
  from (
    select
      application_record.created_at,
      jsonb_build_object(
        'applicationId', application_record.id,
        'applicationTypeKey', application_type.key,
        'applicationTypeName', application_type.display_name,
        'applicationCategory', application_type.application_category,
        'status', application_record.status,
        'activeVersion', application_record.active_version,
        'submittedAt', application_record.submitted_at,
        'decidedAt', application_record.decided_at,
        'approvedAt', application_record.approved_at,
        'rejectedAt', application_record.rejected_at,
        'suspendedAt', application_record.suspended_at,
        'withdrawnAt', application_record.withdrawn_at,
        'activatedSubjectType', application_record.activated_subject_type,
        'activatedSubjectId', application_record.activated_subject_id,
        'latestApplicantMessage', latest_review.applicant_message,
        'latestApplicantDecision', latest_review.decision,
        'latestApplicantMessageAt', latest_review.created_at,
        'missingRequiredFields', field_summary.missing_labels,
        'missingRequiredFieldCount', field_summary.missing_count,
        'applicableDocumentCount', document_summary.applicable_count,
        'requiredDocumentCount', document_summary.required_count,
        'submissionReadyDocumentCount', document_summary.submission_ready_count,
        'approvalReadyDocumentCount', document_summary.approval_ready_count,
        'missingRequiredDocumentCount', document_summary.missing_required_count,
        'documentsAwaitingReviewCount', document_summary.awaiting_review_count,
        'documentsNeedingCorrectionCount', document_summary.correction_count,
        'documents', document_summary.documents,
        'canSubmitNow',
          application_record.status in ('draft','incomplete','additional_info_required')
          and field_summary.missing_count = 0
          and document_summary.missing_required_count = 0,
        'waitingOnSkima',
          application_record.status in ('submitted','under_review','resubmitted')
          and document_summary.correction_count = 0,
        'nextAction',
          case
            when application_record.status in ('draft','incomplete')
              and field_summary.missing_count > 0
              then 'Complete the missing application details before submitting.'
            when application_record.status in ('draft','incomplete','additional_info_required')
              and document_summary.correction_count > 0
              then 'Replace or correct the documents marked for changes, then submit again.'
            when application_record.status in ('draft','incomplete','additional_info_required')
              and document_summary.missing_required_count > 0
              then 'Add the remaining required documents before submitting.'
            when application_record.status in ('draft','incomplete','additional_info_required')
              then 'Your required application details and documents are ready. Review them and submit when you are satisfied.'
            when application_record.status = 'submitted'
              then 'SKIMA has received your application. No applicant action is currently required unless SKIMA requests changes.'
            when application_record.status = 'resubmitted'
              then 'SKIMA has received your updated application. No applicant action is currently required unless SKIMA requests more changes.'
            when application_record.status = 'under_review'
              then 'Your application is under review. No applicant action is currently required unless SKIMA requests changes.'
            when application_record.status = 'approved'
              then case
                when application_record.activated_subject_id is not null
                  then 'Your application is approved and the approved partner record has been created.'
                else 'Your application is approved. Partner activation may still be completing through the platform workflow.'
              end
            when application_record.status = 'rejected'
              then case
                when latest_review.applicant_message is not null
                  then 'Review the message SKIMA sent with the decision for the reason and any available next step.'
                else 'This application was not approved. Contact SKIMA support if you need clarification.'
              end
            when application_record.status = 'suspended'
              then 'This approved application is currently suspended. Follow the applicant-facing SKIMA message or contact support for the permitted next step.'
            when application_record.status = 'expired'
              then 'This application has expired. Start a new application if the option is still available.'
            when application_record.status = 'withdrawn'
              then 'This application was withdrawn. Start a new application if you want to apply again.'
            else 'Open the application to review its current status and any applicant-facing message.'
          end,
        'explanationLimits', jsonb_build_object(
          'readOnly', true,
          'doesNotApproveApplication', true,
          'doesNotRejectApplication', true,
          'doesNotAssignReviewer', true,
          'doesNotReviewDocuments', true,
          'doesNotExposeInternalNotes', true
        )
      ) as row_data
    from public.application_records application_record
    join public.application_type_definitions application_type
      on application_type.id = application_record.application_type_id
    left join lateral (
      select coalesce(application_version.payload, '{}'::jsonb) as payload
      from public.application_versions application_version
      where application_version.application_id = application_record.id
        and application_version.version = application_record.active_version
      limit 1
    ) active_payload on true
    left join lateral (
      select
        review_event.decision,
        nullif(btrim(review_event.applicant_message), '') as applicant_message,
        review_event.created_at
      from public.application_review_events review_event
      where review_event.application_id = application_record.id
        and nullif(btrim(review_event.applicant_message), '') is not null
      order by review_event.created_at desc, review_event.id desc
      limit 1
    ) latest_review on true
    cross join lateral (
      select
        count(*)::integer as missing_count,
        coalesce(
          jsonb_agg(
            coalesce(field_definition ->> 'label', field_definition ->> 'path')
            order by field_definition ->> 'path'
          ) filter (
            where nullif(
              btrim(
                coalesce(
                  coalesce(active_payload.payload, '{}'::jsonb)
                    #>> string_to_array(field_definition ->> 'path', '.'),
                  ''
                )
              ),
              ''
            ) is null
          ),
          '[]'::jsonb
        ) as missing_labels
      from jsonb_array_elements(
        case
          when jsonb_typeof(application_type.metadata -> 'submission_required_fields') = 'array'
            then application_type.metadata -> 'submission_required_fields'
          else '[]'::jsonb
        end
      ) field_definition
    ) field_summary
    cross join lateral (
      select
        count(*)::integer as applicable_count,
        count(*) filter (where requirement.is_required)::integer as required_count,
        count(*) filter (
          where requirement.is_required
            and submission_counts.submission_ready_count >= requirement.min_count
        )::integer as submission_ready_count,
        count(*) filter (
          where requirement.review_required
            and submission_counts.approved_count >= requirement.min_count
        )::integer as approval_ready_count,
        count(*) filter (
          where requirement.is_required
            and submission_counts.submission_ready_count < requirement.min_count
        )::integer as missing_required_count,
        count(*) filter (
          where requirement.review_required
            and submission_counts.submission_ready_count >= requirement.min_count
            and submission_counts.approved_count < requirement.min_count
            and not submission_counts.needs_correction
        )::integer as awaiting_review_count,
        count(*) filter (
          where submission_counts.needs_correction
        )::integer as correction_count,
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'requirementKey', requirement.key,
              'displayName', requirement.display_name,
              'description', requirement.description,
              'required', requirement.is_required,
              'reviewRequired', requirement.review_required,
              'minCount', requirement.min_count,
              'latestStatus', submission_counts.latest_status,
              'submittedCount', submission_counts.total_submission_count,
              'submissionReadyCount', submission_counts.submission_ready_count,
              'approvedCount', submission_counts.approved_count,
              'needsCorrection', submission_counts.needs_correction,
              'latestApplicantMessage', submission_counts.latest_applicant_message,
              'latestApplicantMessageAt', submission_counts.latest_applicant_message_at
            )
            order by requirement.is_required desc, requirement.display_name
          ),
          '[]'::jsonb
        ) as documents
      from public.document_requirements requirement
      cross join lateral (
        select
          count(submission.id)::integer as total_submission_count,
          count(submission.id) filter (
            where submission.status in ('uploaded','submitted','under_review','approved')
          )::integer as submission_ready_count,
          count(submission.id) filter (
            where submission.status = 'approved'
          )::integer as approved_count,
          coalesce((
            select latest_submission.status in ('rejected','correction_required')
            from public.document_submissions latest_submission
            where latest_submission.application_id = application_record.id
              and latest_submission.requirement_id = requirement.id
            order by latest_submission.created_at desc, latest_submission.id desc
            limit 1
          ), false) as needs_correction,
          (
            select latest_submission.status
            from public.document_submissions latest_submission
            where latest_submission.application_id = application_record.id
              and latest_submission.requirement_id = requirement.id
            order by latest_submission.created_at desc, latest_submission.id desc
            limit 1
          ) as latest_status,
          (
            select nullif(btrim(document_event.applicant_message), '')
            from public.document_review_events document_event
            join public.document_submissions message_submission
              on message_submission.id = document_event.document_submission_id
            where message_submission.application_id = application_record.id
              and message_submission.requirement_id = requirement.id
              and nullif(btrim(document_event.applicant_message), '') is not null
            order by document_event.created_at desc, document_event.id desc
            limit 1
          ) as latest_applicant_message,
          (
            select document_event.created_at
            from public.document_review_events document_event
            join public.document_submissions message_submission
              on message_submission.id = document_event.document_submission_id
            where message_submission.application_id = application_record.id
              and message_submission.requirement_id = requirement.id
              and nullif(btrim(document_event.applicant_message), '') is not null
            order by document_event.created_at desc, document_event.id desc
            limit 1
          ) as latest_applicant_message_at
        from public.document_submissions submission
        where submission.application_id = application_record.id
          and submission.requirement_id = requirement.id
      ) submission_counts
      where requirement.requirement_set_id = application_type.document_requirement_set_id
        and requirement.status = 'active'
        and public.application_requirement_applies(
          requirement.metadata,
          coalesce(active_payload.payload, '{}'::jsonb)
        )
    ) document_summary
    where application_record.applicant_user_id = auth.uid()
    order by application_record.created_at desc
    limit least(greatest(coalesce(target_limit, 10), 1), 50)
  ) applicant_rows;

  return result;
end;
$$;

revoke all on function public.read_my_application_explanations(integer)
from public, anon;
grant execute on function public.read_my_application_explanations(integer)
to authenticated, service_role;

comment on function public.read_my_application_explanations(integer) is
  'Applicant-safe, read-only application/document explanation. Exposes only the signed-in applicant own records and applicant-facing reviewer messages; excludes internal notes and reviewer identity.';

commit;
