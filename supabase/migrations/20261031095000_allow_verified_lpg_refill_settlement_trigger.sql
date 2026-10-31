begin;

CREATE OR REPLACE FUNCTION public.execute_service_request_settlement(target_service_request_id uuid, target_escrow_hold_id uuid, target_distribution jsonb, target_idempotency_key text, target_source text DEFAULT 'platform.settlement_engine'::text, target_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  request_record record;
  hold_record record;
  parsed_beneficiary record;
  total_release_amount numeric(28, 8) := 0;
  beneficiary_amount numeric(28, 8);
  beneficiary_wallet_id uuid;
  transaction_entries jsonb := '[]'::jsonb;
  settlement_execution_id uuid;
  transaction_id uuid;
  existing_record record;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.settlement.execute', null)
    and not public.can_execute_platform_runtime()
    and not (
      pg_trigger_depth() > 0
      and target_source = 'lpg.settlement_engine'
      and target_metadata ->> 'automatic_refill_settlement' = 'true'
      and exists (
        select 1
        from public.lpg_refill_orders lpg_order
        join public.lpg_order_events refill_event
          on refill_event.lpg_order_id = lpg_order.id
         and refill_event.id::text = target_metadata ->> 'source_event_id'
         and refill_event.event_type = 'lpg.refill.confirmed'
         and refill_event.to_status = 'refill_confirmed'
        join public.lpg_refill_records refill_record
          on refill_record.lpg_order_id = lpg_order.id
         and refill_record.id::text = refill_event.metadata ->> 'refill_record_id'
        where lpg_order.id::text = target_metadata ->> 'lpg_order_id'
          and lpg_order.service_request_id = target_service_request_id
          and lpg_order.escrow_hold_id = target_escrow_hold_id
          and lpg_order.status = 'refill_confirmed'
          and lpg_order.actual_kg = refill_record.actual_kg
      )
    ) then
    raise exception 'settlement execution permission is required';
  end if;

  if target_service_request_id is null or target_escrow_hold_id is null then
    raise exception 'target_service_request_id and target_escrow_hold_id are required';
  end if;

  if target_distribution is null
    or jsonb_typeof(target_distribution) <> 'array'
    or jsonb_array_length(target_distribution) = 0 then
    raise exception 'target_distribution must be a non-empty JSON array';
  end if;

  if target_idempotency_key is null
    or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_source is null
    or target_source !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_source must be a valid platform key';
  end if;

  if target_metadata is null
    or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select request.*
  into request_record
  from public.service_requests request
  where request.id = target_service_request_id
  for update;

  if not found then
    raise exception 'target_service_request_id must reference an existing service request';
  end if;

  select hold.*
  into hold_record
  from public.escrow_holds hold
  where hold.id = target_escrow_hold_id
    and hold.subject_type = 'service_request'
    and hold.subject_id = target_service_request_id
  for update;

  if not found then
    raise exception 'target_escrow_hold_id must reference an escrow hold for the service request';
  end if;

  if hold_record.status not in ('held', 'partially_released') then
    if hold_record.status = 'released' then
      select existing.*
      into existing_record
      from public.settlement_executions existing
      where existing.source = target_source
        and existing.idempotency_key = target_idempotency_key;

      if found then
        return existing_record.id;
      end if;
    end if;

    raise exception 'escrow hold cannot be settled from its current status';
  end if;

  select existing.*
  into existing_record
  from public.settlement_executions existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    if existing_record.service_request_id <> target_service_request_id
      or existing_record.escrow_hold_id <> target_escrow_hold_id
      or existing_record.distribution <> target_distribution then
      raise exception 'target_idempotency_key has already been used with different settlement details';
    end if;

    return existing_record.id;
  end if;

  for parsed_beneficiary in
    select parsed.value
    from jsonb_array_elements(target_distribution) parsed(value)
  loop
    begin
      beneficiary_wallet_id := (parsed_beneficiary.value ->> 'wallet_id')::uuid;
      beneficiary_amount := (parsed_beneficiary.value ->> 'amount')::numeric(28, 8);
    exception
      when others then
        raise exception 'each distribution entry must include valid wallet_id and amount';
    end;

    if beneficiary_amount <= 0 then
      raise exception 'each distribution amount must be greater than zero';
    end if;

    if not exists (
      select 1
      from public.wallet_accounts wallet
      where wallet.id = beneficiary_wallet_id
        and wallet.status = 'active'
        and wallet.currency_code = hold_record.currency_code
    ) then
      raise exception 'each distribution wallet must be active and match escrow currency';
    end if;

    total_release_amount := total_release_amount + beneficiary_amount;
    transaction_entries := transaction_entries || jsonb_build_array(
      jsonb_build_object(
        'wallet_id',
        beneficiary_wallet_id,
        'direction',
        'credit',
        'amount',
        beneficiary_amount,
        'entry_type',
        coalesce(parsed_beneficiary.value ->> 'entry_type', 'principal'),
        'metadata',
        coalesce(parsed_beneficiary.value -> 'metadata', '{}'::jsonb)
      )
    );
  end loop;

  if total_release_amount <= 0 then
    raise exception 'settlement distribution total must be greater than zero';
  end if;

  if total_release_amount > hold_record.hold_amount - hold_record.released_amount then
    raise exception 'settlement distribution exceeds available escrow balance';
  end if;

  transaction_entries := jsonb_build_array(
    jsonb_build_object(
      'wallet_id',
      hold_record.wallet_id,
      'direction',
      'debit',
      'amount',
      total_release_amount,
      'entry_type',
      'principal',
      'metadata',
      jsonb_build_object('role', 'escrow')
    )
  ) || transaction_entries;

  transaction_id := public.post_financial_transaction(
    'release',
    hold_record.currency_code,
    target_source,
    'service_request',
    target_service_request_id,
    transaction_entries,
    target_idempotency_key || ':financial',
    null,
    null,
    jsonb_build_object('settlement_policy_id', request_record.settlement_policy_id),
    target_metadata
  );

  insert into public.settlement_executions (
    service_request_id,
    escrow_hold_id,
    settlement_policy_id,
    transaction_id,
    status,
    currency_code,
    gross_amount,
    distribution,
    policy_snapshot,
    source,
    idempotency_key,
    created_by
  )
  values (
    target_service_request_id,
    target_escrow_hold_id,
    request_record.settlement_policy_id,
    transaction_id,
    'posted',
    hold_record.currency_code,
    total_release_amount,
    target_distribution,
    coalesce(target_metadata -> 'policy_snapshot', '{}'::jsonb),
    target_source,
    target_idempotency_key,
    auth.uid()
  )
  returning id into settlement_execution_id;

  update public.escrow_holds
  set released_amount = released_amount + total_release_amount,
      status = case
        when released_amount + total_release_amount = hold_amount then 'released'
        else 'partially_released'
      end,
      updated_at = timezone('utc', now())
  where id = target_escrow_hold_id;

  update public.service_requests
  set status = case
        when total_release_amount = hold_record.hold_amount - hold_record.released_amount then 'settled'
        else status
      end,
      updated_at = timezone('utc', now())
  where id = target_service_request_id;

  if request_record.workflow_instance_id is not null then
    perform public.process_service_request_event(
      target_service_request_id,
      'event.settlement.released',
      target_metadata || jsonb_build_object(
        'settlement_execution_id',
        settlement_execution_id,
        'transaction_id',
        transaction_id
      ),
      target_idempotency_key || ':workflow'
    );
  end if;

  insert into public.service_request_events (
    service_request_id,
    event_type_key,
    event_id,
    status,
    idempotency_key,
    metadata
  )
  values (
    target_service_request_id,
    'event.settlement.released',
    null,
    'settled',
    target_idempotency_key || ':settled',
    target_metadata || jsonb_build_object(
      'settlement_execution_id',
      settlement_execution_id,
      'transaction_id',
      transaction_id,
      'gross_amount',
      total_release_amount
    )
  )
  on conflict do nothing;

  return settlement_execution_id;
end;
$function$
;

comment on function public.execute_service_request_settlement(uuid,uuid,jsonb,text,text,jsonb) is
  'Executes a settlement only for authorized platform actors or for an internal LPG refill trigger carrying a matching confirmed order, refill record and escrow hold.';

commit;
