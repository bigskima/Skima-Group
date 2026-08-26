begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- These generic purposes intentionally have independent configurable quality
-- records. They are not aliases for a city, country, service, or provider.
insert into public.location_quality_policies (
  purpose, high_confidence_max_meters, acceptable_max_meters,
  recapture_above_meters, status, configuration
)
select configured.*
from (values
  ('APPLICATION_SUBMISSION', 30, 100, 500, 'active', '{"missingAccuracyResult":"RECAPTURE_REQUIRED"}'::jsonb),
  ('APPLICATION_DECLARED', 30, 100, 500, 'active', '{"missingAccuracyResult":"MANUAL_REVIEW"}'::jsonb)
) configured(purpose, high_confidence_max_meters, acceptable_max_meters, recapture_above_meters, status, configuration)
where not exists (
  select 1
  from public.location_quality_policies existing
  where existing.purpose = configured.purpose
    and existing.service_key is null
    and existing.capture_source is null
    and existing.status = 'active'
);

-- Complete the production cutover for records that existed before canonical
-- location writes became authoritative.  Legacy rows remain compatibility
-- projections, but every one is mapped to an immutable canonical point.
with unmapped as (
  select legacy.*,
    coalesce(legacy.metadata->'addressComponents', '{}'::jsonb) address
  from public.lpg_customer_locations legacy
  left join public.canonical_location_legacy_mappings mapping
    on mapping.legacy_source = 'lpg_customer_locations'
   and mapping.legacy_id = legacy.id
  where mapping.id is null
), inserted as (
  insert into public.locations (
    point, accuracy_meters, formatted_address, country, country_code,
    admin_area_1, admin_area_2, locality, sublocality, street, house_number,
    postal_code, landmark, capture_source, geocoder_provider,
    geocoder_reference, captured_at, created_by, metadata
  )
  select
    extensions.st_setsrid(extensions.st_makepoint(unmapped.longitude, unmapped.latitude), 4326)::extensions.geography,
    unmapped.accuracy_meters,
    unmapped.formatted_address,
    unmapped.address->>'country',
    case when unmapped.address->>'countryCode' ~ '^[A-Za-z]{2}$' then upper(unmapped.address->>'countryCode') end,
    unmapped.address->>'region',
    unmapped.address->>'district',
    unmapped.address->>'city',
    unmapped.address->>'sublocality',
    unmapped.address->>'street',
    unmapped.address->>'houseNumber',
    unmapped.address->>'postalCode',
    unmapped.landmark,
    'IMPORTED',
    unmapped.provider_source,
    unmapped.provider_place_id,
    unmapped.created_at,
    unmapped.owner_user_id,
    unmapped.metadata || jsonb_build_object(
      'legacySource', 'lpg_customer_locations',
      'legacyId', unmapped.id,
      'quality', public.evaluate_location_quality('CUSTOMER_ADDRESS', unmapped.accuracy_meters, 'lpg', 'IMPORTED')
    )
  from unmapped
  returning id, metadata
)
insert into public.canonical_location_legacy_mappings (legacy_source, legacy_id, location_id, metadata)
select 'lpg_customer_locations', (inserted.metadata->>'legacyId')::uuid, inserted.id,
  jsonb_build_object('migration', 'canonical_location_production_cutover')
from inserted
on conflict (legacy_source, legacy_id) do nothing;

insert into public.entity_locations (entity_type, entity_id, location_id, purpose, is_current, metadata)
select 'LPG_CUSTOMER_LOCATION', mapping.legacy_id, mapping.location_id, 'CUSTOMER_ADDRESS', true,
  jsonb_build_object('ownerUserId', legacy.owner_user_id, 'migration', 'canonical_location_production_cutover')
from public.canonical_location_legacy_mappings mapping
join public.lpg_customer_locations legacy on legacy.id = mapping.legacy_id
left join public.entity_locations relationship
  on relationship.entity_type = 'LPG_CUSTOMER_LOCATION'
 and relationship.entity_id = mapping.legacy_id
 and relationship.purpose = 'CUSTOMER_ADDRESS'
 and relationship.is_current
where mapping.legacy_source = 'lpg_customer_locations'
  and relationship.id is null
on conflict do nothing;

update public.lpg_customer_locations legacy
set metadata = legacy.metadata || jsonb_build_object(
      'canonicalLocationId', mapping.location_id,
      'locationQuality', public.evaluate_location_quality('CUSTOMER_ADDRESS', legacy.accuracy_meters, 'lpg', 'IMPORTED')
    ),
    updated_at = timezone('utc', now())
from public.canonical_location_legacy_mappings mapping
where mapping.legacy_source = 'lpg_customer_locations'
  and mapping.legacy_id = legacy.id
  and legacy.metadata->>'canonicalLocationId' is distinct from mapping.location_id::text;

-- Existing application evidence is preserved and related to canonical
-- locations without rewriting the original verification record.
with unmapped as (
  select verification.*,
    case
      when verification.location_purpose like '%submission%' then 'APPLICATION_SUBMISSION'
      when verification.location_purpose like '%declared%' then 'APPLICATION_DECLARED'
      when verification.location_purpose like '%station%' then 'STATION_PHYSICAL'
      else 'APPLICATION_OPERATING_BASE'
    end relationship_purpose,
    case lower(coalesce(verification.provider_source, ''))
      when 'manual_pin' then 'MAP_PIN'
      when 'maps_adapter' then 'GEOCODED'
      when 'admin_verified' then 'ADMIN_VERIFIED'
      else 'IMPORTED'
    end source_class,
    application.applicant_user_id
  from public.application_location_verifications verification
  join public.application_records application on application.id = verification.application_id
  left join public.canonical_location_legacy_mappings mapping
    on mapping.legacy_source = 'application_location_verifications'
   and mapping.legacy_id = verification.id
  where mapping.id is null
), inserted as (
  insert into public.locations (
    point, accuracy_meters, formatted_address, capture_source,
    geocoder_provider, geocoder_reference, captured_at, confirmed_at,
    created_by, metadata
  )
  select
    extensions.st_setsrid(extensions.st_makepoint(unmapped.longitude, unmapped.latitude), 4326)::extensions.geography,
    unmapped.accuracy_meters,
    unmapped.formatted_address,
    unmapped.source_class,
    unmapped.provider_source,
    unmapped.provider_place_id,
    unmapped.recorded_at,
    case when unmapped.status = 'verified' then unmapped.reviewed_at end,
    unmapped.applicant_user_id,
    jsonb_build_object(
      'legacySource', 'application_location_verifications',
      'legacyId', unmapped.id,
      'applicationId', unmapped.application_id,
      'applicationVersionId', unmapped.application_version_id,
      'relationshipPurpose', unmapped.relationship_purpose,
      'evidenceSnapshot', unmapped.evidence_snapshot,
      'quality', public.evaluate_location_quality(unmapped.relationship_purpose, unmapped.accuracy_meters, null, unmapped.source_class)
    )
  from unmapped
  returning id, metadata
)
insert into public.canonical_location_legacy_mappings (legacy_source, legacy_id, location_id, metadata)
select 'application_location_verifications', (inserted.metadata->>'legacyId')::uuid, inserted.id,
  jsonb_build_object('purpose', inserted.metadata->>'relationshipPurpose', 'migration', 'canonical_location_production_cutover')
from inserted
on conflict (legacy_source, legacy_id) do nothing;

with ordered_evidence as (
  select verification.id verification_id, verification.application_id,
    verification.application_version_id, mapping.location_id,
    mapping.metadata->>'purpose' purpose,
    coalesce(verification.recorded_at, verification.created_at)
      + (row_number() over (
          partition by verification.application_id, mapping.metadata->>'purpose'
          order by coalesce(verification.recorded_at, verification.created_at), verification.id
        ) - 1) * interval '1 microsecond' valid_from
  from public.canonical_location_legacy_mappings mapping
  join public.application_location_verifications verification on verification.id = mapping.legacy_id
  where mapping.legacy_source = 'application_location_verifications'
), canonicalized as (
  select ordered_evidence.*,
    lead(ordered_evidence.valid_from) over (
      partition by ordered_evidence.application_id, ordered_evidence.purpose
      order by ordered_evidence.valid_from, ordered_evidence.verification_id
    ) valid_to
  from ordered_evidence
)
insert into public.entity_locations (
  entity_type, entity_id, location_id, purpose, is_current,
  valid_from, valid_to, metadata
)
select 'APPLICATION', canonicalized.application_id, canonicalized.location_id,
  canonicalized.purpose, canonicalized.valid_to is null,
  canonicalized.valid_from, canonicalized.valid_to,
  jsonb_build_object('verificationId', canonicalized.verification_id,
    'applicationVersionId', canonicalized.application_version_id,
    'migration', 'canonical_location_production_cutover')
from canonicalized
left join public.entity_locations relationship
  on relationship.entity_type = 'APPLICATION'
 and relationship.entity_id = canonicalized.application_id
 and relationship.location_id = canonicalized.location_id
where relationship.id is null
order by canonicalized.application_id, canonicalized.purpose, canonicalized.valid_from, canonicalized.verification_id
on conflict do nothing;

-- Snapshot pre-cutover orders. New orders are handled synchronously by the
-- insert trigger, so order history has the same guarantees on both sides of
-- the deployment boundary.
insert into public.order_location_snapshots (
  order_type, order_id, purpose, location_id, point, accuracy_meters,
  formatted_address, address_snapshot, capture_source, captured_at,
  quality_status, policy_snapshot
)
select 'LPG_REFILL', orders.id, role.purpose, mapping.location_id,
  extensions.st_setsrid(extensions.st_makepoint(location.longitude, location.latitude), 4326)::extensions.geography,
  location.accuracy_meters, location.formatted_address,
  jsonb_build_object(
    'landmark', location.landmark,
    'deliveryInstructions', location.delivery_instructions,
    'contactName', location.contact_name,
    'contactPhone', location.contact_phone,
    'metadata', location.metadata
  ),
  'IMPORTED', location.created_at,
  quality.decision->>'status', quality.decision
from public.lpg_refill_orders orders
cross join lateral (values
  ('PICKUP'::text, orders.pickup_location_id),
  ('DELIVERY'::text, orders.delivery_location_id)
) role(purpose, location_id)
join public.lpg_customer_locations location on location.id = role.location_id
join public.canonical_location_legacy_mappings mapping
  on mapping.legacy_source = 'lpg_customer_locations'
 and mapping.legacy_id = location.id
cross join lateral (
  select public.evaluate_location_quality('CUSTOMER_ADDRESS', location.accuracy_meters, 'lpg', 'IMPORTED') decision
) quality
on conflict (order_type, order_id, purpose) do nothing;

create or replace function public.read_location_production_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  legacy_unmapped bigint;
  evidence_unmapped bigint;
  orders_without_snapshots bigint;
  duplicate_active_policies bigint;
begin
  if not public.has_permission('platform.location_evidence.read', null)
     and not public.has_permission('platform.coverage.read', null)
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'location readiness permission required';
  end if;

  select count(*) into legacy_unmapped
  from public.lpg_customer_locations legacy
  left join public.canonical_location_legacy_mappings mapping
    on mapping.legacy_source = 'lpg_customer_locations' and mapping.legacy_id = legacy.id
  where mapping.id is null;

  select count(*) into evidence_unmapped
  from public.application_location_verifications verification
  left join public.canonical_location_legacy_mappings mapping
    on mapping.legacy_source = 'application_location_verifications' and mapping.legacy_id = verification.id
  where mapping.id is null;

  select count(*) into orders_without_snapshots
  from public.lpg_refill_orders orders
  where not exists (
    select 1 from public.order_location_snapshots snapshot
    where snapshot.order_type = 'LPG_REFILL' and snapshot.order_id = orders.id and snapshot.purpose = 'PICKUP'
  ) or not exists (
    select 1 from public.order_location_snapshots snapshot
    where snapshot.order_type = 'LPG_REFILL' and snapshot.order_id = orders.id and snapshot.purpose = 'DELIVERY'
  );

  select count(*) into duplicate_active_policies
  from (
    select policy.service_key, policy.capability_key, policy.target_geography_id,
      level.specificity_rank, policy.priority
    from public.service_coverage_policies policy
    join public.geographies geography on geography.id = policy.target_geography_id
    join public.geography_levels level on level.id = geography.geography_level_id
    where policy.status = 'active'
      and (policy.starts_at is null or policy.starts_at <= timezone('utc', now()))
      and (policy.ends_at is null or policy.ends_at > timezone('utc', now()))
    group by policy.service_key, policy.capability_key, policy.target_geography_id,
      level.specificity_rank, policy.priority
    having count(*) > 1
  ) conflicts;

  return jsonb_build_object(
    'ready', legacy_unmapped = 0 and evidence_unmapped = 0 and orders_without_snapshots = 0 and duplicate_active_policies = 0,
    'legacyLocationsUnmapped', legacy_unmapped,
    'applicationEvidenceUnmapped', evidence_unmapped,
    'ordersWithoutCompleteSnapshots', orders_without_snapshots,
    'duplicateActivePolicies', duplicate_active_policies,
    'checkedAt', timezone('utc', now())
  );
end;
$$;

revoke all on function public.read_location_production_readiness() from public, anon;
grant execute on function public.read_location_production_readiness() to authenticated, service_role;

commit;
