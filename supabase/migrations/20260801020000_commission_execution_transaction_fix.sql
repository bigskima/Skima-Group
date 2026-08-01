begin;

create or replace function public.execute_driver_commission(
  target_order_id uuid default null,
  target_escrow_hold_id uuid default null,
  target_driver_wallet_id uuid default null,
  target_commission_policy_key text default 'commission.driver.percentage.default',
  target_base_amount numeric default null,
  target_source text default 'platform.commission_engine',
  target_idempotency_key text default null,
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
  policy_record record;
  commission_amount numeric(28, 8);
  release_transaction_id uuid;
  execution_id uuid;
  existing_record record;
begin
  if not public.can_execute_financial_runtime() then
    raise exception 'commission execution permission is required';
  end if;

  if target_order_id is null or target_escrow_hold_id is null or target_driver_wallet_id is null then
    raise exception 'target_order_id, target_escrow_hold_id, and target_driver_wallet_id are required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select existing.*
  into existing_record
  from public.commission_executions existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if found then
    return existing_record.id;
  end if;

  select order_record_inner.*
  into order_record
  from public.order_records order_record_inner
  where order_record_inner.id = target_order_id;

  if not found then
    raise exception 'target_order_id must reference an existing order';
  end if;

  select hold.*
  into hold_record
  from public.escrow_holds hold
  where hold.id = target_escrow_hold_id
    and hold.subject_id = order_record.service_request_id
  for update;

  if not found then
    raise exception 'target_escrow_hold_id must reference an escrow hold for the order service request';
  end if;

  select policy.*
  into policy_record
  from public.commission_policies policy
  where policy.key = target_commission_policy_key
    and policy.currency_code = order_record.currency_code
    and policy.status = 'active'
  order by case policy.scope_type when 'global' then 10 else 1 end
  limit 1;

  if not found then
    raise exception 'target_commission_policy_key must reference an active commission policy';
  end if;

  commission_amount := round(
    case policy_record.calculation_mode
      when 'fixed' then policy_record.fixed_amount
      when 'percentage' then coalesce(target_base_amount, order_record.total_amount) * policy_record.percentage_rate / 100
      else policy_record.fixed_amount + coalesce(target_base_amount, order_record.total_amount) * policy_record.percentage_rate / 100
    end,
    2
  );

  if commission_amount <= 0 then
    raise exception 'calculated commission amount must be greater than zero';
  end if;

  release_transaction_id := public.release_escrow_hold(
    target_escrow_hold_id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id', target_driver_wallet_id,
        'amount', commission_amount,
        'entry_type', 'commission',
        'metadata', jsonb_build_object('role', 'driver_commission')
      )
    ),
    target_idempotency_key || ':release',
    target_source,
    target_metadata || jsonb_build_object('commission_policy_id', policy_record.id)
  );

  insert into public.commission_executions (
    service_request_id,
    order_id,
    escrow_hold_id,
    driver_wallet_id,
    commission_policy_id,
    transaction_id,
    currency_code,
    amount,
    status,
    policy_snapshot,
    source,
    idempotency_key,
    metadata,
    created_by
  )
  values (
    order_record.service_request_id,
    order_record.id,
    target_escrow_hold_id,
    target_driver_wallet_id,
    policy_record.id,
    release_transaction_id,
    order_record.currency_code,
    commission_amount,
    'posted',
    to_jsonb(policy_record),
    target_source,
    target_idempotency_key,
    target_metadata,
    auth.uid()
  )
  on conflict (source, idempotency_key) do nothing
  returning id into execution_id;

  if execution_id is not null then
    return execution_id;
  end if;

  select existing.id
  into execution_id
  from public.commission_executions existing
  where existing.source = target_source
    and existing.idempotency_key = target_idempotency_key;

  if execution_id is null then
    raise exception 'commission execution could not be recorded';
  end if;

  return execution_id;
end;
$$;

revoke all on function public.execute_driver_commission(uuid, uuid, uuid, text, numeric, text, text, jsonb) from public;
grant execute on function public.execute_driver_commission(uuid, uuid, uuid, text, numeric, text, text, jsonb) to authenticated, service_role;

commit;
