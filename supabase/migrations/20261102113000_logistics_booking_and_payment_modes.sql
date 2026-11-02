begin;

-- SKIMA Logistics booking and fee lifecycle.
-- Finance policy versions are intentionally not seeded with guessed amounts.
-- Bookings fail closed until an approved currency-specific policy version exists.

insert into public.financial_policy_definitions (
  key, display_name, policy_family, value_schema, approval_required,
  allow_partner_delegation, metadata
)
values
  (
    'fees.logistics.customer_booking',
    'Logistics customer booking fee',
    'marketplace_fee',
    '{
      "type":"object",
      "required":["fixed_amount","percentage_basis_points"],
      "properties":{
        "fixed_amount":{"type":"number","minimum":0,"description":"Fixed amount in major currency units"},
        "percentage_basis_points":{"type":"integer","minimum":0,"maximum":10000,"description":"Percentage of delivery price in basis points"}
      },
      "additionalProperties":false
    }'::jsonb,
    true,
    false,
    '{"module":"logistics_network","service":"logistics.booking","side":"customer"}'::jsonb
  ),
  (
    'fees.logistics.provider_receival',
    'Logistics provider offline booking receival fee',
    'marketplace_fee',
    '{
      "type":"object",
      "required":["fixed_amount","percentage_basis_points"],
      "properties":{
        "fixed_amount":{"type":"number","minimum":0,"description":"Fixed amount in major currency units"},
        "percentage_basis_points":{"type":"integer","minimum":0,"maximum":10000,"description":"Percentage of delivery price in basis points"}
      },
      "additionalProperties":false
    }'::jsonb,
    true,
    false,
    '{"module":"logistics_network","service":"logistics.booking","side":"provider","payment_mode":"offline"}'::jsonb
  ),
  (
    'commission.logistics.provider',
    'Logistics provider online settlement commission',
    'commission',
    '{
      "type":"object",
      "required":["fixed_amount","percentage_basis_points"],
      "properties":{
        "fixed_amount":{"type":"number","minimum":0,"description":"Fixed amount in major currency units"},
        "percentage_basis_points":{"type":"integer","minimum":0,"maximum":10000,"description":"Percentage of delivery price in basis points"}
      },
      "additionalProperties":false
    }'::jsonb,
    true,
    false,
    '{"module":"logistics_network","service":"logistics.booking","side":"provider","payment_mode":"online_wallet"}'::jsonb
  )
on conflict (key) do nothing;

create table if not exists public.logistics_bookings (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.logistics_job_requests(id) on delete restrict,
  offer_id uuid not null unique references public.logistics_offers(id) on delete restrict,
  requester_user_id uuid not null references public.profiles(id) on delete restrict,
  provider_organization_id uuid not null references public.organizations(id) on delete restrict,
  payment_mode text not null check (payment_mode in ('online_wallet', 'offline')),
  status text not null default 'awaiting_payment'
    check (status in (
      'awaiting_payment',
      'awaiting_offline_confirmation',
      'payment_reserved',
      'offline_payment_confirmed',
      'provider_accepted',
      'in_progress',
      'delivered',
      'settled',
      'completed_offline',
      'cancelled',
      'payment_failed',
      'disputed',
      'refunded'
    )),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  delivery_amount numeric(28,8) not null check (delivery_amount > 0),
  customer_booking_fee_amount numeric(28,8) not null default 0 check (customer_booking_fee_amount >= 0),
  provider_receival_fee_amount numeric(28,8) not null default 0 check (provider_receival_fee_amount >= 0),
  provider_commission_amount numeric(28,8) not null default 0 check (provider_commission_amount >= 0),
  provider_net_amount numeric(28,8) not null check (provider_net_amount >= 0),
  total_customer_charge numeric(28,8) not null check (total_customer_charge > 0),
  policy_snapshots jsonb not null check (jsonb_typeof(policy_snapshots) = 'object'),
  service_request_id uuid references public.service_requests(id) on delete restrict,
  order_id uuid references public.order_records(id) on delete restrict,
  escrow_hold_id uuid references public.escrow_holds(id) on delete restrict,
  payment_transaction_id uuid references public.financial_transactions(id) on delete restrict,
  offline_fee_transaction_id uuid references public.financial_transactions(id) on delete restrict,
  settlement_execution_id uuid references public.settlement_executions(id) on delete restrict,
  delivery_verified_at timestamptz,
  delivery_verified_by uuid references public.profiles(id) on delete set null,
  delivery_verification_snapshot jsonb not null default '{}'::jsonb
    check (jsonb_typeof(delivery_verification_snapshot) = 'object'),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (requester_user_id, idempotency_key),
  check (
    (payment_mode = 'online_wallet'
      and provider_receival_fee_amount = 0
      and provider_net_amount + provider_commission_amount = delivery_amount)
    or
    (payment_mode = 'offline'
      and provider_commission_amount = 0
      and provider_net_amount = delivery_amount)
  ),
  check (total_customer_charge = delivery_amount + customer_booking_fee_amount)
);

create unique index if not exists logistics_bookings_one_open_per_job_idx
  on public.logistics_bookings (job_id)
  where status not in ('cancelled', 'payment_failed', 'refunded');

create index if not exists logistics_bookings_customer_idx
  on public.logistics_bookings (requester_user_id, created_at desc);
create index if not exists logistics_bookings_provider_idx
  on public.logistics_bookings (provider_organization_id, status, created_at desc);

create table if not exists public.logistics_booking_events (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.logistics_bookings(id) on delete restrict,
  job_id uuid not null references public.logistics_job_requests(id) on delete restrict,
  actor_user_id uuid references public.profiles(id) on delete set null,
  event_type text not null check (event_type ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  from_status text,
  to_status text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  unique (booking_id, idempotency_key)
);

create or replace function public.calculate_logistics_policy_fee(
  target_policy_snapshot jsonb,
  target_base_amount numeric,
  target_currency_decimals integer
)
returns numeric
language plpgsql
immutable
set search_path = public
as $$
declare
  configuration jsonb;
  fixed_amount numeric;
  percentage_basis_points numeric;
  calculated numeric;
begin
  if target_policy_snapshot is null
    or jsonb_typeof(target_policy_snapshot) <> 'object'
    or target_base_amount is null
    or target_base_amount < 0
    or target_currency_decimals is null
    or target_currency_decimals not between 0 and 8 then
    raise exception 'valid policy snapshot, base amount and currency precision are required';
  end if;

  configuration := target_policy_snapshot -> 'configuration';
  if configuration is null or jsonb_typeof(configuration) <> 'object'
    or not (configuration ? 'fixed_amount')
    or not (configuration ? 'percentage_basis_points') then
    raise exception 'logistics fee policy must explicitly configure fixed_amount and percentage_basis_points';
  end if;

  begin
    fixed_amount := (configuration ->> 'fixed_amount')::numeric;
    percentage_basis_points := (configuration ->> 'percentage_basis_points')::numeric;
  exception when others then
    raise exception 'logistics fee policy amounts must be numeric';
  end;

  if fixed_amount < 0 or percentage_basis_points < 0 or percentage_basis_points > 10000
    or percentage_basis_points <> trunc(percentage_basis_points) then
    raise exception 'logistics fee policy values are outside the supported range';
  end if;

  calculated := fixed_amount + (target_base_amount * percentage_basis_points / 10000);
  return round(calculated, target_currency_decimals);
end;
$$;

create or replace function public.record_logistics_booking_event(
  target_booking_id uuid,
  target_event_type text,
  target_idempotency_key text,
  target_from_status text default null,
  target_to_status text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_record public.logistics_bookings%rowtype;
  event_id uuid;
begin
  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id;
  if not found then raise exception 'logistics booking was not found'; end if;

  if target_event_type is null or target_event_type !~ '^[a-z][a-z0-9_.:-]{2,120}$'
    or target_idempotency_key is null or btrim(target_idempotency_key) = ''
    or target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'valid booking event inputs are required';
  end if;

  insert into public.logistics_booking_events (
    booking_id, job_id, actor_user_id, event_type, from_status, to_status, idempotency_key, metadata
  )
  values (
    booking_record.id, booking_record.job_id, auth.uid(),
    target_event_type, target_from_status, target_to_status, target_idempotency_key, target_metadata
  )
  on conflict (booking_id, idempotency_key) do nothing
  returning id into event_id;

  if event_id is null then
    select id into event_id from public.logistics_booking_events
    where booking_id = target_booking_id and idempotency_key = target_idempotency_key;
  end if;
  return event_id;
end;
$$;

create or replace function public.create_logistics_booking_for_offer(
  target_offer_id uuid,
  target_payment_mode text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  offer_record public.logistics_offers%rowtype;
  job_record public.logistics_job_requests%rowtype;
  currency_decimals integer;
  delivery_amount_value numeric(28,8);
  booking_fee_policy jsonb;
  provider_receival_policy jsonb;
  provider_commission_policy jsonb;
  customer_booking_fee numeric(28,8) := 0;
  provider_receival_fee numeric(28,8) := 0;
  provider_commission numeric(28,8) := 0;
  provider_net numeric(28,8);
  total_charge numeric(28,8);
  booking_id uuid;
  request_id uuid;
  order_id uuid;
  module_id uuid;
  module_version_id uuid;
  existing_booking public.logistics_bookings%rowtype;
  snapshots jsonb;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_payment_mode is null or target_payment_mode not in ('online_wallet', 'offline') then
    raise exception 'payment mode must be online_wallet or offline';
  end if;
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'valid booking idempotency key is required';
  end if;

  select * into existing_booking
  from public.logistics_bookings
  where requester_user_id = actor and idempotency_key = target_idempotency_key;
  if found then
    if existing_booking.offer_id <> target_offer_id or existing_booking.payment_mode <> target_payment_mode then
      raise exception 'booking idempotency key was reused with different booking details';
    end if;
    return existing_booking.id;
  end if;

  select * into offer_record
  from public.logistics_offers
  where id = target_offer_id
  for update;
  if not found then raise exception 'logistics offer was not found'; end if;

  select * into job_record
  from public.logistics_job_requests
  where id = offer_record.job_id
  for update;
  if job_record.requester_user_id <> actor then
    raise exception 'only the customer who created the job may book a provider offer';
  end if;

  -- This selection and booking creation are one transaction; a missing fee policy
  -- or another booking failure rolls back selection and its event.
  perform public.select_logistics_offer(target_offer_id, target_idempotency_key || ':offer_selection');

  select currency.decimal_places into currency_decimals
  from public.currency_definitions currency
  where currency.code = offer_record.currency_code
    and currency.status = 'enabled';
  if currency_decimals is null then raise exception 'offer currency is not enabled'; end if;

  delivery_amount_value := offer_record.delivery_price_minor / power(10::numeric, currency_decimals);
  if delivery_amount_value <= 0 then raise exception 'provider offer amount is invalid'; end if;

  booking_fee_policy := public.resolve_financial_policy(
    'fees.logistics.customer_booking', offer_record.currency_code, timezone('utc', now()),
    'logistics_network', offer_record.organization_id, 'logistics.booking', 'global', null
  );
  customer_booking_fee := public.calculate_logistics_policy_fee(
    booking_fee_policy, delivery_amount_value, currency_decimals
  );

  if target_payment_mode = 'offline' then
    provider_receival_policy := public.resolve_financial_policy(
      'fees.logistics.provider_receival', offer_record.currency_code, timezone('utc', now()),
      'logistics_network', offer_record.organization_id, 'logistics.booking', 'global', null
    );
    provider_receival_fee := public.calculate_logistics_policy_fee(
      provider_receival_policy, delivery_amount_value, currency_decimals
    );
  else
    provider_commission_policy := public.resolve_financial_policy(
      'commission.logistics.provider', offer_record.currency_code, timezone('utc', now()),
      'logistics_network', offer_record.organization_id, 'logistics.booking', 'global', null
    );
    provider_commission := public.calculate_logistics_policy_fee(
      provider_commission_policy, delivery_amount_value, currency_decimals
    );
    if provider_commission > delivery_amount_value then
      raise exception 'provider commission cannot exceed the delivery price';
    end if;
  end if;

  provider_net := delivery_amount_value - provider_commission;
  total_charge := delivery_amount_value + customer_booking_fee;
  if target_payment_mode = 'online_wallet' and provider_net <= 0 then
    raise exception 'online provider net amount must be positive';
  end if;

  select module.id, version.id
  into module_id, module_version_id
  from public.business_modules module
  join public.business_module_versions version on version.module_id = module.id
  where module.key = 'logistics_network'
    and module.status = 'active'
    and version.status = 'active'
  order by version.version desc
  limit 1;
  if module_id is null or module_version_id is null then
    raise exception 'an active SKIMA Logistics module version is required';
  end if;

  booking_id := gen_random_uuid();
  snapshots := jsonb_strip_nulls(jsonb_build_object(
    'customerBooking', booking_fee_policy,
    'providerReceival', provider_receival_policy,
    'providerCommission', provider_commission_policy,
    'paymentMode', target_payment_mode,
    'currencyDecimals', currency_decimals,
    'deliveryAmount', delivery_amount_value,
    'customerBookingFeeAmount', customer_booking_fee,
    'providerReceivalFeeAmount', provider_receival_fee,
    'providerCommissionAmount', provider_commission,
    'providerNetAmount', provider_net
  ));

  insert into public.service_requests (
    module_id, module_version_id, requester_user_id, organization_id,
    status, request_payload, participants, source, idempotency_key, metadata
  )
  values (
    module_id, module_version_id, actor, offer_record.organization_id,
    'requested',
    jsonb_build_object(
      'module_key', 'logistics_network',
      'booking_id', booking_id,
      'job_id', job_record.id,
      'offer_id', offer_record.id,
      'provider_organization_id', offer_record.organization_id,
      'payment_mode', target_payment_mode,
      'currency_code', offer_record.currency_code,
      'delivery_amount', delivery_amount_value,
      'customer_booking_fee_amount', customer_booking_fee
    ),
    jsonb_build_object(
      'customer_user_id', actor,
      'provider_organization_id', offer_record.organization_id
    ),
    'platform.logistics.bookings',
    target_idempotency_key || ':request',
    jsonb_build_object('logistics_booking_id', booking_id, 'policy_snapshots', snapshots)
  )
  returning id into request_id;

  insert into public.order_records (
    service_request_id, module_id, module_version_id, organization_id,
    requester_user_id, status, fulfillment_method, currency_code,
    subtotal_amount, fee_amount, discount_amount, tax_amount, total_amount,
    order_payload, source, idempotency_key, metadata, created_by
  )
  values (
    request_id, module_id, module_version_id, offer_record.organization_id,
    actor, 'received', 'provider_logistics', offer_record.currency_code,
    delivery_amount_value, customer_booking_fee, 0, 0, total_charge,
    jsonb_build_object(
      'booking_id', booking_id,
      'job_id', job_record.id,
      'offer_id', offer_record.id,
      'payment_mode', target_payment_mode,
      'provider_organization_id', offer_record.organization_id
    ),
    'platform.logistics.bookings',
    target_idempotency_key || ':order',
    jsonb_build_object('policy_snapshots', snapshots),
    actor
  )
  returning id into order_id;

  insert into public.logistics_bookings (
    id, job_id, offer_id, requester_user_id, provider_organization_id,
    payment_mode, status, currency_code, delivery_amount,
    customer_booking_fee_amount, provider_receival_fee_amount,
    provider_commission_amount, provider_net_amount, total_customer_charge,
    policy_snapshots, service_request_id, order_id, idempotency_key, metadata
  )
  values (
    booking_id, job_record.id, offer_record.id, actor, offer_record.organization_id,
    target_payment_mode,
    case when target_payment_mode = 'online_wallet' then 'awaiting_payment' else 'awaiting_offline_confirmation' end,
    offer_record.currency_code, delivery_amount_value, customer_booking_fee,
    provider_receival_fee, provider_commission, provider_net, total_charge,
    snapshots, request_id, order_id, target_idempotency_key,
    jsonb_build_object('source', 'offer_selection')
  );

  update public.logistics_job_requests
  set status = 'booked', updated_at = timezone('utc', now())
  where id = job_record.id;

  perform public.record_logistics_booking_event(
    booking_id, 'logistics.booking.created', target_idempotency_key || ':created',
    'booking_pending',
    case when target_payment_mode = 'online_wallet' then 'awaiting_payment' else 'awaiting_offline_confirmation' end,
    jsonb_build_object(
      'offer_id', offer_record.id,
      'payment_mode', target_payment_mode,
      'delivery_amount', delivery_amount_value,
      'customer_booking_fee_amount', customer_booking_fee,
      'provider_receival_fee_amount', provider_receival_fee,
      'provider_commission_amount', provider_commission
    )
  );

  perform public.record_logistics_job_event(
    job_record.id, 'logistics.booking.created', target_idempotency_key || ':job_event',
    'booking_pending', 'booked',
    jsonb_build_object('booking_id', booking_id, 'payment_mode', target_payment_mode)
  );

  return booking_id;
end;
$$;

create or replace function public.mark_logistics_booking_payment_reserved(
  target_booking_id uuid,
  target_requester_user_id uuid,
  target_escrow_hold_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_record public.logistics_bookings%rowtype;
  hold_record public.escrow_holds%rowtype;
begin
  if auth.role() <> 'service_role' then raise exception 'service role is required'; end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;
  if not found or booking_record.requester_user_id <> target_requester_user_id then
    raise exception 'logistics booking was not found for the authenticated customer';
  end if;

  select * into hold_record
  from public.escrow_holds
  where id = target_escrow_hold_id
    and subject_type = 'service_request'
    and subject_id = booking_record.service_request_id
  for update;
  if not found then raise exception 'the payment hold does not belong to this logistics booking'; end if;

  if hold_record.hold_amount <> booking_record.total_customer_charge
    or hold_record.currency_code <> booking_record.currency_code then
    raise exception 'escrow hold does not match the locked logistics booking total';
  end if;

  if booking_record.status = 'payment_reserved' then
    if booking_record.escrow_hold_id <> hold_record.id then
      raise exception 'booking was already funded by a different escrow hold';
    end if;
    return booking_record.id;
  end if;
  if booking_record.status <> 'awaiting_payment' then
    raise exception 'logistics booking is not awaiting online payment';
  end if;

  update public.logistics_bookings
  set status = 'payment_reserved',
      escrow_hold_id = hold_record.id,
      payment_transaction_id = hold_record.source_transaction_id,
      updated_at = timezone('utc', now())
  where id = booking_record.id;

  perform public.record_logistics_booking_event(
    booking_record.id, 'logistics.booking.payment_reserved',
    'payment_reserved:' || hold_record.id::text,
    booking_record.status, 'payment_reserved',
    jsonb_build_object('escrow_hold_id', hold_record.id, 'transaction_id', hold_record.source_transaction_id)
  );

  return booking_record.id;
end;
$$;

create or replace function public.confirm_logistics_offline_booking_payment(
  target_booking_id uuid,
  target_requester_user_id uuid,
  target_customer_wallet_id uuid,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  booking_record public.logistics_bookings%rowtype;
  customer_wallet public.wallet_accounts%rowtype;
  provider_wallet_id uuid;
  revenue_wallet_id uuid;
  customer_balance numeric(28,8) := 0;
  provider_balance numeric(28,8) := 0;
  total_fee_amount numeric(28,8) := 0;
  transaction_entries jsonb := '[]'::jsonb;
  fee_transaction_id uuid;
begin
  if auth.role() <> 'service_role' then raise exception 'service role is required'; end if;
  if target_idempotency_key is null or char_length(btrim(target_idempotency_key)) < 8 then
    raise exception 'valid idempotency key is required';
  end if;

  select * into booking_record
  from public.logistics_bookings
  where id = target_booking_id
  for update;
  if not found or booking_record.requester_user_id <> target_requester_user_id then
    raise exception 'logistics booking was not found for the authenticated customer';
  end if;

  if booking_record.payment_mode <> 'offline' then
    raise exception 'offline fee collection is not allowed for an online-wallet booking';
  end if;
  if booking_record.status = 'offline_payment_confirmed' then
    if booking_record.offline_fee_transaction_id is not null then
      return booking_record.offline_fee_transaction_id;
    end if;
    return booking_record.id;
  end if;
  if booking_record.status <> 'awaiting_offline_confirmation' then
    raise exception 'logistics booking is not awaiting offline payment confirmation';
  end if;

  select * into customer_wallet
  from public.wallet_accounts
  where id = target_customer_wallet_id
    and wallet_type = 'customer'
    and owner_entity_type = 'user'
    and owner_entity_id = target_requester_user_id
    and currency_code = booking_record.currency_code
    and status = 'active';
  if not found then raise exception 'an active customer wallet owned by this customer is required'; end if;

  provider_wallet_id := public.ensure_wallet_account(
    'partner', 'organization', booking_record.provider_organization_id, booking_record.currency_code,
    'platform.logistics.wallet_engine',
    jsonb_build_object('module_key', 'logistics_network', 'wallet_role', 'provider'),
    'logistics-provider:' || booking_record.provider_organization_id::text || ':' || booking_record.currency_code
  );

  revenue_wallet_id := public.ensure_platform_purpose_wallet(
    'platform_revenue', 'logistics_marketplace_fees', booking_record.currency_code,
    'platform.logistics.wallet_engine',
    'logistics-revenue:' || booking_record.currency_code
  );

  select coalesce(balance.balance, 0) into customer_balance
  from public.wallet_balances balance
  where balance.wallet_id = customer_wallet.id;

  select coalesce(balance.balance, 0) into provider_balance
  from public.wallet_balances balance
  where balance.wallet_id = provider_wallet_id;

  if booking_record.customer_booking_fee_amount > 0
    and customer_balance < booking_record.customer_booking_fee_amount then
    raise exception 'customer wallet has insufficient balance for the Logistics booking fee';
  end if;
  if booking_record.provider_receival_fee_amount > 0
    and provider_balance < booking_record.provider_receival_fee_amount then
    raise exception 'provider company wallet has insufficient balance for its offline receival fee';
  end if;

  if booking_record.customer_booking_fee_amount > 0 then
    transaction_entries := transaction_entries || jsonb_build_array(jsonb_build_object(
      'wallet_id', customer_wallet.id,
      'direction', 'debit',
      'amount', booking_record.customer_booking_fee_amount,
      'entry_type', 'fee',
      'metadata', jsonb_build_object('role', 'customer_booking_fee', 'booking_id', booking_record.id)
    ));
    total_fee_amount := total_fee_amount + booking_record.customer_booking_fee_amount;
  end if;

  if booking_record.provider_receival_fee_amount > 0 then
    transaction_entries := transaction_entries || jsonb_build_array(jsonb_build_object(
      'wallet_id', provider_wallet_id,
      'direction', 'debit',
      'amount', booking_record.provider_receival_fee_amount,
      'entry_type', 'fee',
      'metadata', jsonb_build_object('role', 'provider_offline_receival_fee', 'booking_id', booking_record.id)
    ));
    total_fee_amount := total_fee_amount + booking_record.provider_receival_fee_amount;
  end if;

  if total_fee_amount > 0 then
    transaction_entries := transaction_entries || jsonb_build_array(jsonb_build_object(
      'wallet_id', revenue_wallet_id,
      'direction', 'credit',
      'amount', total_fee_amount,
      'entry_type', 'fee',
      'metadata', jsonb_build_object('role', 'logistics_marketplace_fee_revenue', 'booking_id', booking_record.id)
    ));

    fee_transaction_id := public.post_financial_transaction(
      'fee',
      booking_record.currency_code,
      'platform.logistics.offline_booking_fees',
      'logistics_booking',
      booking_record.id,
      transaction_entries,
      target_idempotency_key,
      null,
      null,
      booking_record.policy_snapshots,
      jsonb_build_object(
        'booking_id', booking_record.id,
        'requester_user_id', target_requester_user_id,
        'payment_mode', 'offline',
        'fee_collection', 'customer_booking_and_provider_receival'
      )
    );
  end if;

  update public.logistics_bookings
  set status = 'offline_payment_confirmed',
      offline_fee_transaction_id = fee_transaction_id,
      updated_at = timezone('utc', now())
  where id = booking_record.id;

  update public.service_requests
  set status = 'workflow_started', updated_at = timezone('utc', now())
  where id = booking_record.service_request_id;

  update public.order_records
  set status = 'accepted', accepted_at = coalesce(accepted_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = booking_record.order_id;

  perform public.record_logistics_booking_event(
    booking_record.id, 'logistics.booking.offline_payment_confirmed',
    target_idempotency_key || ':event',
    booking_record.status, 'offline_payment_confirmed',
    jsonb_build_object(
      'customer_booking_fee_amount', booking_record.customer_booking_fee_amount,
      'provider_receival_fee_amount', booking_record.provider_receival_fee_amount,
      'fee_transaction_id', fee_transaction_id
    )
  );

  return coalesce(fee_transaction_id, booking_record.id);
end;
$$;

alter table public.logistics_bookings enable row level security;
alter table public.logistics_booking_events enable row level security;

create policy logistics_bookings_read_customer_or_provider
on public.logistics_bookings for select to authenticated
using (
  requester_user_id = auth.uid()
  or public.can_read_logistics_company(provider_organization_id)
  or public.has_permission('logistics.marketplace.read', null)
  or public.has_permission('logistics.marketplace.manage', null)
);
create policy logistics_bookings_no_direct_insert
on public.logistics_bookings for insert to authenticated with check (false);
create policy logistics_bookings_no_direct_update
on public.logistics_bookings for update to authenticated using (false) with check (false);
create policy logistics_bookings_no_direct_delete
on public.logistics_bookings for delete to authenticated using (false);

create policy logistics_booking_events_read_customer_or_provider
on public.logistics_booking_events for select to authenticated
using (
  exists (
    select 1 from public.logistics_bookings booking
    where booking.id = logistics_booking_events.booking_id
      and (
        booking.requester_user_id = auth.uid()
        or public.can_read_logistics_company(booking.provider_organization_id)
        or public.has_permission('logistics.marketplace.manage', null)
      )
  )
);
create policy logistics_booking_events_no_direct_insert
on public.logistics_booking_events for insert to authenticated with check (false);
create policy logistics_booking_events_no_direct_update
on public.logistics_booking_events for update to authenticated using (false) with check (false);
create policy logistics_booking_events_no_direct_delete
on public.logistics_booking_events for delete to authenticated using (false);

grant select on public.logistics_bookings, public.logistics_booking_events to authenticated, service_role;

revoke all on function public.calculate_logistics_policy_fee(jsonb,numeric,integer) from public,anon,authenticated;
revoke all on function public.record_logistics_booking_event(uuid,text,text,text,text,jsonb) from public,anon,authenticated;
revoke all on function public.create_logistics_booking_for_offer(uuid,text,text) from public,anon;
revoke all on function public.mark_logistics_booking_payment_reserved(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.confirm_logistics_offline_booking_payment(uuid,uuid,uuid,text) from public,anon,authenticated;

grant execute on function public.create_logistics_booking_for_offer(uuid,text,text) to authenticated,service_role;
grant execute on function public.mark_logistics_booking_payment_reserved(uuid,uuid,uuid) to service_role;
grant execute on function public.confirm_logistics_offline_booking_payment(uuid,uuid,uuid,text) to service_role;

notify pgrst,'reload schema';
commit;
