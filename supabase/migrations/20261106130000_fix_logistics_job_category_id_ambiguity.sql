begin;

-- Fix the PL/pgSQL variable/column name collision in public request matching.
-- Keep customer category matching broad across all eligible provider services.
create or replace function public.create_logistics_job(
  target_payload jsonb,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  v_category_id uuid;
  pickup_geo_id uuid;
  destination_geo_id uuid;
  v_job_id uuid;
  existing_job public.logistics_job_requests%rowtype;
  request_title text;
  request_service_key text;
  customer_phone text;
  match_count integer;
  event_status text;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_payload is null or jsonb_typeof(target_payload) <> 'object' then
    raise exception 'logistics job payload must be an object';
  end if;
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'valid idempotency key is required';
  end if;

  select category.id into v_category_id
  from public.logistics_service_categories category
  where category.key = target_payload->>'category_key'
    and category.status = 'active';
  if v_category_id is null then raise exception 'active logistics category is required'; end if;

  request_service_key := target_payload->>'service_key';
  if request_service_key is null or request_service_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'valid service key is required';
  end if;
  request_title := btrim(coalesce(target_payload->>'title', ''));
  if char_length(request_title) not between 3 and 180 then
    raise exception 'job title must contain 3 to 180 characters';
  end if;

  pickup_geo_id := nullif(target_payload #>> '{pickup,geography_id}', '')::uuid;
  destination_geo_id := nullif(target_payload #>> '{destination,geography_id}', '')::uuid;
  if pickup_geo_id is null or destination_geo_id is null then
    raise exception 'pickup and destination geography are required';
  end if;
  if not exists (select 1 from public.geographies where id = pickup_geo_id and status = 'active')
    or not exists (select 1 from public.geographies where id = destination_geo_id and status = 'active') then
    raise exception 'pickup and destination must reference active platform geographies';
  end if;
  if target_payload->'pickup' is null
    or jsonb_typeof(target_payload->'pickup') is distinct from 'object'
    or target_payload->'destination' is null
    or jsonb_typeof(target_payload->'destination') is distinct from 'object'
    or jsonb_typeof(coalesce(target_payload->'cargo', '{}'::jsonb)) is distinct from 'object'
    or target_payload->'customer_contact' is null
    or jsonb_typeof(target_payload->'customer_contact') is distinct from 'object'
    or jsonb_typeof(coalesce(target_payload->'metadata', '{}'::jsonb)) is distinct from 'object' then
    raise exception 'pickup, destination, cargo, contact and metadata must be JSON objects';
  end if;

  customer_phone := btrim(coalesce(target_payload #>> '{customer_contact,phone}', ''));
  if length(btrim(coalesce(target_payload #>> '{customer_contact,name}', ''))) < 2
    or customer_phone !~ '^[+]?[0-9]'
    or regexp_replace(customer_phone, '^[+]?[0-9][0-9 ()-]*', '') <> ''
    or length(regexp_replace(customer_phone, '[^0-9]', '', 'g')) not between 7 and 15 then
    raise exception 'customer contact name and a valid phone number are required';
  end if;

  select * into existing_job
  from public.logistics_job_requests
  where requester_user_id = actor and idempotency_key = target_idempotency_key;

  if found then
    if existing_job.category_id <> v_category_id
      or existing_job.service_key <> request_service_key
      or existing_job.title <> request_title
      or existing_job.description is distinct from nullif(btrim(target_payload->>'description'), '')
      or existing_job.pickup_location <> target_payload->'pickup'
      or existing_job.destination_location <> target_payload->'destination'
      or existing_job.cargo_snapshot <> coalesce(target_payload->'cargo', '{}'::jsonb)
      or existing_job.customer_contact_snapshot->>'name' is distinct from btrim(target_payload #>> '{customer_contact,name}')
      or existing_job.customer_contact_snapshot->>'phone' is distinct from customer_phone
      or existing_job.instructions is distinct from nullif(btrim(target_payload->>'instructions'), '')
      or existing_job.requested_pickup_at is distinct from nullif(target_payload->>'requested_pickup_at', '')::timestamptz
      or existing_job.metadata <> coalesce(target_payload->'metadata', '{}'::jsonb) then
      raise exception 'idempotency key was already used for a different logistics job';
    end if;
    return existing_job.id;
  end if;

  insert into public.logistics_job_requests (
    requester_user_id, category_id, service_key, title, description,
    pickup_geography_id, destination_geography_id, pickup_location, destination_location,
    cargo_snapshot, customer_contact_snapshot, instructions, requested_pickup_at,
    status, published_at, expires_at, metadata, idempotency_key
  )
  values (
    actor, v_category_id, request_service_key, request_title,
    nullif(btrim(target_payload->>'description'), ''),
    pickup_geo_id, destination_geo_id,
    target_payload->'pickup', target_payload->'destination',
    coalesce(target_payload->'cargo', '{}'::jsonb),
    jsonb_strip_nulls(jsonb_build_object(
      'name', btrim(target_payload #>> '{customer_contact,name}'),
      'phone', customer_phone,
      'email', nullif(lower(btrim(target_payload #>> '{customer_contact,email}')), ''),
      'contact_instructions', nullif(btrim(target_payload #>> '{customer_contact,contact_instructions}'), '')
    )),
    nullif(btrim(target_payload->>'instructions'), ''),
    nullif(target_payload->>'requested_pickup_at', '')::timestamptz,
    'open', timezone('utc', now()),
    timezone('utc', now()) + interval '7 days',
    coalesce(target_payload->'metadata', '{}'::jsonb),
    target_idempotency_key
  )
  returning id into v_job_id;

  insert into public.logistics_job_opportunities (
    job_id, organization_id, provider_service_id, status, match_reasons,
    job_snapshot, customer_contact_snapshot
  )
  select
    v_job_id,
    service.organization_id,
    service.id,
    'matched',
    jsonb_build_array('service_capability', 'pickup_coverage', 'destination_coverage', 'provider_verified'),
    jsonb_build_object(
      'job_id', v_job_id,
      'title', request_title,
      'description', nullif(btrim(target_payload->>'description'), ''),
      'service_key', request_service_key,
      'category_key', target_payload->>'category_key',
      'provider_organization_id', service.organization_id,
      'provider_name', provider.public_name,
      'provider_service_id', service.id,
      'provider_service_name', service.display_name,
      'pickup', target_payload->'pickup',
      'destination', target_payload->'destination',
      'cargo', coalesce(target_payload->'cargo', '{}'::jsonb),
      'instructions', nullif(btrim(target_payload->>'instructions'), ''),
      'requested_pickup_at', nullif(target_payload->>'requested_pickup_at', '') 
    ),
    jsonb_strip_nulls(jsonb_build_object(
      'name', btrim(target_payload #>> '{customer_contact,name}'),
      'phone', customer_phone,
      'email', nullif(lower(btrim(target_payload #>> '{customer_contact,email}')), ''),
      'contact_instructions', nullif(btrim(target_payload #>> '{customer_contact,contact_instructions}'), '')
    ))
  from public.logistics_provider_services service
  join public.logistics_provider_profiles provider
    on provider.organization_id = service.organization_id
  where service.category_id = v_category_id
    and service.status = 'active'
    and service.availability_enabled = true
    and provider.verification_status = 'verified'
    and provider.operational_status = 'active'
    and exists (
      select 1
      from public.logistics_provider_coverage origin
      where origin.provider_service_id = service.id
        and origin.status = 'active'
        and (
          (origin.coverage_mode in ('origin', 'both') and public.logistics_geography_is_covered(origin.geography_id, pickup_geo_id))
          or (origin.coverage_mode = 'route'
            and public.logistics_geography_is_covered(origin.geography_id, pickup_geo_id)
            and public.logistics_geography_is_covered(origin.destination_geography_id, destination_geo_id))
        )
    )
    and exists (
      select 1
      from public.logistics_provider_coverage destination
      where destination.provider_service_id = service.id
        and destination.status = 'active'
        and (
          (destination.coverage_mode in ('destination', 'both') and public.logistics_geography_is_covered(destination.geography_id, destination_geo_id))
          or (destination.coverage_mode = 'route'
            and public.logistics_geography_is_covered(destination.geography_id, pickup_geo_id)
            and public.logistics_geography_is_covered(destination.destination_geography_id, destination_geo_id))
        )
    )
    and (
      service.maximum_weight_kg is null
      or nullif(target_payload #>> '{cargo,weight_kg}', '') is null
      or service.maximum_weight_kg >= (target_payload #>> '{cargo,weight_kg}')::numeric
    )
    and (
      service.maximum_volume_m3 is null
      or nullif(target_payload #>> '{cargo,volume_m3}', '') is null
      or service.maximum_volume_m3 >= (target_payload #>> '{cargo,volume_m3}')::numeric
    )
    and (
      cardinality(service.cargo_type_keys) = 0
      or jsonb_array_length(coalesce(target_payload #> '{cargo,cargo_type_keys}', '[]'::jsonb)) = 0
      or service.cargo_type_keys && array(
        select jsonb_array_elements_text(coalesce(target_payload #> '{cargo,cargo_type_keys}', '[]'::jsonb))
      )
    )
    and (
      cardinality(service.vehicle_type_keys) = 0
      or jsonb_array_length(coalesce(target_payload #> '{cargo,vehicle_type_keys}', '[]'::jsonb)) = 0
      or service.vehicle_type_keys && array(
        select jsonb_array_elements_text(coalesce(target_payload #> '{cargo,vehicle_type_keys}', '[]'::jsonb))
      )
    )
  on conflict (job_id, organization_id) do nothing;

  get diagnostics match_count = row_count;
  event_status := case when match_count > 0 then 'matching' else 'open' end;

  update public.logistics_job_requests
  set status = event_status, updated_at = timezone('utc', now())
  where id = v_job_id;

  perform public.record_logistics_job_event(
    v_job_id,
    case when match_count > 0 then 'logistics.job.distributed' else 'logistics.job.no_provider_match' end,
    target_idempotency_key || ':published',
    'draft',
    event_status,
    jsonb_build_object('matched_provider_count', match_count)
  );

  return v_job_id;
end;
$$;

commit;
