begin;

set local lock_timeout='10s';
set local statement_timeout='0';

-- Give utility marketing/sponsor subsidies their own wallet class instead of
-- sharing the generic platform liability bucket. This keeps the admin campaign
-- balance semantically exact and prevents unrelated liabilities from being
-- displayed as spendable campaign funds.
alter table public.wallet_accounts
  drop constraint if exists wallet_accounts_wallet_type_check;

alter table public.wallet_accounts
  add constraint wallet_accounts_wallet_type_check
  check (
    wallet_type in (
      'customer','driver','partner','platform',
      'platform_clearing','platform_revenue','platform_liability',
      'platform_provider','platform_campaign',
      'escrow','commission','refund','bonus','loyalty','generic'
    )
  );

create or replace function public.ensure_utility_campaign_funding_wallet(
  target_currency_code text default 'NGN'
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  wallet_id uuid;
  resolved_key text;
begin
  if auth.role()<>'service_role'
     and not (
       public.has_permission('platform.billing.manage',null)
       and public.has_permission('platform.revenue.manage',null)
     )
     and not public.is_platform_super_admin() then
    raise exception using errcode='42501',
      message='utility campaign funding management permission is required';
  end if;

  if target_currency_code is null
     or target_currency_code !~ '^[A-Z0-9]{3,12}$'
     or not exists(
       select 1
       from public.currency_definitions currency
       where currency.code=target_currency_code
         and currency.status='enabled'
     ) then
    raise exception 'target_currency_code must reference an enabled currency';
  end if;

  select wallet.id
  into wallet_id
  from public.wallet_accounts wallet
  where wallet.wallet_type='platform_campaign'
    and wallet.owner_entity_type='platform'
    and wallet.owner_entity_id is null
    and wallet.currency_code=target_currency_code
    and wallet.status='active'
  limit 1;

  if wallet_id is not null then return wallet_id; end if;

  resolved_key:='utility-campaign-funding:'||lower(target_currency_code);

  insert into public.wallet_accounts(
    wallet_type,owner_entity_type,owner_entity_id,currency_code,status,
    metadata,created_by,source,idempotency_key
  )
  values(
    'platform_campaign','platform',null,target_currency_code,'active',
    jsonb_build_object(
      'wallet_purpose','utility_campaign_funding',
      'platform_internal',true,
      'withdrawable',false
    ),
    auth.uid(),'platform.utility_billing',resolved_key
  )
  on conflict do nothing
  returning id into wallet_id;

  if wallet_id is null then
    select wallet.id
    into wallet_id
    from public.wallet_accounts wallet
    where wallet.wallet_type='platform_campaign'
      and wallet.owner_entity_type='platform'
      and wallet.owner_entity_id is null
      and wallet.currency_code=target_currency_code
    limit 1;
  end if;

  if wallet_id is null then
    raise exception 'utility campaign funding wallet could not be ensured';
  end if;

  insert into public.wallet_account_events(
    wallet_account_id,event_type,status,idempotency_key,metadata
  )
  values(
    wallet_id,'created','active',resolved_key||':created',
    jsonb_build_object(
      'source','platform.utility_billing',
      'wallet_purpose','utility_campaign_funding'
    )
  )
  on conflict do nothing;

  return wallet_id;
end;
$$;

create or replace function public.read_utility_campaign_pool_balance(
  target_currency_code text default 'NGN'
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  wallet_id uuid;
  balance_amount numeric(28,8):=0;
begin
  if not(
    public.has_permission('platform.billing.read',null)
    or public.has_permission('platform.billing.manage',null)
    or public.is_platform_super_admin()
  ) then
    raise exception using errcode='42501',
      message='bill service access is required';
  end if;

  select wallet.id,coalesce(balance.balance,0)
  into wallet_id,balance_amount
  from public.wallet_accounts wallet
  left join public.wallet_balances balance on balance.wallet_id=wallet.id
  where wallet.wallet_type='platform_campaign'
    and wallet.owner_entity_type='platform'
    and wallet.owner_entity_id is null
    and wallet.currency_code=target_currency_code
    and wallet.status='active'
    and wallet.metadata->>'wallet_purpose'='utility_campaign_funding'
  limit 1;

  return jsonb_build_object(
    'currencyCode',target_currency_code,
    'walletId',wallet_id,
    'balance',coalesce(balance_amount,0)
  );
end;
$$;

notify pgrst,'reload schema';

commit;