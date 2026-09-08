begin;

-- Use Didit's existing Free KYC workflow for personal identity checks.
-- The previous "Compliance workflow" is billable ($0.15-$0.35/session)
-- and was causing live session creation to fail with "not enough credits"
-- even though SKIMA should be using Didit's free monthly KYC allowance.
update public.verification_provider_routes route
set
  workflow_ref = '108e2fb0-6f50-4a39-87c9-a87060dabcd1',
  status = 'active',
  config = (
    coalesce(route.config, '{}'::jsonb)
      - 'runtimePauseReason'
      - 'runtimePausedAt'
  ) || jsonb_build_object(
    'workflow_kind', 'KYC',
    'workflow_label', 'Free KYC',
    'features', jsonb_build_array(
      'ID_VERIFICATION',
      'PASSIVE_LIVENESS',
      'FACE_MATCH',
      'IP_ANALYSIS'
    ),
    'launchMode', 'automatic_kyc',
    'freeTierEligible', true,
    'freeTierAllowancePerFeaturePerMonth', 500,
    'providerWorkflowStatus', 'available',
    'policySource', 'skima_launch_verification_policy',
    'source', 'didit_live_workflow_reconciliation'
  ),
  updated_at = timezone('utc', now())
from public.verification_definitions definition,
     public.provider_adapters provider
where route.verification_definition_id = definition.id
  and route.provider_adapter_id = provider.id
  and definition.key = 'verification.person.identity'
  and provider.key = 'provider.verification.didit'
  and provider.provider_kind = 'verification';

-- Representative authority is not identity verification. The old route reused
-- a KYC workflow, which could never prove employment/authority. Keep this
-- requirement manual/assisted and preserve its mapped authority evidence.
update public.verification_provider_routes route
set
  status = 'paused',
  config = coalesce(route.config, '{}'::jsonb) || jsonb_build_object(
    'launchMode', 'assisted_authority_review',
    'manualReviewPrimary', true,
    'automaticRouteRetained', true,
    'policySource', 'skima_launch_verification_policy',
    'pauseReason', 'authority_evidence_requires_manual_review'
  ),
  updated_at = timezone('utc', now())
from public.verification_definitions definition,
     public.provider_adapters provider
where route.verification_definition_id = definition.id
  and route.provider_adapter_id = provider.id
  and definition.key = 'verification.station.authority'
  and provider.key = 'provider.verification.didit'
  and provider.provider_kind = 'verification';

update public.application_verification_requirements mapping
set
  metadata = coalesce(mapping.metadata, '{}'::jsonb) || jsonb_build_object(
    'launch_mode', 'assisted_authority_review',
    'manual_admin_review', true,
    'automatic_identity_check_does_not_satisfy_authority', true
  ),
  updated_at = timezone('utc', now())
from public.application_type_definitions application_type,
     public.verification_definitions definition
where mapping.application_type_id = application_type.id
  and mapping.verification_definition_id = definition.id
  and application_type.key = 'application.lpg.station.phase-one'
  and definition.key = 'verification.station.authority';

notify pgrst, 'reload schema';

commit;
