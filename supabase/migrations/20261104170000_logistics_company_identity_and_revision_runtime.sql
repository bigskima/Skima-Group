begin;

-- Keep CAC evidence optional, but require the person applying for the company
-- to identify themselves with an 11-digit NIN and upload their identity evidence.
update public.document_requirements requirement
set is_required = requirement.key = 'logistics.company.owner-identity',
    min_count = case when requirement.key = 'logistics.company.owner-identity' then 1 else 0 end,
    max_count = case when requirement.key = 'logistics.company.owner-identity' then 2 else 5 end,
    metadata = requirement.metadata
      || case
        when requirement.key = 'logistics.company.owner-identity' then
          jsonb_build_object(
            'privacy_classification', 'PRIVATE_KYC',
            'applicant_identity_required', true,
            'nin_document_required', true
          )
        when requirement.key = 'logistics.company.registration' then
          jsonb_build_object(
            'optional_for_unregistered_company', true,
            'registration_document_optional', true
          )
        else '{}'::jsonb
      end,
    updated_at = timezone('utc', now())
from public.application_type_definitions application_type
where application_type.key = 'application.logistics.company'
  and requirement.requirement_set_id = application_type.document_requirement_set_id
  and requirement.key in (
    'logistics.company.owner-identity',
    'logistics.company.registration',
    'logistics.company.proof-of-address'
  );

update public.application_type_definitions
set metadata = metadata || jsonb_build_object(
  'registration_optional', true,
  'registration_document_optional', true,
  'submission_required_fields', jsonb_build_array(
    jsonb_build_object('path', 'applicant.full_name', 'label', 'Applicant full name'),
    jsonb_build_object('path', 'applicant.nin', 'label', 'Applicant NIN')
  )
),
updated_at = timezone('utc', now())
where key = 'application.logistics.company';

-- Reuse the existing provider-agnostic Didit person identity flow for the
-- natural person who represents a Logistics company. CAC/KYB remains SKIMA's
-- manual review decision; no company-registry lookup or CAC certificate is
-- made mandatory by this mapping.
insert into public.application_verification_requirements (
  application_type_id,
  verification_definition_id,
  is_required,
  manual_fallback_allowed,
  satisfies_document_keys,
  priority,
  status,
  metadata
)
select
  application_type.id,
  verification_definition.id,
  true,
  true,
  '{}'::text[],
  10,
  'active',
  jsonb_build_object(
    'provider_audience', 'logistics_company_representative',
    'review_scope', 'company_applicant_identity',
    'manual_fallback_evidence_key', 'logistics.company.owner-identity'
  )
from public.application_type_definitions application_type
join public.verification_definitions verification_definition
  on verification_definition.key = 'verification.person.identity'
 and verification_definition.status = 'active'
where application_type.key = 'application.logistics.company'
on conflict (application_type_id, verification_definition_id) do update
set is_required = excluded.is_required,
    manual_fallback_allowed = excluded.manual_fallback_allowed,
    satisfies_document_keys = excluded.satisfies_document_keys,
    priority = excluded.priority,
    status = 'active',
    metadata = public.application_verification_requirements.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

-- Extend the active personal KYC route audience without changing the existing
-- LPG driver or station representative audiences.
update public.verification_provider_routes route
set config = jsonb_set(
      route.config,
      '{audience}',
      coalesce(route.config -> 'audience', '[]'::jsonb)
        || '["logistics_company_representative"]'::jsonb,
      true
    ),
    updated_at = timezone('utc', now())
from public.verification_definitions definition
where route.verification_definition_id = definition.id
  and definition.key = 'verification.person.identity'
  and route.status = 'active'
  and not coalesce(route.config -> 'audience', '[]'::jsonb)
    ? 'logistics_company_representative';

-- Let applicants make audited edits and upload replacement evidence while
-- SKIMA's review task is still open. Final decisions remain immutable.
do $$
declare
  original_definition text;
  patched_definition text;
begin
  select pg_get_functiondef(
    'public.update_application_payload(uuid,jsonb,text,jsonb)'::regprocedure
  ) into original_definition;

  patched_definition := replace(
    original_definition,
    $old$if application_record.status not in (
    'draft',
    'incomplete',
    'additional_info_required',
    'resubmitted'
  ) then$old$,
    $new$if application_record.status not in (
    'draft',
    'incomplete',
    'additional_info_required',
    'resubmitted',
    'submitted',
    'under_review'
  ) then$new$
  );

  if patched_definition = original_definition then
    raise exception 'Could not safely extend update_application_payload review-state policy';
  end if;
  execute patched_definition;

  select pg_get_functiondef(
    'public.register_document_submission(uuid,text,text,text,text,bigint,text,text,text,jsonb)'::regprocedure
  ) into original_definition;

  patched_definition := replace(
    original_definition,
    $old$if application_record.status not in ('draft','incomplete','additional_info_required','resubmitted') then$old$,
    $new$if application_record.status not in ('draft','incomplete','additional_info_required','resubmitted','submitted','under_review') then$new$
  );

  if patched_definition = original_definition then
    raise exception 'Could not safely extend register_document_submission review-state policy';
  end if;
  execute patched_definition;
end;
$$;

create or replace function public.enforce_logistics_company_nin_before_submission()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  application_type_key text;
  application_payload jsonb;
  applicant_name text;
  applicant_nin text;
begin
  if new.status is not distinct from old.status
    or new.status not in ('submitted', 'under_review', 'resubmitted') then
    return new;
  end if;

  select application_type.key
  into application_type_key
  from public.application_type_definitions application_type
  where application_type.id = new.application_type_id;

  if application_type_key <> 'application.logistics.company' then
    return new;
  end if;

  select coalesce(version.payload, '{}'::jsonb)
  into application_payload
  from public.application_versions version
  where version.application_id = new.id
    and version.version = new.active_version;

  applicant_name := nullif(btrim(application_payload #>> '{applicant,full_name}'), '');
  applicant_nin := nullif(btrim(application_payload #>> '{applicant,nin}'), '');

  if applicant_name is null then
    raise exception 'The applicant full name is required before submitting the Logistics company application';
  end if;

  if applicant_nin is null or applicant_nin !~ '^[0-9]{11}$' then
    raise exception 'Enter a valid 11-digit NIN before submitting the Logistics company application';
  end if;

  return new;
end;
$$;

drop trigger if exists logistics_company_nin_submission_guard on public.application_records;
create trigger logistics_company_nin_submission_guard
before update of status on public.application_records
for each row
execute function public.enforce_logistics_company_nin_before_submission();

revoke all on function public.enforce_logistics_company_nin_before_submission() from public, anon, authenticated;

commit;
