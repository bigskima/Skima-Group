begin;

create index if not exists lpg_internal_driver_earnings_approved_by_idx
  on public.lpg_internal_driver_earnings(approved_by);
create index if not exists lpg_internal_driver_earnings_currency_code_idx
  on public.lpg_internal_driver_earnings(currency_code);
create index if not exists lpg_internal_driver_earnings_paid_by_idx
  on public.lpg_internal_driver_earnings(paid_by);
create index if not exists lpg_internal_refill_procurements_approved_by_idx
  on public.lpg_internal_refill_procurements(approved_by);
create index if not exists lpg_internal_refill_procurements_receipt_media_asset_idx
  on public.lpg_internal_refill_procurements(receipt_media_asset_id);
create index if not exists lpg_refill_orders_internal_settlement_execution_idx
  on public.lpg_refill_orders(internal_settlement_execution_id);

commit;
