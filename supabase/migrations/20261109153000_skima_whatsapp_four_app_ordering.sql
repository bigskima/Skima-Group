begin;

-- WhatsApp is an additional customer channel. These wrappers resolve the linked
-- customer and then invoke the same authenticated domain operations used by the
-- four native apps. No WhatsApp-specific order, wallet or settlement ledger is
-- created here.

create or replace function public.skima_whatsapp_create_fuel_order(
  target_whatsapp_wa_id text,
  target_branch_id uuid,
  target_product_key text,
  target_requested_litres numeric,
  target_container_mode text,
  target_container_type_key text,
  target_fulfillment_mode text,
  target_currency_code text,
  target_delivery_location_id uuid,
  target_delivery_instructions text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
  order_result jsonb;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='service role required';
  end if;
  if coalesce(btrim(target_whatsapp_wa_id),'') !~ '^[0-9]{6,20}$'
    or coalesce(btrim(target_idempotency_key),'')=''
    or target_branch_id is null
    or target_product_key is null or target_product_key not in ('fuel.pms','fuel.ago','fuel.dpk')
    or target_requested_litres is null or target_requested_litres<=0
    or target_currency_code is null
    or target_delivery_location_id is null then
    raise exception using errcode='22023',message='valid linked customer, station, fuel product, litres, currency, delivery address and idempotency key are required';
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id=btrim(target_whatsapp_wa_id)
    and link_status='linked' and profile_id is not null
  for share;
  if not found or not exists(
    select 1 from public.profiles p
    where p.id=contact_record.profile_id and p.status='active'
  ) then
    raise exception using errcode='42501',message='an active linked SKIMA customer is required';
  end if;

  perform set_config('request.jwt.claim.sub',contact_record.profile_id::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',contact_record.profile_id::text,'role','service_role')::text,true);

  if not public.has_accepted_current_policy('policy.customer.terms',null) then
    raise exception using errcode='55000',message='review and accept the current SKIMA Customer Terms in the Refill app before ordering Fuel';
  end if;

  order_result:=public.create_fuel_order_with_quote(
    target_branch_id,
    target_product_key,
    target_requested_litres,
    target_container_mode,
    target_container_type_key,
    target_fulfillment_mode,
    target_currency_code,
    target_idempotency_key,
    target_delivery_location_id,
    target_delivery_instructions,
    jsonb_build_object('channel','whatsapp','entrypoint','skima.whatsapp','whatsapp_wa_id',contact_record.whatsapp_wa_id)
  );

  return order_result;
end
$$;

create or replace function public.skima_whatsapp_pay_fuel_order(
  target_whatsapp_wa_id text,
  target_order_id uuid,
  target_price_quote_id uuid,
  target_wallet_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
  order_record public.order_records%rowtype;
  snapshot_record public.fuel_order_commercial_snapshots%rowtype;
  module_key text;
  hold_id uuid;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='service role required';
  end if;
  if target_order_id is null or target_price_quote_id is null or target_wallet_id is null
    or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='Fuel order, accepted quote, customer wallet and idempotency key are required';
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id=btrim(coalesce(target_whatsapp_wa_id,''))
    and link_status='linked' and profile_id is not null
  for share;
  if not found or not exists(
    select 1 from public.profiles p where p.id=contact_record.profile_id and p.status='active'
  ) then
    raise exception using errcode='42501',message='an active linked SKIMA customer is required';
  end if;

  perform set_config('request.jwt.claim.sub',contact_record.profile_id::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',contact_record.profile_id::text,'role','service_role')::text,true);

  if not public.has_accepted_current_policy('policy.customer.terms',null) then
    raise exception using errcode='55000',message='review and accept the current SKIMA Customer Terms in the Refill app before paying for Fuel';
  end if;

  select o.* into order_record
  from public.order_records o
  join public.business_modules m on m.id=o.module_id and m.key='fuel'
  where o.id=target_order_id and o.requester_user_id=contact_record.profile_id
  for update of o;
  if not found then
    raise exception using errcode='42501',message='Fuel order was not found for this linked customer';
  end if;

  if not exists(
    select 1 from public.fuel_order_commercial_snapshots s
    where s.order_id=target_order_id and s.generic_price_quote_id=target_price_quote_id
  ) then
    raise exception using errcode='42501',message='Fuel quote does not belong to this order';
  end if;

  perform public.accept_price_quote(
    target_price_quote_id,
    target_idempotency_key||':accept-quote',
    jsonb_build_object('channel','whatsapp','order_id',target_order_id)
  );

  select * into snapshot_record
  from public.fuel_order_commercial_snapshots s
  where s.order_id=target_order_id
  for update;
  if not found or snapshot_record.status<>'accepted'
    or snapshot_record.valid_until is not null and snapshot_record.valid_until<=timezone('utc',now()) then
    raise exception using errcode='55000',message='The Fuel quote is not accepted or has expired; request a fresh quote';
  end if;

  if not exists(
    select 1 from public.wallet_accounts w
    where w.id=target_wallet_id
      and w.owner_entity_type='user'
      and w.owner_entity_id=contact_record.profile_id
      and w.wallet_type='customer'
      and w.currency_code=order_record.currency_code
      and w.status='active'
  ) then
    raise exception using errcode='42501',message='An active customer wallet in the Fuel order currency is required';
  end if;

  hold_id:=public.fund_order_from_wallet(
    target_order_id,
    target_wallet_id,
    null,
    'platform.fuel.orders',
    target_idempotency_key||':funding',
    jsonb_build_object(
      'module_key','fuel',
      'fuel_commercial_snapshot_id',snapshot_record.id,
      'generic_price_quote_id',target_price_quote_id,
      'payment_channel','customer_wallet',
      'channel','whatsapp'
    )
  );

  return jsonb_build_object(
    'orderId',target_order_id,
    'serviceRequestId',order_record.service_request_id,
    'escrowHoldId',hold_id,
    'status','payment_reserved',
    'currencyCode',snapshot_record.currency_code,
    'totalAmount',snapshot_record.grand_total
  );
end
$$;

create or replace function public.skima_whatsapp_create_utility_payment(
  target_whatsapp_wa_id text,
  target_product_id uuid,
  target_wallet_id uuid,
  target_customer_identifier text,
  target_amount numeric,
  target_recipient_phone text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
  request_id uuid;
  reserve_result jsonb;
  request_record public.utility_payment_requests%rowtype;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='service role required';
  end if;
  if target_product_id is null or target_wallet_id is null
    or coalesce(btrim(target_customer_identifier),'')=''
    or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='Bill service, customer identifier, wallet and idempotency key are required';
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id=btrim(coalesce(target_whatsapp_wa_id,''))
    and link_status='linked' and profile_id is not null
  for share;
  if not found or not exists(
    select 1 from public.profiles p where p.id=contact_record.profile_id and p.status='active'
  ) then
    raise exception using errcode='42501',message='an active linked SKIMA customer is required';
  end if;

  perform set_config('request.jwt.claim.sub',contact_record.profile_id::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',contact_record.profile_id::text,'role','service_role')::text,true);

  if not public.has_accepted_current_policy('policy.customer.bills.terms',null) then
    raise exception using errcode='55000',message='review and accept the current SKIMA Bills Customer Terms in the Bills app before making a bill payment';
  end if;

  request_id:=public.create_utility_payment_request(
    target_product_id,
    target_wallet_id,
    btrim(target_customer_identifier),
    target_amount,
    nullif(btrim(coalesce(target_recipient_phone,'')),''),
    null,
    target_idempotency_key,
    jsonb_build_object('channel','whatsapp','customerValidated',true,'origin','official_skima_whatsapp')
  );

  reserve_result:=public.reserve_utility_payment_request(
    request_id,
    'whatsapp-utility-reserve:'||request_id::text
  );

  select * into request_record
  from public.utility_payment_requests
  where id=request_id;

  return jsonb_build_object(
    'requestId',request_record.id,
    'publicReference',request_record.public_reference,
    'status',request_record.status,
    'currencyCode',request_record.currency_code,
    'totalAmount',request_record.total_amount,
    'reservation',reserve_result
  );
exception when others then
  -- The canonical request creation and reservation routines own the financial
  -- state. If reservation fails, close only an unreserved request; do not leave
  -- an apparently payable duplicate behind.
  if request_id is not null then
    perform public.fail_unreserved_utility_payment_request(
      request_id,'whatsapp_reservation_failed',sqlerrm
    );
  end if;
  raise;
end
$$;

create or replace function public.skima_whatsapp_create_logistics_job(
  target_whatsapp_wa_id text,
  target_payload jsonb,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
  job_id uuid;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='service role required';
  end if;
  if target_payload is null or jsonb_typeof(target_payload)<>'object'
    or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='valid logistics request details and idempotency key are required';
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id=btrim(coalesce(target_whatsapp_wa_id,''))
    and link_status='linked' and profile_id is not null
  for share;
  if not found or not exists(
    select 1 from public.profiles p where p.id=contact_record.profile_id and p.status='active'
  ) then
    raise exception using errcode='42501',message='an active linked SKIMA customer is required';
  end if;

  perform set_config('request.jwt.claim.sub',contact_record.profile_id::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',contact_record.profile_id::text,'role','service_role')::text,true);

  if not public.has_accepted_current_policy('policy.customer.logistics.terms',null) then
    raise exception using errcode='55000',message='review and accept the current SKIMA Logistics Customer Terms in the Logistics app before publishing a request';
  end if;

  job_id:=public.create_logistics_job(
    target_payload||jsonb_build_object(
      'metadata',coalesce(target_payload->'metadata','{}'::jsonb)||jsonb_build_object('channel','whatsapp','origin','official_skima_whatsapp')
    ),
    target_idempotency_key
  );
  return job_id;
end
$$;

create or replace function public.skima_whatsapp_create_logistics_booking(
  target_whatsapp_wa_id text,
  target_offer_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
  booking_id uuid;
  booking_record public.logistics_bookings%rowtype;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='service role required';
  end if;
  if target_offer_id is null or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='provider offer and booking idempotency key are required';
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id=btrim(coalesce(target_whatsapp_wa_id,''))
    and link_status='linked' and profile_id is not null
  for share;
  if not found or not exists(
    select 1 from public.profiles p where p.id=contact_record.profile_id and p.status='active'
  ) then
    raise exception using errcode='42501',message='an active linked SKIMA customer is required';
  end if;

  perform set_config('request.jwt.claim.sub',contact_record.profile_id::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',contact_record.profile_id::text,'role','service_role')::text,true);

  if not exists(
    select 1
    from public.logistics_offers offer
    join public.logistics_job_requests job on job.id=offer.job_id
    where offer.id=target_offer_id
      and job.requester_user_id=contact_record.profile_id
      and offer.status='submitted'
      and (offer.expires_at is null or offer.expires_at>timezone('utc',now()))
  ) then
    raise exception using errcode='42501',message='that provider offer is not available for this linked customer''s request';
  end if;

  if not public.has_accepted_current_policy('policy.customer.logistics.terms',null) then
    raise exception using errcode='55000',message='review and accept the current SKIMA Logistics Customer Terms in the Logistics app before booking a provider';
  end if;

  booking_id:=public.create_logistics_booking_for_offer(
    target_offer_id,'online_wallet',target_idempotency_key
  );
  select * into booking_record
  from public.logistics_bookings
  where id=booking_id
    and requester_user_id=contact_record.profile_id;
  if not found then
    raise exception 'created logistics booking could not be verified for the linked customer';
  end if;

  return jsonb_build_object(
    'bookingId',booking_record.id,
    'jobId',booking_record.job_id,
    'status',booking_record.status,
    'currencyCode',booking_record.currency_code,
    'deliveryAmount',booking_record.delivery_amount,
    'customerBookingFeeAmount',booking_record.customer_booking_fee_amount,
    'totalCustomerCharge',booking_record.total_customer_charge,
    'paymentMode',booking_record.payment_mode
  );
end
$$;

create or replace function public.skima_whatsapp_pay_logistics_booking(
  target_whatsapp_wa_id text,
  target_booking_id uuid,
  target_wallet_id uuid,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
  booking_record public.logistics_bookings%rowtype;
  reservation jsonb;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='service role required';
  end if;
  if target_booking_id is null or target_wallet_id is null
    or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='logistics booking, customer wallet and idempotency key are required';
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id=btrim(coalesce(target_whatsapp_wa_id,''))
    and link_status='linked' and profile_id is not null
  for share;
  if not found or not exists(
    select 1 from public.profiles p where p.id=contact_record.profile_id and p.status='active'
  ) then
    raise exception using errcode='42501',message='an active linked SKIMA customer is required';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id=target_booking_id
    and requester_user_id=contact_record.profile_id
  for update;
  if not found then
    raise exception using errcode='42501',message='logistics booking was not found for this linked customer';
  end if;

  if not exists(
    select 1 from public.wallet_accounts w
    where w.id=target_wallet_id
      and w.owner_entity_type='user'
      and w.owner_entity_id=contact_record.profile_id
      and w.wallet_type='customer'
      and w.currency_code=booking_record.currency_code
      and w.status='active'
  ) then
    raise exception using errcode='42501',message='an active customer wallet in the booking currency is required';
  end if;

  if not public.has_accepted_current_policy('policy.customer.logistics.terms',null) then
    raise exception using errcode='55000',message='review and accept the current SKIMA Logistics Customer Terms in the Logistics app before paying for this booking';
  end if;

  reservation:=public.reserve_logistics_booking_online_payment(
    booking_record.id,
    contact_record.profile_id,
    target_wallet_id,
    target_idempotency_key
  );

  if reservation->>'status'<>'payment_reserved' then
    raise exception using errcode='55000',message='logistics booking payment has not reached the reserved state';
  end if;

  return reservation||jsonb_build_object(
    'bookingId',booking_record.id,
    'status','payment_reserved',
    'currencyCode',booking_record.currency_code,
    'totalAmount',booking_record.total_customer_charge
  );
end
$$;

create or replace function public.skima_whatsapp_cancel_logistics_booking(
  target_whatsapp_wa_id text,
  target_booking_id uuid,
  target_reason text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
  booking_id uuid;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='service role required';
  end if;
  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id=btrim(coalesce(target_whatsapp_wa_id,''))
    and link_status='linked' and profile_id is not null
  for share;
  if not found or not exists(
    select 1 from public.profiles p where p.id=contact_record.profile_id and p.status='active'
  ) then
    raise exception using errcode='42501',message='an active linked SKIMA customer is required';
  end if;
  perform set_config('request.jwt.claim.sub',contact_record.profile_id::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',contact_record.profile_id::text,'role','service_role')::text,true);
  booking_id:=public.cancel_logistics_booking_before_payment(
    target_booking_id,
    coalesce(nullif(btrim(target_reason),''),'Customer cancelled in WhatsApp'),
    target_idempotency_key
  );
  return booking_id;
end
$$;

create or replace function public.skima_whatsapp_store_checkout(
  target_whatsapp_wa_id text,
  target_line_items jsonb,
  target_wallet_id uuid,
  target_fulfillment_method text,
  target_delivery_location_id uuid,
  target_customer_note text,
  target_idempotency_key text,
  target_expected_total numeric,
  target_confirm_payment boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  contact_record public.skima_whatsapp_contacts%rowtype;
  module_id uuid;
  settings_record public.storefront_settings%rowtype;
  wallet_record public.wallet_accounts%rowtype;
  location_record public.lpg_customer_locations%rowtype;
  order_record public.order_records%rowtype;
  order_id uuid;
  line_count integer;
  persisted_count integer;
  subtotal_amount numeric(28,8);
  delivery_fee_amount numeric(28,8):=0;
  total_amount numeric(28,8);
  free_threshold numeric(28,8);
  location_snapshot jsonb:=null;
  pickup_snapshot jsonb:=null;
  default_payload jsonb;
  checkout_snapshot jsonb;
  previous_snapshot jsonb;
  updated_payload jsonb;
  funding_hold_id uuid;
begin
  if auth.role()<>'service_role' then
    raise exception using errcode='42501',message='service role required';
  end if;
  if target_line_items is null or jsonb_typeof(target_line_items)<>'array'
    or jsonb_array_length(target_line_items)=0
    or target_wallet_id is null
    or target_fulfillment_method not in ('delivery','pickup')
    or coalesce(btrim(target_idempotency_key),'')=''
    or coalesce(char_length(target_customer_note),0)>1200 then
    raise exception using errcode='22023',message='valid Store basket, wallet, fulfilment, note and idempotency key are required';
  end if;

  select * into contact_record
  from public.skima_whatsapp_contacts
  where whatsapp_wa_id=btrim(coalesce(target_whatsapp_wa_id,''))
    and link_status='linked' and profile_id is not null
  for share;
  if not found or not exists(
    select 1 from public.profiles p where p.id=contact_record.profile_id and p.status='active'
  ) then
    raise exception using errcode='42501',message='an active linked SKIMA customer is required';
  end if;

  perform set_config('request.jwt.claim.sub',contact_record.profile_id::text,true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',contact_record.profile_id::text,'role','service_role')::text,true);

  if not public.has_accepted_current_policy('policy.customer.store.terms',null) then
    raise exception using errcode='55000',message='review and accept the current SKIMA Store Customer Terms in the Store app before checkout';
  end if;

  select m.id into module_id
  from public.business_modules m
  where m.key='store' and m.status='active';
  if module_id is null then
    raise exception using errcode='55000',message='SKIMA Store is not available right now';
  end if;

  select * into settings_record
  from public.storefront_settings s
  where s.module_id=module_id and s.status='active'
  for share;
  if not found then
    raise exception using errcode='55000',message='SKIMA Store has not been activated by an administrator';
  end if;

  if not target_fulfillment_method=any(settings_record.fulfillment_methods) then
    raise exception using errcode='23514',message='the selected Store fulfilment option is not currently available';
  end if;

  select * into wallet_record
  from public.wallet_accounts w
  where w.id=target_wallet_id
    and w.wallet_type='customer'
    and w.owner_entity_type='user'
    and w.owner_entity_id=contact_record.profile_id
    and w.currency_code=settings_record.currency_code
    and w.status='active';
  if not found then
    raise exception using errcode='42501',message='an active customer wallet in the Store currency is required';
  end if;

  if target_fulfillment_method='delivery' then
    if target_delivery_location_id is null then
      raise exception using errcode='22023',message='choose a saved delivery address before Store checkout';
    end if;
    select * into location_record
    from public.lpg_customer_locations l
    where l.id=target_delivery_location_id
      and l.owner_user_id=contact_record.profile_id
      and l.status='active';
    if not found or coalesce(btrim(location_record.formatted_address),'')='' then
      raise exception using errcode='42501',message='the selected Store delivery address is not available or is incomplete';
    end if;
    location_snapshot:=jsonb_build_object(
      'id',location_record.id,
      'label',location_record.label,
      'formattedAddress',location_record.formatted_address,
      'landmark',location_record.landmark,
      'deliveryInstructions',location_record.delivery_instructions,
      'contactName',location_record.contact_name,
      'contactPhone',location_record.contact_phone
    );
  else
    if coalesce(btrim(settings_record.pickup_formatted_address),'')='' then
      raise exception using errcode='55000',message='Store customer pickup has not been configured';
    end if;
    pickup_snapshot:=jsonb_build_object(
      'label',settings_record.pickup_location_label,
      'formattedAddress',settings_record.pickup_formatted_address,
      'instructions',settings_record.pickup_instructions
    );
  end if;

  default_payload:=jsonb_build_object(
    'channel','skima_store',
    'fulfillment_method',target_fulfillment_method,
    'customer_note',nullif(btrim(coalesce(target_customer_note,'')),''),
    'delivery_location',location_snapshot,
    'pickup_location',pickup_snapshot
  );

  select * into order_record
  from public.order_records o
  where o.source='skima.store.customer'
    and o.idempotency_key=target_idempotency_key
  for update;

  if found then
    if order_record.requester_user_id<>contact_record.profile_id then
      raise exception using errcode='42501',message='Store checkout key belongs to another customer';
    end if;
    if coalesce(order_record.order_payload->>'channel','')<>'skima_store'
      or coalesce(order_record.order_payload->>'fulfillment_method','')<>target_fulfillment_method
      or coalesce(order_record.order_payload#>>'{delivery_location,id}','')<>coalesce(target_delivery_location_id::text,'')
      or coalesce(order_record.order_payload->>'customer_note','')<>coalesce(nullif(btrim(coalesce(target_customer_note,'')),''),'') then
      raise exception using errcode='23505',message='this Store checkout key already contains different order details';
    end if;
    order_id:=order_record.id;
  else
    order_id:=public.create_order_from_catalog(
      'store',
      settings_record.organization_id,
      settings_record.branch_id,
      target_line_items,
      target_fulfillment_method,
      settings_record.currency_code,
      'store.order.acceptance.manual.v1',
      default_payload,
      'skima.store.customer',
      target_idempotency_key,
      jsonb_build_object(
        'channel','skima_store',
        'storefront_module','store',
        'customer_app','skima.store.mobile'
      )
    );
    select * into order_record from public.order_records o where o.id=order_id for update;
  end if;

  if not found and order_record.id is null then
    raise exception 'Store order could not be loaded after catalogue checkout';
  end if;

  select count(*) into line_count
  from jsonb_to_recordset(target_line_items) as requested("itemId" uuid,"variantId" uuid,quantity numeric);
  select count(*) into persisted_count
  from public.order_line_items li where li.order_id=order_id;
  if line_count<>persisted_count or exists(
    select 1
    from jsonb_to_recordset(target_line_items) as requested("itemId" uuid,"variantId" uuid,quantity numeric)
    where not exists(
      select 1 from public.order_line_items li
      where li.order_id=order_id
        and li.item_id=requested."itemId"
        and li.variant_id is not distinct from requested."variantId"
        and li.quantity=requested.quantity
    )
  ) then
    raise exception using errcode='23505',message='the Store basket changed after this checkout was started; please restart checkout';
  end if;

  select coalesce(sum(li.line_amount),0) into subtotal_amount
  from public.order_line_items li where li.order_id=order_id;
  if subtotal_amount<=0 then
    raise exception using errcode='23514',message='the Store basket has no valid payable product total';
  end if;
  if subtotal_amount<coalesce(settings_record.minimum_order_amount,0) then
    raise exception using errcode='23514',message='this basket is below the Store minimum order amount';
  end if;

  previous_snapshot:=order_record.order_payload->'store_checkout_snapshot';
  if previous_snapshot is not null then
    checkout_snapshot:=previous_snapshot;
    if checkout_snapshot->>'fulfillmentMethod'<>target_fulfillment_method
      or coalesce(checkout_snapshot#>>'{deliveryLocation,id}','')<>coalesce(target_delivery_location_id::text,'') then
      raise exception using errcode='23505',message='the saved Store checkout snapshot does not match the current fulfilment choice';
    end if;
    delivery_fee_amount:=coalesce((checkout_snapshot->>'deliveryFeeAmount')::numeric,0);
  else
    if target_fulfillment_method='delivery' then
      delivery_fee_amount:=coalesce(settings_record.delivery_base_fee_amount,0);
      free_threshold:=settings_record.free_delivery_minimum_amount;
      if free_threshold is not null and subtotal_amount>=free_threshold then
        delivery_fee_amount:=0;
      end if;
    else
      delivery_fee_amount:=0;
    end if;
    checkout_snapshot:=jsonb_build_object(
      'subtotalAmount',subtotal_amount,
      'deliveryFeeAmount',delivery_fee_amount,
      'deliveryDistanceKm',null,
      'fulfillmentMethod',target_fulfillment_method,
      'deliveryLocation',location_snapshot,
      'pickupLocation',pickup_snapshot,
      'deliveryEtaMinBusinessDays',coalesce(settings_record.delivery_eta_min_business_days,2),
      'deliveryEtaMaxBusinessDays',coalesce(settings_record.delivery_eta_max_business_days,5),
      'deliveryEtaUnit','business_days',
      'deliveryEtaStartsAt','order_accepted',
      'pricingCapturedAt',timezone('utc',now())
    );
  end if;

  total_amount:=round(subtotal_amount+delivery_fee_amount,2);
  updated_payload:=coalesce(order_record.order_payload,'{}'::jsonb)||jsonb_build_object('store_checkout_snapshot',checkout_snapshot);

  update public.order_records
  set fee_amount=delivery_fee_amount,
      total_amount=total_amount,
      order_payload=updated_payload,
      metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
        'store_checkout_snapshot',checkout_snapshot,
        'storefront_module','store',
        'channel','skima_store'
      ),
      updated_at=timezone('utc',now())
  where id=order_id;

  update public.service_requests
  set request_payload=updated_payload||jsonb_build_object(
        'order_id',order_id,
        'subtotal_amount',subtotal_amount,
        'fee_amount',delivery_fee_amount,
        'total_amount',total_amount,
        'currency_code',settings_record.currency_code
      ),
      updated_at=timezone('utc',now())
  where id=order_record.service_request_id;

  if target_expected_total is null or abs(target_expected_total-total_amount)>0.01 then
    return jsonb_build_object(
      'orderId',order_id,
      'status','awaiting_confirmation',
      'requiresConfirmation',true,
      'currencyCode',settings_record.currency_code,
      'subtotalAmount',subtotal_amount,
      'deliveryFeeAmount',delivery_fee_amount,
      'totalAmount',total_amount
    );
  end if;

  if target_confirm_payment is not true then
    return jsonb_build_object(
      'orderId',order_id,
      'status','awaiting_confirmation',
      'requiresConfirmation',true,
      'currencyCode',settings_record.currency_code,
      'subtotalAmount',subtotal_amount,
      'deliveryFeeAmount',delivery_fee_amount,
      'totalAmount',total_amount
    );
  end if;

  funding_hold_id:=public.fund_order_from_wallet(
    order_id,
    target_wallet_id,
    null,
    'skima.store.checkout',
    target_idempotency_key||':funding',
    jsonb_build_object(
      'storefront_module','store',
      'channel','skima_store',
      'delivery_fee_amount',delivery_fee_amount,
      'payment_channel','customer_wallet'
    )
  );

  return jsonb_build_object(
    'orderId',order_id,
    'serviceRequestId',order_record.service_request_id,
    'escrowHoldId',funding_hold_id,
    'status','payment_reserved',
    'currencyCode',settings_record.currency_code,
    'subtotalAmount',subtotal_amount,
    'deliveryFeeAmount',delivery_fee_amount,
    'totalAmount',total_amount
  );
end
$$;

revoke all on function public.skima_whatsapp_create_fuel_order(text,uuid,text,numeric,text,text,text,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.skima_whatsapp_pay_fuel_order(text,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.skima_whatsapp_create_utility_payment(text,uuid,uuid,text,numeric,text,text) from public,anon,authenticated;
revoke all on function public.skima_whatsapp_create_logistics_job(text,jsonb,text) from public,anon,authenticated;
revoke all on function public.skima_whatsapp_create_logistics_booking(text,uuid,text) from public,anon,authenticated;
revoke all on function public.skima_whatsapp_pay_logistics_booking(text,uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.skima_whatsapp_cancel_logistics_booking(text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.skima_whatsapp_store_checkout(text,jsonb,uuid,text,uuid,text,text,numeric,boolean) from public,anon,authenticated;

grant execute on function public.skima_whatsapp_create_fuel_order(text,uuid,text,numeric,text,text,text,text,uuid,text,text) to service_role;
grant execute on function public.skima_whatsapp_pay_fuel_order(text,uuid,uuid,uuid,text) to service_role;
grant execute on function public.skima_whatsapp_create_utility_payment(text,uuid,uuid,text,numeric,text,text) to service_role;
grant execute on function public.skima_whatsapp_create_logistics_job(text,jsonb,text) to service_role;
grant execute on function public.skima_whatsapp_create_logistics_booking(text,uuid,text) to service_role;
grant execute on function public.skima_whatsapp_pay_logistics_booking(text,uuid,uuid,text) to service_role;
grant execute on function public.skima_whatsapp_cancel_logistics_booking(text,uuid,text,text) to service_role;
grant execute on function public.skima_whatsapp_store_checkout(text,jsonb,uuid,text,uuid,text,text,numeric,boolean) to service_role;

notify pgrst,'reload schema';
commit;
