begin;

create index if not exists lpg_internal_driver_payouts_currency_idx
  on public.lpg_internal_driver_payouts(currency_code);
create index if not exists lpg_internal_driver_payouts_wallet_idx
  on public.lpg_internal_driver_payouts(driver_wallet_id);
create index if not exists lpg_internal_driver_payouts_paid_by_idx
  on public.lpg_internal_driver_payouts(paid_by)
  where paid_by is not null;

commit;
