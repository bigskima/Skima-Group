begin;

-- ============================================================================
-- 1. SEPARATE CORE STATE ENGINE:
--    Document Verification != Application Approval != Partner Activation
-- ============================================================================

-- Ensure application_records has operational_status, activated_at, activated_by
alter table public.application_records
add column if not exists operational_status text default 'pending'
  check (operational_status in ('pending', 'active', 'inactive', 'suspended', 'deactivated'));

alter table public.application_records
add column if not exists activated_at timestamptz;

alter table public.application_records
add column if not exists activated_by uuid references public.profiles(id) on delete set null;

-- Add requirement replacement / correction metadata on document_submissions
alter table public.document_submissions
add column if not exists replacement_requested boolean not null default false;

alter table public.document_submissions
add column if not exists replacement_reason text;

-- ============================================================================
-- 2. FIX STATION ACTIVATION BUG IN BACKEND RUNTIME
-- ============================================================================

create or replace function public.admin_activate_station(
  target_application_id uuid,
  target_service_radius_meters integer default 8000,
  target_idempotency_key text default null,
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
  version_record record;
  station_payload jsonb := '{}'::jsonb;
  org_id uuid;
  branch_id uuid;
  station_branch_id uuid;
  resolved_owner_user_id uuid;
  resolved_branch_key text;
  resolved_display_name text;
  resolved_address text;
  resolved_latitude numeric;
  resolved_longitude numeric;
  resolved_capacity numeric;
  resolved_sizes numeric[];
  resolved_hours jsonb;
  resolved_idempotency_key text;
  preset_record record;
begin
  if auth.role() <> 'service_role' and not public.can_review_applications() and not public.can_manage_lpg_operations() then
    raise exception 'admin permission required to activate LPG station';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  select *
  into application_record
  from public.application_records
  where id = target_application_id
  for update;

  if not found then
    raise exception 'application not found';
  end if;

  if application_record.status <> 'approved' then
    raise exception 'only approved applications can be operationally activated';
  end if;

  select *
  into application_type_record
  from public.application_type_definitions
  where id = application_record.application_type_id;

  if application_type_record.application_category <> 'business' then
    raise exception 'station activation requires a business application';
  end if;

  select *
  into version_record
  from public.application_versions
  where application_id = target_application_id
    and version = application_record.active_version;

  station_payload := coalesce(
    version_record.payload -> 'lpgStation',
    version_record.payload -> 'lpg_station',
    version_record.payload -> 'station',
    version_record.payload -> 'business',
    '{}'::jsonb
  );

  org_id := application_record.organization_id;
  if org_id is null then
    perform public.activate_approved_application(target_application_id);
    select organization_id into org_id from public.application_records where id = target_application_id;
  end if;

  if org_id is null then
    raise exception 'organization record could not be resolved for station activation';
  end if;

  resolved_owner_user_id := application_record.applicant_user_id;

  resolved_display_name := coalesce(
    nullif(station_payload ->> 'displayName', ''),
    nullif(station_payload ->> 'display_name', ''),
    nullif(version_record.payload -> 'organization' ->> 'displayName', ''),
    nullif(version_record.payload -> 'organization' ->> 'display_name', ''),
    nullif(application_record.metadata ->> 'display_name', ''),
    'SKIMA Station'
  );

  resolved_address := coalesce(
    nullif(station_payload ->> 'formattedAddress', ''),
    nullif(station_payload ->> 'formatted_address', ''),
    nullif(station_payload ->> 'address', ''),
    nullif(version_record.payload -> 'location' ->> 'formattedAddress', ''),
    'Station Address'
  );

  resolved_latitude := coalesce(
    nullif(station_payload ->> 'latitude', '')::numeric,
    nullif(version_record.payload -> 'location' ->> 'latitude', '')::numeric,
    6.5244
  );

  resolved_longitude := coalesce(
    nullif(station_payload ->> 'longitude', '')::numeric,
    nullif(version_record.payload -> 'location' ->> 'longitude', '')::numeric,
    3.3792
  );

  resolved_capacity := coalesce(
    nullif(station_payload ->> 'refillCapacityKg', '')::numeric,
    nullif(station_payload ->> 'refill_capacity_kg', '')::numeric,
    5000
  );

  resolved_hours := coalesce(
    station_payload -> 'operatingHours',
    station_payload -> 'operating_hours',
    '{"opensAt":"08:00","closesAt":"18:00"}'::jsonb
  );

  resolved_branch_key := coalesce(
    nullif(version_record.payload -> 'organization' ->> 'slug', ''),
    nullif(station_payload ->> 'branchKey', ''),
    nullif(station_payload ->> 'branch_key', ''),
    'station.' || substr(replace(target_application_id::text, '-', ''), 1, 16)
  );

  resolved_idempotency_key := coalesce(target_idempotency_key, 'admin-activate-station:' || target_application_id::text);

  -- Create or retrieve organization branch
  select id into branch_id
  from public.organization_branches
  where organization_id = org_id
    and branch_key = resolved_branch_key
  limit 1;

  if branch_id is null then
    branch_id := public.create_organization_branch(
      org_id,
      resolved_branch_key,
      resolved_display_name,
      jsonb_build_object('formatted_address', resolved_address),
      jsonb_build_object('latitude', resolved_latitude, 'longitude', resolved_longitude),
      'active',
      'platform.admin',
      resolved_idempotency_key || ':branch',
      target_metadata || jsonb_build_object('bounded_context', 'lpg')
    );
  end if;

  -- Upsert lpg_station_branches with active operational status
  insert into public.lpg_station_branches (
    organization_id,
    branch_id,
    display_name,
    formatted_address,
    latitude,
    longitude,
    service_radius_meters,
    operating_hours,
    supported_cylinder_sizes_kg,
    refill_capacity_kg,
    current_available_kg,
    availability_status,
    approval_status,
    compliance_status,
    metadata,
    source,
    idempotency_key
  )
  values (
    org_id,
    branch_id,
    btrim(resolved_display_name),
    btrim(resolved_address),
    resolved_latitude,
    resolved_longitude,
    coalesce(target_service_radius_meters, 8000),
    resolved_hours,
    array[3, 6, 12.5, 25, 50]::numeric[],
    resolved_capacity,
    resolved_capacity,
    'available',
    'approved',
    'approved',
    target_metadata || jsonb_build_object(
      'activated_from_application_id', target_application_id,
      'owner_user_id', resolved_owner_user_id,
      'activated_at', timezone('utc', now())
    ),
    'platform.admin_activation',
    resolved_idempotency_key || ':station'
  )
  on conflict (source, idempotency_key) do update
  set availability_status = 'available',
      approval_status = 'approved',
      compliance_status = 'approved',
      refill_capacity_kg = excluded.refill_capacity_kg,
      current_available_kg = excluded.current_available_kg,
      metadata = public.lpg_station_branches.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into station_branch_id;

  if station_branch_id is null then
    select id into station_branch_id
    from public.lpg_station_branches
    where organization_id = org_id and branch_id = branch_id
    limit 1;
  end if;

  -- Configure roles and assign owner
  for preset_record in
    select preset.*
    from public.lpg_station_role_presets preset
    where preset.status = 'active'
    order by preset.key
  loop
    perform public.configure_organization_role(
      org_id,
      preset_record.role_key,
      preset_record.display_name,
      preset_record.permission_keys,
      'Branch-scoped preset for LPG station operations.',
      branch_id,
      'platform.admin',
      resolved_idempotency_key || ':role:' || preset_record.key,
      preset_record.metadata || jsonb_build_object('station_branch_id', station_branch_id)
    );
  end loop;

  if resolved_owner_user_id is not null then
    perform public.assign_lpg_station_role(
      station_branch_id,
      resolved_owner_user_id,
      'lpg.station.owner',
      resolved_idempotency_key || ':owner-role',
      target_metadata
    );
  end if;

  -- Update application record state
  update public.application_records
  set operational_status = 'active',
      activated_at = timezone('utc', now()),
      activated_by = auth.uid(),
      activated_subject_type = 'station',
      activated_subject_id = station_branch_id,
      updated_at = timezone('utc', now())
  where id = target_application_id;

  -- Queue activation notification for station owner
  perform public.queue_communication_message(
    'in_app',
    'station.activated',
    'user',
    resolved_owner_user_id,
    null,
    jsonb_build_object(
      'title', 'Station Activated',
      'body', 'Your station is now active on SKIMA and can receive eligible LPG orders.',
      'category', 'partner',
      'deepLink', '/(station)/profile',
      'stationBranchId', station_branch_id,
      'applicationId', target_application_id
    ),
    'provider.communication.sandbox',
    'platform.admin',
    resolved_idempotency_key || ':notif',
    jsonb_build_object('recipient_role', 'station')
  );

  return station_branch_id;
end;
$$;

-- ============================================================================
-- 3. FIX DRIVER ACTIVATION IN BACKEND RUNTIME
-- ============================================================================

create or replace function public.admin_activate_driver(
  target_application_id uuid,
  target_idempotency_key text default null,
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
  driver_profile_id uuid;
  resolved_user_id uuid;
  resolved_idempotency_key text;
begin
  if auth.role() <> 'service_role' and not public.can_review_applications() and not public.can_manage_lpg_operations() then
    raise exception 'admin permission required to activate driver';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  select *
  into application_record
  from public.application_records
  where id = target_application_id
  for update;

  if not found then
    raise exception 'application not found';
  end if;

  if application_record.status <> 'approved' then
    raise exception 'only approved applications can be operationally activated';
  end if;

  select *
  into application_type_record
  from public.application_type_definitions
  where id = application_record.application_type_id;

  if application_type_record.application_category <> 'driver' then
    raise exception 'driver activation requires a driver application';
  end if;

  resolved_user_id := application_record.applicant_user_id;
  resolved_idempotency_key := coalesce(target_idempotency_key, 'admin-activate-driver:' || target_application_id::text);

  -- Upsert driver profile with active card and verified capability
  insert into public.driver_profiles (
    user_id,
    organization_id,
    operational_status,
    verification_status,
    driver_card_status,
    driver_card_issued_at,
    metadata,
    created_by
  )
  values (
    resolved_user_id,
    application_record.organization_id,
    'offline',
    'approved',
    'active',
    timezone('utc', now()),
    target_metadata || jsonb_build_object('source_application_id', target_application_id),
    auth.uid()
  )
  on conflict (user_id) do update
  set verification_status = 'approved',
      driver_card_status = 'active',
      driver_card_issued_at = coalesce(public.driver_profiles.driver_card_issued_at, timezone('utc', now())),
      metadata = public.driver_profiles.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into driver_profile_id;

  -- Ensure driver card identity is populated
  perform public.ensure_driver_card_identity(driver_profile_id, target_application_id);

  -- Activate capabilities
  insert into public.entity_capabilities (
    entity_type,
    entity_id,
    capability_key,
    constraints,
    status,
    verified_at,
    created_by
  )
  values (
    'driver',
    driver_profile_id,
    'capability.driver.delivery',
    jsonb_build_object('source_application_id', target_application_id),
    'active',
    timezone('utc', now()),
    auth.uid()
  )
  on conflict (entity_type, entity_id, capability_key) do update
  set status = 'active',
      verified_at = timezone('utc', now()),
      updated_at = timezone('utc', now());

  -- Update application record
  update public.application_records
  set operational_status = 'active',
      activated_at = timezone('utc', now()),
      activated_by = auth.uid(),
      activated_subject_type = 'driver',
      activated_subject_id = driver_profile_id,
      updated_at = timezone('utc', now())
  where id = target_application_id;

  -- Queue activation notification for driver
  perform public.queue_communication_message(
    'in_app',
    'driver.activated',
    'user',
    resolved_user_id,
    null,
    jsonb_build_object(
      'title', 'Driver Account Activated',
      'body', 'Your SKIMA Driver account is now active. You can now receive eligible delivery jobs in your approved service area.',
      'category', 'partner',
      'deepLink', '/(driver)/id-card',
      'driverProfileId', driver_profile_id,
      'applicationId', target_application_id
    ),
    'provider.communication.sandbox',
    'platform.admin',
    resolved_idempotency_key || ':notif',
    jsonb_build_object('recipient_role', 'driver')
  );

  return driver_profile_id;
end;
$$;

-- ============================================================================
-- 4. PARTNER DEACTIVATION & SUSPENSION RPC
-- ============================================================================

create or replace function public.admin_deactivate_partner(
  target_application_id uuid,
  target_reason text default 'Administrative deactivation',
  target_idempotency_key text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record record;
  resolved_idempotency_key text;
begin
  if auth.role() <> 'service_role' and not public.can_review_applications() and not public.can_manage_lpg_operations() then
    raise exception 'admin permission required to deactivate partner';
  end if;

  select *
  into application_record
  from public.application_records
  where id = target_application_id
  for update;

  if not found then
    raise exception 'application not found';
  end if;

  resolved_idempotency_key := coalesce(target_idempotency_key, 'admin-deactivate:' || target_application_id::text);

  if application_record.activated_subject_type = 'station' and application_record.activated_subject_id is not null then
    update public.lpg_station_branches
    set availability_status = 'offline',
        approval_status = 'suspended',
        compliance_status = 'suspended',
        updated_at = timezone('utc', now())
    where id = application_record.activated_subject_id;
  elsif application_record.activated_subject_type = 'driver' and application_record.activated_subject_id is not null then
    update public.driver_profiles
    set operational_status = 'offline',
        driver_card_status = 'suspended',
        updated_at = timezone('utc', now())
    where id = application_record.activated_subject_id;
  end if;

  update public.application_records
  set operational_status = 'deactivated',
      updated_at = timezone('utc', now())
  where id = target_application_id;

  return true;
end;
$$;

-- ============================================================================
-- 5. ITEMISED REQUIREMENT CORRECTION / REPLACEMENT RPC
-- ============================================================================

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

  select *
  into submission_record
  from public.document_submissions
  where id = target_document_submission_id
  for update;

  if not found then
    raise exception 'document submission not found';
  end if;

  select *
  into application_record
  from public.application_records
  where id = submission_record.application_id;

  select *
  into requirement_record
  from public.document_requirements
  where id = submission_record.requirement_id;

  resolved_idempotency_key := coalesce(target_idempotency_key, 'req-replacement:' || target_document_submission_id::text || ':' || extract(epoch from now())::text);

  -- Mark submission as correction requested
  update public.document_submissions
  set status = 'rejected',
      replacement_requested = true,
      replacement_reason = target_reason,
      reviewed_at = timezone('utc', now()),
      reviewed_by = auth.uid(),
      metadata = metadata || jsonb_build_object('replacement_reason', target_reason, 'requested_at', timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = target_document_submission_id;

  -- Transition application state to under_review with changes_requested flag
  update public.application_records
  set status = 'under_review',
      metadata = metadata || jsonb_build_object(
        'changes_requested', true,
        'latest_correction_requirement_key', requirement_record.key,
        'latest_correction_reason', target_reason
      ),
      updated_at = timezone('utc', now())
  where id = submission_record.application_id;

  -- Queue targeted notification to applicant
  perform public.queue_communication_message(
    'in_app',
    'application.changes_requested',
    'user',
    application_record.applicant_user_id,
    null,
    jsonb_build_object(
      'title', 'Document Update Requested',
      'body', 'We need an updated ' || coalesce(requirement_record.display_name, 'document') || ': ' || target_reason,
      'category', 'partner',
      'deepLink', '/(customer)/' || case when application_record.activated_subject_type = 'driver' then 'driver' else 'station' end || '-documents',
      'applicationId', submission_record.application_id,
      'requirementKey', requirement_record.key,
      'reason', target_reason
    ),
    'provider.communication.sandbox',
    'platform.admin',
    resolved_idempotency_key || ':notif',
    jsonb_build_object('recipient_role', 'applicant')
  );

  return target_document_submission_id;
end;
$$;

-- Revoke & Grant permissions
revoke all on function public.admin_activate_station(uuid, integer, text, jsonb) from public, anon;
grant execute on function public.admin_activate_station(uuid, integer, text, jsonb) to authenticated, service_role;

revoke all on function public.admin_activate_driver(uuid, text, jsonb) from public, anon;
grant execute on function public.admin_activate_driver(uuid, text, jsonb) to authenticated, service_role;

revoke all on function public.admin_deactivate_partner(uuid, text, text) from public, anon;
grant execute on function public.admin_deactivate_partner(uuid, text, text) to authenticated, service_role;

revoke all on function public.request_document_requirement_replacement(uuid, text, text) from public, anon;
grant execute on function public.request_document_requirement_replacement(uuid, text, text) to authenticated, service_role;

commit;
