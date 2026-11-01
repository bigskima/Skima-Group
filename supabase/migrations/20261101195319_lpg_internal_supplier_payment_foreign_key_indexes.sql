begin;

create index if not exists lpg_internal_supplier_payments_currency_paid_at_idx
  on public.lpg_internal_supplier_payments (currency_code, paid_at desc);

create index if not exists lpg_internal_supplier_payments_evidence_media_asset_idx
  on public.lpg_internal_supplier_payments (evidence_media_asset_id)
  where evidence_media_asset_id is not null;

create index if not exists lpg_internal_supplier_payments_paid_by_idx
  on public.lpg_internal_supplier_payments (paid_by)
  where paid_by is not null;

notify pgrst,'reload schema';
commit;
