begin;

-- Separate application approval from operational activation.
alter table public.application_records
  add column if not exists operational_status text not null default 'pending';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.application_records'::regclass
      and conname = 'application_records_operational_status_check'
  ) then
    alter table public.application_records
      add constraint application_records_operational_status_check
      check (operational_status in ('pending','active','inactive','suspended','deactivated'));
  end if;
end $$;

alter table public.application_records
  add column if not exists activated_at timestamptz,
  add column if not exists activated_by uuid references public.profiles(id) on delete set null;

alter table public.document_submissions
  add column if not exists replacement_requested boolean not null default false,
  add column if not exists replacement_reason text;

-- In the LPG mobile product, module-specific application definitions are authoritative.
-- Keep generic definitions available as retired templates instead of allowing first-match selection.
update public.application_type_definitions
set status = 'retired',
    updated_at = timezone('utc', now())
where key in (
  'application.business.default',
  'application.driver.default',
  'application.vehicle.default'
)
  and status = 'active';

update public.application_type_definitions
set status = 'active',
    updated_at = timezone('utc', now())
where key in (
  'application.lpg.station.phase-one',
  'application.lpg.driver.phase-one',
  'application.lpg.vehicle.phase-one'
);

-- Approval must not make station/driver live. Vehicle activation remains automatic
-- because there is no separate live-activation action for vehicles.
create or replace function public.decide_application_review(
  target_application_id uuid,
  target_decision text,
  target_reason text,
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
  missing_review_count integer;
  event_type_key text;
  review_task_id uuid;
begin
  if auth.role() <> 'service_role' and not public.can_review_applications() then
    raise exception 'application review permission is required';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  if target_decision not in ('approved', 'rejected', 'suspended', 'reactivated') then
    raise exception 'target_decision is not supported';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select app_rec.*
  into application_record
  from public.application_records app_rec
  where app_rec.id = target_application_id
  for update;

  if not found then
    raise exception 'target_application_id must reference an existing application';
  end if;

  select app_type.*
  into application_type_record
  from public.application_type_definitions app_type
  where app_type.id = application_record.application_type_id;

  if not found then
    raise exception 'application type definition was not found';
  end if;

  if target_decision in ('approved', 'rejected') and application_record.status <> 'under_review' then
    raise exception 'application approval decisions require under_review state';
  end if;

  if target_decision = 'suspended' and application_record.status <> 'approved' then
    raise exception 'only approved applications can be suspended';
  end if;

  if target_decision = 'reactivated' and application_record.status <> 'suspended' then
    raise exception 'only suspended applications can be reactivated';
  end if;

  if target_decision = 'approved' then
    select count(*)
    into missing_review_count
    from public.document_requirements req
    where req.requirement_set_id = application_type_record.document_requirement_set_id
      and req.status = 'active'
      and req.review_required
      and (
        select count(*)
        from public.document_submissions doc_sub
        where doc_sub.application_id = target_application_id
          and doc_sub.requirement_id = req.id
          and doc_sub.status = 'approved'
      ) < req.min_count;

    if missing_review_count > 0 then
      raise exception 'required documents must be approved before application approval';
    end if;
  end if;

  event_type_key := case target_decision
    when 'approved' then 'event.application.approved'
    when 'rejected' then 'event.application.rejected'
    when 'suspended' then 'event.application.suspended'
    when 'reactivated' then 'event.application.reactivated'
  end;

  perform public.advance_application_record_state(
    target_application_id,
    event_type_key,
    target_metadata || jsonb_build_object('reason', target_reason),
    target_idempotency_key || ':workflow'
  );

  select task.id
  into review_task_id
  from public.application_review_tasks task
  where task.application_id = target_application_id
    and task.status in ('open', 'assigned', 'correction_requested')
  order by task.created_at desc
  limit 1;

  if review_task_id is not null then
    update public.application_review_tasks
    set status = case
          when target_decision = 'approved' then 'approved'
          when target_decision = 'rejected' then 'rejected'
          else status
        end,
        metadata = metadata || target_metadata,
        updated_at = timezone('utc', now())
    where id = review_task_id;
  end if;

  insert into public.application_review_events (
    application_id,
    review_task_id,
    reviewer_user_id,
    decision,
    internal_notes,
    applicant_message,
    idempotency_key,
    metadata
  )
  values (
    target_application_id,
    review_task_id,
    auth.uid(),
    target_decision,
    target_reason,
    case when target_decision in ('approved', 'rejected') then target_reason else null end,
    target_idempotency_key,
    target_metadata
  )
  on conflict do nothing;

  if target_decision in ('approved', 'reactivated')
     and application_type_record.application_category = 'vehicle' then
    perform public.activate_approved_application(target_application_id);

    update public.application_records
    set operational_status = 'active',
        activated_at = coalesce(activated_at, timezone('utc', now())),
        activated_by = coalesce(activated_by, auth.uid()),
        updated_at = timezone('utc', now())
    where id = target_application_id;
  elsif target_decision = 'approved' then
    update public.application_records
    set operational_status = 'pending',
        activated_at = null,
        activated_by = null,
        updated_at = timezone('utc', now())
    where id = target_application_id;
  elsif target_decision = 'suspended' then
    update public.application_records
    set operational_status = 'suspended',
        updated_at = timezone('utc', now())
    where id = target_application_id;
  elsif target_decision = 'reactivated' then
    update public.application_records
    set operational_status = case
          when application_type_record.application_category = 'vehicle' then 'active'
          else 'pending'
        end,
        updated_at = timezone('utc', now())
    where id = target_application_id;
  end if;

  return target_application_id;
end;
$$;

-- Remove the emergency auto-live hook. Provisioning is now only explicit from Admin activation.
drop trigger if exists trg_lpg_station_application_activation on public.application_records;

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
  station_branch_id uuid;
  existing_station record;
  resolved_capacity numeric;
  resolved_sizes numeric[];
  resolved_hours jsonb;
  resolved_geofence jsonb;
  resolved_display_name text;
  resolved_address text;
  resolved_latitude numeric;
  resolved_longitude numeric;
  resolved_idempotency_key text;
  preset_record record;
begin
  if auth.role() <> 'service_role'
     and not public.can_review_applications()
     and not public.can_manage_lpg_operations() then
    raise exception 'admin permission required to activate LPG station';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if coalesce(target_service_radius_meters, 0) <= 0 then
    raise exception 'target_service_radius_meters must be greater than zero';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select app.*
  into application_record
  from public.application_records app
  where app.id = target_application_id
  for update;

  if not found then
    raise exception 'application not found';
  end if;

  if application_record.status <> 'approved' then
    raise exception 'only approved applications can be operationally activated';
  end if;

  select app_type.*
  into application_type_record
  from public.application_type_definitions app_type
  where app_type.id = application_record.application_type_id;

  if application_type_record.application_category <> 'business' then
    raise exception 'station activation requires a business application';
  end if;

  select version.*
  into version_record
  from public.application_versions version
  where version.application_id = target_application_id
    and version.version = application_record.active_version;

  station_payload := coalesce(
    version_record.payload -> 'lpgStation',
    version_record.payload -> 'lpg_station',
    version_record.payload -> 'station',
    '{}'::jsonb
  );

  if jsonb_typeof(station_payload) <> 'object' or station_payload = '{}'::jsonb then
    raise exception 'approved station application is missing station payload';
  end if;

  resolved_display_name := coalesce(
    nullif(station_payload ->> 'displayName', ''),
    nullif(station_payload ->> 'display_name', ''),
    nullif(version_record.payload #>> '{organization,displayName}', ''),
    nullif(version_record.payload #>> '{organization,display_name}', '')
  );
  resolved_address := coalesce(
    nullif(station_payload ->> 'formattedAddress', ''),
    nullif(station_payload ->> 'formatted_address', ''),
    nullif(station_payload #>> '{location,formattedAddress}', ''),
    nullif(station_payload #>> '{location,formatted_address}', ''),
    nullif(version_record.payload #>> '{location,formattedAddress}', ''),
    nullif(version_record.payload #>> '{location,formatted_address}', '')
  );
  resolved_latitude := coalesce(
    nullif(station_payload ->> 'latitude', '')::numeric,
    nullif(station_payload #>> '{location,latitude}', '')::numeric,
    nullif(version_record.payload #>> '{location,latitude}', '')::numeric
  );
  resolved_longitude := coalesce(
    nullif(station_payload ->> 'longitude', '')::numeric,
    nullif(station_payload #>> '{location,longitude}', '')::numeric,
    nullif(version_record.payload #>> '{location,longitude}', '')::numeric
  );
  resolved_capacity := coalesce(
    nullif(station_payload ->> 'refillCapacityKg', '')::numeric,
    nullif(station_payload ->> 'refill_capacity_kg', '')::numeric
  );
  resolved_hours := coalesce(
    station_payload -> 'operatingHours',
    station_payload -> 'operating_hours',
    '{}'::jsonb
  );
  resolved_geofence := coalesce(
    station_payload -> 'geofence',
    '{}'::jsonb
  );

  if resolved_display_name is null or char_length(btrim(resolved_display_name)) < 2 then
    raise exception 'station display name is required';
  end if;

  if resolved_address is null or char_length(btrim(resolved_address)) < 5 then
    raise exception 'station formatted address is required';
  end if;

  if resolved_latitude is null or resolved_latitude < -90 or resolved_latitude > 90
     or resolved_longitude is null or resolved_longitude < -180 or resolved_longitude > 180 then
    raise exception 'station latitude and longitude must be valid coordinates';
  end if;

  if resolved_capacity is null or resolved_capacity <= 0 then
    raise exception 'station refill capacity must be greater than zero';
  end if;

  if jsonb_typeof(station_payload -> 'supportedCylinderSizesKg') = 'array'
     or jsonb_typeof(station_payload -> 'supported_cylinder_sizes_kg') = 'array' then
    select coalesce(array_agg(size_value::numeric order by size_value::numeric), array[]::numeric[])
    into resolved_sizes
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(station_payload -> 'supportedCylinderSizesKg') = 'array'
          then station_payload -> 'supportedCylinderSizesKg'
        else station_payload -> 'supported_cylinder_sizes_kg'
      end
    ) as sizes(size_value);
  else
    select coalesce(array_agg(profile.size_kg order by profile.size_kg), array[]::numeric[])
    into resolved_sizes
    from public.lpg_cylinder_type_profiles profile
    where profile.status = 'active';
  end if;

  resolved_idempotency_key := btrim(target_idempotency_key);

  select station.*
  into existing_station
  from public.lpg_station_branches station
  where station.metadata ->> 'source_application_id' = target_application_id::text
     or station.metadata ->> 'activated_from_application_id' = target_application_id::text
  order by station.created_at asc
  limit 1
  for update;

  if found then
    station_branch_id := existing_station.id;

    update public.lpg_station_branches
    set display_name = btrim(resolved_display_name),
        formatted_address = btrim(resolved_address),
        latitude = resolved_latitude,
        longitude = resolved_longitude,
        service_radius_meters = target_service_radius_meters,
        operating_hours = resolved_hours,
        supported_cylinder_sizes_kg = resolved_sizes,
        refill_capacity_kg = resolved_capacity,
        current_available_kg = current_available_kg,
        geofence = resolved_geofence,
        availability_status = 'available',
        approval_status = 'approved',
        compliance_status = 'approved',
        metadata = metadata || target_metadata || jsonb_build_object(
          'source_application_id', target_application_id,
          'owner_user_id', application_record.applicant_user_id,
          'operationally_activated_at', timezone('utc', now())
        ),
        updated_at = timezone('utc', now())
    where id = station_branch_id;

    for preset_record in
      select preset.*
      from public.lpg_station_role_presets preset
      where preset.status = 'active'
      order by preset.key
    loop
      perform public.configure_organization_role(
        existing_station.organization_id,
        preset_record.role_key,
        preset_record.display_name,
        preset_record.permission_keys,
        'Branch-scoped preset for LPG station operations.',
        existing_station.branch_id,
        'platform.admin',
        resolved_idempotency_key || ':role:' || preset_record.key,
        preset_record.metadata || jsonb_build_object('station_branch_id', station_branch_id)
      );
    end loop;

    perform public.assign_lpg_station_role(
      station_branch_id,
      application_record.applicant_user_id,
      'lpg.station.owner',
      resolved_idempotency_key || ':owner-role',
      target_metadata
    );
  else
    station_branch_id := public.activate_lpg_station_branch(
      target_application_id => target_application_id,
      target_display_name => resolved_display_name,
      target_formatted_address => resolved_address,
      target_latitude => resolved_latitude,
      target_longitude => resolved_longitude,
      target_idempotency_key => resolved_idempotency_key || ':station',
      target_owner_user_id => application_record.applicant_user_id,
      target_branch_key => 'lpg.station.primary',
      target_service_radius_meters => target_service_radius_meters,
      target_supported_cylinder_sizes_kg => resolved_sizes,
      target_refill_capacity_kg => resolved_capacity,
      target_current_available_kg => resolved_capacity,
      target_operating_hours => resolved_hours,
      target_geofence => resolved_geofence,
      target_metadata => target_metadata || jsonb_build_object(
        'source_application_id', target_application_id,
        'owner_user_id', application_record.applicant_user_id
      ),
      target_source => 'lpg.admin_activation'
    );
  end if;

  select *
  into application_record
  from public.application_records
  where id = target_application_id;

  update public.application_records
  set operational_status = 'active',
      activated_at = timezone('utc', now()),
      activated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where id = target_application_id;

  perform public.queue_communication_message(
    'in_app',
    'station.activated',
    'profile',
    application_record.applicant_user_id,
    null,
    jsonb_build_object(
      'title', 'Station Activated',
      'body', 'Your station is now active on SKIMA and can receive eligible LPG orders.',
      'category', 'partner',
      'path', '/(station)',
      'deepLink', '/(station)',
      'stationBranchId', station_branch_id,
      'applicationId', target_application_id
    ),
    'provider.communication.sandbox',
    'skima.application.activation',
    resolved_idempotency_key || ':notification',
    jsonb_build_object('workspace', 'station')
  );

  return station_branch_id;
end;
$$;

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
  activation_result jsonb;
  driver_profile_id uuid;
  resolved_idempotency_key text;
begin
  if auth.role() <> 'service_role'
     and not public.can_review_applications()
     and not public.can_manage_lpg_operations() then
    raise exception 'admin permission required to activate driver';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select app.*
  into application_record
  from public.application_records app
  where app.id = target_application_id
  for update;

  if not found then
    raise exception 'application not found';
  end if;

  if application_record.status <> 'approved' then
    raise exception 'only approved applications can be operationally activated';
  end if;

  select app_type.*
  into application_type_record
  from public.application_type_definitions app_type
  where app_type.id = application_record.application_type_id;

  if application_type_record.application_category <> 'driver' then
    raise exception 'driver activation requires a driver application';
  end if;

  resolved_idempotency_key := btrim(target_idempotency_key);

  if application_record.activated_subject_type is null
     or application_record.activated_subject_id is null then
    activation_result := public.activate_approved_application(target_application_id);
    driver_profile_id := nullif(activation_result ->> 'activated_subject_id', '')::uuid;
  elsif application_record.activated_subject_type = 'driver' then
    driver_profile_id := application_record.activated_subject_id;
  else
    raise exception 'approved driver application has an incompatible activated subject';
  end if;

  if driver_profile_id is null then
    raise exception 'driver profile could not be activated';
  end if;

  update public.driver_profiles
  set verification_status = 'approved',
      operational_status = 'offline',
      driver_card_status = 'active',
      driver_card_issued_at = coalesce(driver_card_issued_at, timezone('utc', now())),
      metadata = metadata || target_metadata || jsonb_build_object(
        'source_application_id', target_application_id,
        'operationally_activated_at', timezone('utc', now())
      ),
      updated_at = timezone('utc', now())
  where id = driver_profile_id;

  perform public.ensure_driver_card_identity(driver_profile_id, target_application_id);

  update public.entity_capabilities
  set status = 'active',
      verified_at = coalesce(verified_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where entity_type = 'driver'
    and entity_id = driver_profile_id;

  update public.application_records
  set operational_status = 'active',
      activated_at = timezone('utc', now()),
      activated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where id = target_application_id;

  perform public.queue_communication_message(
    'in_app',
    'driver.activated',
    'profile',
    application_record.applicant_user_id,
    null,
    jsonb_build_object(
      'title', 'Driver Account Activated',
      'body', 'Your SKIMA Driver account is active. Your Driver Pass is ready and you can receive eligible jobs when you go available.',
      'category', 'partner',
      'path', '/(driver)/id-card',
      'deepLink', '/(driver)/id-card',
      'driverProfileId', driver_profile_id,
      'applicationId', target_application_id
    ),
    'provider.communication.sandbox',
    'skima.application.activation',
    resolved_idempotency_key || ':notification',
    jsonb_build_object('workspace', 'driver')
  );

  return driver_profile_id;
end;
$$;

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
  station_branch_id uuid;
  resolved_idempotency_key text;
  workspace_value text;
begin
  if auth.role() <> 'service_role'
     and not public.can_review_applications()
     and not public.can_manage_lpg_operations() then
    raise exception 'admin permission required to deactivate partner';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select app.*, app_type.application_category, app_type.metadata as application_type_metadata
  into application_record
  from public.application_records app
  join public.application_type_definitions app_type on app_type.id = app.application_type_id
  where app.id = target_application_id
  for update of app;

  if not found then
    raise exception 'application not found';
  end if;

  resolved_idempotency_key := btrim(target_idempotency_key);
  workspace_value := coalesce(application_record.application_type_metadata ->> 'workspace',
    case when application_record.application_category = 'driver' then 'driver' else 'station' end);

  if application_record.activated_subject_type = 'driver'
     and application_record.activated_subject_id is not null then
    update public.driver_profiles
    set operational_status = 'offline',
        verification_status = 'suspended',
        driver_card_status = 'suspended',
        updated_at = timezone('utc', now())
    where id = application_record.activated_subject_id;

    update public.entity_capabilities
    set status = 'suspended',
        updated_at = timezone('utc', now())
    where entity_type = 'driver'
      and entity_id = application_record.activated_subject_id;
  else
    select station.id
    into station_branch_id
    from public.lpg_station_branches station
    where station.metadata ->> 'source_application_id' = target_application_id::text
       or station.metadata ->> 'activated_from_application_id' = target_application_id::text
    order by station.created_at asc
    limit 1;

    if station_branch_id is not null then
      update public.lpg_station_branches
      set availability_status = 'paused',
          approval_status = 'suspended',
          compliance_status = 'suspended',
          updated_at = timezone('utc', now())
      where id = station_branch_id;
    end if;

    if application_record.activated_subject_type = 'partner'
       and application_record.activated_subject_id is not null then
      update public.partner_profiles
      set status = 'suspended',
          updated_at = timezone('utc', now())
      where id = application_record.activated_subject_id;

      update public.entity_capabilities
      set status = 'suspended',
          updated_at = timezone('utc', now())
      where entity_type = 'partner'
        and entity_id = application_record.activated_subject_id;
    end if;
  end if;

  update public.application_records
  set operational_status = 'deactivated',
      updated_at = timezone('utc', now())
  where id = target_application_id;

  perform public.queue_communication_message(
    'in_app',
    workspace_value || '.deactivated',
    'profile',
    application_record.applicant_user_id,
    null,
    jsonb_build_object(
      'title', case when workspace_value = 'driver' then 'Driver Account Deactivated' else 'Station Deactivated' end,
      'body', coalesce(nullif(btrim(target_reason), ''), 'Your SKIMA partner access has been deactivated by an administrator.'),
      'category', 'partner',
      'applicationId', target_application_id
    ),
    'provider.communication.sandbox',
    'skima.application.activation',
    resolved_idempotency_key || ':notification',
    jsonb_build_object('workspace', workspace_value)
  );

  return true;
end;
$$;

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

  select app.*
  into application_record
  from public.application_records app
  where app.id = submission_record.application_id;

  select requirement.*
  into requirement_record
  from public.document_requirements requirement
  where requirement.id = submission_record.requirement_id;

  resolved_idempotency_key := btrim(target_idempotency_key);

  update public.document_submissions
  set status = 'rejected',
      replacement_requested = true,
      replacement_reason = btrim(target_reason),
      reviewed_at = timezone('utc', now()),
      reviewed_by = auth.uid(),
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

-- Revoke anonymous access to privileged review/activation helpers.
revoke execute on function public.decide_application_review(uuid, text, text, text, jsonb) from anon;
revoke execute on function public.activate_approved_application(uuid) from anon;
revoke execute on function public.request_application_correction(uuid, text, text, text, jsonb) from anon;

revoke all on function public.admin_activate_station(uuid, integer, text, jsonb) from public, anon;
grant execute on function public.admin_activate_station(uuid, integer, text, jsonb) to authenticated, service_role;

revoke all on function public.admin_activate_driver(uuid, text, jsonb) from public, anon;
grant execute on function public.admin_activate_driver(uuid, text, jsonb) to authenticated, service_role;

revoke all on function public.admin_deactivate_partner(uuid, text, text) from public, anon;
grant execute on function public.admin_deactivate_partner(uuid, text, text) to authenticated, service_role;

revoke all on function public.request_document_requirement_replacement(uuid, text, text) from public, anon;
grant execute on function public.request_document_requirement_replacement(uuid, text, text) to authenticated, service_role;

-- Preserve already-live records while bringing the new operational state column into sync.
update public.application_records app
set operational_status = 'active',
    activated_at = coalesce(app.activated_at, app.updated_at),
    updated_at = timezone('utc', now())
where app.status = 'approved'
  and (
    exists (
      select 1
      from public.lpg_station_branches station
      where station.metadata ->> 'source_application_id' = app.id::text
         or station.metadata ->> 'activated_from_application_id' = app.id::text
    )
    or exists (
      select 1
      from public.driver_profiles driver
      where driver.metadata ->> 'source_application_id' = app.id::text
        and driver.verification_status = 'approved'
    )
  );

-- Existing emergency-provisioned stations should be immediately orderable when their
-- reviewed application declared a positive refill capacity.
update public.lpg_station_branches station
set current_available_kg = station.refill_capacity_kg,
    metadata = station.metadata || jsonb_build_object(
      'capacity_initialized_from_reviewed_refill_capacity', true,
      'capacity_initialized_at', timezone('utc', now())
    ),
    updated_at = timezone('utc', now())
where station.current_available_kg = 0
  and station.refill_capacity_kg > 0
  and (
    station.metadata ? 'source_application_id'
    or station.metadata ? 'activated_from_application_id'
  )
  and station.approval_status = 'approved'
  and station.compliance_status = 'approved'
  and station.availability_status = 'available';

commit;
