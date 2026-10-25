begin;

-- Customer-channel read/quote/order wrappers. These are service-role-only because
-- the webhook authenticates WhatsApp via the already-linked contact, not a user JWT.
-- Each wrapper verifies that link before reusing the canonical LPG RPCs.

create or replace function public.read_skima_whatsapp_customer_choices(
  target_whatsapp_wa_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
  cylinder_choices jsonb;
  location_choices jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501', message='service role required';
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id = btrim(coalesce(target_whatsapp_wa_id, ''))
    and link_status = 'linked'
    and profile_id is not null
  for share;

  if not found or not exists (
    select 1 from public.profiles p
    where p.id = contact_record.profile_id and p.status = 'active'
  ) then
    raise exception using errcode='42501', message='active linked SKIMA customer required';
  end if;

  select coalesce(jsonb_agg(choice order by choice->>'displayName'), '[]'::jsonb)
  into cylinder_choices
  from (
    select jsonb_build_object(
      'id', c.id,
      'displayName', coalesce(nullif(c.display_name, ''), nullif(c.brand, ''), c.cylinder_identifier, 'LPG cylinder'),
      'sizeKg', c.size_kg,
      'maxCapacityKg', c.max_capacity_kg,
      'status', c.status
    ) as choice
    from public.lpg_cylinders c
    where c.owner_user_id = contact_record.profile_id
      and c.status in ('active', 'pending_verification', 'verified')
      and coalesce(c.condition_status, 'good') not in ('damaged', 'unsafe', 'expired')
      and coalesce(c.safety_restriction, '') = ''
    order by c.created_at desc
    limit 10
  ) cylinders;

  select coalesce(jsonb_agg(choice order by choice->>'label'), '[]'::jsonb)
  into location_choices
  from (
    select jsonb_build_object(
      'id', l.id,
      'label', l.label,
      'address', l.formatted_address,
      'landmark', l.landmark,
      'contactName', l.contact_name,
      'contactPhone', l.contact_phone,
      'latitude', l.latitude,
      'longitude', l.longitude
    ) as choice
    from public.lpg_customer_locations l
    where l.owner_user_id = contact_record.profile_id
      and l.status = 'active'
      and l.latitude is not null
      and l.longitude is not null
    order by l.created_at desc
    limit 10
  ) locations;

  return jsonb_build_object(
    'cylinders', cylinder_choices,
    'locations', location_choices
  );
end;
$$;

create or replace function public.read_skima_whatsapp_eligible_stations(
  target_whatsapp_wa_id text,
  target_cylinder_id uuid,
  target_requested_kg numeric,
  target_pickup_location_id uuid,
  target_delivery_location_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
  cylinder_record public.lpg_cylinders%rowtype;
  standard_options jsonb := '[]'::jsonb;
  station_managed_options jsonb := '[]'::jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501', message='service role required';
  end if;
  if target_requested_kg is null or target_requested_kg <= 0 then
    raise exception using errcode='22023', message='requested kilograms must be greater than zero';
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id = btrim(coalesce(target_whatsapp_wa_id, ''))
    and link_status = 'linked'
    and profile_id is not null
  for share;
  if not found or not exists (
    select 1 from public.profiles p
    where p.id = contact_record.profile_id and p.status = 'active'
  ) then
    raise exception using errcode='42501', message='active linked SKIMA customer required';
  end if;

  select * into cylinder_record
  from public.lpg_cylinders c
  where c.id = target_cylinder_id
    and c.owner_user_id = contact_record.profile_id
    and c.status in ('active', 'pending_verification', 'verified')
    and coalesce(c.condition_status, 'good') not in ('damaged', 'unsafe', 'expired')
    and coalesce(c.safety_restriction, '') = ''
  for share;
  if not found then
    raise exception using errcode='42501', message='selected LPG cylinder is not available to this customer';
  end if;
  if target_requested_kg > cylinder_record.max_capacity_kg then
    raise exception using errcode='22023', message='requested kilograms exceed the selected cylinder capacity';
  end if;

  if not exists (
    select 1 from public.lpg_customer_locations l
    where l.id = target_pickup_location_id and l.owner_user_id = contact_record.profile_id
      and l.status = 'active' and l.latitude is not null and l.longitude is not null
  ) or not exists (
    select 1 from public.lpg_customer_locations l
    where l.id = target_delivery_location_id and l.owner_user_id = contact_record.profile_id
      and l.status = 'active' and l.latitude is not null and l.longitude is not null
  ) then
    raise exception using errcode='42501', message='selected pickup and delivery locations must be active saved customer locations';
  end if;

  perform set_config('request.jwt.claim.sub', contact_record.profile_id::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', contact_record.profile_id::text, 'role', 'service_role')::text, true);

  select coalesce(jsonb_agg(
    to_jsonb(s) || jsonb_build_object('fulfillmentMode', 'independent_driver')
  ), '[]'::jsonb)
  into standard_options
  from public.read_lpg_eligible_stations(
    target_pickup_location_id, target_delivery_location_id, target_cylinder_id,
    target_requested_kg, 5, timezone('utc', now())
  ) s;

  select coalesce(jsonb_agg(
    to_jsonb(s) || jsonb_build_object('fulfillmentMode', 'station_managed')
  ), '[]'::jsonb)
  into station_managed_options
  from public.read_lpg_station_managed_eligible_stations(
    target_pickup_location_id, target_delivery_location_id, target_cylinder_id,
    target_requested_kg, 5, timezone('utc', now())
  ) s;

  return standard_options || station_managed_options;
end;
$$;

create or replace function public.create_skima_whatsapp_lpg_quote(
  target_whatsapp_wa_id text,
  target_cylinder_id uuid,
  target_requested_kg numeric,
  target_pickup_location_id uuid,
  target_delivery_location_id uuid,
  target_station_branch_id uuid,
  target_fulfillment_mode text,
  target_idempotency_key text,
  target_provider_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
  eligible_options jsonb;
  quote_id uuid;
  quote_record record;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501', message='service role required';
  end if;
  if target_fulfillment_mode not in ('independent_driver', 'station_managed') then
    raise exception using errcode='22023', message='unsupported LPG fulfillment option';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception using errcode='22023', message='idempotency key required';
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id = btrim(coalesce(target_whatsapp_wa_id, ''))
    and link_status = 'linked'
    and profile_id is not null
  for share;
  if not found or not exists (
    select 1 from public.profiles p
    where p.id = contact_record.profile_id and p.status = 'active'
  ) then
    raise exception using errcode='42501', message='active linked SKIMA customer required';
  end if;

  eligible_options := public.read_skima_whatsapp_eligible_stations(
    target_whatsapp_wa_id, target_cylinder_id, target_requested_kg,
    target_pickup_location_id, target_delivery_location_id
  );
  if not exists (
    select 1
    from jsonb_array_elements(eligible_options) option_row
    where option_row->>'station_branch_id' = target_station_branch_id::text
      and option_row->>'fulfillmentMode' = target_fulfillment_mode
  ) then
    raise exception using errcode='40001', message='selected station is no longer eligible; request the available options again';
  end if;

  perform set_config('request.jwt.claim.sub', contact_record.profile_id::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', contact_record.profile_id::text, 'role', 'service_role')::text, true);

  quote_id := public.create_lpg_refill_quote(
    target_cylinder_id,
    target_requested_kg,
    target_pickup_location_id,
    target_delivery_location_id,
    target_idempotency_key,
    target_station_branch_id,
    null,
    null,
    jsonb_build_object(
      'channel', 'whatsapp',
      'fulfillment_mode', target_fulfillment_mode,
      'provider_message_id', target_provider_message_id
    ),
    'skima.lpg.whatsapp'
  );

  select q.id, q.public_reference, q.requested_kg, q.currency_code, q.lpg_amount,
    q.delivery_fee_amount, q.platform_fee_amount, q.tax_amount, q.total_amount,
    q.expires_at, q.status, s.display_name as station_name, q.fulfillment_mode
  into quote_record
  from public.lpg_refill_quotes q
  left join public.lpg_station_branches s on s.id = q.station_branch_id
  where q.id = quote_id
    and exists (
      select 1 from public.lpg_cylinders c
      where c.id = q.cylinder_id and c.owner_user_id = contact_record.profile_id
    );
  if not found then
    raise exception 'created quote could not be verified against the linked customer';
  end if;

  return jsonb_build_object(
    'id', quote_record.id,
    'publicReference', quote_record.public_reference,
    'requestedKg', quote_record.requested_kg,
    'currencyCode', quote_record.currency_code,
    'lpgAmount', quote_record.lpg_amount,
    'deliveryFeeAmount', quote_record.delivery_fee_amount,
    'platformFeeAmount', quote_record.platform_fee_amount,
    'taxAmount', quote_record.tax_amount,
    'totalAmount', quote_record.total_amount,
    'expiresAt', quote_record.expires_at,
    'status', quote_record.status,
    'stationName', quote_record.station_name,
    'fulfillmentMode', coalesce(quote_record.fulfillment_mode, target_fulfillment_mode)
  );
end;
$$;

create or replace function public.create_skima_whatsapp_lpg_order(
  target_whatsapp_wa_id text,
  target_quote_id uuid,
  target_idempotency_key text,
  target_provider_message_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
  quote_record public.lpg_refill_quotes%rowtype;
  order_id uuid;
  order_record record;
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode='42501', message='service role required';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception using errcode='22023', message='idempotency key required';
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id = btrim(coalesce(target_whatsapp_wa_id, ''))
    and link_status = 'linked'
    and profile_id is not null
  for share;
  if not found or not exists (
    select 1 from public.profiles p
    where p.id = contact_record.profile_id and p.status = 'active'
  ) then
    raise exception using errcode='42501', message='active linked SKIMA customer required';
  end if;

  select q.* into quote_record
  from public.lpg_refill_quotes q
  join public.lpg_cylinders c on c.id = q.cylinder_id
  where q.id = target_quote_id
    and c.owner_user_id = contact_record.profile_id
  for update of q;
  if not found then
    raise exception using errcode='42501', message='quote does not belong to this linked customer';
  end if;
  if quote_record.status <> 'quoted' or quote_record.expires_at <= timezone('utc', now()) then
    raise exception using errcode='55000', message='quote expired or is no longer available; request a fresh quote';
  end if;

  perform set_config('request.jwt.claim.sub', contact_record.profile_id::text, true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', contact_record.profile_id::text, 'role', 'service_role')::text, true);

  order_id := public.create_lpg_refill_order(
    target_quote_id,
    target_idempotency_key,
    jsonb_build_object(
      'channel', 'whatsapp',
      'provider_message_id', target_provider_message_id,
      'whatsapp_contact_id', contact_record.id
    ),
    'skima.lpg.whatsapp'
  );

  select o.id, o.public_reference, o.status, o.payment_status,
    o.total_amount, o.currency_code, o.created_at
  into order_record
  from public.lpg_refill_orders o
  where o.id = order_id and o.customer_user_id = contact_record.profile_id;
  if not found then
    raise exception 'created order could not be verified against the linked customer';
  end if;

  return jsonb_build_object(
    'id', order_record.id,
    'publicReference', order_record.public_reference,
    'status', order_record.status,
    'paymentStatus', order_record.payment_status,
    'totalAmount', order_record.total_amount,
    'currencyCode', order_record.currency_code,
    'createdAt', order_record.created_at
  );
end;
$$;

revoke all on function public.read_skima_whatsapp_customer_choices(text) from public, anon, authenticated;
revoke all on function public.read_skima_whatsapp_eligible_stations(text, uuid, numeric, uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_skima_whatsapp_lpg_quote(text, uuid, numeric, uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.create_skima_whatsapp_lpg_order(text, uuid, text, text) from public, anon, authenticated;

grant execute on function public.read_skima_whatsapp_customer_choices(text) to service_role;
grant execute on function public.read_skima_whatsapp_eligible_stations(text, uuid, numeric, uuid, uuid) to service_role;
grant execute on function public.create_skima_whatsapp_lpg_quote(text, uuid, numeric, uuid, uuid, uuid, text, text, text) to service_role;
grant execute on function public.create_skima_whatsapp_lpg_order(text, uuid, text, text) to service_role;

commit;
