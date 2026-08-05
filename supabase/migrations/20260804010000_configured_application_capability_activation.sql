begin;

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
  is_required,
  allowed_content_types,
  metadata
) as (
  values
    ('documents.lpg.station.phase-one', 'station.business-registration', 'Business Registration', true, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], '{}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.owner-identity', 'Owner Identity', true, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], '{}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.regulatory-certificate', 'Regulatory Certificate', true, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], '{}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.business-permit', 'Business Permit', true, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], '{}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.fire-safety-certificate', 'Fire Safety Certificate', true, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], '{}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.settlement-evidence', 'Settlement Account Evidence', true, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], '{}'::jsonb),
    ('documents.lpg.station.phase-one', 'station.photo', 'Station Photo', true, array['image/jpeg', 'image/png', 'image/webp']::text[], '{"media_purpose":"station_photo"}'::jsonb),
    ('documents.lpg.driver.phase-one', 'driver.identity', 'Driver Identity', true, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], '{}'::jsonb),
    ('documents.lpg.driver.phase-one', 'driver.licence', 'Driver Licence', true, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], '{}'::jsonb),
    ('documents.lpg.driver.phase-one', 'driver.address-evidence', 'Address Evidence', true, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], '{}'::jsonb),
    ('documents.lpg.driver.phase-one', 'driver.profile-photo', 'Profile Photo', true, array['image/jpeg', 'image/png', 'image/webp']::text[], '{"media_purpose":"profile_photo"}'::jsonb),
    ('documents.lpg.vehicle.phase-one', 'vehicle.registration', 'Vehicle Registration', true, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], '{}'::jsonb),
    ('documents.lpg.vehicle.phase-one', 'vehicle.ownership-authorization', 'Vehicle Ownership Or Authorization', true, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], '{}'::jsonb),
    ('documents.lpg.vehicle.phase-one', 'vehicle.insurance', 'Vehicle Insurance', true, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], '{}'::jsonb),
    ('documents.lpg.vehicle.phase-one', 'vehicle.roadworthiness', 'Roadworthiness Evidence', true, array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[], '{}'::jsonb),
    ('documents.lpg.vehicle.phase-one', 'vehicle.photo', 'Vehicle Photo', true, array['image/jpeg', 'image/png', 'image/webp']::text[], '{"media_purpose":"vehicle_photo"}'::jsonb)
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
  1,
  5,
  requirement_seed.allowed_content_types,
  52428800,
  'active',
  requirement_seed.metadata || '{"bounded_context":"lpg"}'::jsonb
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

do $$
declare
  lpg_module_id uuid;
  application_workflow_key text;
  business_requirement_set_id uuid;
  driver_requirement_set_id uuid;
  vehicle_requirement_set_id uuid;
begin
  select id into lpg_module_id
  from public.business_modules
  where key = 'lpg' and status = 'active';

  if lpg_module_id is null then
    raise exception 'the active LPG business module is required';
  end if;

  select workflow_key into application_workflow_key
  from public.application_type_definitions
  where key = 'application.business.default';

  select id into business_requirement_set_id
  from public.document_requirement_sets
  where key = 'documents.lpg.station.phase-one';

  select id into driver_requirement_set_id
  from public.document_requirement_sets
  where key = 'documents.lpg.driver.phase-one';

  select id into vehicle_requirement_set_id
  from public.document_requirement_sets
  where key = 'documents.lpg.vehicle.phase-one';

  if application_workflow_key is null
    or business_requirement_set_id is null
    or driver_requirement_set_id is null
    or vehicle_requirement_set_id is null then
    raise exception 'application workflow and document configuration must exist';
  end if;

  insert into public.application_type_definitions (
    key,
    display_name,
    application_category,
    module_id,
    workflow_key,
    document_requirement_set_id,
    review_policy,
    activation_policy,
    status,
    metadata
  )
  values
    (
      'application.lpg.station.phase-one',
      'LPG Station Application',
      'business',
      lpg_module_id,
      application_workflow_key,
      business_requirement_set_id,
      '{"requires_admin_review":true}'::jsonb,
      '{"capability_source":"application_type_policy","entity_capability_keys":["capability.partner.refill-fulfillment"],"partner_behavior":{"bounded_context":"lpg"}}'::jsonb,
      'active',
      '{"bounded_context":"lpg","workspace":"station"}'::jsonb
    ),
    (
      'application.lpg.driver.phase-one',
      'LPG Driver Application',
      'driver',
      lpg_module_id,
      application_workflow_key,
      driver_requirement_set_id,
      '{"requires_admin_review":true}'::jsonb,
      '{"capability_source":"application_type_policy","entity_capability_keys":["capability.driver.cylinder-handling"],"metadata_payload_path":"service","metadata_target_key":"service_profile"}'::jsonb,
      'active',
      '{"bounded_context":"lpg","workspace":"driver","stage":"identity"}'::jsonb
    ),
    (
      'application.lpg.vehicle.phase-one',
      'LPG Delivery Vehicle Application',
      'vehicle',
      lpg_module_id,
      application_workflow_key,
      vehicle_requirement_set_id,
      '{"requires_admin_review":true}'::jsonb,
      '{"capability_source":"application_type_policy","entity_capability_keys":["capability.cargo.pressurized-cylinder","capability.cargo.returnable-container"],"metadata_payload_path":"vehicle","metadata_target_key":"vehicle_profile"}'::jsonb,
      'active',
      '{"bounded_context":"lpg","workspace":"driver","stage":"vehicle","ownershipTypes":[{"key":"driver_owned","displayName":"Driver Owned"},{"key":"leased","displayName":"Leased"},{"key":"rented","displayName":"Rented"},{"key":"third_party_authorized","displayName":"Third Party Authorized"},{"key":"fleet_assigned","displayName":"Fleet Assigned"}]}'::jsonb
    )
  on conflict (key) do update
  set display_name = excluded.display_name,
      application_category = excluded.application_category,
      module_id = excluded.module_id,
      workflow_key = excluded.workflow_key,
      document_requirement_set_id = excluded.document_requirement_set_id,
      review_policy = excluded.review_policy,
      activation_policy = excluded.activation_policy,
      status = excluded.status,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now());
end $$;

create or replace function public.remove_applicant_capability_grants()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.payload := coalesce(new.payload, '{}'::jsonb) - 'capabilityKeys' - 'capability_keys';

  if jsonb_typeof(new.payload -> 'vehicle') = 'object' then
    new.payload := jsonb_set(
      new.payload,
      '{vehicle}',
      (new.payload -> 'vehicle') - 'capabilityKeys' - 'capability_keys',
      false
    );
  end if;

  return new;
end;
$$;

drop trigger if exists application_versions_remove_applicant_capability_grants
on public.application_versions;

create trigger application_versions_remove_applicant_capability_grants
before insert or update of payload on public.application_versions
for each row execute function public.remove_applicant_capability_grants();

create or replace function public.apply_configured_application_capabilities()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  activation_policy jsonb;
  approved_payload jsonb;
  configured_keys jsonb;
  configured_key text;
  metadata_payload_path text;
  metadata_target_key text;
  metadata_value jsonb;
begin
  if new.status <> 'approved'
    or new.activated_subject_id is null
    or new.activated_subject_type is null
    or (
      old.activated_subject_id is not distinct from new.activated_subject_id
      and old.activated_subject_type is not distinct from new.activated_subject_type
    ) then
    return new;
  end if;

  select application_type.activation_policy
  into activation_policy
  from public.application_type_definitions application_type
  where application_type.id = new.application_type_id;

  configured_keys := coalesce(activation_policy -> 'entity_capability_keys', '[]'::jsonb);
  metadata_payload_path := nullif(activation_policy ->> 'metadata_payload_path', '');
  metadata_target_key := nullif(activation_policy ->> 'metadata_target_key', '');

  if metadata_payload_path is not null and metadata_target_key is not null then
    select version.payload
    into approved_payload
    from public.application_versions version
    where version.application_id = new.id
      and version.version = new.active_version;

    metadata_value := approved_payload -> metadata_payload_path;
    if metadata_value is not null and jsonb_typeof(metadata_value) = 'object' then
      if new.activated_subject_type = 'driver' then
        update public.driver_profiles
        set metadata = metadata || jsonb_build_object(metadata_target_key, metadata_value),
            updated_at = timezone('utc', now())
        where id = new.activated_subject_id;
      elsif new.activated_subject_type = 'vehicle' then
        update public.vehicles
        set metadata = metadata || jsonb_build_object(metadata_target_key, metadata_value),
            updated_at = timezone('utc', now())
        where id = new.activated_subject_id;
      end if;
    end if;
  end if;

  if jsonb_typeof(configured_keys) <> 'array' then
    raise exception 'application type capability policy must be an array';
  end if;

  for configured_key in select jsonb_array_elements_text(configured_keys)
  loop
    if not exists (
      select 1
      from public.capability_definitions capability
      where capability.key = configured_key
        and capability.status = 'active'
    ) then
      raise exception 'configured application capability is not active: %', configured_key;
    end if;

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
      new.activated_subject_type,
      new.activated_subject_id,
      configured_key,
      jsonb_build_object(
        'source_application_id', new.id,
        'source_application_type_id', new.application_type_id
      ),
      'active',
      timezone('utc', now()),
      auth.uid()
    )
    on conflict (entity_type, entity_id, capability_key) do update
    set constraints = public.entity_capabilities.constraints || excluded.constraints,
        status = 'active',
        verified_at = excluded.verified_at,
        updated_at = timezone('utc', now());
  end loop;

  return new;
end;
$$;

drop trigger if exists application_records_apply_configured_capabilities
on public.application_records;

create trigger application_records_apply_configured_capabilities
after update of activated_subject_id, activated_subject_type on public.application_records
for each row execute function public.apply_configured_application_capabilities();

revoke all on function public.remove_applicant_capability_grants() from public;
revoke all on function public.apply_configured_application_capabilities() from public;

commit;
