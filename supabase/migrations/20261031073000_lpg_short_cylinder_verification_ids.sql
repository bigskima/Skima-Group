begin;

-- Five-character, case-insensitive human verification IDs. The alphabet
-- excludes visually ambiguous I/O/0/1 and requires at least one letter and
-- one digit. The internal UUID remains the immutable relational identity.
create or replace function public.generate_lpg_cylinder_short_identifier()
returns text
language plpgsql
volatile
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  candidate text;
  index_value integer;
  attempt integer := 0;
begin
  -- Serialize code allocation so two concurrent cylinder registrations cannot
  -- both pass the availability check with the same candidate.
  perform pg_advisory_xact_lock(741582103, 1);

  loop
    attempt := attempt + 1;
    candidate := '';

    for index_value in 1..5 loop
      candidate := candidate || substr(
        alphabet,
        (get_byte(extensions.gen_random_bytes(1), 0) % char_length(alphabet)) + 1,
        1
      );
    end loop;

    if candidate ~ '[A-HJ-NP-Z]'
      and candidate ~ '[2-9]'
      and not exists (
        select 1
        from public.lpg_cylinders cylinder
        where upper(cylinder.cylinder_identifier) = candidate
      ) then
      return candidate;
    end if;

    if attempt >= 500 then
      raise exception 'unable to allocate a unique five-character LPG Cylinder ID';
    end if;
  end loop;
end;
$function$;

create or replace function public.assign_lpg_cylinder_short_identifier()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  previous_identifier text;
  existing_aliases jsonb;
begin
  previous_identifier := nullif(btrim(new.cylinder_identifier), '');
  existing_aliases := case
    when jsonb_typeof(coalesce(new.metadata, '{}'::jsonb)->'legacyCylinderIdentifiers') = 'array'
      then coalesce(new.metadata, '{}'::jsonb)->'legacyCylinderIdentifiers'
    else '[]'::jsonb
  end;

  new.cylinder_identifier := public.generate_lpg_cylinder_short_identifier();

  if previous_identifier is not null
    and upper(previous_identifier) <> new.cylinder_identifier then
    existing_aliases := existing_aliases || jsonb_build_array(previous_identifier);
  end if;

  new.metadata := coalesce(new.metadata, '{}'::jsonb)
    || jsonb_build_object(
      'cylinderIdentifierFormat', 'five_character_alphanumeric_v1',
      'legacyCylinderIdentifiers', existing_aliases
    );

  return new;
end;
$function$;

revoke all on function public.generate_lpg_cylinder_short_identifier() from public, anon, authenticated;
revoke all on function public.assign_lpg_cylinder_short_identifier() from public, anon, authenticated;

-- Backfill every registered cylinder. Preserve the previous human-readable
-- identifier and old CYL- registry reference as accepted scan aliases, while
-- changing the permanent ID shown to drivers, stations and customers.
do $backfill$
declare
  cylinder_row record;
  next_identifier text;
  legacy_aliases jsonb;
begin
  perform pg_advisory_xact_lock(741582103, 1);

  for cylinder_row in
    select id, cylinder_identifier, public_reference, metadata
    from public.lpg_cylinders
    order by created_at, id
    for update
  loop
    next_identifier := public.generate_lpg_cylinder_short_identifier();

    select coalesce(jsonb_agg(to_jsonb(alias_value)), '[]'::jsonb)
    into legacy_aliases
    from (
      select distinct btrim(alias_value) as alias_value
      from unnest(array[
        nullif(btrim(cylinder_row.cylinder_identifier), ''),
        nullif(btrim(cylinder_row.public_reference), '')
      ]) as aliases(alias_value)
      where alias_value is not null
        and upper(alias_value) <> next_identifier
    ) aliases;

    update public.lpg_cylinders
    set cylinder_identifier = next_identifier,
        metadata = coalesce(cylinder_row.metadata, '{}'::jsonb)
          || jsonb_build_object(
            'cylinderIdentifierFormat', 'five_character_alphanumeric_v1',
            'legacyCylinderIdentifiers',
              case
                when jsonb_typeof(coalesce(cylinder_row.metadata, '{}'::jsonb)->'legacyCylinderIdentifiers') = 'array'
                  then coalesce(cylinder_row.metadata, '{}'::jsonb)->'legacyCylinderIdentifiers' || legacy_aliases
                else legacy_aliases
              end,
            'cylinderIdentifierChangedAt', timezone('utc', now())
          ),
        updated_at = timezone('utc', now())
    where id = cylinder_row.id;
  end loop;
end;
$backfill$;

-- Enforce global uniqueness, not merely uniqueness within a customer account.
create unique index if not exists lpg_cylinders_cylinder_identifier_global_unique
  on public.lpg_cylinders (upper(cylinder_identifier));

-- All future cylinders receive the same code automatically, regardless of
-- whether they are registered by a customer flow, an admin flow or an API.
drop trigger if exists lpg_cylinders_assign_short_identifier on public.lpg_cylinders;
create trigger lpg_cylinders_assign_short_identifier
before insert on public.lpg_cylinders
for each row
execute function public.assign_lpg_cylinder_short_identifier();

-- Update scan validation to accept the short ID and retain existing legacy
-- values as aliases. The cylinder UUID and physical tag verification remain
-- unchanged; this is not a relaxation of order/cylinder matching.
create or replace function public.verify_lpg_scan_cylinder_identity()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  cylinder_record record;
  scanned_cylinder_id text;
  scanned_reference text;
  scanned_token text;
  verification_method text;
  matched_tag_id uuid := null;
  matched_tag_reference text := null;
  matched_tag_type text := null;
  legacy_aliases jsonb;
  reference_matches boolean := false;
begin
  select cylinder.id,
         cylinder.public_reference,
         cylinder.cylinder_identifier,
         cylinder.qr_payload,
         cylinder.barcode_payload,
         cylinder.tag_status,
         cylinder.metadata
  into cylinder_record
  from public.lpg_cylinders cylinder
  where cylinder.id = new.cylinder_id;

  if not found then
    raise exception 'scan cylinder does not exist';
  end if;

  legacy_aliases := case
    when jsonb_typeof(cylinder_record.metadata->'legacyCylinderIdentifiers') = 'array'
      then cylinder_record.metadata->'legacyCylinderIdentifiers'
    else '[]'::jsonb
  end;

  scanned_cylinder_id := nullif(btrim(coalesce(new.payload ->> 'scannedCylinderId', '')), '');
  scanned_reference := nullif(btrim(coalesce(new.payload ->> 'scannedPublicReference', '')), '');
  scanned_token := nullif(btrim(coalesce(new.payload ->> 'scannedToken', '')), '');

  if scanned_cylinder_id is not null
    and scanned_cylinder_id <> cylinder_record.id::text then
    raise exception 'scanned cylinder does not match the LPG order cylinder';
  end if;

  if scanned_reference is not null then
    reference_matches :=
      upper(scanned_reference) = upper(coalesce(cylinder_record.cylinder_identifier, ''))
      or upper(scanned_reference) = upper(coalesce(cylinder_record.public_reference, ''))
      or exists (
        select 1
        from jsonb_array_elements_text(legacy_aliases) alias_row(value)
        where upper(alias_row.value) = upper(scanned_reference)
      );

    if not reference_matches then
      raise exception 'scanned cylinder does not match the LPG order cylinder';
    end if;
  end if;

  if scanned_token is null then
    raise exception 'a SKIMA cylinder credential or Cylinder ID is required';
  end if;

  if scanned_token is not distinct from cylinder_record.qr_payload
    or scanned_token is not distinct from cylinder_record.barcode_payload then
    verification_method := 'qr_scan';
  else
    select tag.id, tag.public_tag_reference, tag.tag_type
    into matched_tag_id, matched_tag_reference, matched_tag_type
    from public.lpg_cylinder_tags tag
    where tag.cylinder_id = cylinder_record.id
      and tag.status = 'active'
      and tag.credential_hash = public.hash_lpg_cylinder_tag_credential(scanned_token)
    limit 1;

    if matched_tag_id is not null then
      verification_method := case matched_tag_type
        when 'nfc' then 'nfc_tag'
        when 'barcode' then 'barcode_tag'
        else 'qr_tag'
      end;
    elsif upper(scanned_token) = upper(coalesce(cylinder_record.cylinder_identifier, ''))
      or upper(scanned_token) = upper(coalesce(cylinder_record.public_reference, ''))
      or exists (
        select 1
        from jsonb_array_elements_text(legacy_aliases) alias_row(value)
        where upper(alias_row.value) = upper(scanned_token)
      ) then
      verification_method := 'manual_cylinder_id';
    else
      raise exception 'scanned cylinder does not match the LPG order cylinder';
    end if;
  end if;

  new.payload := (new.payload - 'scannedPublicReference') || jsonb_strip_nulls(jsonb_build_object(
    'verifiedCylinderId', cylinder_record.id,
    'verifiedCylinderReference', cylinder_record.cylinder_identifier,
    'verifiedCylinderPublicReference', cylinder_record.public_reference,
    'identityVerified', true,
    'credentialVerified', verification_method <> 'manual_cylinder_id',
    'verificationMethod', verification_method,
    'physicalTagStatus', cylinder_record.tag_status,
    'verifiedTagId', matched_tag_id,
    'verifiedTagReference', matched_tag_reference
  ));

  return new;
end;
$function$;

revoke all on function public.verify_lpg_scan_cylinder_identity() from public, anon, authenticated;

comment on column public.lpg_cylinders.cylinder_identifier is
  'Five-character globally unique alphanumeric permanent Cylinder ID; previous identifiers are retained in metadata for backward-compatible scan verification.';

commit;
