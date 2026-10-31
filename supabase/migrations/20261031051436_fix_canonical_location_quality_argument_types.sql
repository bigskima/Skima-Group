begin;

-- Keep the mobile application-version read model compatible with the API
-- gateway. The field is nullable until a workflow chooses to provide a summary.
alter table public.application_versions
  add column if not exists change_summary text;

-- The canonical location trigger used a double precision accuracy value and
-- an untyped NULL. The policy resolver accepts numeric/text arguments.
-- Explicit casts keep the location-evidence insert and its transaction valid.
create or replace function public.sync_application_location_verification_to_canonical()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  canonical_id uuid;
  relationship_purpose text;
  source_class text;
begin
  relationship_purpose := case
    when new.location_purpose like '%submission%' then 'APPLICATION_SUBMISSION'
    when new.location_purpose like '%declared%' then 'APPLICATION_DECLARED'
    when new.location_purpose like '%station%' then 'STATION_PHYSICAL'
    else 'APPLICATION_OPERATING_BASE'
  end;

  source_class := case lower(coalesce(new.provider_source, ''))
    when 'manual_pin' then 'MAP_PIN'
    when 'maps_adapter' then 'GEOCODED'
    when 'admin_verified' then 'ADMIN_VERIFIED'
    else 'DEVICE_GPS'
  end;

  insert into public.locations (
    point, accuracy_meters, formatted_address, capture_source,
    geocoder_provider, geocoder_reference, captured_at, confirmed_at,
    created_by, metadata
  )
  values (
    extensions.st_setsrid(extensions.st_makepoint(new.longitude, new.latitude), 4326)::extensions.geography,
    new.accuracy_meters,
    new.formatted_address,
    source_class,
    new.provider_source,
    new.provider_place_id,
    new.recorded_at,
    case when new.status = 'verified' then new.reviewed_at else null end,
    (select applicant_user_id from public.application_records where id = new.application_id),
    jsonb_build_object(
      'verificationId', new.id,
      'applicationId', new.application_id,
      'applicationVersionId', new.application_version_id,
      'evidenceSnapshot', new.evidence_snapshot,
      'quality', public.evaluate_location_quality(
        relationship_purpose,
        new.accuracy_meters::numeric,
        null::text,
        source_class
      )
    )
  )
  returning id into canonical_id;

  update public.entity_locations
  set is_current = false, valid_to = timezone('utc', now()), updated_at = timezone('utc', now())
  where entity_type = 'APPLICATION'
    and entity_id = new.application_id
    and purpose = relationship_purpose
    and is_current;

  insert into public.entity_locations (entity_type, entity_id, location_id, purpose, is_current, metadata)
  values (
    'APPLICATION',
    new.application_id,
    canonical_id,
    relationship_purpose,
    true,
    jsonb_build_object('verificationId', new.id, 'applicationVersionId', new.application_version_id)
  );

  insert into public.canonical_location_legacy_mappings (legacy_source, legacy_id, location_id, metadata)
  values (
    'application_location_verifications',
    new.id,
    canonical_id,
    jsonb_build_object('purpose', relationship_purpose)
  )
  on conflict (legacy_source, legacy_id)
  do update set location_id = excluded.location_id, metadata = excluded.metadata;

  return new;
end;
$function$;

comment on function public.sync_application_location_verification_to_canonical() is
  'Projects application location evidence to the canonical location model using type-safe location-quality policy arguments.';

commit;