begin;

alter table public.driver_profiles
add column if not exists driver_display_name text;

alter table public.driver_profiles
add column if not exists public_driver_id text;

alter table public.driver_profiles
add column if not exists profile_photo_asset_id uuid;

alter table public.driver_profiles
add column if not exists driver_card_issued_at timestamptz;

alter table public.driver_profiles
add column if not exists driver_card_status text not null default 'pending'
  check (driver_card_status in ('pending', 'active', 'suspended', 'revoked', 'expired'));

create unique index if not exists driver_profiles_public_driver_id_unique
on public.driver_profiles (public_driver_id)
where public_driver_id is not null;

alter table public.lpg_station_branches
add column if not exists business_legal_name text;

alter table public.lpg_station_branches
add column if not exists public_display_name text;

alter table public.lpg_station_branches
add column if not exists applicant_authority_profile jsonb not null default '{}'::jsonb
  check (jsonb_typeof(applicant_authority_profile) = 'object');

create or replace function public.skima_driver_public_id(target_driver_profile_id uuid)
returns text
language sql
stable
as $$
  select 'SKD-' || upper(substr(replace(target_driver_profile_id::text, '-', ''), 1, 12));
$$;

create or replace function public.ensure_driver_card_identity(
  target_driver_profile_id uuid,
  target_application_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  driver_record public.driver_profiles%rowtype;
  application_id uuid;
  application_payload jsonb := '{}'::jsonb;
  applicant_profile record;
  display_name_value text;
  profile_photo_id uuid;
  issued_driver_id text;
begin
  select *
  into driver_record
  from public.driver_profiles
  where id = target_driver_profile_id
  for update;

  if not found then
    raise exception 'target_driver_profile_id must reference a driver profile';
  end if;

  application_id := coalesce(
    target_application_id,
    case
      when driver_record.metadata ? 'source_application_id'
        and (driver_record.metadata ->> 'source_application_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (driver_record.metadata ->> 'source_application_id')::uuid
      else null
    end
  );

  if application_id is not null then
    select version.payload
    into application_payload
    from public.application_records application
    join public.application_type_definitions application_type
      on application_type.id = application.application_type_id
    join public.application_versions version
      on version.application_id = application.id
      and version.version = application.active_version
    where application.id = application_id
      and application_type.application_category = 'driver';
  end if;

  select profile.id, profile.display_name
  into applicant_profile
  from public.profiles profile
  where profile.id = driver_record.user_id;

  display_name_value := coalesce(
    nullif(application_payload #>> '{identity,driverDisplayName}', ''),
    nullif(application_payload #>> '{identity,driver_display_name}', ''),
    nullif(application_payload #>> '{driver,displayName}', ''),
    nullif(application_payload #>> '{driver,display_name}', ''),
    nullif(driver_record.driver_display_name, ''),
    nullif(application_payload #>> '{identity,fullName}', ''),
    nullif(application_payload #>> '{identity,full_name}', ''),
    nullif(applicant_profile.display_name, ''),
    'SKIMA Driver'
  );

  if application_id is not null then
    select document.media_asset_id
    into profile_photo_id
    from public.document_submissions document
    join public.document_requirements requirement
      on requirement.id = document.requirement_id
    where document.application_id = application_id
      and requirement.key = 'driver.profile-photo'
      and document.status = 'approved'
      and document.media_asset_id is not null
    order by document.reviewed_at desc nulls last, document.created_at desc
    limit 1;
  end if;

  issued_driver_id := coalesce(
    nullif(driver_record.public_driver_id, ''),
    public.skima_driver_public_id(driver_record.id)
  );

  update public.driver_profiles
  set public_driver_id = issued_driver_id,
      driver_display_name = display_name_value,
      profile_photo_asset_id = coalesce(profile_photo_id, profile_photo_asset_id),
      driver_card_issued_at = case
        when driver_card_issued_at is null and verification_status = 'approved'
          then timezone('utc', now())
        else driver_card_issued_at
      end,
      driver_card_status = case verification_status
        when 'approved' then 'active'
        when 'suspended' then 'suspended'
        when 'rejected' then 'revoked'
        else driver_card_status
      end,
      metadata = metadata || jsonb_build_object(
        'driver_card',
        jsonb_build_object(
          'source_application_id', application_id,
          'safe_public_identity', true,
          'updated_at', timezone('utc', now())
        )
      ),
      updated_at = timezone('utc', now())
  where id = target_driver_profile_id;

  return issued_driver_id;
end;
$$;

create or replace function public.sync_driver_card_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  source_application_id uuid;
begin
  if new.verification_status in ('approved', 'suspended', 'rejected')
    and (
      tg_op = 'INSERT'
      or new.verification_status is distinct from old.verification_status
      or new.public_driver_id is null
    ) then
    source_application_id := case
      when new.metadata ? 'source_application_id'
        and (new.metadata ->> 'source_application_id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (new.metadata ->> 'source_application_id')::uuid
      else null
    end;

    perform public.ensure_driver_card_identity(new.id, source_application_id);
  end if;

  return new;
end;
$$;

drop trigger if exists driver_profiles_sync_driver_card_identity on public.driver_profiles;
create trigger driver_profiles_sync_driver_card_identity
after insert or update of verification_status, public_driver_id on public.driver_profiles
for each row execute function public.sync_driver_card_identity();

update public.driver_profiles
set driver_card_status = case verification_status
    when 'approved' then 'active'
    when 'suspended' then 'suspended'
    when 'rejected' then 'revoked'
    else driver_card_status
  end,
    public_driver_id = coalesce(public_driver_id, public.skima_driver_public_id(id)),
    driver_card_issued_at = case
      when verification_status = 'approved' and driver_card_issued_at is null
        then timezone('utc', now())
      else driver_card_issued_at
    end
where verification_status in ('approved', 'suspended', 'rejected');

with station_requirement_set as (
  select id
  from public.document_requirement_sets
  where key = 'documents.lpg.station.phase-one'
),
station_requirement_seed(requirement_key, display_name, description, is_required, min_count, max_count, allowed_content_types, metadata) as (
  values
    (
      'station.authority-evidence',
      'Authority To Represent Station',
      'Evidence that the applicant is allowed to onboard this station for SKIMA.',
      true,
      1,
      5,
      array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[],
      '{"sensitive":true,"kyc":true,"public_safe":false}'::jsonb
    ),
    (
      'station.representative-identity',
      'Representative Government ID',
      'Government-issued identity for the person submitting the station application.',
      true,
      1,
      3,
      array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']::text[],
      '{"sensitive":true,"kyc":true,"public_safe":false}'::jsonb
    )
)
insert into public.document_requirements (
  requirement_set_id,
  key,
  display_name,
  description,
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
  station_requirement_set.id,
  station_requirement_seed.requirement_key,
  station_requirement_seed.display_name,
  station_requirement_seed.description,
  station_requirement_seed.is_required,
  true,
  station_requirement_seed.min_count,
  station_requirement_seed.max_count,
  station_requirement_seed.allowed_content_types,
  52428800,
  'active',
  station_requirement_seed.metadata || '{"bounded_context":"lpg"}'::jsonb
from station_requirement_set
cross join station_requirement_seed
on conflict (requirement_set_id, key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    is_required = excluded.is_required,
    review_required = excluded.review_required,
    min_count = excluded.min_count,
    max_count = excluded.max_count,
    allowed_content_types = excluded.allowed_content_types,
    max_byte_size = excluded.max_byte_size,
    status = excluded.status,
    metadata = excluded.metadata,
    updated_at = timezone('utc', now());

update public.document_requirements requirement
set display_name = 'Station Photos',
    description = 'Upload exterior, entrance/signage, reception and operational-area photos where available.',
    max_count = 5,
    metadata = requirement.metadata || '{"media_purpose":"station_photo","public_safe_candidate":true,"requires_public_approval":true}'::jsonb,
    updated_at = timezone('utc', now())
from public.document_requirement_sets requirement_set
where requirement.requirement_set_id = requirement_set.id
  and requirement_set.key = 'documents.lpg.station.phase-one'
  and requirement.key = 'station.photo';

update public.document_requirements requirement
set display_name = 'Driver Profile Photograph',
    description = 'Clear face photograph for the approved SKIMA Driver ID card.',
    metadata = requirement.metadata || '{"media_purpose":"driver_profile_photo","public_safe_candidate":true,"driver_card":true}'::jsonb,
    updated_at = timezone('utc', now())
from public.document_requirement_sets requirement_set
where requirement.requirement_set_id = requirement_set.id
  and requirement_set.key = 'documents.lpg.driver.phase-one'
  and requirement.key = 'driver.profile-photo';

revoke all on function public.skima_driver_public_id(uuid) from public;
revoke all on function public.ensure_driver_card_identity(uuid, uuid) from public;
revoke all on function public.sync_driver_card_identity() from public;

grant execute on function public.skima_driver_public_id(uuid) to authenticated, service_role;
grant execute on function public.ensure_driver_card_identity(uuid, uuid) to service_role;

commit;
