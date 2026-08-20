begin;

create or replace function public.verify_lpg_scan_cylinder_identity()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  cylinder_record record;
  scanned_cylinder_id text;
  scanned_reference text;
  scanned_token text;
  verification_method text;
  matched_tag_id uuid := null;
  matched_tag_reference text := null;
  matched_tag_type text := null;
begin
  select cylinder.id,
         cylinder.public_reference,
         cylinder.cylinder_identifier,
         cylinder.qr_payload,
         cylinder.barcode_payload,
         cylinder.tag_status
  into cylinder_record
  from public.lpg_cylinders cylinder
  where cylinder.id = new.cylinder_id;

  if not found then
    raise exception 'scan cylinder does not exist';
  end if;

  scanned_cylinder_id := nullif(btrim(coalesce(new.payload ->> 'scannedCylinderId', '')), '');
  scanned_reference := nullif(btrim(coalesce(new.payload ->> 'scannedPublicReference', '')), '');
  scanned_token := nullif(btrim(coalesce(new.payload ->> 'scannedToken', '')), '');

  if scanned_cylinder_id is not null and scanned_cylinder_id <> cylinder_record.id::text then
    raise exception 'scanned cylinder does not match the LPG order cylinder';
  end if;

  if scanned_reference is not null
    and upper(scanned_reference) <> upper(coalesce(cylinder_record.public_reference, '')) then
    raise exception 'scanned cylinder does not match the LPG order cylinder';
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
    elsif upper(scanned_token) = upper(coalesce(cylinder_record.public_reference, ''))
      or upper(scanned_token) = upper(coalesce(cylinder_record.cylinder_identifier, '')) then
      verification_method := 'manual_cylinder_id';
    else
      raise exception 'scanned cylinder does not match the LPG order cylinder';
    end if;
  end if;

  new.payload := (new.payload - 'scannedPublicReference') || jsonb_strip_nulls(jsonb_build_object(
    'verifiedCylinderId', cylinder_record.id,
    'verifiedCylinderReference', cylinder_record.public_reference,
    'identityVerified', true,
    'credentialVerified', verification_method <> 'manual_cylinder_id',
    'verificationMethod', verification_method,
    'physicalTagStatus', cylinder_record.tag_status,
    'verifiedTagId', matched_tag_id,
    'verifiedTagReference', matched_tag_reference
  ));

  return new;
end;
$$;

revoke all on function public.verify_lpg_scan_cylinder_identity() from public;

commit;
