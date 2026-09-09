begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Didit credentials are runtime secrets only. The database stores only the
-- reference name and routing metadata; verification runtimes no longer read
-- secret values through database RPC/Vault fallback.
update public.provider_adapters
set
  secret_ref = 'SUPABASE_SECRET:DIDIT_API_KEY',
  config = (
    coalesce(config, '{}'::jsonb)
      - 'credential_source'
      - 'database_secret_fallback'
  ) || jsonb_build_object(
    'credential_source', 'supabase_edge_function_secret',
    'database_secret_fallback', false,
    'credential_name', 'DIDIT_API_KEY',
    'activation_note', 'DIDIT_API_KEY must be configured as a Supabase Edge Function secret. Database secret fallback is disabled.'
  ),
  updated_at = timezone('utc', now())
where provider_kind = 'verification'
  and key = 'provider.verification.didit';

update public.provider_adapters
set
  config = jsonb_set(
    coalesce(config, '{}'::jsonb),
    '{webhook}',
    coalesce(config->'webhook', '{}'::jsonb) || jsonb_build_object(
      'secret_ref', 'SUPABASE_SECRET:DIDIT_WEBHOOK_SECRET',
      'secret_source', 'supabase_edge_function_secret',
      'database_secret_fallback', false
    ),
    true
  ),
  updated_at = timezone('utc', now())
where provider_kind = 'verification'
  and key = 'provider.verification.didit';

notify pgrst, 'reload schema';

commit;
