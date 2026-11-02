begin;
-- Follow-on security and matching hardening for SKIMA Logistics only.

create unique index if not exists logistics_provider_coverage_identity_idx
on public.logistics_provider_coverage (
 organization_id, provider_service_id, coverage_mode, geography_id,
 coalesce(destination_geography_id,'00000000-0000-0000-0000-000000000000'::uuid)
);

create or replace function public.set_logistics_provider_verification(
  target_organization_id uuid,
  target_decision text,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  provider_id uuid;
begin
  if not public.has_permission('logistics.marketplace.manage', null) then
    raise exception 'logistics marketplace administration permission is required';
  end if;
  if target_decision is null or target_decision not in ('verified', 'rejected', 'suspended') then
    raise exception 'verification decision is not supported';
  end if;
  if target_reason is null or char_length(btrim(target_reason)) < 5 then
    raise exception 'a verification reason is required';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'idempotency key is required';
  end if;

  update public.logistics_provider_profiles
  set verification_status = target_decision,
      operational_status = case
        when target_decision = 'verified' and operational_status = 'onboarding' then 'active'
        when target_decision in ('rejected', 'suspended') then 'suspended'
        else operational_status
      end,
      verified_by = case when target_decision = 'verified' then auth.uid() else verified_by end,
      verified_at = case when target_decision = 'verified' then timezone('utc', now()) else verified_at end,
      verification_reason = btrim(target_reason),
      updated_at = timezone('utc', now())
  where organization_id = target_organization_id
  returning id into provider_id;

  if provider_id is null then raise exception 'logistics provider company was not found'; end if;

  update public.organizations
  set status = case
        when target_decision = 'verified' then 'active'
        when target_decision = 'suspended' then 'suspended'
        else status
      end,
      updated_at = timezone('utc', now())
  where id = target_organization_id;

  if target_decision = 'verified' then
    update public.logistics_provider_services
    set status = 'active', updated_at = timezone('utc', now())
    where organization_id = target_organization_id and status = 'draft';
  end if;

  return provider_id;
end;
$$;

create or replace function public.configure_logistics_provider_coverage(
  target_organization_id uuid,
  target_service_key text,
  target_coverage_mode text,
  target_geography_id uuid,
  target_destination_geography_id uuid default null,
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider_service_id uuid;
  coverage_id uuid;
begin
  if not public.can_manage_logistics_company(target_organization_id) then
    raise exception 'logistics company management permission is required';
  end if;
  if target_coverage_mode is null or target_coverage_mode not in ('origin', 'destination', 'both', 'route') then
    raise exception 'coverage mode is not supported';
  end if;
  if target_coverage_mode = 'route' and (
    target_destination_geography_id is null
    or target_destination_geography_id = target_geography_id
  ) then
    raise exception 'route coverage requires different origin and destination geographies';
  end if;
  if target_coverage_mode <> 'route' and target_destination_geography_id is not null then
    raise exception 'destination geography is allowed only for route coverage';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'idempotency key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'coverage metadata must be an object';
  end if;

  select id into v_provider_service_id
  from public.logistics_provider_services
  where organization_id = target_organization_id and service_key = target_service_key;
  if v_provider_service_id is null then raise exception 'provider service was not found'; end if;

  if not exists (select 1 from public.geographies where id = target_geography_id and status = 'active') then
    raise exception 'active origin geography is required';
  end if;
  if target_destination_geography_id is not null and not exists (
    select 1 from public.geographies where id = target_destination_geography_id and status = 'active'
  ) then
    raise exception 'active destination geography is required';
  end if;

  insert into public.logistics_provider_coverage (
    organization_id, provider_service_id, coverage_mode, geography_id,
    destination_geography_id, status, metadata, created_by
  )
  values (
    target_organization_id, v_provider_service_id, target_coverage_mode, target_geography_id,
    target_destination_geography_id, 'active', target_metadata, auth.uid()
  )
  on conflict do nothing
  returning id into coverage_id;

  if coverage_id is null then
    select id into coverage_id
    from public.logistics_provider_coverage
    where logistics_provider_coverage.organization_id = target_organization_id
      and logistics_provider_coverage.provider_service_id = v_provider_service_id
      and logistics_provider_coverage.coverage_mode = target_coverage_mode
      and geography_id = target_geography_id
      and destination_geography_id is not distinct from target_destination_geography_id
      and status = 'active'
    order by created_at desc limit 1;
  end if;

  return coverage_id;
end;
$$;

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
  category_id uuid;
  pickup_geo_id uuid;
  destination_geo_id uuid;
  job_id uuid;
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

  select id into category_id
  from public.logistics_service_categories
  where key = target_payload->>'category_key' and status = 'active';
  if category_id is null then raise exception 'active logistics category is required'; end if;

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
    if existing_job.category_id <> category_id
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
    actor, category_id, request_service_key, request_title,
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
  returning id into job_id;

  insert into public.logistics_job_opportunities (
    job_id, organization_id, provider_service_id, status, match_reasons,
    job_snapshot, customer_contact_snapshot
  )
  select
    job_id,
    service.organization_id,
    service.id,
    'matched',
    jsonb_build_array('service_capability', 'pickup_coverage', 'destination_coverage', 'provider_verified'),
    jsonb_build_object(
      'job_id', job_id,
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
  where service.category_id = category_id
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
      or service.cargo_type_keys && array(
        select jsonb_array_elements_text(coalesce(target_payload #> '{cargo,cargo_type_keys}', '[]'::jsonb))
      )
    )
    and (
      cardinality(service.vehicle_type_keys) = 0
      or service.vehicle_type_keys && array(
        select jsonb_array_elements_text(coalesce(target_payload #> '{cargo,vehicle_type_keys}', '[]'::jsonb))
      )
    )
  on conflict (job_id, organization_id) do nothing;

  get diagnostics match_count = row_count;
  event_status := case when match_count > 0 then 'matching' else 'open' end;

  update public.logistics_job_requests
  set status = event_status, updated_at = timezone('utc', now())
  where id = job_id;

  perform public.record_logistics_job_event(
    job_id,
    case when match_count > 0 then 'logistics.job.distributed' else 'logistics.job.no_provider_match' end,
    target_idempotency_key || ':published',
    'draft',
    event_status,
    jsonb_build_object('matched_provider_count', match_count)
  );

  return job_id;
end;
$$;

create or replace function public.create_logistics_offer(
  target_opportunity_id uuid,
  target_currency_code text,
  target_delivery_price_minor bigint,
  target_estimated_duration_minutes integer,
  target_terms jsonb,
  target_expires_at timestamptz,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  opportunity public.logistics_job_opportunities%rowtype;
  job public.logistics_job_requests%rowtype;
  offer_id uuid;
begin
  select * into opportunity
  from public.logistics_job_opportunities
  where id = target_opportunity_id
  for update;
  if not found then raise exception 'logistics opportunity was not found'; end if;
  if not public.can_manage_logistics_company(opportunity.organization_id)
    and not public.has_permission('business.logistics.offers.manage', opportunity.organization_id) then
    raise exception 'offer management permission is required for this provider company';
  end if;
  select * into job from public.logistics_job_requests where id = opportunity.job_id for update;
  if target_delivery_price_minor is null or target_delivery_price_minor <= 0 then
    raise exception 'delivery offer must be a positive minor-unit amount';
  end if;
  if target_currency_code is null or not exists (
    select 1 from public.currency_definitions
    where code = target_currency_code and status = 'enabled'
  ) then
    raise exception 'an enabled currency is required for a logistics offer';
  end if;
  if target_estimated_duration_minutes is not null and target_estimated_duration_minutes <= 0 then
    raise exception 'estimated duration must be positive';
  end if;
  if target_terms is null or jsonb_typeof(target_terms) <> 'object' then
    raise exception 'offer terms must be an object';
  end if;
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) < 8 then
    raise exception 'valid idempotency key is required';
  end if;
  if exists (
    select 1 from public.logistics_offers
    where created_by = auth.uid() and idempotency_key = target_idempotency_key
  ) then
    select existing.id into offer_id
    from public.logistics_offers existing
    where existing.created_by = auth.uid()
      and existing.idempotency_key = target_idempotency_key
      and existing.opportunity_id = target_opportunity_id
      and existing.currency_code = target_currency_code
      and existing.delivery_price_minor = target_delivery_price_minor
      and existing.terms = target_terms;
    if offer_id is null then raise exception 'idempotency key was reused with different offer details'; end if;
    return offer_id;
  end if;

  if job.status not in ('matching', 'offers_received') then
    raise exception 'this logistics job is no longer accepting provider offers';
  end if;
  if opportunity.status not in ('matched', 'viewed', 'offered') then
    raise exception 'this provider opportunity is no longer available';
  end if;
  if target_expires_at is not null and target_expires_at <= timezone('utc', now()) then
    raise exception 'offer expiry must be in the future';
  end if;
  if exists (
    select 1 from public.logistics_offers existing
    where existing.opportunity_id = target_opportunity_id
  ) then
    raise exception 'a provider quote already exists; use the negotiation counteroffer flow';
  end if;

  if not exists (
    select 1 from public.logistics_provider_profiles
    where organization_id = opportunity.organization_id
      and verification_status = 'verified'
      and operational_status = 'active'
  ) then raise exception 'only verified, active providers may submit offers'; end if;

  insert into public.logistics_offers (
    job_id, opportunity_id, organization_id, offer_type, currency_code,
    delivery_price_minor, estimated_duration_minutes, terms, status,
    expires_at, created_by, idempotency_key
  )
  values (
    opportunity.job_id, opportunity.id, opportunity.organization_id, 'provider_quote',
    target_currency_code, target_delivery_price_minor, target_estimated_duration_minutes,
    target_terms, 'submitted', target_expires_at, auth.uid(), target_idempotency_key
  )
  returning id into offer_id;

  update public.logistics_job_opportunities
  set status = 'offered', updated_at = timezone('utc', now())
  where id = opportunity.id;

  update public.logistics_job_requests
  set status = 'offers_received', updated_at = timezone('utc', now())
  where id = job.id;

  perform public.record_logistics_job_event(
    job.id, 'logistics.offer.submitted', target_idempotency_key || ':event',
    job.status, 'offers_received',
    jsonb_build_object('offer_id', offer_id, 'provider_organization_id', opportunity.organization_id)
  );

  return offer_id;
end;
$$;

create or replace function public.counter_logistics_offer(
  target_parent_offer_id uuid,
  target_currency_code text,
  target_delivery_price_minor bigint,
  target_estimated_duration_minutes integer,
  target_terms jsonb,
  target_expires_at timestamptz,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_offer public.logistics_offers%rowtype;
  new_offer_id uuid;
  offer_type_value text;
  job public.logistics_job_requests%rowtype;
begin
  select * into parent_offer
  from public.logistics_offers
  where id = target_parent_offer_id
  for update;
  if not found then raise exception 'offer to counter was not found'; end if;
  select * into job
  from public.logistics_job_requests
  where id = parent_offer.job_id
  for update;
  if target_delivery_price_minor is null or target_delivery_price_minor <= 0 then
    raise exception 'counteroffer must be a positive minor-unit amount';
  end if;
  if target_currency_code is null or not exists (
    select 1 from public.currency_definitions
    where code = target_currency_code and status = 'enabled'
  ) then
    raise exception 'an enabled currency is required for a counteroffer';
  end if;
  if target_terms is null or jsonb_typeof(target_terms) <> 'object' then
    raise exception 'counteroffer terms must be an object';
  end if;
  if target_estimated_duration_minutes is not null and target_estimated_duration_minutes <= 0 then
    raise exception 'estimated duration must be positive';
  end if;
  if target_currency_code <> parent_offer.currency_code then
    raise exception 'counteroffers must use the original quote currency';
  end if;
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) < 8 then
    raise exception 'valid idempotency key is required';
  end if;
  if auth.uid() = job.requester_user_id then
    if parent_offer.offer_type = 'customer_counter' then
      raise exception 'the customer cannot counter their own latest offer';
    end if;
    offer_type_value := 'customer_counter';
  elsif public.can_manage_logistics_company(parent_offer.organization_id)
    or public.has_permission('business.logistics.offers.manage', parent_offer.organization_id) then
    if parent_offer.offer_type in ('provider_quote', 'provider_counter') then
      raise exception 'the provider cannot counter their own latest offer';
    end if;
    offer_type_value := 'provider_counter';
  else
    raise exception 'only the customer or matched provider may negotiate this offer';
  end if;

  if exists (select 1 from public.logistics_offers where created_by = auth.uid() and idempotency_key = target_idempotency_key) then
    select existing.id into new_offer_id
    from public.logistics_offers existing
    where existing.created_by = auth.uid()
      and existing.idempotency_key = target_idempotency_key
      and existing.parent_offer_id = parent_offer.id
      and existing.offer_type = offer_type_value
      and existing.currency_code = target_currency_code
      and existing.delivery_price_minor = target_delivery_price_minor
      and existing.terms = target_terms;
    if new_offer_id is null then
      raise exception 'idempotency key was reused with different counteroffer details';
    end if;
    return new_offer_id;
  end if;

  if job.status not in ('matching', 'offers_received') then
    raise exception 'this logistics job is no longer open for negotiation';
  end if;
  if target_expires_at is not null and target_expires_at <= timezone('utc', now()) then
    raise exception 'counteroffer expiry must be in the future';
  end if;
  if parent_offer.status <> 'submitted' then
    raise exception 'only the latest open offer can be negotiated';
  end if;

  insert into public.logistics_offers (
    job_id, opportunity_id, organization_id, parent_offer_id, offer_type, currency_code,
    delivery_price_minor, estimated_duration_minutes, terms, status, expires_at,
    created_by, idempotency_key
  )
  values (
    parent_offer.job_id, parent_offer.opportunity_id, parent_offer.organization_id,
    parent_offer.id, offer_type_value, target_currency_code,
    target_delivery_price_minor, target_estimated_duration_minutes,
    target_terms, 'submitted', target_expires_at, auth.uid(), target_idempotency_key
  )
  returning id into new_offer_id;

  update public.logistics_offers
  set status = 'countered'
  where id = parent_offer.id;

  return new_offer_id;
end;
$$;

create or replace function public.add_logistics_negotiation_message(
  target_opportunity_id uuid,
  target_offer_id uuid,
  target_message text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  opportunity public.logistics_job_opportunities%rowtype;
  message_id uuid;
  requester_id uuid;
begin
  select * into opportunity
  from public.logistics_job_opportunities
  where id = target_opportunity_id;
  if not found then raise exception 'logistics opportunity was not found'; end if;

  select requester_user_id into requester_id
  from public.logistics_job_requests where id = opportunity.job_id;

  if auth.uid() <> requester_id
    and not public.can_read_logistics_company(opportunity.organization_id) then
    raise exception 'only the customer and matched provider may send negotiation messages';
  end if;
  if target_message is null or char_length(btrim(target_message)) not between 1 and 3000 then
    raise exception 'message must contain 1 to 3000 characters';
  end if;
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) < 8 then
    raise exception 'valid idempotency key is required';
  end if;
  if target_offer_id is not null and not exists (
    select 1 from public.logistics_offers
    where id = target_offer_id and job_id = opportunity.job_id
      and opportunity_id = opportunity.id
  ) then raise exception 'message offer must belong to this opportunity'; end if;

  insert into public.logistics_negotiation_messages (
    job_id, opportunity_id, organization_id, offer_id, sender_user_id,
    message, idempotency_key
  )
  values (
    opportunity.job_id, opportunity.id, opportunity.organization_id, target_offer_id,
    auth.uid(), btrim(target_message), target_idempotency_key
  )
  on conflict (sender_user_id, idempotency_key) do nothing
  returning id into message_id;

  if message_id is null then
    select existing.id into message_id
    from public.logistics_negotiation_messages existing
    where existing.sender_user_id = auth.uid()
      and existing.idempotency_key = target_idempotency_key
      and existing.opportunity_id = opportunity.id
      and existing.offer_id is not distinct from target_offer_id
      and existing.message = btrim(target_message);
    if message_id is null then
      raise exception 'idempotency key was reused with different negotiation message details';
    end if;
  end if;

  return message_id;
end;
$$;

create or replace function public.select_logistics_offer(
  target_offer_id uuid,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_offer public.logistics_offers%rowtype;
  job public.logistics_job_requests%rowtype;
begin
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) < 8 then
    raise exception 'valid idempotency key is required';
  end if;

  select * into selected_offer
  from public.logistics_offers
  where id = target_offer_id
  for update;
  if not found then raise exception 'logistics offer was not found'; end if;

  select * into job
  from public.logistics_job_requests
  where id = selected_offer.job_id
  for update;

  if job.requester_user_id <> auth.uid() then
    raise exception 'only the job customer may select a provider offer';
  end if;

  if exists (
    select 1 from public.logistics_job_events event_record
    where event_record.job_id = job.id
      and event_record.idempotency_key = target_idempotency_key || ':event'
      and event_record.event_type = 'logistics.offer.selected'
  ) then
    if exists (
      select 1 from public.logistics_job_events event_record
      where event_record.job_id = job.id
        and event_record.idempotency_key = target_idempotency_key || ':event'
        and event_record.metadata->>'offer_id' = target_offer_id::text
    ) then
      return target_offer_id;
    end if;
    raise exception 'idempotency key was reused to select a different offer';
  end if;

  if job.status not in ('matching', 'offers_received') then
    raise exception 'job is not accepting offer selection';
  end if;
  if selected_offer.status <> 'submitted' then
    raise exception 'only the latest open offer may be selected';
  end if;
  if selected_offer.expires_at is not null and selected_offer.expires_at <= timezone('utc', now()) then
    raise exception 'selected offer has expired';
  end if;
  if not exists (
    select 1 from public.logistics_provider_profiles provider
    where provider.organization_id = selected_offer.organization_id
      and provider.verification_status = 'verified'
      and provider.operational_status = 'active'
  ) then raise exception 'provider is no longer eligible'; end if;

  update public.logistics_offers
  set status = case when id = target_offer_id then 'selected' else 'not_selected' end
  where job_id = job.id and status in ('submitted', 'countered');

  update public.logistics_job_opportunities
  set status = case when id = selected_offer.opportunity_id then 'selected' else 'not_selected' end,
      updated_at = timezone('utc', now())
  where job_id = job.id;

  update public.logistics_job_requests
  set status = 'booking_pending', updated_at = timezone('utc', now())
  where id = job.id;

  perform public.record_logistics_job_event(
    job.id,
    'logistics.offer.selected',
    target_idempotency_key || ':event',
    job.status,
    'booking_pending',
    jsonb_build_object(
      'offer_id', target_offer_id,
      'provider_organization_id', selected_offer.organization_id,
      'next_step', 'complete_booking_terms_and_payment'
    )
  );

  return target_offer_id;
end;
$$;

create or replace function public.upsert_logistics_service_category(
  target_key text,
  target_display_name text,
  target_parent_key text default null,
  target_description text default null,
  target_status text default 'active',
  target_sort_order integer default 100,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  parent_id uuid;
  category_id uuid;
begin
  if not public.has_permission('logistics.marketplace.manage', null) then
    raise exception 'logistics marketplace administration permission is required';
  end if;
  if target_key is null or target_key !~ '^[a-z][a-z0-9_.:-]{2,120}$'
    or target_display_name is null or char_length(btrim(target_display_name)) not between 2 and 120 then
    raise exception 'valid category key and display name are required';
  end if;
  if target_status is null or target_status not in ('draft', 'active', 'suspended', 'retired') then
    raise exception 'category status is not supported';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'category metadata must be an object';
  end if;
  if target_parent_key is not null then
    select id into parent_id from public.logistics_service_categories where key = target_parent_key;
    if parent_id is null then raise exception 'parent logistics category was not found'; end if;
  end if;

  insert into public.logistics_service_categories (
    key, display_name, description, parent_category_id, status, sort_order, metadata, created_by
  )
  values (
    target_key, btrim(target_display_name), nullif(btrim(target_description), ''),
    parent_id, target_status, target_sort_order, target_metadata, auth.uid()
  )
  on conflict (key) do update
  set display_name = excluded.display_name,
      description = excluded.description,
      parent_category_id = excluded.parent_category_id,
      status = excluded.status,
      sort_order = excluded.sort_order,
      metadata = excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into category_id;

  return category_id;
end;
$$;

create or replace function public.logistics_geography_is_covered(
  target_coverage_geography_id uuid,
  target_requested_geography_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive requested_ancestors(id, parent_id) as (
    select geography.id, geography.parent_id
    from public.geographies geography
    where geography.id = target_requested_geography_id
      and geography.status = 'active'
    union all
    select parent.id, parent.parent_id
    from public.geographies parent
    join requested_ancestors child on parent.id = child.parent_id
    where parent.status = 'active'
  )
  select target_coverage_geography_id is not null
    and target_requested_geography_id is not null
    and exists (
      select 1 from requested_ancestors
      where requested_ancestors.id = target_coverage_geography_id
    );
$$;

create or replace function public.update_logistics_provider_profile(
  target_organization_id uuid,
  target_about text,
  target_support_contact jsonb,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare provider_id uuid;
begin
  if not public.can_manage_logistics_company(target_organization_id) then
    raise exception 'logistics company management permission is required';
  end if;
  if target_about is not null and char_length(target_about) > 2000 then raise exception 'company description is too long'; end if;
  if target_support_contact is null or jsonb_typeof(target_support_contact) <> 'object'
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'support contact and metadata must be JSON objects';
  end if;
  update public.logistics_provider_profiles
  set about = nullif(btrim(target_about), ''),
      support_contact = target_support_contact,
      metadata = metadata || target_metadata,
      updated_at = timezone('utc', now())
  where organization_id = target_organization_id
  returning id into provider_id;
  if provider_id is null then raise exception 'logistics provider profile was not found'; end if;
  return provider_id;
end;
$$;

create or replace function public.set_logistics_provider_operational_status(
  target_organization_id uuid, target_status text, target_reason text, target_idempotency_key text
)
returns uuid language plpgsql security definer set search_path = public
as $$
declare provider_id uuid;
begin
  if not public.can_manage_logistics_company(target_organization_id)
    and not public.has_permission('logistics.marketplace.manage', null) then
    raise exception 'logistics company management permission is required';
  end if;
  if target_status is null or target_status not in ('active', 'paused', 'closed') then raise exception 'provider operational status is not supported'; end if;
  if target_reason is null or char_length(btrim(target_reason)) < 3
    or target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'a reason and idempotency key are required';
  end if;
  update public.logistics_provider_profiles
  set operational_status = case when target_status = 'active' and verification_status <> 'verified' then 'onboarding' else target_status end,
      updated_at = timezone('utc', now())
  where organization_id = target_organization_id
  returning id into provider_id;
  if provider_id is null then raise exception 'logistics provider profile was not found'; end if;
  return provider_id;
end;
$$;

create or replace function public.refresh_logistics_job_matches(
  target_job_id uuid, target_idempotency_key text
)
returns integer language plpgsql security definer set search_path = public
as $$
declare
  job public.logistics_job_requests%rowtype;
  added_count integer := 0;
begin
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) < 8 then raise exception 'valid idempotency key is required'; end if;
  select * into job from public.logistics_job_requests where id = target_job_id for update;
  if not found then raise exception 'logistics job was not found'; end if;
  if job.requester_user_id <> auth.uid() and not public.has_permission('logistics.marketplace.manage', null) then
    raise exception 'only the job customer or marketplace administrator may refresh matching';
  end if;
  if exists (select 1 from public.logistics_job_events e where e.job_id = job.id and e.idempotency_key = target_idempotency_key || ':event') then return 0; end if;
  if job.status not in ('open', 'matching', 'offers_received') then raise exception 'this logistics job is no longer accepting provider matches'; end if;

  insert into public.logistics_job_opportunities (
    job_id, organization_id, provider_service_id, status, match_reasons, job_snapshot, customer_contact_snapshot
  )
  select
    job.id, service.organization_id, service.id, 'matched',
    jsonb_build_array('service_capability', 'pickup_coverage', 'destination_coverage', 'provider_verified'),
    jsonb_build_object('job_id',job.id,'title',job.title,'description',job.description,'service_key',job.service_key,
      'category_id',job.category_id,'provider_organization_id',service.organization_id,
      'provider_name',provider.public_name,'provider_service_id',service.id,
      'provider_service_name',service.display_name,'pickup',job.pickup_location,'destination',job.destination_location,
      'cargo',job.cargo_snapshot,'instructions',job.instructions,'requested_pickup_at',job.requested_pickup_at),
    job.customer_contact_snapshot
  from public.logistics_provider_services service
  join public.logistics_provider_profiles provider on provider.organization_id = service.organization_id
  where service.category_id = job.category_id
    and service.status = 'active'
    and service.availability_enabled = true
    and provider.verification_status = 'verified'
    and provider.operational_status = 'active'
    and exists (
      select 1 from public.logistics_provider_coverage origin
      where origin.provider_service_id = service.id and origin.status = 'active'
        and ((origin.coverage_mode in ('origin','both') and public.logistics_geography_is_covered(origin.geography_id, job.pickup_geography_id))
          or (origin.coverage_mode = 'route' and public.logistics_geography_is_covered(origin.geography_id, job.pickup_geography_id) and public.logistics_geography_is_covered(origin.destination_geography_id, job.destination_geography_id)))
    )
    and exists (
      select 1 from public.logistics_provider_coverage destination
      where destination.provider_service_id = service.id and destination.status = 'active'
        and ((destination.coverage_mode in ('destination','both') and public.logistics_geography_is_covered(destination.geography_id, job.destination_geography_id))
          or (destination.coverage_mode = 'route' and public.logistics_geography_is_covered(destination.geography_id, job.pickup_geography_id) and public.logistics_geography_is_covered(destination.destination_geography_id, job.destination_geography_id)))
    )
    and (service.maximum_weight_kg is null or nullif(job.cargo_snapshot->>'weight_kg','') is null or service.maximum_weight_kg >= (job.cargo_snapshot->>'weight_kg')::numeric)
    and (service.maximum_volume_m3 is null or nullif(job.cargo_snapshot->>'volume_m3','') is null or service.maximum_volume_m3 >= (job.cargo_snapshot->>'volume_m3')::numeric)
    and (cardinality(service.cargo_type_keys)=0 or service.cargo_type_keys && array(select jsonb_array_elements_text(coalesce(job.cargo_snapshot->'cargo_type_keys','[]'::jsonb))))
    and (cardinality(service.vehicle_type_keys)=0 or service.vehicle_type_keys && array(select jsonb_array_elements_text(coalesce(job.cargo_snapshot->'vehicle_type_keys','[]'::jsonb))))
  on conflict (job_id, organization_id) do nothing;
  get diagnostics added_count = row_count;
  if added_count > 0 and job.status in ('open','matching') then
    update public.logistics_job_requests set status='matching',updated_at=timezone('utc',now()) where id=job.id;
  end if;
  perform public.record_logistics_job_event(job.id,'logistics.job.matching_refreshed',target_idempotency_key || ':event',
    job.status,case when added_count > 0 then 'matching' else job.status end,
    jsonb_build_object('additional_provider_matches',added_count));
  return added_count;
end;
$$;

create or replace function public.search_logistics_providers(
  target_pickup_geography_id uuid,
  target_destination_geography_id uuid,
  target_category_key text default null,
  target_service_key text default null,
  target_cargo_type_keys text[] default '{}',
  target_vehicle_type_keys text[] default '{}',
  target_capability_keys text[] default '{}',
  target_weight_kg numeric default null,
  target_volume_m3 numeric default null,
  target_search text default null,
  target_limit integer default 30
)
returns table (
  provider_organization_id uuid, provider_name text, provider_service_id uuid,
  service_key text, service_name text, category_key text, category_name text,
  pricing_mode text, capability_keys text[], cargo_type_keys text[], vehicle_type_keys text[],
  maximum_weight_kg numeric, maximum_volume_m3 numeric
)
language sql stable security definer set search_path = public
as $$
  select provider.organization_id,provider.public_name,service.id,service.service_key,service.display_name,
    category.key,category.display_name,service.pricing_mode,service.capability_keys,service.cargo_type_keys,
    service.vehicle_type_keys,service.maximum_weight_kg,service.maximum_volume_m3
  from public.logistics_provider_services service
  join public.logistics_provider_profiles provider on provider.organization_id=service.organization_id
  join public.logistics_service_categories category on category.id=service.category_id
  where auth.uid() is not null and target_pickup_geography_id is not null and target_destination_geography_id is not null
    and provider.verification_status='verified' and provider.operational_status='active'
    and service.status='active' and service.availability_enabled=true and category.status='active'
    and (target_category_key is null or category.key=target_category_key)
    and (target_service_key is null or service.service_key=target_service_key)
    and (target_weight_kg is null or service.maximum_weight_kg is null or service.maximum_weight_kg>=target_weight_kg)
    and (target_volume_m3 is null or service.maximum_volume_m3 is null or service.maximum_volume_m3>=target_volume_m3)
    and (coalesce(cardinality(target_cargo_type_keys),0)=0 or coalesce(cardinality(service.cargo_type_keys),0)=0 or service.cargo_type_keys && target_cargo_type_keys)
    and (coalesce(cardinality(target_vehicle_type_keys),0)=0 or coalesce(cardinality(service.vehicle_type_keys),0)=0 or service.vehicle_type_keys && target_vehicle_type_keys)
    and (coalesce(cardinality(target_capability_keys),0)=0 or service.capability_keys && target_capability_keys)
    and (target_search is null or provider.public_name ilike '%'||target_search||'%' or service.display_name ilike '%'||target_search||'%' or service.description ilike '%'||target_search||'%')
    and exists (
      select 1 from public.logistics_provider_coverage origin
      where origin.provider_service_id=service.id and origin.status='active'
        and ((origin.coverage_mode in ('origin','both') and public.logistics_geography_is_covered(origin.geography_id,target_pickup_geography_id))
          or (origin.coverage_mode='route' and public.logistics_geography_is_covered(origin.geography_id,target_pickup_geography_id) and public.logistics_geography_is_covered(origin.destination_geography_id,target_destination_geography_id)))
    )
    and exists (
      select 1 from public.logistics_provider_coverage destination
      where destination.provider_service_id=service.id and destination.status='active'
        and ((destination.coverage_mode in ('destination','both') and public.logistics_geography_is_covered(destination.geography_id,target_destination_geography_id))
          or (destination.coverage_mode='route' and public.logistics_geography_is_covered(destination.geography_id,target_pickup_geography_id) and public.logistics_geography_is_covered(destination.destination_geography_id,target_destination_geography_id)))
    )
  order by provider.public_name,service.display_name
  limit greatest(1,least(coalesce(target_limit,30),100));
$$;


drop policy if exists logistics_opportunities_read_matched_company on public.logistics_job_opportunities;
create policy logistics_opportunities_read_customer_or_matched_company
on public.logistics_job_opportunities for select to authenticated
using (
 public.can_read_logistics_job(job_id)
 or public.can_read_logistics_company(organization_id)
 or public.has_permission('logistics.marketplace.manage', null)
);

revoke all on function public.record_logistics_job_event(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.record_logistics_job_event(uuid,text,text,text,text,jsonb) to service_role;


revoke all on function public.logistics_geography_is_covered(uuid,uuid) from public,anon,authenticated;
grant execute on function public.logistics_geography_is_covered(uuid,uuid) to service_role;
revoke all on function public.update_logistics_provider_profile(uuid,text,jsonb,jsonb) from public,anon;
revoke all on function public.set_logistics_provider_operational_status(uuid,text,text,text) from public,anon;
revoke all on function public.refresh_logistics_job_matches(uuid,text) from public,anon;
revoke all on function public.search_logistics_providers(uuid,uuid,text,text,text[],text[],text[],numeric,numeric,text,integer) from public,anon;

grant execute on function public.update_logistics_provider_profile(uuid,text,jsonb,jsonb) to authenticated,service_role;
grant execute on function public.set_logistics_provider_operational_status(uuid,text,text,text) to authenticated,service_role;
grant execute on function public.refresh_logistics_job_matches(uuid,text) to authenticated,service_role;
grant execute on function public.search_logistics_providers(uuid,uuid,text,text,text[],text[],text[],numeric,numeric,text,integer) to authenticated,service_role;

insert into public.role_permissions (role_id, permission_id, conditions)
select role_record.id, permission_record.id, '{}'::jsonb
from public.roles role_record
join public.permissions permission_record
  on permission_record.key in ('logistics.marketplace.manage', 'logistics.marketplace.read')
where role_record.organization_id is null
  and (
    (permission_record.key = 'logistics.marketplace.manage'
      and role_record.key in ('platform.super_admin', 'platform.company_admin', 'platform.operations_admin'))
    or
    (permission_record.key = 'logistics.marketplace.read'
      and role_record.key in ('platform.super_admin', 'platform.company_admin', 'platform.operations_admin', 'platform.module_admin', 'platform.audit_admin'))
  )
on conflict (role_id, permission_id) do nothing;

notify pgrst,'reload schema';
commit;
