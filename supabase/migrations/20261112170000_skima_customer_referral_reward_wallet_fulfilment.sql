begin;

-- Customer referral rewards are a separate programme from the Station Affiliate
-- commission programme. Approved wallet-credit rewards move value through the
-- existing SKIMA revenue and customer-wallet ledger; they never write balances.
create or replace function public.fulfil_skima_referral_reward(
  target_reward_entry_id uuid,
  target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $skima_referral_reward_fulfil$
declare
  reward_record public.referral_reward_entries%rowtype;
  referral_record public.user_referrals%rowtype;
  campaign_record public.referral_campaigns%rowtype;
  revenue_wallet_id uuid;
  customer_wallet_id uuid;
  transaction_id uuid;
  currency_value text;
  amount_value numeric(28,8);
  available_balance numeric(28,8) := 0;
  amount_text text;
begin
  if auth.uid() is null
    or not (
      public.has_permission('platform.financial.manage', null)
      and public.has_permission('platform.wallets.manage', null)
      and public.has_permission('platform.revenue.manage', null)
    ) then
    raise exception using errcode = '42501',
      message = 'Financial, wallet and revenue management permissions are required to fulfil referral rewards';
  end if;

  if target_reward_entry_id is null
    or char_length(btrim(coalesce(target_reason, ''))) < 5
    or char_length(btrim(target_reason)) > 500 then
    raise exception using errcode = '22023',
      message = 'A reward entry and a 5-500 character fulfilment reason are required';
  end if;

  select * into reward_record
  from public.referral_reward_entries
  where id = target_reward_entry_id
  for update;

  if not found then
    raise exception using errcode = 'P0002',
      message = 'Referral reward entry was not found';
  end if;

  if reward_record.status = 'posted'
    and reward_record.financial_transaction_id is not null then
    return jsonb_build_object(
      'id', reward_record.id,
      'status', reward_record.status,
      'financialTransactionId', reward_record.financial_transaction_id,
      'postedAt', reward_record.posted_at,
      'alreadyFulfilled', true
    );
  end if;

  if reward_record.status <> 'approved' then
    raise exception using errcode = '55000',
      message = 'Only an independently approved referral reward can be fulfilled';
  end if;

  if reward_record.financial_transaction_id is not null then
    raise exception using errcode = '55000',
      message = 'The reward already references a financial transaction and requires reconciliation';
  end if;

  if jsonb_typeof(reward_record.reward_definition) <> 'object'
    or reward_record.reward_definition ->> 'type' <> 'wallet_credit' then
    raise exception using errcode = '22023',
      message = 'This reward definition is not a supported wallet credit. Configure type=wallet_credit, amount and currency_code';
  end if;

  amount_text := nullif(btrim(reward_record.reward_definition ->> 'amount'), '');
  begin
    amount_value := amount_text::numeric(28,8);
  exception when others then
    raise exception using errcode = '22023',
      message = 'The wallet-credit reward amount must be a valid positive number';
  end;

  if amount_value is null
    or amount_value <= 0
    or amount_value <> round(amount_value, 2) then
    raise exception using errcode = '22023',
      message = 'The wallet-credit reward amount must be positive and use no more than two decimal places';
  end if;

  select * into referral_record
  from public.user_referrals
  where id = reward_record.referral_id;

  if not found then
    raise exception using errcode = '23503',
      message = 'The referral associated with this reward no longer exists';
  end if;

  if reward_record.reward_side = 'referrer'
    and reward_record.beneficiary_user_id <> referral_record.referrer_user_id then
    raise exception using errcode = '23514',
      message = 'The referrer reward beneficiary does not match the attributed referrer';
  end if;

  if reward_record.reward_side = 'referred'
    and reward_record.beneficiary_user_id <> referral_record.referred_user_id then
    raise exception using errcode = '23514',
      message = 'The new-customer reward beneficiary does not match the attributed customer';
  end if;

  if reward_record.reward_side not in ('referrer', 'referred')
    or referral_record.status <> 'qualified' then
    raise exception using errcode = '55000',
      message = 'Only rewards belonging to a qualified referral can be fulfilled';
  end if;

  select * into campaign_record
  from public.referral_campaigns
  where id = referral_record.campaign_id;

  currency_value := upper(coalesce(
    nullif(btrim(reward_record.reward_definition ->> 'currency_code'), ''),
    nullif(btrim(campaign_record.qualification_rules ->> 'currency_code'), ''),
    'NGN'
  ));

  if currency_value !~ '^[A-Z0-9]{3,12}$'
    or not exists (
      select 1 from public.currency_definitions currency
      where currency.code = currency_value and currency.status = 'enabled'
    ) then
    raise exception using errcode = '22023',
      message = 'The reward currency must be enabled in SKIMA currency settings';
  end if;

  -- Use the established SKIMA revenue wallet as the campaign funding source.
  -- The same advisory lock is used by affiliate commission posting to serialize
  -- controlled spending from a platform revenue wallet.
  revenue_wallet_id := public.ensure_platform_revenue_wallet(
    currency_value,
    'platform.skima_referrals',
    'skima-referral-revenue-wallet:' || lower(currency_value)
  );

  perform pg_advisory_xact_lock(hashtextextended(revenue_wallet_id::text, 0));

  select coalesce(balance.balance, 0)
  into available_balance
  from public.wallet_balances balance
  where balance.wallet_id = revenue_wallet_id;

  available_balance := coalesce(available_balance, 0);

  if available_balance < amount_value then
    raise exception using errcode = '55000',
      message = format(
        'The SKIMA revenue wallet has insufficient available %s balance for this reward. Required: %s; available: %s',
        currency_value, amount_value, available_balance
      );
  end if;

  customer_wallet_id := public.ensure_wallet_account(
    'customer',
    'user',
    reward_record.beneficiary_user_id,
    currency_value,
    'skima.referrals.wallet',
    jsonb_build_object(
      'programme', 'customer_referrals',
      'purpose', 'referral_reward_credit'
    ),
    'skima-referral-customer-wallet:' || reward_record.beneficiary_user_id::text || ':' || lower(currency_value)
  );

  transaction_id := public.post_financial_transaction(
    'transfer',
    currency_value,
    'platform.skima_referrals',
    'skima_referral_reward_entry',
    reward_record.id,
    jsonb_build_array(
      jsonb_build_object(
        'wallet_id', revenue_wallet_id,
        'direction', 'debit',
        'amount', amount_value,
        'entry_type', 'adjustment',
        'metadata', jsonb_build_object(
          'role', 'skima_revenue',
          'revenue_stream', 'customer_referral_reward',
          'referral_reward_entry_id', reward_record.id,
          'referral_id', reward_record.referral_id,
          'beneficiary_user_id', reward_record.beneficiary_user_id
        )
      ),
      jsonb_build_object(
        'wallet_id', customer_wallet_id,
        'direction', 'credit',
        'amount', amount_value,
        'entry_type', 'principal',
        'metadata', jsonb_build_object(
          'role', 'customer_referral_reward',
          'programme', 'shared_skima_referrals',
          'referral_reward_entry_id', reward_record.id,
          'referral_id', reward_record.referral_id,
          'reward_side', reward_record.reward_side,
          'beneficiary_user_id', reward_record.beneficiary_user_id
        )
      )
    ),
    'skima-referral-reward:' || reward_record.id::text,
    null,
    null,
    jsonb_build_object(
      'policy_key', 'campaign.skima.customer_referral',
      'campaign_id', referral_record.campaign_id,
      'referral_id', reward_record.referral_id,
      'reward_definition', reward_record.reward_definition
    ),
    jsonb_build_object(
      'programme', 'shared_skima_referrals',
      'referral_reward_entry_id', reward_record.id,
      'referral_id', reward_record.referral_id,
      'reward_side', reward_record.reward_side,
      'beneficiary_user_id', reward_record.beneficiary_user_id,
      'amount', amount_value,
      'currency_code', currency_value
    )
  );

  update public.referral_reward_entries
  set status = 'posted',
      financial_transaction_id = transaction_id,
      posted_at = timezone('utc', now()),
      updated_at = timezone('utc', now()),
      metadata = metadata || jsonb_build_object(
        'fulfilment_reason', btrim(target_reason),
        'fulfilled_by', auth.uid(),
        'customer_wallet_id', customer_wallet_id,
        'financial_transaction_id', transaction_id,
        'amount', amount_value,
        'currency_code', currency_value
      )
  where id = reward_record.id;

  return jsonb_build_object(
    'id', reward_record.id,
    'status', 'posted',
    'amount', amount_value,
    'currencyCode', currency_value,
    'walletId', customer_wallet_id,
    'financialTransactionId', transaction_id,
    'postedAt', timezone('utc', now()),
    'alreadyFulfilled', false
  );
end;
$skima_referral_reward_fulfil$;

revoke all on function public.fulfil_skima_referral_reward(uuid, text) from public, anon;
grant execute on function public.fulfil_skima_referral_reward(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
