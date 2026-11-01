begin;

create or replace function public.resolve_lpg_internal_reference_policy(
  target_pickup_location_id uuid,
  target_at timestamptz default timezone('utc',now())
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  location_record public.lpg_customer_locations%rowtype;
  managed_resolution jsonb;
  matched_geography_id uuid;
  geography_key text;
  mapping_count integer := 0;
  result jsonb;
begin
  if auth.uid() is null and coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501',message='authentication required';
  end if;

  select * into location_record
  from public.lpg_customer_locations
  where id=target_pickup_location_id
    and (coalesce(auth.role(),'')='service_role' or owner_user_id=auth.uid())
    and status<>'deleted';

  if not found then
    raise exception using errcode='42501',message='pickup location is not available to this customer';
  end if;

  -- SKIMA Managed is an independent fulfillment capability. General
  -- customer_ordering coverage must not be required for the SKIMA-owned path.
  managed_resolution:=public.resolve_lpg_location_capability(
    'lpg',
    'skima_managed_fulfillment',
    location_record.longitude,
    location_record.latitude,
    coalesce(location_record.metadata,'{}'::jsonb)
      || jsonb_build_object('formattedAddress',location_record.formatted_address),
    target_at
  );

  if not coalesce((managed_resolution->>'available')::boolean,false) then
    raise exception using errcode='P0001',
      message='SKIMA Managed fulfilment is not enabled for the pickup location';
  end if;

  matched_geography_id:=nullif(managed_resolution->>'matchedGeographyId','')::uuid;
  if matched_geography_id is null then
    raise exception using errcode='55000',
      message='SKIMA Managed coverage must resolve to a mapped geography before pricing';
  end if;

  -- The finance policy is deliberately keyed by the existing legacy
  -- service-area key. Resolve the new geography ID through the verified
  -- migration mapping rather than hard-coding an Awka key or UUID.
  select count(*) into mapping_count
  from public.geography_migration_mappings mapping
  join public.service_areas area on area.id=mapping.legacy_id
  where mapping.legacy_source='service_areas'
    and mapping.migration_status='verified'
    and mapping.geography_id=matched_geography_id
    and area.status='active';

  if mapping_count <> 1 then
    raise exception using errcode='55000',
      message='SKIMA Managed coverage requires exactly one verified active service-area mapping for pricing';
  end if;

  select area.key into geography_key
  from public.geography_migration_mappings mapping
  join public.service_areas area on area.id=mapping.legacy_id
  where mapping.legacy_source='service_areas'
    and mapping.migration_status='verified'
    and mapping.geography_id=matched_geography_id
    and area.status='active'
  order by mapping.verified_at desc, area.key
  limit 1;

  result:=public.resolve_financial_policy(
    'pricing.lpg.internal_reference_per_kg',
    'NGN',
    target_at,
    'lpg',
    null,
    'lpg.refill.internal',
    'service_area',
    geography_key
  );

  return result || jsonb_build_object(
    'serviceability',managed_resolution,
    'resolvedGeographyType','service_area',
    'resolvedGeographyKey',geography_key,
    'matchedGeographyId',matched_geography_id
  );
end
$$;

notify pgrst,'reload schema';
commit;