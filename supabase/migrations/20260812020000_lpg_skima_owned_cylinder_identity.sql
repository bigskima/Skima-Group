begin;

create or replace function public.register_customer_lpg_cylinder(
  target_display_name text,
  target_size_kg numeric,
  target_idempotency_key text,
  target_max_capacity_kg numeric default null,
  target_image_asset_ids uuid[] default array[]::uuid[],
  target_manufacturer text default null,
  target_brand text default null,
  target_colour text default null,
  target_serial_number text default null,
  target_condition_status text default 'unknown',
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.customer_cylinder_registration'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cylinder_id uuid;
  internal_identity text;
  opaque_qr_credential text;
  normalized_name text := nullif(btrim(target_display_name), '');
begin
  if auth.uid() is null then
    raise exception 'authentication is required';
  end if;

  if normalized_name is null or char_length(normalized_name) not between 2 and 80 then
    raise exception 'target_display_name must contain between 2 and 80 characters';
  end if;

  if target_size_kg is null or target_size_kg <= 0 then
    raise exception 'target_size_kg must be greater than zero';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  internal_identity := 'SKIMA-CYL-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 14));
  opaque_qr_credential := 'skima:cylinder:v1:' || encode(extensions.gen_random_bytes(24), 'hex');

  cylinder_id := public.register_lpg_cylinder(
    target_cylinder_identifier => internal_identity,
    target_size_kg => target_size_kg,
    target_max_capacity_kg => coalesce(target_max_capacity_kg, target_size_kg),
    target_idempotency_key => target_idempotency_key,
    target_qr_payload => opaque_qr_credential,
    target_barcode_payload => null,
    target_manufacturer => nullif(btrim(target_manufacturer), ''),
    target_brand => nullif(btrim(target_brand), ''),
    target_colour => nullif(btrim(target_colour), ''),
    target_serial_number => nullif(btrim(target_serial_number), ''),
    target_condition_status => coalesce(target_condition_status, 'unknown'),
    target_image_asset_ids => coalesce(target_image_asset_ids, array[]::uuid[]),
    target_metadata => target_metadata || jsonb_build_object(
      'identityOwner', 'skima',
      'identityVersion', 1,
      'registrationChannel', 'customer',
      'externalIdentifiersSupplementary', true
    ),
    target_source => target_source
  );

  perform public.set_lpg_cylinder_display_name(cylinder_id, normalized_name);
  return cylinder_id;
end;
$$;

create or replace function public.verify_lpg_scan_cylinder_identity()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cylinder_record record;
  scanned_token text;
begin
  select cylinder.id,
         cylinder.public_reference,
         cylinder.qr_payload,
         cylinder.barcode_payload
  into cylinder_record
  from public.lpg_cylinders cylinder
  where cylinder.id = new.cylinder_id;

  if not found then
    raise exception 'scan cylinder does not exist';
  end if;

  scanned_token := nullif(btrim(coalesce(new.payload ->> 'scannedToken', '')), '');

  if scanned_token is null then
    raise exception 'a SKIMA cylinder credential is required';
  end if;

  if scanned_token is distinct from cylinder_record.qr_payload
    and scanned_token is distinct from cylinder_record.barcode_payload then
    raise exception 'scanned cylinder does not match the LPG order cylinder';
  end if;

  new.payload := (new.payload - 'scannedCylinderId' - 'scannedPublicReference') || jsonb_build_object(
    'verifiedCylinderId', cylinder_record.id,
    'verifiedCylinderReference', cylinder_record.public_reference,
    'credentialVerified', true
  );
  return new;
end;
$$;

revoke all on function public.register_customer_lpg_cylinder(text, numeric, text, numeric, uuid[], text, text, text, text, text, jsonb, text) from public;
revoke all on function public.verify_lpg_scan_cylinder_identity() from public;
grant execute on function public.register_customer_lpg_cylinder(text, numeric, text, numeric, uuid[], text, text, text, text, text, jsonb, text) to authenticated, service_role;

commit;
