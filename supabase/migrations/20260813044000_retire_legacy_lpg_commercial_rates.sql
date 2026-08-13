begin;

update public.lpg_refill_pricing
set status = 'retired',
    effective_until = coalesce(effective_until, timezone('utc', now())),
    metadata = metadata || jsonb_build_object(
      'retired_reason', 'legacy hardcoded commercial components replaced by versioned financial policy',
      'retired_at', timezone('utc', now())
    ),
    updated_at = timezone('utc', now())
where station_branch_id is null
  and source = 'lpg.pricing_seed'
  and idempotency_key = 'lpg-pricing-default-ngn-v1'
  and (
    price_per_kg = 1200
    or delivery_base_fee = 1000
    or platform_fee_amount = 250
    or driver_commission_amount = 700
  );

update public.commission_policies
set status = 'retired',
    metadata = metadata || jsonb_build_object(
      'retired_reason', 'LPG driver payout must use locked route and logistics policy, never LPG value',
      'retired_at', timezone('utc', now())
    ),
    updated_at = timezone('utc', now())
where key = 'commission.lpg.driver.exact.v1';

commit;
