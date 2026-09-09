begin;

update public.provider_adapters
set config=jsonb_set(
  coalesce(config,'{}'::jsonb),
  '{webhook}',
  coalesce(config->'webhook','{}'::jsonb)||jsonb_build_object(
    'path','/functions/v1/utility-provider-webhook/flutterwave',
    'secretRef','SUPABASE_SECRET:FLUTTERWAVE_WEBHOOK_SECRET',
    'credentialSource','supabase_edge_function_secret',
    'signatureScheme','flutterwave-hmac-or-verif-hash',
    'authoritativeStatusVerification',true
  ),
  true
),
updated_at=timezone('utc',now())
where provider_kind='utility'
  and key='provider.utility.flutterwave';

notify pgrst,'reload schema';

commit;