begin;

-- Let an active Logistics company owner move settled company earnings into
-- their own existing SKIMA customer wallet. This is an internal balanced
-- ledger transfer; it is not a bank payout and does not use a payout provider.
-- Only the authenticated Logistics runtime (service role) may invoke this RPC.

create or replace function public.transfer_logistics_company_earnings_to_owner_wallet(
  target_organization_id uuid,
  target_owner_user_id uuid,
  target_owner_wallet_id uuid,
  target_amount numeric,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  company_wallet public.wallet_accounts%rowtype;
  owner_wallet public.wallet_accounts%rowtype;
  company_balance numeric(28,8) := 0;
  owner_balance numeric(28,8) := 0;
  currency_decimals integer;
  transaction_id uuid;
  existing_transaction public.financial_transactions%rowtype;
  transaction_metadata jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required';
  end if;

  if target_organization_id is null
    or target_owner_user_id is null
    or target_owner_wallet_id is null
    or target_amount is null
    or target_amount <= 0
    or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'company, owner, personal wallet, positive amount and valid idempotency key are required';
  end if;

  if not exists (
    select 1
    from public.logistics_provider_profiles provider
    join public.organization_memberships membership
      on membership.organization_id = provider.organization_id
     and membership.user_id = target_owner_user_id
     and membership.status = 'active'
     and membership.membership_type = 'owner'
    where provider.organization_id = target_organization_id
  ) then
    raise exception 'active Logistics company owner permission is required';
  end if;

  select * into owner_wallet
  from public.wallet_accounts
  where id = target_owner_wallet_id
    and wallet_type = 'customer'
    and owner_entity_type = 'user'
    and owner_entity_id = target_owner_user_id
    and status = 'active';
  if not found then
    raise exception 'destination must be an active personal customer wallet owned by the company owner';
  end if;

  select * into company_wallet
  from public.wallet_accounts
  where wallet_type = 'logistics_earnings'
    and owner_entity_type = 'organization'
    and owner_entity_id = target_organization_id
    and currency_code = owner_wallet.currency_code
    and status = 'active'
  order by created_at
  limit 1;
  if not found then
    raise exception 'a settled company earnings wallet in the selected currency is not available';
  end if;

  select decimal_places into currency_decimals
  from public.currency_definitions
  where code = company_wallet.currency_code
    and status = 'enabled';
  if currency_decimals is null then
    raise exception 'company earnings currency is not enabled';
  end if;
  if target_amount <> trunc(target_amount, currency_decimals) then
    raise exception 'transfer amount exceeds the currency decimal precision';
  end if;

  transaction_metadata := jsonb_build_object(
    'module_key', 'logistics_network',
    'transfer_type', 'company_earnings_to_owner_customer_wallet',
    'organization_id', target_organization_id,
    'owner_user_id', target_owner_user_id,
    'company_wallet_id', company_wallet.id,
    'owner_wallet_id', owner_wallet.id,
    'amount', target_amount,
    'currency_code', company_wallet.currency_code
  );

  select * into existing_transaction
  from public.financial_transactions
  where source = 'platform.logistics.company_earnings_owner_transfer'
    and idempotency_key = target_idempotency_key;
  if found then
    if existing_transaction.transaction_type <> 'transfer'
      or existing_transaction.subject_type <> 'logistics_company_owner_wallet_transfer'
      or existing_transaction.subject_id <> target_organization_id
      or existing_transaction.currency_code <> company_wallet.currency_code
      or existing_transaction.total_amount <> target_amount
      or existing_transaction.metadata <> transaction_metadata then
      raise exception 'transfer idempotency key has already been used with different details';
    end if;

    select coalesce(balance.balance, 0) into company_balance
    from public.wallet_balances balance
    where balance.wallet_id = company_wallet.id;
    select coalesce(balance.balance, 0) into owner_balance
    from public.wallet_balances balance
    where balance.wallet_id = owner_wallet.id;

    return jsonb_build_object(
      'transaction_id', existing_transaction.id,
      'company_wallet_id', company_wallet.id,
      'owner_wallet_id', owner_wallet.id,
      'currency_code', company_wallet.currency_code,
      'transferred_amount', target_amount,
      'company_wallet_balance', coalesce(company_balance, 0),
      'owner_wallet_balance', coalesce(owner_balance, 0),
      'idempotent_replay', true
    );
  end if;

  -- Lock both wallet accounts in the same stable order as other transfers.
  perform wallet.id
  from public.wallet_accounts wallet
  where wallet.id in (company_wallet.id, owner_wallet.id)
  order by wallet.id
  for update;

  select coalesce((
    select balance.balance
    from public.wallet_balances balance
    where balance.wallet_id = company_wallet.id
  ), 0) into company_balance;

  if company_balance < target_amount then
    raise exception 'company earnings wallet has insufficient available balance';
  end if;

  transaction_id := public.post_financial_transaction(
    'transfer',
    company_wallet.currency_code,
    'platform.logistics.company_earnings_owner_transfer',
    'logistics_company_owner_wallet_transfer',
    target_organization_id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id', company_wallet.id,
        'direction', 'debit',
        'amount', target_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object(
          'role', 'company_earnings_source',
          'organization_id', target_organization_id,
          'owner_user_id', target_owner_user_id
        )
      ),
      jsonb_build_object(
        'wallet_id', owner_wallet.id,
        'direction', 'credit',
        'amount', target_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object(
          'role', 'company_owner_destination',
          'organization_id', target_organization_id,
          'owner_user_id', target_owner_user_id
        )
      )
    ),
    target_idempotency_key,
    null,
    null,
    jsonb_build_object('module_key', 'logistics_network', 'currency_code', company_wallet.currency_code),
    transaction_metadata
  );

  select coalesce((
    select balance.balance
    from public.wallet_balances balance
    where balance.wallet_id = company_wallet.id
  ), 0) into company_balance;
  select coalesce((
    select balance.balance
    from public.wallet_balances balance
    where balance.wallet_id = owner_wallet.id
  ), 0) into owner_balance;

  return jsonb_build_object(
    'transaction_id', transaction_id,
    'company_wallet_id', company_wallet.id,
    'owner_wallet_id', owner_wallet.id,
    'currency_code', company_wallet.currency_code,
    'transferred_amount', target_amount,
    'company_wallet_balance', coalesce(company_balance, 0),
    'owner_wallet_balance', coalesce(owner_balance, 0),
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.transfer_logistics_company_earnings_to_owner_wallet(uuid,uuid,uuid,numeric,text)
  from public, anon, authenticated;
grant execute on function public.transfer_logistics_company_earnings_to_owner_wallet(uuid,uuid,uuid,numeric,text)
  to service_role;

notify pgrst,'reload schema';
commit;
