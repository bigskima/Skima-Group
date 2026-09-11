begin;

-- Personal KYC is shared by driver applicants and station representatives.
-- Keep role/audience naming in configuration rather than provider runtime branches so
-- the verification adapter remains reusable outside the LPG bounded context.
update public.application_verification_requirements mapping
set
  metadata = coalesce(mapping.metadata, '{}'::jsonb) || jsonb_build_object(
    'provider_audience', 'driver'
  ),
  updated_at = timezone('utc', now())
from public.application_type_definitions application_type,
     public.verification_definitions definition
where mapping.application_type_id = application_type.id
  and mapping.verification_definition_id = definition.id
  and application_type.key = 'application.lpg.driver.phase-one'
  and definition.key = 'verification.person.identity';

update public.application_verification_requirements mapping
set
  metadata = coalesce(mapping.metadata, '{}'::jsonb) || jsonb_build_object(
    'provider_audience', 'station_rep'
  ),
  updated_at = timezone('utc', now())
from public.application_type_definitions application_type,
     public.verification_definitions definition
where mapping.application_type_id = application_type.id
  and mapping.verification_definition_id = definition.id
  and application_type.key = 'application.lpg.station.phase-one'
  and definition.key = 'verification.person.identity';

-- The API key and workflow UUID can belong to different Didit applications after
-- credentials are rotated. Allow the Edge adapter to recover from a stale UUID by
-- resolving an active KYC workflow owned by the currently configured API key. The
-- resolved workflow is persisted back to this route, so discovery is not repeated.
update public.verification_provider_routes route
set
  config = coalesce(route.config, '{}'::jsonb) || jsonb_build_object(
    'audience', jsonb_build_array('driver', 'station_rep', 'station_representative'),
    'workflowRecoveryEnabled', true,
    'workflowRecoveryPreferConfiguredLabel', true,
    'workflowRecoveryAllowDefaultKyc', true,
    'workflowRecoveryPersistResolvedRef', true,
    'providerAudienceAliases', jsonb_build_object(
      'station_rep', jsonb_build_array('station_rep', 'station_representative'),
      'station_representative', jsonb_build_array('station_rep', 'station_representative')
    ),
    'policySource', 'skima_launch_verification_policy'
  ),
  updated_at = timezone('utc', now())
from public.verification_definitions definition,
     public.provider_adapters provider
where route.verification_definition_id = definition.id
  and route.provider_adapter_id = provider.id
  and definition.key = 'verification.person.identity'
  and provider.key = 'provider.verification.didit'
  and provider.provider_kind = 'verification'
  and route.status <> 'retired';

notify pgrst, 'reload schema';

commit;
