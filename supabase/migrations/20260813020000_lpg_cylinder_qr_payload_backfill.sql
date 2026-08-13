begin;

update public.lpg_cylinders
set
  qr_payload = 'skima:cylinder:v1:' || encode(extensions.gen_random_bytes(24), 'hex'),
  metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'qr_payload_backfilled_at',
    timezone('utc', now()),
    'qr_payload_backfill_source',
    '20260813020000_lpg_cylinder_qr_payload_backfill'
  ),
  updated_at = timezone('utc', now())
where nullif(btrim(coalesce(qr_payload, '')), '') is null
  and status <> 'deactivated';

commit;
