begin;

-- SKIMA application review readiness for authorized administrators.
-- This is a deterministic, read-only decision-support projection.
-- The existing application/document workflow remains authoritative and this function
-- cannot approve, reject, suspend, assign a reviewer, or review a document.

create or replace function public.read_ai_application_review_readiness(
  target_limit integer default 50
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
  if not (
    auth.role() = 'service_role'
    or public.is_platform_super_admin()
    or public.has_permission('platform.ai.read', null)
    or public.has_permission('platform.ai.manage', null)
    or public.has_permission('platform.applications.review', null)
    or public.has_permission('platform.applications.manage', null)
    or public.has_permission('platform.documents.review', null)
  ) then
    raise exception using
      errcode = '42501',
      message = 'application review readiness permission is required';
  end if;

  select coalesce(
    jsonb_agg(row_data order by review_rank desc, submitted_at asc nulls last, created_at asc),
    '[]'::jsonb
  )
  into result
  from (
    select
      application_record.created_at,
      application_record.submitted_at,
      (
        case
          when application_record.status = 'under_review'
            and document_summary.approval_blocker_count = 0 then 400
          when application_record.status = 'under_review' then 300
          when application_record.status in ('submitted','resubmitted') then 200
          when application_record.status = 'additional_info_required' then 100
          else 0
        end
        + least(
            greatest(
              floor(
                extract(
                  epoch from (
                    timezone('utc', now())
                    - coalesce(
                        application_record.submitted_at,
                        application_record.created_at
                      )
                  )
                ) / 86400.0
              )::integer,
              0
            ),
            30
          )
      ) as review_rank,
      jsonb_build_object(
        'applicationId', application_record.id,
        'applicantUserId', application_record.applicant_user_id,
        'applicationTypeKey', application_type.key,
        'applicationTypeName', application_type.display_name,
        'applicationCategory', application_type.application_category,
        'status', application_record.status,
        'activeVersion', application_record.active_version,
        'submittedAt', application_record.submitted_at,
        'createdAt', application_record.created_at,
        'updatedAt', application_record.updated_at,
        'latestReviewTaskStatus', latest_task.status,
        'latestReviewTaskDueAt', latest_task.due_at,
        'latestApplicantMessage', latest_review.applicant_message,
        'latestApplicantDecision', latest_review.decision,
        'missingRequiredFieldCount', field_summary.missing_count,
        'missingRequiredFields', field_summary.missing_labels,
        'applicableDocumentCount', document_summary.applicable_count,
        'requiredDocumentCount', document_summary.required_count,
        'reviewRequiredDocumentCount', document_summary.review_required_count,
        'submissionReadyDocumentCount', document_summary.submission_ready_count,
        'approvedReviewRequiredDocumentCount', document_summary.approved_review_count,
        'missingRequiredDocumentCount', document_summary.missing_required_count,
        'approvalBlockerCount', document_summary.approval_blocker_count,
        'documentsAwaitingReviewCount', document_summary.awaiting_review_count,
        'documentsNeedingCorrectionCount', document_summary.correction_count,
        'missingRequiredDocuments', document_summary.missing_required_labels,
        'documentsAwaitingReview', document_summary.awaiting_review_labels,
        'documentsNeedingCorrection', document_summary.correction_labels,
        'decisionReady',
          application_record.status = 'under_review'
          and document_summary.approval_blocker_count = 0,
        'waitingOnApplicant',
          application_record.status = 'additional_info_required'
          or document_summary.correction_count > 0,
        'waitingOnSkima',
          application_record.status in ('submitted','resubmitted','under_review')
          and document_summary.correction_count = 0,
        'reviewAgeHours',
          round(
            greatest(
              extract(
                epoch from (
                  timezone('utc', now())
                  - coalesce(
                      application_record.submitted_at,
                      application_record.created_at
                    )
                )
              ) / 3600.0,
              0
            ),
            2
          ),
        'nextReviewAction',
          case
            when application_record.status = 'additional_info_required'
              then 'Wait for the applicant to submit the requested changes unless a support follow-up is needed.'
            when field_summary.missing_count > 0
              then 'The saved application is missing configured required fields. Review the application record before any decision.'
            when document_summary.missing_required_count > 0
              then 'Required applicable documents are missing. Do not approve the application.'
            when document_summary.correction_count > 0
              then 'Applicant-facing document corrections are outstanding. Do not approve until corrected evidence is submitted and reviewed.'
            when document_summary.awaiting_review_count > 0
              then 'Review the applicable submitted documents that are still awaiting an approval decision.'
            when application_record.status in ('submitted','resubmitted')
              then 'Assign or begin human review using the canonical application review workflow.'
            when application_record.status = 'under_review'
              and document_summary.approval_blocker_count = 0
              then 'The applicable document approval gate is satisfied. A human reviewer may now evaluate the application and make the final decision.'
            when application_record.status = 'under_review'
              then 'Continue human review of the outstanding applicable documents before a final application decision.'
            else 'Review the canonical application workflow state before taking any action.'
          end,
        'control', jsonb_build_object(
          'advisoryOnly', true,
          'doesNotApproveApplication', true,
          'doesNotRejectApplication', true,
          'doesNotSuspendApplication', true,
          'doesNotAssignReviewer', true,
          'doesNotReviewDocuments', true,
          'doesNotExposeInternalNotes', true,
          'humanDecisionRequired', true
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
      select review_task.status, review_task.due_at
      from public.application_review_tasks review_task
      where review_task.application_id = application_record.id
      order by review_task.created_at desc, review_task.id desc
      limit 1
    ) latest_task on true
    left join lateral (
      select
        review_event.decision,
        nullif(btrim(review_event.applicant_message), '') as applicant_message
      from public.application_review_events review_event
      where review_event.application_id = application_record.id
        and nullif(btrim(review_event.applicant_message), '') is not null
      order by review_event.created_at desc, review_event.id desc
      limit 1
    ) latest_review on true
    cross join lateral (
      select
        count(*) filter (
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
        )::integer as missing_count,
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
        count(*) filter (where requirement.review_required)::integer as review_required_count,
        count(*) filter (
          where requirement.is_required
            and submission_counts.submission_ready_count >= requirement.min_count
        )::integer as submission_ready_count,
        count(*) filter (
          where requirement.review_required
            and submission_counts.approved_count >= requirement.min_count
        )::integer as approved_review_count,
        count(*) filter (
          where requirement.is_required
            and submission_counts.submission_ready_count < requirement.min_count
        )::integer as missing_required_count,
        count(*) filter (
          where requirement.review_required
            and submission_counts.approved_count < requirement.min_count
        )::integer as approval_blocker_count,
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
          jsonb_agg(requirement.display_name order by requirement.display_name)
            filter (
              where requirement.is_required
                and submission_counts.submission_ready_count < requirement.min_count
            ),
          '[]'::jsonb
        ) as missing_required_labels,
        coalesce(
          jsonb_agg(requirement.display_name order by requirement.display_name)
            filter (
              where requirement.review_required
                and submission_counts.submission_ready_count >= requirement.min_count
                and submission_counts.approved_count < requirement.min_count
                and not submission_counts.needs_correction
            ),
          '[]'::jsonb
        ) as awaiting_review_labels,
        coalesce(
          jsonb_agg(requirement.display_name order by requirement.display_name)
            filter (where submission_counts.needs_correction),
          '[]'::jsonb
        ) as correction_labels
      from public.document_requirements requirement
      cross join lateral (
        select
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
          ), false) as needs_correction
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
    where application_record.status in (
      'submitted',
      'under_review',
      'additional_info_required',
      'resubmitted'
    )
    order by
      review_rank desc,
      application_record.submitted_at asc nulls last,
      application_record.created_at asc
    limit least(greatest(coalesce(target_limit, 50), 1), 250)
  ) review_rows;

  return result;
end;
$$;

revoke all on function public.read_ai_application_review_readiness(integer)
from public, anon;
grant execute on function public.read_ai_application_review_readiness(integer)
to authenticated, service_role;

comment on function public.read_ai_application_review_readiness(integer) is
  'Authorized read-only application review readiness. Mirrors conditional document submission/approval gates but never performs a review or exposes internal reviewer notes.';

commit;
