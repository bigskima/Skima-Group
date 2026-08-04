-- LPG bounded-context bridge for reserving customer funds through the generic escrow engine.

create or replace function public.reserve_lpg_refill_order_payment(
  target_lpg_order_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_customer_wallet_id uuid default null,
  target_escrow_wallet_id uuid default null,
  target_source text default 'lpg.payment_api',
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record record;
  hold_record record;
  customer_wallet_record record;
  escrow_wallet_record record;
  resolved_customer_wallet_id uuid;
  resolved_escrow_wallet_id uuid;
  created_escrow_hold_id uuid;
  reservation_metadata jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required to reserve LPG order payment';
  end if;

  if target_lpg_order_id is null then
    raise exception 'target_lpg_order_id is required';
  end if;

  if target_actor_user_id is null then
    raise exception 'target_actor_user_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_source is null or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select
    target_order.*,
    quote.status as quote_status,
    quote.total_amount as quote_total_amount,
    quote.currency_code as quote_currency_code,
    request.status as service_request_status,
    request.escrow_hold_id as service_request_escrow_hold_id
  into order_record
  from public.lpg_refill_orders target_order
  join public.price_quotes quote on quote.id = target_order.price_quote_id
  join public.service_requests request on request.id = target_order.service_request_id
  where target_order.id = target_lpg_order_id
  for update of target_order, request;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG refill order';
  end if;

  if order_record.customer_user_id <> target_actor_user_id then
    raise exception 'target_actor_user_id must match LPG order customer';
  end if;

  if order_record.payment_status = 'reserved' then
    if order_record.escrow_hold_id is null then
      raise exception 'LPG order payment status is reserved without an escrow hold';
    end if;

    select hold.*
    into hold_record
    from public.escrow_holds hold
    where hold.id = order_record.escrow_hold_id;

    if not found then
      raise exception 'LPG order escrow hold is missing';
    end if;

    if hold_record.subject_type <> 'service_request'
      or hold_record.subject_id <> order_record.service_request_id
      or hold_record.currency_code <> order_record.currency_code
      or hold_record.hold_amount <> order_record.total_amount then
      raise exception 'LPG order escrow hold is inconsistent';
    end if;

    return order_record.id;
  end if;

  if order_record.payment_status <> 'pending' then
    raise exception 'LPG order payment cannot be reserved from its current payment status';
  end if;

  if order_record.status <> 'awaiting_payment' then
    raise exception 'LPG order cannot reserve payment from its current status';
  end if;

  if order_record.quote_status <> 'accepted' then
    raise exception 'LPG order price quote must be accepted before payment reservation';
  end if;

  if order_record.quote_currency_code <> order_record.currency_code
    or order_record.quote_total_amount <> order_record.total_amount then
    raise exception 'LPG order amount must match its accepted platform quote';
  end if;

  if target_customer_wallet_id is null then
    resolved_customer_wallet_id := public.ensure_wallet_account(
      'customer',
      'user',
      order_record.customer_user_id,
      order_record.currency_code,
      'platform.wallet_engine',
      jsonb_build_object(
        'bounded_context',
        'lpg',
        'purpose',
        'customer_payment_wallet',
        'lpg_order_id',
        order_record.id
      ),
      target_source || ':' || target_idempotency_key || ':customer-wallet'
    );
  else
    resolved_customer_wallet_id := target_customer_wallet_id;
  end if;

  select wallet.*
  into customer_wallet_record
  from public.wallet_accounts wallet
  where wallet.id = resolved_customer_wallet_id
    and wallet.status = 'active';

  if not found then
    raise exception 'target_customer_wallet_id must reference an active wallet';
  end if;

  if customer_wallet_record.wallet_type <> 'customer'
    or customer_wallet_record.owner_entity_type <> 'user'
    or customer_wallet_record.owner_entity_id <> order_record.customer_user_id then
    raise exception 'target_customer_wallet_id must reference the LPG order customer wallet';
  end if;

  if customer_wallet_record.currency_code <> order_record.currency_code then
    raise exception 'target_customer_wallet_id currency must match the LPG order currency';
  end if;

  if target_escrow_wallet_id is null then
    resolved_escrow_wallet_id := public.ensure_wallet_account(
      'escrow',
      'escrow',
      order_record.service_request_id,
      order_record.currency_code,
      'platform.wallet_engine',
      jsonb_build_object(
        'bounded_context',
        'lpg',
        'purpose',
        'service_request_escrow_wallet',
        'lpg_order_id',
        order_record.id,
        'service_request_id',
        order_record.service_request_id
      ),
      target_source || ':' || target_idempotency_key || ':escrow-wallet'
    );
  else
    resolved_escrow_wallet_id := target_escrow_wallet_id;
  end if;

  select wallet.*
  into escrow_wallet_record
  from public.wallet_accounts wallet
  where wallet.id = resolved_escrow_wallet_id
    and wallet.status = 'active';

  if not found then
    raise exception 'target_escrow_wallet_id must reference an active wallet';
  end if;

  if escrow_wallet_record.wallet_type <> 'escrow'
    or escrow_wallet_record.owner_entity_type <> 'escrow'
    or escrow_wallet_record.owner_entity_id <> order_record.service_request_id then
    raise exception 'target_escrow_wallet_id must reference the LPG service request escrow wallet';
  end if;

  if escrow_wallet_record.currency_code <> order_record.currency_code then
    raise exception 'target_escrow_wallet_id currency must match the LPG order currency';
  end if;

  reservation_metadata := target_metadata || jsonb_build_object(
    'bounded_context',
    'lpg',
    'lpg_order_id',
    order_record.id,
    'lpg_public_reference',
    order_record.public_reference,
    'service_request_id',
    order_record.service_request_id,
    'price_quote_id',
    order_record.price_quote_id,
    'customer_user_id',
    order_record.customer_user_id,
    'customer_wallet_id',
    resolved_customer_wallet_id,
    'escrow_wallet_id',
    resolved_escrow_wallet_id
  );

  created_escrow_hold_id := public.create_escrow_hold(
    order_record.service_request_id,
    resolved_customer_wallet_id,
    resolved_escrow_wallet_id,
    target_idempotency_key || ':escrow-hold',
    target_source,
    reservation_metadata
  );

  update public.lpg_refill_orders
  set escrow_hold_id = created_escrow_hold_id,
      payment_status = 'reserved',
      status = 'payment_reserved',
      metadata = metadata || jsonb_build_object(
        'payment_reservation',
        jsonb_build_object(
          'reserved_at',
          timezone('utc', now()),
          'escrow_hold_id',
          created_escrow_hold_id,
          'customer_wallet_id',
          resolved_customer_wallet_id,
          'escrow_wallet_id',
          resolved_escrow_wallet_id,
          'idempotency_key',
          target_idempotency_key,
          'source',
          target_source
        )
      ),
      updated_at = timezone('utc', now())
  where id = order_record.id;

  update public.service_requests
  set status = 'payment_reserved',
      metadata = metadata || jsonb_build_object(
        'lpg_payment_reservation',
        jsonb_build_object(
          'lpg_order_id',
          order_record.id,
          'escrow_hold_id',
          created_escrow_hold_id,
          'reserved_at',
          timezone('utc', now())
        )
      ),
      updated_at = timezone('utc', now())
  where id = order_record.service_request_id;

  perform public.record_lpg_order_event(
    order_record.id,
    'lpg.payment.reserved',
    order_record.status,
    'payment_reserved',
    target_idempotency_key || ':payment-reserved',
    reservation_metadata || jsonb_build_object('escrow_hold_id', created_escrow_hold_id)
  );

  return order_record.id;
end;
$$;

revoke all on function public.reserve_lpg_refill_order_payment(uuid, uuid, text, uuid, uuid, text, jsonb) from public;
revoke all on function public.reserve_lpg_refill_order_payment(uuid, uuid, text, uuid, uuid, text, jsonb) from anon;
revoke all on function public.reserve_lpg_refill_order_payment(uuid, uuid, text, uuid, uuid, text, jsonb) from authenticated;
grant execute on function public.reserve_lpg_refill_order_payment(uuid, uuid, text, uuid, uuid, text, jsonb) to service_role;
