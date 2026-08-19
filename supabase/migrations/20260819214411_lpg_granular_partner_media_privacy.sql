begin;

-- Explicit privacy tier for all media. Public visibility is an administrative decision.
alter table public.media_assets
  add column if not exists privacy_classification text not null default 'INTERNAL_ONLY';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.media_assets'::regclass
      and conname = 'media_assets_privacy_classification_check'
  ) then
    alter table public.media_assets
      add constraint media_assets_privacy_classification_check
      check (privacy_classification in (
        'PRIVATE_KYC',
        'PRIVATE_VERIFICATION',
        'INTERNAL_ONLY',
        'PUBLIC_PROFILE_CANDIDATE',
        'PUBLIC_APPROVED'
      ));
  end if;
end $$;

create index if not exists media_assets_privacy_classification_idx
  on public.media_assets (privacy_classification, status);

-- Direct table writes are not the authority for media. Use the controlled runtime functions.
drop policy if exists media_assets_manage_owner_or_privileged on public.media_assets;
drop policy if exists media_assets_select_owner_member_or_privileged on public.media_assets;
create policy media_assets_select_owner_member_or_privileged
on public.media_assets
for select
to authenticated
using (
  privacy_classification = 'PUBLIC_APPROVED'
  or owner_user_id = auth.uid()
  or (organization_id is not null and public.is_organization_member(organization_id))
  or public.has_permission('platform.assets.manage', organization_id)
  or public.can_review_applications()
);

drop policy if exists entity_media_links_select_accessible on public.entity_media_links;
create policy entity_media_links_select_accessible
on public.entity_media_links
for select
to authenticated
using (
  exists (
    select 1
    from public.media_assets media
    where media.id = entity_media_links.media_asset_id
      and media.status = 'active'
      and (
        media.privacy_classification = 'PUBLIC_APPROVED'
        or media.owner_user_id = auth.uid()
        or (media.organization_id is not null and public.is_organization_member(media.organization_id))
        or public.has_permission('platform.assets.manage', media.organization_id)
        or public.can_review_applications()
      )
  )
);

-- Classify existing requirements without changing their legal/operational requiredness.
update public.document_requirements
set metadata = metadata || jsonb_build_object(
      'privacy_classification',
      case
        when key in ('driver.identity','driver.licence','driver.address-evidence','station.owner-identity','station.representative-identity','station.authority-evidence','station.settlement-evidence')
          then 'PRIVATE_KYC'
        when key in ('driver.profile-photo','station.photo')
          then 'PUBLIC_PROFILE_CANDIDATE'
        else 'PRIVATE_VERIFICATION'
      end
    ),
    updated_at = timezone('utc', now())
where key in (
  'driver.identity','driver.licence','driver.address-evidence','driver.profile-photo',
  'station.owner-identity','station.representative-identity','station.authority-evidence',
  'station.settlement-evidence','station.business-registration','station.business-permit',
  'station.fire-safety-certificate','station.regulatory-certificate','station.photo',
  'vehicle.registration','vehicle.insurance','vehicle.roadworthiness','vehicle.ownership-authorization','vehicle.photo'
);

-- Structured station photo requirements replace the ambiguous all-in-one station.photo requirement.
update public.document_requirements
set status = 'retired',
    metadata = metadata || jsonb_build_object('superseded_by_structured_station_photos', true),
    updated_at = timezone('utc', now())
where key = 'station.photo'
  and requirement_set_id = (
    select id from public.document_requirement_sets where key = 'documents.lpg.station.phase-one'
  );

with requirement_seed(
  set_key,
  requirement_key,
  display_name,
  description,
  is_required,
  min_count,
  max_count,
  allowed_content_types,
  privacy_classification,
  metadata
) as (
  values
    ('documents.lpg.driver.phase-one','driver.profile-photo','Driver Photograph','Upload a recent, clear photograph of yourself. Your face must be fully visible.',true,1,1,array['image/jpeg','image/png','image/webp']::text[],'PUBLIC_PROFILE_CANDIDATE','{"media_purpose":"profile_photo","driver_card":true,"public_safe_candidate":true}'::jsonb),
    ('documents.lpg.driver.phase-one','driver.identity','Means of Identification','Upload a valid government-issued identity document.',true,1,1,array['application/pdf','image/jpeg','image/png','image/webp']::text[],'PRIVATE_KYC','{"media_purpose":"identity_document"}'::jsonb),
    ('documents.lpg.driver.phase-one','driver.licence','Driver Licence','Upload a clear photo or scan of your valid driver licence.',true,1,1,array['application/pdf','image/jpeg','image/png','image/webp']::text[],'PRIVATE_KYC','{"media_purpose":"driver_licence"}'::jsonb),
    ('documents.lpg.driver.phase-one','driver.address-evidence','Proof of Residential Address','Upload current evidence of your residential address.',true,1,1,array['application/pdf','image/jpeg','image/png','image/webp']::text[],'PRIVATE_KYC','{"media_purpose":"address_proof"}'::jsonb),

    ('documents.lpg.station.phase-one','station.representative-photo','Applicant Photograph','Upload a recent clear photograph of the station applicant or authorized representative.',true,1,1,array['image/jpeg','image/png','image/webp']::text[],'PRIVATE_KYC','{"media_purpose":"representative_photo"}'::jsonb),
    ('documents.lpg.station.phase-one','station.photo.front','Front View Photo','Show the front view of the station compound.',true,1,2,array['image/jpeg','image/png','image/webp']::text[],'PUBLIC_PROFILE_CANDIDATE','{"media_purpose":"station_front","view_type":"front","public_safe_candidate":true}'::jsonb),
    ('documents.lpg.station.phase-one','station.photo.entrance','Main Entrance Photo','Show the main entrance and road access to the station.',true,1,2,array['image/jpeg','image/png','image/webp']::text[],'PUBLIC_PROFILE_CANDIDATE','{"media_purpose":"station_entrance","view_type":"entrance","public_safe_candidate":true}'::jsonb),
    ('documents.lpg.station.phase-one','station.photo.pump','Pump Area Photo','Show the LPG dispensing or refill area clearly.',true,1,2,array['image/jpeg','image/png','image/webp']::text[],'PUBLIC_PROFILE_CANDIDATE','{"media_purpose":"station_pump","view_type":"pump","public_safe_candidate":true}'::jsonb),
    ('documents.lpg.station.phase-one','station.photo.tank','Storage Tank Photo','Show the LPG storage tank and relevant gas infrastructure for verification.',true,1,2,array['image/jpeg','image/png','image/webp']::text[],'INTERNAL_ONLY','{"media_purpose":"station_tank","view_type":"tank","public_safe_candidate":false}'::jsonb),
    ('documents.lpg.station.phase-one','station.photo.compound','Compound Wide View','Show the station yard and safety perimeter in one wide view.',true,1,2,array['image/jpeg','image/png','image/webp']::text[],'PUBLIC_PROFILE_CANDIDATE','{"media_purpose":"station_compound","view_type":"compound","public_safe_candidate":true}'::jsonb),
    ('documents.lpg.station.phase-one','station.photo.signboard','Station Signboard Photo','Show the official station signboard and station name clearly.',true,1,2,array['image/jpeg','image/png','image/webp']::text[],'PUBLIC_PROFILE_CANDIDATE','{"media_purpose":"station_signboard","view_type":"signboard","public_safe_candidate":true}'::jsonb),
    ('documents.lpg.station.phase-one','station.photo.drone','Elevated or Drone Photo','Optional elevated view of the overall facility.',false,0,2,array['image/jpeg','image/png','image/webp']::text[],'PUBLIC_PROFILE_CANDIDATE','{"media_purpose":"station_drone","view_type":"drone","public_safe_candidate":true}'::jsonb),

    ('documents.lpg.vehicle.phase-one','vehicle.registration','Vehicle Registration Document','Upload proof of official motor vehicle registration.',true,1,1,array['application/pdf','image/jpeg','image/png','image/webp']::text[],'PRIVATE_VERIFICATION','{"media_purpose":"vehicle_registration"}'::jsonb),
    ('documents.lpg.vehicle.phase-one','vehicle.insurance','Vehicle Insurance Policy','Upload a valid motor vehicle insurance certificate.',true,1,1,array['application/pdf','image/jpeg','image/png','image/webp']::text[],'PRIVATE_VERIFICATION','{"media_purpose":"vehicle_insurance"}'::jsonb),
    ('documents.lpg.vehicle.phase-one','vehicle.roadworthiness','Roadworthiness Certificate','Upload current vehicle roadworthiness or inspection evidence.',true,1,1,array['application/pdf','image/jpeg','image/png','image/webp']::text[],'PRIVATE_VERIFICATION','{"media_purpose":"roadworthiness"}'::jsonb),
    ('documents.lpg.vehicle.phase-one','vehicle.ownership-authorization','Vehicle Ownership or Authorization','Upload ownership, lease, rental, fleet assignment, or third-party authorization evidence.',true,1,2,array['application/pdf','image/jpeg','image/png','image/webp']::text[],'PRIVATE_VERIFICATION','{"media_purpose":"vehicle_ownership_authorization"}'::jsonb),
    ('documents.lpg.vehicle.phase-one','vehicle.photo','Vehicle Photo','Upload a clear photograph showing the vehicle and registration plate.',true,1,2,array['image/jpeg','image/png','image/webp']::text[],'PRIVATE_VERIFICATION','{"media_purpose":"vehicle_photo"}'::jsonb)
)
insert into public.document_requirements (
  requirement_set_id,key,display_name,description,is_required,review_required,
  min_count,max_count,allowed_content_types,max_byte_size,status,metadata
)
select
  requirement_set.id,
  seed.requirement_key,
  seed.display_name,
  seed.description,
  seed.is_required,
  true,
  seed.min_count,
  seed.max_count,
  seed.allowed_content_types,
  20971520,
  'active',
  seed.metadata || jsonb_build_object(
    'privacy_classification', seed.privacy_classification,
    'bounded_context','lpg'
  )
from requirement_seed seed
join public.document_requirement_sets requirement_set on requirement_set.key = seed.set_key
on conflict (requirement_set_id,key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    is_required = excluded.is_required,
    review_required = excluded.review_required,
    min_count = excluded.min_count,
    max_count = excluded.max_count,
    allowed_content_types = excluded.allowed_content_types,
    max_byte_size = excluded.max_byte_size,
    status = excluded.status,
    metadata = public.document_requirements.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

-- Station public profile images are curated individually, never auto-published from approval.
update public.application_type_definitions
set activation_policy = jsonb_set(
      activation_policy,
      '{media_projections}',
      '[]'::jsonb,
      true
    ) || jsonb_build_object('public_media_requires_admin_approval', true),
    updated_at = timezone('utc', now())
where key = 'application.lpg.station.phase-one';

-- Support the mobile upload flow where a controlled media asset was registered before
-- its document submission. The runtime resolves the real storage location from that asset.
create or replace function public.register_document_submission(
  target_application_id uuid,
  target_requirement_key text,
  target_storage_bucket text,
  target_storage_path text,
  target_content_type text,
  target_byte_size bigint,
  target_checksum text,
  target_source text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record record;
  application_type_record record;
  requirement_record record;
  existing_media_record record;
  media_asset_id uuid;
  document_submission_id uuid;
  existing_record record;
  expected_owner_prefix text;
  supplied_media_asset_id uuid;
  resolved_storage_bucket text;
  resolved_storage_path text;
  resolved_content_type text;
  resolved_byte_size bigint;
  resolved_checksum text;
  resolved_privacy_classification text;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  if target_requirement_key is null or target_requirement_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_requirement_key must be a valid platform key';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select existing.*
  into existing_record
  from public.document_submissions existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    return existing_record.id;
  end if;

  select app.*
  into application_record
  from public.application_records app
  where app.id = target_application_id;

  if not found then
    raise exception 'target_application_id must reference an existing application';
  end if;

  if auth.role() <> 'service_role'
     and application_record.applicant_user_id <> auth.uid()
     and not public.can_review_applications()
     and not public.can_manage_applications() then
    raise exception 'only the applicant or reviewer can register application documents';
  end if;

  if application_record.status not in ('draft','incomplete','additional_info_required','resubmitted') then
    raise exception 'documents cannot be added in the current application state';
  end if;

  select app_type.*
  into application_type_record
  from public.application_type_definitions app_type
  where app_type.id = application_record.application_type_id;

  select requirement.*
  into requirement_record
  from public.document_requirements requirement
  where requirement.requirement_set_id = application_type_record.document_requirement_set_id
    and requirement.key = target_requirement_key
    and requirement.status = 'active';

  if not found then
    raise exception 'target_requirement_key must be active for this application type';
  end if;

  resolved_privacy_classification := coalesce(
    nullif(requirement_record.metadata ->> 'privacy_classification',''),
    nullif(requirement_record.metadata ->> 'privacy_tier',''),
    nullif(requirement_record.metadata ->> 'classification',''),
    'PRIVATE_VERIFICATION'
  );

  if resolved_privacy_classification not in (
    'PRIVATE_KYC','PRIVATE_VERIFICATION','INTERNAL_ONLY','PUBLIC_PROFILE_CANDIDATE','PUBLIC_APPROVED'
  ) then
    raise exception 'document requirement privacy classification is invalid';
  end if;

  supplied_media_asset_id := case
    when coalesce(target_metadata ->> 'mediaAssetId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (target_metadata ->> 'mediaAssetId')::uuid
    when coalesce(target_metadata ->> 'media_asset_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (target_metadata ->> 'media_asset_id')::uuid
    else null
  end;

  if supplied_media_asset_id is not null then
    select media.*
    into existing_media_record
    from public.media_assets media
    where media.id = supplied_media_asset_id
      and media.status = 'active'
      and media.owner_user_id = application_record.applicant_user_id;

    if not found then
      raise exception 'supplied media asset must be active and owned by the applicant';
    end if;

    media_asset_id := existing_media_record.id;
    resolved_storage_bucket := existing_media_record.storage_bucket;
    resolved_storage_path := existing_media_record.storage_path;
    resolved_content_type := existing_media_record.content_type;
    resolved_byte_size := existing_media_record.byte_size;
    resolved_checksum := existing_media_record.checksum;

    update public.media_assets
    set organization_id = coalesce(organization_id, application_record.organization_id),
        privacy_classification = resolved_privacy_classification,
        metadata = metadata || jsonb_build_object(
          'application_id', target_application_id,
          'requirement_key', target_requirement_key,
          'privacy_classification_source', 'document_requirement'
        ),
        updated_at = timezone('utc', now())
    where id = media_asset_id;
  else
    if target_storage_bucket not in ('skima-platform-documents','skima-platform-media') then
      raise exception 'target_storage_bucket must reference an approved platform storage bucket';
    end if;

    if target_storage_path is null or btrim(target_storage_path) = '' or target_storage_path like '%..%' then
      raise exception 'target_storage_path is required and must be normalized';
    end if;

    expected_owner_prefix := application_record.applicant_user_id::text || '/';
    if left(target_storage_path, length(expected_owner_prefix)) <> expected_owner_prefix
       and not public.can_review_applications()
       and auth.role() <> 'service_role' then
      raise exception 'target_storage_path must be scoped to the applicant user id';
    end if;

    resolved_storage_bucket := target_storage_bucket;
    resolved_storage_path := target_storage_path;
    resolved_content_type := target_content_type;
    resolved_byte_size := target_byte_size;
    resolved_checksum := target_checksum;

    insert into public.media_assets (
      organization_id,owner_user_id,storage_bucket,storage_path,content_type,byte_size,checksum,
      status,privacy_classification,asset_type_key,metadata,source,idempotency_key,created_by
    )
    values (
      application_record.organization_id,application_record.applicant_user_id,
      resolved_storage_bucket,resolved_storage_path,resolved_content_type,resolved_byte_size,resolved_checksum,
      'active',resolved_privacy_classification,'media.application-document',
      target_metadata || jsonb_build_object('application_id',target_application_id,'requirement_key',target_requirement_key),
      target_source,target_idempotency_key || ':asset',auth.uid()
    )
    on conflict (storage_bucket,storage_path) do update
    set content_type = excluded.content_type,
        byte_size = excluded.byte_size,
        checksum = excluded.checksum,
        status = 'active',
        privacy_classification = excluded.privacy_classification,
        metadata = public.media_assets.metadata || excluded.metadata,
        updated_at = timezone('utc', now())
    returning id into media_asset_id;
  end if;

  if resolved_content_type is not null
     and cardinality(requirement_record.allowed_content_types) > 0
     and resolved_content_type <> all(requirement_record.allowed_content_types) then
    raise exception 'media content type is not allowed for this document requirement';
  end if;

  if requirement_record.max_byte_size is not null
     and resolved_byte_size is not null
     and resolved_byte_size > requirement_record.max_byte_size then
    raise exception 'media size exceeds the configured document requirement limit';
  end if;

  insert into public.document_submissions (
    requirement_id,application_id,subject_type,subject_id,owner_user_id,organization_id,
    media_asset_id,status,storage_bucket,storage_path,content_type,byte_size,checksum,expires_at,
    source,idempotency_key,metadata,created_by
  )
  values (
    requirement_record.id,target_application_id,'application',target_application_id,
    application_record.applicant_user_id,application_record.organization_id,media_asset_id,'uploaded',
    resolved_storage_bucket,resolved_storage_path,resolved_content_type,resolved_byte_size,resolved_checksum,
    case when requirement_record.expires_after_days is null then null
         else timezone('utc', now()) + make_interval(days => requirement_record.expires_after_days) end,
    target_source,target_idempotency_key,
    target_metadata || jsonb_build_object('privacy_classification',resolved_privacy_classification),auth.uid()
  )
  returning id into document_submission_id;

  insert into public.application_events (
    application_id,event_type_key,from_status,to_status,actor_user_id,idempotency_key,metadata
  )
  values (
    target_application_id,'event.application.document.registered',application_record.status,
    application_record.status,auth.uid(),target_idempotency_key || ':document',
    target_metadata || jsonb_build_object('document_submission_id',document_submission_id,'requirement_key',target_requirement_key)
  )
  on conflict do nothing;

  return document_submission_id;
end;
$$;

-- Replacement requests use the real reviewer_user_id column and the configured application workflow.
create or replace function public.request_document_requirement_replacement(
  target_document_submission_id uuid,
  target_reason text,
  target_idempotency_key text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  submission_record record;
  application_record record;
  requirement_record record;
  resolved_idempotency_key text;
begin
  if auth.role() <> 'service_role' and not public.can_review_applications() then
    raise exception 'application review permission required to request document correction';
  end if;

  if target_document_submission_id is null then
    raise exception 'target_document_submission_id is required';
  end if;

  if target_reason is null or btrim(target_reason) = '' then
    raise exception 'target_reason is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select submission.*
  into submission_record
  from public.document_submissions submission
  where submission.id = target_document_submission_id
  for update;

  if not found then
    raise exception 'document submission not found';
  end if;

  select app.* into application_record
  from public.application_records app
  where app.id = submission_record.application_id;

  select requirement.* into requirement_record
  from public.document_requirements requirement
  where requirement.id = submission_record.requirement_id;

  resolved_idempotency_key := btrim(target_idempotency_key);

  update public.document_submissions
  set status = 'rejected',
      replacement_requested = true,
      replacement_reason = btrim(target_reason),
      reviewed_at = timezone('utc', now()),
      reviewer_user_id = auth.uid(),
      decision_reason = btrim(target_reason),
      metadata = metadata || jsonb_build_object(
        'replacement_reason', btrim(target_reason),
        'replacement_requested_at', timezone('utc', now())
      ),
      updated_at = timezone('utc', now())
  where id = target_document_submission_id;

  if application_record.status = 'under_review' then
    perform public.request_application_correction(
      submission_record.application_id,
      'Replacement requested for ' || coalesce(requirement_record.display_name, requirement_record.key),
      btrim(target_reason),
      resolved_idempotency_key || ':application',
      jsonb_build_object(
        'document_submission_id', target_document_submission_id,
        'requirement_key', requirement_record.key
      )
    );
  end if;

  return target_document_submission_id;
end;
$$;

-- Only reviewed, candidate station application media may be exposed publicly.
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
  submission_record record;
  source_application_id uuid;
  link_id uuid;
begin
  if auth.role() <> 'service_role'
     and not public.can_review_applications()
     and not public.can_manage_lpg_operations() then
    raise exception 'admin permission required to approve public station media';
  end if;

  if target_display_order < 0 then
    raise exception 'target_display_order must be zero or greater';
  end if;

  select station.* into station_record
  from public.lpg_station_branches station
  where station.id = target_station_branch_id;

  if not found then
    raise exception 'station branch not found';
  end if;

  source_application_id := case
    when coalesce(station_record.metadata ->> 'source_application_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (station_record.metadata ->> 'source_application_id')::uuid
    when coalesce(station_record.metadata ->> 'activated_from_application_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (station_record.metadata ->> 'activated_from_application_id')::uuid
    else null
  end;

  if source_application_id is null then
    raise exception 'station has no source application for public media review';
  end if;

  select media.* into media_record
  from public.media_assets media
  where media.id = target_media_asset_id
    and media.status = 'active';

  if not found then
    raise exception 'media asset not found';
  end if;

  select submission.*, requirement.key as requirement_key,
         requirement.metadata as requirement_metadata
  into submission_record
  from public.document_submissions submission
  join public.document_requirements requirement on requirement.id = submission.requirement_id
  where submission.application_id = source_application_id
    and submission.media_asset_id = target_media_asset_id
    and submission.status = 'approved'
  order by submission.reviewed_at desc nulls last, submission.created_at desc
  limit 1;

  if not found then
    raise exception 'media must be an approved document submission from this station application';
  end if;

  if coalesce(submission_record.requirement_metadata ->> 'privacy_classification','PRIVATE_VERIFICATION') <> 'PUBLIC_PROFILE_CANDIDATE' then
    raise exception 'only public-profile candidate media can be approved for public display';
  end if;

  if media_record.privacy_classification in ('PRIVATE_KYC','PRIVATE_VERIFICATION','INTERNAL_ONLY') then
    raise exception 'private or internal media cannot be approved for public display';
  end if;

  if target_is_primary then
    update public.entity_media_links
    set is_primary = false,
        updated_at = timezone('utc', now())
    where entity_type = 'station'
      and entity_id = target_station_branch_id
      and media_role = 'station.photo.public'
      and status = 'active'
      and is_primary;
  end if;

  update public.media_assets
  set privacy_classification = 'PUBLIC_APPROVED',
      organization_id = coalesce(organization_id, station_record.organization_id),
      metadata = metadata || jsonb_build_object(
        'public_approved_at', timezone('utc', now()),
        'public_approved_by', auth.uid(),
        'public_station_branch_id', target_station_branch_id,
        'source_application_id', source_application_id
      ),
      updated_at = timezone('utc', now())
  where id = target_media_asset_id;

  insert into public.entity_media_links (
    organization_id,entity_type,entity_id,media_asset_id,media_role,is_primary,display_order,
    status,metadata,source,idempotency_key,created_by
  )
  values (
    station_record.organization_id,'station',target_station_branch_id,target_media_asset_id,
    'station.photo.public',target_is_primary,target_display_order,'active',
    jsonb_build_object(
      'application_id',source_application_id,
      'requirement_key',submission_record.requirement_key,
      'public_approved',true
    ),
    'platform.admin_curation',
    'public-station-media:' || target_station_branch_id::text || ':' || target_media_asset_id::text,
    auth.uid()
  )
  on conflict (entity_type,entity_id,media_asset_id,media_role) do update
  set is_primary = excluded.is_primary,
      display_order = excluded.display_order,
      status = 'active',
      metadata = public.entity_media_links.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into link_id;

  return link_id;
end;
$$;

revoke all on function public.admin_approve_public_station_media(uuid,uuid,boolean,integer) from public,anon;
grant execute on function public.admin_approve_public_station_media(uuid,uuid,boolean,integer) to authenticated,service_role;

-- Explicit driver activation is also the approval point for the public-safe Driver Pass photograph.
create or replace function public.publish_driver_profile_photo_on_activation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  application_category_value text;
  photo_asset_id uuid;
begin
  if new.operational_status = 'active'
     and old.operational_status is distinct from new.operational_status then
    select app_type.application_category
    into application_category_value
    from public.application_type_definitions app_type
    where app_type.id = new.application_type_id;

    if application_category_value = 'driver' then
      select submission.media_asset_id
      into photo_asset_id
      from public.document_submissions submission
      join public.document_requirements requirement on requirement.id = submission.requirement_id
      where submission.application_id = new.id
        and requirement.key = 'driver.profile-photo'
        and submission.status = 'approved'
      order by submission.reviewed_at desc nulls last, submission.created_at desc
      limit 1;

      if photo_asset_id is not null then
        update public.media_assets
        set privacy_classification = 'PUBLIC_APPROVED',
            metadata = metadata || jsonb_build_object(
              'public_approved_at', timezone('utc', now()),
              'public_approved_by', new.activated_by,
              'driver_pass_public_photo', true,
              'source_application_id', new.id
            ),
            updated_at = timezone('utc', now())
        where id = photo_asset_id
          and privacy_classification = 'PUBLIC_PROFILE_CANDIDATE';
      end if;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists application_records_publish_driver_photo on public.application_records;
create trigger application_records_publish_driver_photo
after update of operational_status on public.application_records
for each row
execute function public.publish_driver_profile_photo_on_activation();

revoke all on function public.publish_driver_profile_photo_on_activation() from public,anon,authenticated;

-- Backfill classification from already-registered document requirements.
update public.media_assets media
set privacy_classification = coalesce(
      nullif(requirement.metadata ->> 'privacy_classification',''),
      nullif(requirement.metadata ->> 'privacy_tier',''),
      nullif(requirement.metadata ->> 'classification',''),
      media.privacy_classification
    ),
    metadata = media.metadata || jsonb_build_object(
      'privacy_classification_source','document_requirement'
    ),
    updated_at = timezone('utc', now())
from public.document_submissions submission
join public.document_requirements requirement on requirement.id = submission.requirement_id
where submission.media_asset_id = media.id
  and coalesce(
        nullif(requirement.metadata ->> 'privacy_classification',''),
        nullif(requirement.metadata ->> 'privacy_tier',''),
        nullif(requirement.metadata ->> 'classification','')
      ) is not null;

-- Existing active Driver Pass photos become public-approved only when their source driver is already active.
update public.media_assets media
set privacy_classification = 'PUBLIC_APPROVED',
    metadata = media.metadata || jsonb_build_object('driver_pass_public_photo',true),
    updated_at = timezone('utc', now())
from public.document_submissions submission
join public.document_requirements requirement on requirement.id = submission.requirement_id
join public.application_records application on application.id = submission.application_id
where submission.media_asset_id = media.id
  and requirement.key = 'driver.profile-photo'
  and submission.status = 'approved'
  and application.operational_status = 'active'
  and media.privacy_classification = 'PUBLIC_PROFILE_CANDIDATE';

commit;
