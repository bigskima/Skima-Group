begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

update public.provider_adapters
set config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
      'webhook', jsonb_build_object(
        'enabled', true,
        'path', '/functions/v1/verification-provider-webhook/didit',
        'secret_ref', 'SUPABASE_SECRET:DIDIT_WEBHOOK_SECRET',
        'signature_algorithm', 'HMAC-SHA256',
        'timestamp_tolerance_seconds', 300,
        'subscribed_events', jsonb_build_array('status.updated', 'data.updated'),
        'source_of_truth', true,
        'polling_fallback', true
      )
    ),
    updated_at = timezone('utc', now())
where provider_kind = 'verification'
  and key = 'provider.verification.didit';

commit;
