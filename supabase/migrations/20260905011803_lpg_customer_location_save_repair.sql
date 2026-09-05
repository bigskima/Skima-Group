begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Keep the module-facing LPG record and the reusable canonical location model in
-- one transaction. Address components are supplied by provider adapters, whose
-- field names vary; normalize those names at the platform boundary rather than
-- teaching downstream workflows about a specific maps provider.
create or replace function public.create_canonical_customer_location(
  target_label text,
  target_formatted_address text,
  target_latitude numeric,
  target_longitude numeric,
  target_idempotency_key text,
  target_accuracy_meters numeric default null,
  target_landmark text default null,
  target_delivery_instructions text default null,
  target_contact_name text default null,
  target_contact_phone text default null,
  target_provider_source text default null,
  target_provider_place_id text default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.location_api',
  target_address jsonb default '{}'::jsonb,
  target_capture_source text default 'DEVICE_GPS',
  target_captured_at timestamptz default timezone('utc', now())
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  legacy_id uuid;
  canonical_id uuid;
  quality jsonb;
  normalized_address jsonb;
  normalized_metadata jsonb;
  normalized_capture_source text;
  normalized_accuracy numeric;
  normalized_country_code text;
begin
  normalized_address := case
    when jsonb_typeof(coalesce(target_address, '{}'::jsonb)) = 'object'
      then coalesce(target_address, '{}'::jsonb)
    else '{}'::jsonb
  end;
  normalized_metadata := case
    when jsonb_typeof(coalesce(target_metadata, '{}'::jsonb)) = 'object'
      then coalesce(target_metadata, '{}'::jsonb)
    else '{}'::jsonb
  end;
  normalized_accuracy := case
    when target_accuracy_meters is null or target_accuracy_meters < 0 then null
    else target_accuracy_meters
  end;
  normalized_capture_source := case upper(coalesce(target_capture_source, ''))
    when 'DEVICE_GPS' then 'DEVICE_GPS'
    when 'MAP_PIN' then 'MAP_PIN'
    when 'MANUAL_ADDRESS' then 'MANUAL_ADDRESS'
    when 'GEOCODED' then 'GEOCODED'
    when 'IMPORTED' then 'IMPORTED'
    when 'ADMIN_VERIFIED' then 'ADMIN_VERIFIED'
    else case lower(coalesce(target_provider_source, ''))
      when 'manual_pin' then 'MAP_PIN'
      when 'maps_adapter' then 'GEOCODED'
      when 'device_gps' then 'DEVICE_GPS'
      else 'MANUAL_ADDRESS'
    end
  end;
  normalized_country_code := upper(coalesce(
    nullif(btrim(normalized_address->>'countryCode'), ''),
    nullif(btrim(normalized_address->>'country_code'), '')
  ));
  if normalized_country_code !~ '^[A-Z]{2}$' then
    normalized_country_code := null;
  end if;

  legacy_id := public.create_lpg_customer_location(
    target_label,
    target_formatted_address,
    target_latitude,
    target_longitude,
    target_idempotency_key,
    normalized_accuracy,
    nullif(btrim(target_landmark), ''),
    target_delivery_instructions,
    target_contact_name,
    target_contact_phone,
    target_provider_source,
    target_provider_place_id,
    normalized_metadata,
    target_source
  );

  -- Serialize duplicate retries for the same module record. This prevents two
  -- concurrent requests from creating separate canonical evidence rows.
  perform pg_advisory_xact_lock(
    hashtextextended('canonical_customer_location:' || legacy_id::text, 0)
  );

  select mapping.location_id
  into canonical_id
  from public.canonical_location_legacy_mappings mapping
  where mapping.legacy_source = 'lpg_customer_locations'
    and mapping.legacy_id = legacy_id;

  if canonical_id is null then
    quality := public.evaluate_location_quality(
      'CUSTOMER_ADDRESS',
      normalized_accuracy,
      'lpg',
      normalized_capture_source
    );

    insert into public.locations (
      point,
      accuracy_meters,
      formatted_address,
      country,
      country_code,
      admin_area_1,
      admin_area_2,
      locality,
      sublocality,
      street,
      house_number,
      postal_code,
      landmark,
      capture_source,
      geocoder_provider,
      geocoder_reference,
      captured_at,
      created_by,
      metadata
    )
    values (
      extensions.st_setsrid(
        extensions.st_makepoint(target_longitude, target_latitude),
        4326
      )::extensions.geography,
      normalized_accuracy,
      btrim(target_formatted_address),
      coalesce(
        nullif(btrim(normalized_address->>'country'), ''),
        nullif(btrim(normalized_address->>'countryName'), '')
      ),
      normalized_country_code,
      coalesce(
        nullif(btrim(normalized_address->>'state'), ''),
        nullif(btrim(normalized_address->>'region'), ''),
        nullif(btrim(normalized_address->>'adminArea1'), ''),
        nullif(btrim(normalized_address->>'admin_area_1'), '')
      ),
      coalesce(
        nullif(btrim(normalized_address->>'lga'), ''),
        nullif(btrim(normalized_address->>'district'), ''),
        nullif(btrim(normalized_address->>'county'), ''),
        nullif(btrim(normalized_address->>'adminArea2'), ''),
        nullif(btrim(normalized_address->>'admin_area_2'), '')
      ),
      coalesce(
        nullif(btrim(normalized_address->>'city'), ''),
        nullif(btrim(normalized_address->>'town'), ''),
        nullif(btrim(normalized_address->>'village'), ''),
        nullif(btrim(normalized_address->>'locality'), '')
      ),
      coalesce(
        nullif(btrim(normalized_address->>'neighbourhood'), ''),
        nullif(btrim(normalized_address->>'neighborhood'), ''),
        nullif(btrim(normalized_address->>'suburb'), ''),
        nullif(btrim(normalized_address->>'sublocality'), ''),
        nullif(btrim(normalized_address->>'subLocality'), '')
      ),
      coalesce(
        nullif(btrim(normalized_address->>'street'), ''),
        nullif(btrim(normalized_address->>'road'), '')
      ),
      coalesce(
        nullif(btrim(normalized_address->>'houseNumber'), ''),
        nullif(btrim(normalized_address->>'house_number'), '')
      ),
      coalesce(
        nullif(btrim(normalized_address->>'postalCode'), ''),
        nullif(btrim(normalized_address->>'postcode'), ''),
        nullif(btrim(normalized_address->>'postal_code'), '')
      ),
      nullif(btrim(target_landmark), ''),
      normalized_capture_source,
      nullif(btrim(target_provider_source), ''),
      nullif(btrim(target_provider_place_id), ''),
      coalesce(target_captured_at, timezone('utc', now())),
      auth.uid(),
      normalized_metadata || jsonb_build_object(
        'quality', quality,
        'deliveryInstructions', target_delivery_instructions,
        'addressSnapshot', normalized_address
      )
    )
    returning id into canonical_id;

    insert into public.canonical_location_legacy_mappings (
      legacy_source,
      legacy_id,
      location_id,
      metadata
    )
    values (
      'lpg_customer_locations',
      legacy_id,
      canonical_id,
      jsonb_build_object('ownerUserId', auth.uid())
    );

    insert into public.entity_locations (
      entity_type,
      entity_id,
      location_id,
      purpose,
      is_current,
      metadata
    )
    values (
      'LPG_CUSTOMER_LOCATION',
      legacy_id,
      canonical_id,
      'CUSTOMER_ADDRESS',
      true,
      jsonb_build_object('ownerUserId', auth.uid())
    );

    update public.lpg_customer_locations
    set metadata = metadata || jsonb_build_object(
          'canonicalLocationId', canonical_id,
          'locationQuality', quality,
          'addressComponents', normalized_address
        ),
        landmark = coalesce(nullif(btrim(target_landmark), ''), landmark),
        updated_at = timezone('utc', now())
    where id = legacy_id;
  end if;

  return legacy_id;
end;
$$;

revoke all on function public.create_canonical_customer_location(
  text, text, numeric, numeric, text, numeric, text, text, text, text,
  text, text, jsonb, text, jsonb, text, timestamptz
) from public, anon;
grant execute on function public.create_canonical_customer_location(
  text, text, numeric, numeric, text, numeric, text, text, text, text,
  text, text, jsonb, text, jsonb, text, timestamptz
) to authenticated, service_role;

commit;
