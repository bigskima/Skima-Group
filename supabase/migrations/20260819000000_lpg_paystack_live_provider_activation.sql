-- Migration: Activate Live Paystack Payment & Payout Adapter
-- Description: Switches platform.payments active provider configuration to provider.payment.paystack
-- and ensures withdrawal_beneficiaries table includes provider_recipient_code column for Paystack payouts.

do $$
begin
  -- 1. Ensure provider.payment.paystack adapter status is active
  update public.provider_adapters
  set status = 'active',
      updated_at = timezone('utc', now())
  where key = 'provider.payment.paystack';

  -- 2. Update global platform.payments configuration entry to set active_provider_key to provider.payment.paystack
  update public.configuration_entries
  set value = jsonb_set(value, '{active_provider_key}', '"provider.payment.paystack"'::jsonb),
      version = version + 1,
      updated_at = timezone('utc', now())
  where namespace = 'platform.payments'
    and key = 'provider_selection'
    and scope_type = 'global'
    and status = 'active';

  -- 3. Add provider_recipient_code column to withdrawal_beneficiaries if missing
  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'withdrawal_beneficiaries'
      and column_name = 'provider_recipient_code'
  ) then
    alter table public.withdrawal_beneficiaries
      add column provider_recipient_code text;
  end if;
end $$;
