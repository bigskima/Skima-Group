begin;

-- Bridge approved LPG driver/vehicle application documents into the
-- dispatch compliance ledger. Application documents are owned by an
-- application record, while dispatch evaluates the activated driver/vehicle
-- entity. Keep the source application and document auditable.
create or replace function public.sync_application_compliance_evidence(target_application_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  application_record record;
  requirement_record record;
  document_record record;
  current_evidence record;
  target_subject_type text;
  target_subject_id uuid;
  target_valid_from date;
  target_valid_until date;
  target_reviewed_by uuid;
  target_reviewed_at timestamptz;
  target_document_submission_id uuid;
  has_source_evidence boolean;
  affected integer := 0;
begin
  select
    application.*,
    application_type.key as application_type_key,
    application_type.application_category
  into application_record
  from public.application_records application
  join public.application_type_definitions application_type
    on application_type.id = application.application_type_id
  where application.id = target_application_id;

  if not found then
    return 0;
  end if;

  -- Only approved LPG driver and vehicle applications can project evidence.
  if application_record.status <> 'approved'
    or application_record.application_type_key not like 'application.lpg.%'
    or application_record.application_category not in ('driver', 'vehicle')
    or application_record.activated_subject_type is distinct from application_record.application_category
    or application_record.activated_subject_id is null then
    update public.compliance_evidence evidence
    set status = 'revoked',
        metadata = evidence.metadata || jsonb_build_object(
          'revocationReason', 'Source LPG application is no longer approved and activated',
          'revokedAt', timezone('utc', now())
        ),
        updated_at = timezone('utc', now())
    where evidence.metadata->>'projectionSource' = 'approved_lpg_application'
      and evidence.metadata->>'sourceApplicationId' = target_application_id::text
      and evidence.status in ('pending', 'valid');
    get diagnostics affected = row_count;
    return affected;
  end if;

  target_subject_type := application_record.application_category;
  target_subject_id := application_record.activated_subject_id;

  for requirement_record in
    select requirement.*
    from public.compliance_requirement_definitions requirement
    where requirement.subject_type = target_subject_type
      and requirement.status = 'active'
      and requirement.required
      and (requirement.module_key is null or requirement.module_key = 'lpg')
    order by requirement.key
  loop
    target_document_submission_id := null;
    target_valid_from := coalesce(application_record.approved_at::date, current_date);
    target_valid_until := null;
    target_reviewed_by := null;
    target_reviewed_at := application_record.approved_at;
    has_source_evidence := false;

    -- LPG service approval is the governed approval of the LPG driver
    -- application itself; there is intentionally no separate upload for it.
    if target_subject_type = 'driver'
      and requirement_record.key = 'driver.lpg_approval' then
      has_source_evidence := true;
    elsif requirement_record.document_purpose_key is not null then
      select
        document.id,
        document.expires_at::date as valid_until,
        coalesce(document.reviewed_at::date, document.submitted_at::date, document.created_at::date) as valid_from,
        document.reviewer_user_id,
        document.reviewed_at
      into document_record
      from public.document_submissions document
      join public.document_requirements document_requirement
        on document_requirement.id = document.requirement_id
      where document.application_id = target_application_id
        and document.subject_type = 'application'
        and document.subject_id = target_application_id
        and document_requirement.key = requirement_record.document_purpose_key
        and document_requirement.status = 'active'
        and document.status = 'approved'
        and not coalesce(document.replacement_requested, false)
        and (document.expires_at is null or document.expires_at::date >= current_date)
      order by document.reviewed_at desc nulls last,
        document.submitted_at desc nulls last,
        document.created_at desc
      limit 1;

      if found then
        target_document_submission_id := document_record.id;
        target_valid_from := coalesce(document_record.valid_from, current_date);
        target_valid_until := document_record.valid_until;
        target_reviewed_by := document_record.reviewer_user_id;
        target_reviewed_at := document_record.reviewed_at;
        has_source_evidence := true;
      end if;
    end if;

    if not has_source_evidence then
      update public.compliance_evidence evidence
      set status = 'revoked',
          metadata = evidence.metadata || jsonb_build_object(
            'revocationReason', 'Source application document is no longer approved',
            'revokedAt', timezone('utc', now())
          ),
          updated_at = timezone('utc', now())
      where evidence.requirement_key = requirement_record.key
        and evidence.subject_type = target_subject_type
        and evidence.subject_id = target_subject_id
        and evidence.metadata->>'projectionSource' = 'approved_lpg_application'
        and evidence.metadata->>'sourceApplicationId' = target_application_id::text
        and evidence.status in ('pending', 'valid');
      get diagnostics affected = row_count;
      continue;
    end if;

    select evidence.*
    into current_evidence
    from public.compliance_evidence evidence
    where evidence.requirement_key = requirement_record.key
      and evidence.subject_type = target_subject_type
      and evidence.subject_id = target_subject_id
      and evidence.status in ('pending', 'valid')
    order by evidence.created_at desc
    limit 1
    for update;

    if found then
      -- Do not replace evidence that was separately reviewed directly against
      -- the driver/vehicle entity. Only refresh our own application projection.
      if current_evidence.metadata->>'projectionSource' is distinct from 'approved_lpg_application' then
        continue;
      end if;

      update public.compliance_evidence
      set document_submission_id = target_document_submission_id,
          status = 'valid',
          valid_from = target_valid_from,
          valid_until = target_valid_until,
          reviewed_by = target_reviewed_by,
          reviewed_at = target_reviewed_at,
          metadata = current_evidence.metadata || jsonb_build_object(
            'projectionSource', 'approved_lpg_application',
            'sourceApplicationId', target_application_id,
            'sourceApplicationVersion', application_record.active_version,
            'sourceApplicationTypeKey', application_record.application_type_key,
            'sourceDocumentRequirementKey', requirement_record.document_purpose_key,
            'sourceDocumentSubmissionId', target_document_submission_id,
            'projectedAt', timezone('utc', now())
          ),
          updated_at = timezone('utc', now())
      where id = current_evidence.id;
    else
      insert into public.compliance_evidence (
        requirement_key,
        subject_type,
        subject_id,
        document_submission_id,
        status,
        valid_from,
        valid_until,
        reviewed_by,
        reviewed_at,
        metadata
      )
      values (
        requirement_record.key,
        target_subject_type,
        target_subject_id,
        target_document_submission_id,
        'valid',
        target_valid_from,
        target_valid_until,
        target_reviewed_by,
        target_reviewed_at,
        jsonb_build_object(
          'projectionSource', 'approved_lpg_application',
          'sourceApplicationId', target_application_id,
          'sourceApplicationVersion', application_record.active_version,
          'sourceApplicationTypeKey', application_record.application_type_key,
          'sourceDocumentRequirementKey', requirement_record.document_purpose_key,
          'sourceDocumentSubmissionId', target_document_submission_id,
          'projectedAt', timezone('utc', now())
        )
      );
    end if;

    affected := affected + 1;
  end loop;

  return affected;
end;
$function$;

create or replace function public.sync_application_compliance_evidence_after_application_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  perform public.sync_application_compliance_evidence(new.id);
  return new;
end;
$function$;

create or replace function public.sync_application_compliance_evidence_after_document_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
begin
  if new.subject_type = 'application' and new.application_id is not null then
    perform public.sync_application_compliance_evidence(new.application_id);
  end if;
  return new;
end;
$function$;

revoke all on function public.sync_application_compliance_evidence(uuid) from public, anon, authenticated;
revoke all on function public.sync_application_compliance_evidence_after_application_change() from public, anon, authenticated;
revoke all on function public.sync_application_compliance_evidence_after_document_change() from public, anon, authenticated;

drop trigger if exists application_records_sync_dispatch_compliance on public.application_records;
create trigger application_records_sync_dispatch_compliance
after update of status, activated_subject_type, activated_subject_id
on public.application_records
for each row
execute function public.sync_application_compliance_evidence_after_application_change();

drop trigger if exists document_submissions_sync_dispatch_compliance on public.document_submissions;
create trigger document_submissions_sync_dispatch_compliance
after insert or update
on public.document_submissions
for each row
execute function public.sync_application_compliance_evidence_after_document_change();

-- Backfill entities that were already approved and activated before the bridge
-- existed, including applications whose documents were approved first.
do $backfill$
declare
  application_row record;
begin
  for application_row in
    select application.id
    from public.application_records application
    join public.application_type_definitions application_type
      on application_type.id = application.application_type_id
    where application.status = 'approved'
      and application_type.key like 'application.lpg.%'
      and application_type.application_category in ('driver', 'vehicle')
      and application.activated_subject_type = application_type.application_category
      and application.activated_subject_id is not null
  loop
    perform public.sync_application_compliance_evidence(application_row.id);
  end loop;
end;
$backfill$;

comment on function public.sync_application_compliance_evidence(uuid) is
  'Projects admin-approved LPG driver/vehicle application documents into entity compliance evidence used by live dispatch eligibility, without bypassing document approval or changing application status.';

commit;