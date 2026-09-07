begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- The cylinder presentation task is intentionally routed to Cloudflare Workers
-- AI in the current SKIMA deployment. Keep the provider abstraction intact so
-- an authorized configuration change can switch it later without a mobile
-- redeploy, but do not let a missing transport field silently break routing or
-- fall through to another provider.
update public.provider_adapters
set status = 'active',
    config = coalesce(config, '{}'::jsonb)
      || jsonb_build_object(
        'provider', 'cloudflare',
        'product', 'workers_ai',
        'transport', 'cloudflare_workers_ai',
        'supports', jsonb_build_array('image'),
        'response_mode', 'image',
        'control', 'presentation_derivative_only'
      )
      || case
          when nullif(config ->> 'model', '') is null
            then jsonb_build_object('model', '@cf/black-forest-labs/flux-1-schnell')
          else '{}'::jsonb
        end,
    secret_ref = 'SUPABASE_SECRET:CLOUDFLARE_API_TOKEN',
    updated_at = timezone('utc', now())
where provider_kind = 'ai'
  and key = 'provider.ai.cloudflare-workers-ai';

update public.ai_task_definitions definition
set provider_adapter_id = provider.id,
    status = 'active',
    prompt_config = coalesce(definition.prompt_config, '{}'::jsonb)
      || jsonb_build_object(
        'control', 'presentation_derivative_only',
        'preserve_original', true,
        'provider_route', 'provider.ai.cloudflare-workers-ai'
      ),
    updated_at = timezone('utc', now())
from public.provider_adapters provider
where definition.key = 'ai.lpg.cylinder.presentation'
  and provider.provider_kind = 'ai'
  and provider.key = 'provider.ai.cloudflare-workers-ai'
  and provider.status = 'active';

-- Keep the runtime-facing selection aligned with the active cylinder image
-- provider. This is configuration, not a hardcoded mobile dependency.
update public.configuration_entries
set value = coalesce(value, '{}'::jsonb) || jsonb_build_object(
      'active_provider_key', 'provider.ai.cloudflare-workers-ai',
      'selection_source', 'configuration'
    ),
    version = version + 1,
    updated_at = timezone('utc', now())
where namespace = 'platform.ai'
  and key = 'provider_selection'
  and scope_type = 'global'
  and scope_id is null
  and status = 'active';

commit;
