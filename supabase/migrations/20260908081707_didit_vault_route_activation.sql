begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

create extension if not exists supabase_vault with schema vault;

create or replace function public.read_server_secret(target_name text)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  secret_value text;
begin
  if target_name is null or btrim(target_name) = '' then
    return null;
  end if;

  select decrypted_secret
  into secret_value
  from vault.decrypted_secrets
  where name = target_name
  order by updated_at desc, created_at desc
  limit 1;

  return secret_value;
end;
$$;

revoke all on function public.read_server_secret(text) from public;
revoke all on function public.read_server_secret(text) from anon;
revoke all on function public.read_server_secret(text) from authenticated;
grant execute on function public.read_server_secret(text) to service_role;

comment on function public.read_server_secret(text) is
  'Service-role-only resolver for Supabase Vault secrets used by server runtimes. Never expose through client routes.';

update public.provider_adapters
set status = 'active',
    config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
      'credential_source', 'supabase_vault_or_edge_secret',
      'credential_name', 'DIDIT_API_KEY',
      'webhook_secret_name', 'DIDIT_WEBHOOK_SECRET',
      'webhook_path', '/functions/v1/verification-provider-webhook/didit',
      'management_api_version', 'v3',
      'provider_status', 'live'
    ),
    updated_at = timezone('utc', now())
where provider_kind = 'verification'
  and key = 'provider.verification.didit'
  and exists (
    select 1 from vault.secrets where name = 'DIDIT_API_KEY'
  );

update public.verification_provider_routes route
set workflow_ref = 'f08c2586-0b0c-42a7-b386-c220eb320c37',
    status = 'active',
    config = coalesce(route.config, '{}'::jsonb) || jsonb_build_object(
      'workflow_kind', 'KYC',
      'workflow_label', 'Compliance workflow',
      'features', jsonb_build_array('OCR', 'LIVENESS', 'FACE_MATCH'),
      'source', 'didit_management_api'
    ),
    updated_at = timezone('utc', now())
from public.verification_definitions definition,
     public.provider_adapters provider
where route.verification_definition_id = definition.id
  and route.provider_adapter_id = provider.id
  and definition.key = 'verification.person.identity'
  and provider.key = 'provider.verification.didit'
  and provider.provider_kind = 'verification'
  and provider.status = 'active';

update public.verification_provider_routes route
set workflow_ref = 'bcdcd368-63c0-47ab-8427-35e865dfdde2',
    status = 'active',
    config = coalesce(route.config, '{}'::jsonb) || jsonb_build_object(
      'workflow_kind', 'KYB',
      'workflow_label', 'Business Verification (KYB)',
      'features', jsonb_build_array(
        'KYB_REGISTRY',
        'AML',
        'KYB_DOCUMENTS',
        'KYB_KEY_PEOPLE'
      ),
      'source', 'didit_management_api'
    ),
    updated_at = timezone('utc', now())
from public.verification_definitions definition,
     public.provider_adapters provider
where route.verification_definition_id = definition.id
  and route.provider_adapter_id = provider.id
  and definition.key = 'verification.business.registry'
  and provider.key = 'provider.verification.didit'
  and provider.provider_kind = 'verification'
  and provider.status = 'active';

commit;
