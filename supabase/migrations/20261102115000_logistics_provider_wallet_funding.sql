begin;

-- Allows a verified company owner to move funds from their own customer wallet
-- into the company's partner wallet, so configured offline receival fees have
-- a real source of funds. This is an internal ledger transfer, not a customer
-- payment or platform fee. Only the authenticated Edge Function may invoke it.

create or replace function public.fund_logistics_provider_wallet_from_customer_wallet(
  target_organization_id uuid,
  target_customer_user_id uuid,
  target_customer_wallet_id uuid,
  target_amount numeric,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_wallet public.wallet_accounts%rowtype;
  provider_wallet_id uuid;
  customer_balance numeric(28,8) := 0;
  provider_balance numeric(28,8) := 0;
  currency_decimals integer;
  transaction_id uuid;
  existing_transaction public.financial_transactions%rowtype;
  transaction_metadata jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required';
  end if;

  if target_organization_id is null
    or target_customer_user_id is null
    or target_customer_wallet_id is null
    or target_amount is null
    or target_amount <= 0
    or target_idempotency_key is null
    or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'company, owner, customer wallet, positive amount and valid idempotency key are required';
  end if;

  if not exists (
    select 1
    from public.logistics_provider_profiles provider
    join public.organization_memberships membership
      on membership.organization_id = provider.organization_id
     and membership.user_id = target_customer_user_id
     and membership.status = 'active'
     and membership.membership_type = 'owner'
    where provider.organization_id = target_organization_id
  ) and not exists (
    select 1
    from public.logistics_provider_profiles provider
    join public.organization_memberships membership
      on membership.organization_id = provider.organization_id
     and membership.user_id = target_customer_user_id
     and membership.status = 'active'
    where provider.organization_id = target_organization_id
      and public.has_permission(
        'business.logistics.company.manage',
        target_organization_id
      )
  ) then
    raise exception 'active logistics company owner permission is required to fund this wallet';
  end if;

  select * into customer_wallet
  from public.wallet_accounts
  where id = target_customer_wallet_id
    and wallet_type = 'customer'
    and owner_entity_type = 'user'
    and owner_entity_id = target_customer_user_id
    and status = 'active'
  for update;
  if not found then
    raise exception 'source wallet must be an active customer wallet owned by the company operator';
  end if;

  select decimal_places into currency_decimals
  from public.currency_definitions
  where code = customer_wallet.currency_code
    and status = 'enabled';
  if currency_decimals is null then
    raise exception 'source wallet currency is not enabled';
  end if;
  if target_amount <> trunc(target_amount, currency_decimals) then
    raise exception 'transfer amount exceeds the currency decimal precision';
  end if;

  transaction_metadata := jsonb_build_object(
    'module_key', 'logistics_network',
    'transfer_type', 'company_provider_wallet_funding',
    'organization_id', target_organization_id,
    'customer_user_id', target_customer_user_id,
    'customer_wallet_id', customer_wallet.id,
    'amount', target_amount,
    'currency_code', customer_wallet.currency_code
  );

  select * into existing_transaction
  from public.financial_transactions
  where source = 'platform.logistics.provider_wallet_funding'
    and idempotency_key = target_idempotency_key;
  if found then
    if existing_transaction.transaction_type <> 'transfer'
      or existing_transaction.subject_type <> 'logistics_provider_wallet'
      or existing_transaction.subject_id <> target_organization_id
      or existing_transaction.currency_code <> customer_wallet.currency_code
      or existing_transaction.total_amount <> target_amount
      or existing_transaction.metadata <> transaction_metadata then
      raise exception 'funding idempotency key has already been used with different transfer details';
    end if;

    select id into provider_wallet_id
    from public.wallet_accounts
    where wallet_type = 'partner'
      and owner_entity_type = 'organization'
      and owner_entity_id = target_organization_id
      and currency_code = customer_wallet.currency_code
      and status = 'active';

    select coalesce((
      select balance.balance from public.wallet_balances balance
      where balance.wallet_id = provider_wallet_id
    ), 0) into provider_balance;

    return jsonb_build_object(
      'transaction_id', existing_transaction.id,
      'provider_wallet_id', provider_wallet_id,
      'currency_code', customer_wallet.currency_code,
      'transferred_amount', target_amount,
      'provider_wallet_balance', provider_balance,
      'idempotent_replay', true
    );
  end if;

  provider_wallet_id := public.ensure_wallet_account(
    'partner',
    'organization',
    target_organization_id,
    customer_wallet.currency_code,
    'platform.logistics.wallet_engine',
    jsonb_build_object('module_key', 'logistics_network', 'wallet_role', 'provider'),
    'logistics-provider:' || target_organization_id::text || ':' || customer_wallet.currency_code
  );

  -- Lock both wallet account rows in a consistent order. This serializes
  -- concurrent top-ups and offline fee debits for the same company wallet.
  perform wallet.id
  from public.wallet_accounts wallet
  where wallet.id in (customer_wallet.id, provider_wallet_id)
  order by wallet.id
  for update;

  select coalesce((
    select balance.balance from public.wallet_balances balance
    where balance.wallet_id = customer_wallet.id
  ), 0) into customer_balance;

  if customer_balance < target_amount then
    raise exception 'personal customer wallet has insufficient available balance';
  end if;

  transaction_id := public.post_financial_transaction(
    'transfer',
    customer_wallet.currency_code,
    'platform.logistics.provider_wallet_funding',
    'logistics_provider_wallet',
    target_organization_id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id', customer_wallet.id,
        'direction', 'debit',
        'amount', target_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object(
          'role', 'company_owner_source',
          'organization_id', target_organization_id
        )
      ),
      jsonb_build_object(
        'wallet_id', provider_wallet_id,
        'direction', 'credit',
        'amount', target_amount,
        'entry_type', 'principal',
        'metadata', jsonb_build_object(
          'role', 'company_provider_wallet',
          'organization_id', target_organization_id
        )
      )
    ),
    target_idempotency_key,
    null,
    null,
    jsonb_build_object('module_key', 'logistics_network', 'currency_code', customer_wallet.currency_code),
    transaction_metadata
  );

  select coalesce((
    select balance.balance from public.wallet_balances balance
    where balance.wallet_id = provider_wallet_id
  ), 0) into provider_balance;

  return jsonb_build_object(
    'transaction_id', transaction_id,
    'provider_wallet_id', provider_wallet_id,
    'currency_code', customer_wallet.currency_code,
    'transferred_amount', target_amount,
    'provider_wallet_balance', provider_balance,
    'idempotent_replay', false
  );
end;
$$;

revoke all on function public.fund_logistics_provider_wallet_from_customer_wallet(uuid,uuid,uuid,numeric,text)
  from public, anon, authenticated;
grant execute on function public.fund_logistics_provider_wallet_from_customer_wallet(uuid,uuid,uuid,numeric,text)
  to service_role;

notify pgrst,'reload schema';
commit;
