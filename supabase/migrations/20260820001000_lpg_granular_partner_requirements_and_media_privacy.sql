begin;

-- ============================================================================
-- 1. MEDIA ASSETS PRIVACY CLASSIFICATION
-- ============================================================================

alter table public.media_assets
add column if not exists privacy_classification text default 'INTERNAL_ONLY'
  check (privacy_classification in (
    'PRIVATE_KYC',
    'PRIVATE_VERIFICATION',
    'INTERNAL_ONLY',
    'PUBLIC_PROFILE_CANDIDATE',
    'PUBLIC_APPROVED'
  ));

create index if not exists media_assets_privacy_classification_idx
on public.media_assets (privacy_classification, status);

-- ============================================================================
-- 2. GRANULAR REQUIREMENTS SEEDING FOR DRIVER & STATION
-- ============================================================================

-- Ensure requirement sets exist
insert into public.document_requirement_sets (
  key,
  display_name,
  subject_category,
  status,
  metadata
)
values
  ('documents.lpg.station.phase-one', 'LPG Station Approval Documents', 'business', 'active', '{"bounded_context":"lpg"}'::jsonb),
  ('documents.lpg.driver.phase-one', 'LPG Driver Approval Documents', 'driver', 'active', '{"bounded_context":"lpg"}'::jsonb),
  ('documents.lpg.vehicle.phase-one', 'LPG Vehicle Approval Documents', 'vehicle', 'active', '{"bounded_context":"lpg"}'::jsonb)
on conflict (key) do update
set display_name = excluded.display_name,
    subject_category = excluded.subject_category,
    status = excluded.status,
    metadata = excluded.metadata,
    updated_at = timezone('utc', now());

with requirement_seed(
  set_key,
  requirement_key,
  display_name,
  description,
  is_required,
  min_count,
  max_count,
  allowed_content_types,
  privacy_tier,
  metadata
) as (
  values
    -- Driver Requirements
    ('documents.lpg.driver.phase-one', 'driver.profile-photo', 'Driver Photograph', 'Upload a recent, clear photograph of yourself. Your face must be fully visible.', true, 1, 1, array['image/jpeg', 'image/png', 'image/webp']::text[], 'PUBLIC_PROFILE_CANDIDATE', '{"media_purpose":"profile_photo","classification":"PUBLIC_PROFILE_CANDIDATE"}'::jsonb),
    ('documents.lpg.driver.phase-one', 'driver.identity', 'Means of Identification', 'Upload a valid government-issued ID (National ID, Passport, Voter Card).', true, 1, 1, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], 'PRIVATE_KYC', '{"media_purpose":"identity_document","classification":"PRIVATE_KYC"}'::jsonb),
    ('documents.lpg.driver.phase-one', 'driver.licence', 'Driver Licence', 'Upload a clear photo or scan of your valid driver licence.', true, 1, 1, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], 'PRIVATE_KYC', '{"media_purpose":"driver_licence","classification":"PRIVATE_KYC"}'::jsonb),
    ('documents.lpg.driver.phase-one', 'driver.address-evidence', 'Proof of Residential Address', 'Upload a recent utility bill or bank statement showing your residential address.', true, 1, 1, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], 'PRIVATE_KYC', '{"media_purpose":"address_proof","classification":"PRIVATE_KYC"}'::jsonb),

    -- Station Representative & Business Requirements
    ('documents.lpg.station.phase-one', 'station.representative-photo', 'Applicant Photograph', 'Upload a clear recent photograph showing your face as the station representative.', true, 1, 1, array['image/jpeg', 'image/png', 'image/webp']::text[], 'PRIVATE_KYC', '{"media_purpose":"representative_photo","classification":"PRIVATE_KYC"}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.owner-identity', 'Applicant Identity Document', 'Upload a valid government-issued ID for the station applicant/representative.', true, 1, 1, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], 'PRIVATE_KYC', '{"media_purpose":"identity_document","classification":"PRIVATE_KYC"}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.business-registration', 'Business Registration (CAC)', 'Upload the official Corporate Affairs Commission registration certificate.', true, 1, 1, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], 'PRIVATE_VERIFICATION', '{"media_purpose":"business_registration","classification":"PRIVATE_VERIFICATION"}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.business-permit', 'Station Operating Permit', 'Upload the valid statutory LPG station operating licence or permit.', true, 1, 1, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], 'PRIVATE_VERIFICATION', '{"media_purpose":"business_permit","classification":"PRIVATE_VERIFICATION"}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.fire-safety-certificate', 'Fire Safety Certificate', 'Upload a valid Fire Service safety compliance certificate.', true, 1, 1, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], 'PRIVATE_VERIFICATION', '{"media_purpose":"fire_safety","classification":"PRIVATE_VERIFICATION"}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.settlement-evidence', 'Bank Settlement Account Evidence', 'Upload a bank statement header or cancelled cheque showing company account details.', true, 1, 1, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], 'PRIVATE_KYC', '{"media_purpose":"settlement_evidence","classification":"PRIVATE_KYC"}'::jsonb),

    -- Station Premises Structured Photos (6 views)
    ('documents.lpg.station.phase-one', 'station.photo.front', 'Front View Photo', 'A clear photo showing the front view of the station compound.', true, 1, 2, array['image/jpeg', 'image/png', 'image/webp']::text[], 'PUBLIC_PROFILE_CANDIDATE', '{"media_purpose":"station_front","view_type":"front","classification":"PUBLIC_PROFILE_CANDIDATE"}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.photo.entrance', 'Main Entrance Photo', 'A clear photo showing the main entrance and road access to the station.', true, 1, 2, array['image/jpeg', 'image/png', 'image/webp']::text[], 'PUBLIC_PROFILE_CANDIDATE', '{"media_purpose":"station_entrance","view_type":"entrance","classification":"PUBLIC_PROFILE_CANDIDATE"}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.photo.pump', 'Pump Area Photo', 'A clear photo of the LPG refill dispensing and pump area.', true, 1, 2, array['image/jpeg', 'image/png', 'image/webp']::text[], 'PUBLIC_PROFILE_CANDIDATE', '{"media_purpose":"station_pump","view_type":"pump","classification":"PUBLIC_PROFILE_CANDIDATE"}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.photo.tank', 'Storage Tank Photo', 'A clear photo showing the LPG storage tanks and gas infrastructure.', true, 1, 2, array['image/jpeg', 'image/png', 'image/webp']::text[], 'INTERNAL_ONLY', '{"media_purpose":"station_tank","view_type":"tank","classification":"INTERNAL_ONLY"}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.photo.compound', 'Compound Wide-Angle View', 'A wide-angle photo showing the complete station yard and safety perimeter.', true, 1, 2, array['image/jpeg', 'image/png', 'image/webp']::text[], 'PUBLIC_PROFILE_CANDIDATE', '{"media_purpose":"station_compound","view_type":"compound","classification":"PUBLIC_PROFILE_CANDIDATE"}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.photo.signboard', 'Station Signboard Photo', 'A clear photo of the official signboard displaying the station name.', true, 1, 2, array['image/jpeg', 'image/png', 'image/webp']::text[], 'PUBLIC_PROFILE_CANDIDATE', '{"media_purpose":"station_signboard","view_type":"signboard","classification":"PUBLIC_PROFILE_CANDIDATE"}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.photo.drone', 'Elevated / Drone Photo (Optional)', 'An optional aerial or elevated photo showing the overall facility.', false, 0, 2, array['image/jpeg', 'image/png', 'image/webp']::text[], 'PUBLIC_PROFILE_CANDIDATE', '{"media_purpose":"station_drone","view_type":"drone","classification":"PUBLIC_PROFILE_CANDIDATE"}'::jsonb),

    -- Vehicle Requirements
    ('documents.lpg.vehicle.phase-one', 'vehicle.registration', 'Vehicle Registration Document', 'Upload proof of official motor vehicle registration.', true, 1, 1, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], 'PRIVATE_VERIFICATION', '{"media_purpose":"vehicle_registration","classification":"PRIVATE_VERIFICATION"}'::jsonb),
    ('documents.lpg.vehicle.phase-one', 'vehicle.insurance', 'Vehicle Insurance Policy', 'Upload valid commercial motor vehicle insurance certificate.', true, 1, 1, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], 'PRIVATE_VERIFICATION', '{"media_purpose":"vehicle_insurance","classification":"PRIVATE_VERIFICATION"}'::jsonb),
    ('documents.lpg.vehicle.phase-one', 'vehicle.roadworthiness', 'Roadworthiness Certificate', 'Upload vehicle roadworthiness or inspection certificate.', true, 1, 1, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], 'PRIVATE_VERIFICATION', '{"media_purpose":"roadworthiness","classification":"PRIVATE_VERIFICATION"}'::jsonb),
    ('documents.lpg.vehicle.phase-one', 'vehicle.photo', 'Vehicle Photo', 'Upload a clear photograph showing the vehicle and licence plate.', true, 1, 1, array['image/jpeg', 'image/png', 'image/webp']::text[], 'PUBLIC_PROFILE_CANDIDATE', '{"media_purpose":"vehicle_photo","classification":"PUBLIC_PROFILE_CANDIDATE"}'::jsonb)
)
insert into public.document_requirements (
  requirement_set_id,
  key,
  display_name,
  is_required,
  review_required,
  min_count,
  max_count,
  allowed_content_types,
  max_byte_size,
  status,
  metadata
)
select
  requirement_set.id,
  requirement_seed.requirement_key,
  requirement_seed.display_name,
  requirement_seed.is_required,
  true,
  requirement_seed.min_count,
  requirement_seed.max_count,
  requirement_seed.allowed_content_types,
  52428800,
  'active',
  requirement_seed.metadata || jsonb_build_object(
    'description', requirement_seed.description,
    'privacy_tier', requirement_seed.privacy_tier,
    'bounded_context', 'lpg'
  )
from requirement_seed
join public.document_requirement_sets requirement_set on requirement_set.key = requirement_seed.set_key
on conflict (requirement_set_id, key) do update
set display_name = excluded.display_name,
  is_required = excluded.is_required,
  review_required = excluded.review_required,
  min_count = excluded.min_count,
  max_count = excluded.max_count,
  allowed_content_types = excluded.allowed_content_types,
  max_byte_size = excluded.max_byte_size,
  status = excluded.status,
  metadata = excluded.metadata,
  updated_at = timezone('utc', now());

-- ============================================================================
-- 3. ADMIN PUBLIC PHOTO CURATION RPC
-- ============================================================================

create or replace function public.admin_approve_public_station_media(
  target_media_asset_id uuid,
  target_station_branch_id uuid,
  target_is_primary boolean default false,
  target_display_order integer default 0
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  media_record record;
  station_record record;
  link_id uuid;
begin
  if auth.role() <> 'service_role' and not public.can_review_applications() and not public.can_manage_lpg_operations() then
    raise exception 'admin permission required to approve public media';
  end if;

  select *
  into media_record
  from public.media_assets
  where id = target_media_asset_id;

  if not found then
    raise exception 'media asset not found';
  end if;

  -- Ensure we do not accidentally make private KYC documents public
  if media_record.privacy_classification in ('PRIVATE_KYC', 'PRIVATE_VERIFICATION') then
    raise exception 'private KYC/verification documents cannot be approved for public profile';
  end if;

  select *
  into station_record
  from public.lpg_station_branches
  where id = target_station_branch_id;

  if not found then
    raise exception 'station branch not found';
  end if;

  -- Update media privacy classification to PUBLIC_APPROVED
  update public.media_assets
  set privacy_classification = 'PUBLIC_APPROVED',
      updated_at = timezone('utc', now())
  where id = target_media_asset_id;

  -- Link into entity_media_links for public discovery
  insert into public.entity_media_links (
    organization_id,
    entity_type,
    entity_id,
    media_asset_id,
    media_role,
    is_primary,
    display_order,
    status,
    source,
    idempotency_key,
    created_by
  )
  values (
    station_record.organization_id,
    'station',
    target_station_branch_id,
    target_media_asset_id,
    'station.photo.public',
    target_is_primary,
    target_display_order,
    'active',
    'platform.admin_curation',
    'pub-media:' || target_station_branch_id::text || ':' || target_media_asset_id::text,
    auth.uid()
  )
  on conflict (entity_type, entity_id, media_asset_id, media_role) do update
  set is_primary = excluded.is_primary,
      display_order = excluded.display_order,
      status = 'active',
      updated_at = timezone('utc', now())
  returning id into link_id;

  return link_id;
end;
$$;

revoke all on function public.admin_approve_public_station_media(uuid, uuid, boolean, integer) from public, anon;
grant execute on function public.admin_approve_public_station_media(uuid, uuid, boolean, integer) to authenticated, service_role;

commit;
