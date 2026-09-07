begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Didit uses the same hosted Sessions API for individual KYC and business KYB;
-- the configured workflow ID determines the session kind. Keep routes inactive
-- until an Admin supplies the real workflow IDs, but describe the provider
-- capabilities accurately so station onboarding can use KYB without removing
-- unrelated manual compliance evidence.
update public.provider_adapters
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
      'session_api_version', 'v3',
      'supports', jsonb_build_array(
        'identity_document',
        'passive_liveness',
        'face_match',
        'kyc',
        'business_verification',
        'kyb',
        'company_registry',
        'beneficial_owners',
        'officers',
        'aml_screening'
      ),
      'kyb', jsonb_build_object(
        'enabled', true,
        'workflow_driven', true,
        'satisfies_only_mapped_document_keys', true
      )
    ),
    updated_at = timezone('utc', now())
where provider_kind = 'verification'
  and key = 'provider.verification.didit';

update public.verification_definitions
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'provider_workflow_kind', 'KYB',
      'business_registry_lookup', true,
      'business_profile_supported', true,
      'manual_compliance_preserved', true
    ),
    updated_at = timezone('utc', now())
where key = 'verification.business.registry';

update public.application_verification_requirements mapping
set metadata = coalesce(mapping.metadata, '{}'::jsonb) || jsonb_build_object(
      'provider_workflow_kind', 'KYB',
      'automatic_scope', 'business_registration',
      'manual_compliance_preserved', true,
      'customer_copy', 'Verify the registered business'
    ),
    updated_at = timezone('utc', now())
where mapping.application_type_id = (
    select id
    from public.application_type_definitions
    where key = 'application.lpg.station.phase-one'
  )
  and mapping.verification_definition_id = (
    select id
    from public.verification_definitions
    where key = 'verification.business.registry'
  );

-- These evidence types remain outside the KYB auto-satisfaction mapping. Their
-- existing required/optional status is left unchanged; this metadata prevents
-- future automation from accidentally treating a registry pass as facility
-- safety or operational evidence.
update public.document_requirements requirement
set metadata = coalesce(requirement.metadata, '{}'::jsonb) || jsonb_build_object(
      'verification_scope', 'manual_compliance',
      'not_satisfied_by_business_kyb', true
    ),
    updated_at = timezone('utc', now())
where requirement.requirement_set_id = (
    select id
    from public.document_requirement_sets
    where key = 'documents.lpg.station.phase-one'
  )
  and requirement.key in (
    'station.business-permit',
    'station.fire-safety-certificate',
    'station.regulatory-certificate',
    'station.photo.front',
    'station.photo.pump',
    'station.photo.tank'
  );

commit;
