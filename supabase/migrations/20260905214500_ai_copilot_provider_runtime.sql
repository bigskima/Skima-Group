begin;

-- Compatibility extension for the canonical SKIMA Intelligence runtime introduced in
-- 20260905074500_ai_intelligence_runtime.sql.
-- Do not create a second AI schema here. Extend the canonical provider protocol surface instead.

update public.provider_adapters
set config = config
      || jsonb_build_object(
        'transport', 'anthropic_messages',
        'api_base_url', coalesce(config ->> 'api_base_url', 'https://api.anthropic.com/v1'),
        'supports', '["text","json"]'::jsonb,
        'enabled_by_configuration', true,
        'control', 'assist_only'
      ),
    updated_at = timezone('utc', now())
where provider_kind = 'ai'
  and key = 'provider.ai.anthropic-claude';

create or replace function public.upsert_ai_provider_configuration(
  target_provider_key text,
  target_display_name text,
  target_transport text,
  target_api_base_url text,
  target_secret_ref text,
  target_status text,
  target_config jsonb,
  target_reason text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  provider_record public.provider_adapters%rowtype;
  previous_state jsonb := '{}'::jsonb;
  event_capability_id uuid;
begin
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.ai.manage', null)
  ) then
    raise exception 'AI management permission is required';
  end if;

  if target_provider_key is null or target_provider_key !~ '^provider[.]ai[.][a-z0-9_.:-]{2,100}$'
    or target_display_name is null or char_length(btrim(target_display_name)) < 2
    or target_transport not in (
      'google_generate_content',
      'openai_compatible_chat',
      'anthropic_messages',
      'cloudflare_workers_ai'
    )
    or target_status not in ('inactive','active','degraded','disabled')
    or target_config is null or jsonb_typeof(target_config) <> 'object'
    or target_reason is null or btrim(target_reason) = ''
    or target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'AI provider configuration is invalid';
  end if;

  if target_api_base_url is not null and target_api_base_url !~ '^https://[^ ]+$' then
    raise exception 'AI provider API base URL must use HTTPS';
  end if;

  if target_secret_ref is not null
    and target_secret_ref !~ '^SUPABASE_SECRET:[A-Z][A-Z0-9_]{2,100}$' then
    raise exception 'AI provider secret reference is invalid';
  end if;

  select to_jsonb(provider) into previous_state
  from public.provider_adapters provider
  where provider.provider_kind = 'ai'
    and provider.key = target_provider_key;

  insert into public.provider_adapters (
    provider_kind, key, display_name, status, config, secret_ref, created_by
  )
  values (
    'ai',
    target_provider_key,
    btrim(target_display_name),
    target_status,
    coalesce(target_config, '{}'::jsonb)
      || jsonb_build_object(
        'transport', target_transport,
        'supports', case target_transport
          when 'google_generate_content' then '["text","json","image"]'::jsonb
          when 'openai_compatible_chat' then '["text","json"]'::jsonb
          when 'anthropic_messages' then '["text","json"]'::jsonb
          when 'cloudflare_workers_ai' then '["image"]'::jsonb
          else '[]'::jsonb
        end
      )
      || case when target_api_base_url is null then '{}'::jsonb
              else jsonb_build_object('api_base_url', target_api_base_url) end,
    target_secret_ref,
    auth.uid()
  )
  on conflict (provider_kind, key)
  do update set
    display_name = excluded.display_name,
    status = excluded.status,
    config = public.provider_adapters.config || excluded.config,
    secret_ref = coalesce(excluded.secret_ref, public.provider_adapters.secret_ref),
    updated_at = timezone('utc', now())
  returning * into provider_record;

  select id into event_capability_id
  from public.ai_capabilities
  where key = 'ai.assistant.admin'
  limit 1;

  if event_capability_id is not null then
    insert into public.ai_provider_route_events (
      capability_id, provider_route_id, event_type, previous_state, new_state,
      reason, actor_user_id, idempotency_key
    )
    values (
      event_capability_id, null, 'provider_updated', coalesce(previous_state, '{}'::jsonb),
      to_jsonb(provider_record) - 'secret_ref',
      btrim(target_reason), auth.uid(), target_idempotency_key
    )
    on conflict (idempotency_key) do nothing;
  end if;

  return to_jsonb(provider_record) - 'secret_ref';
end;
$$;

revoke all on function public.upsert_ai_provider_configuration(
  text,text,text,text,text,text,jsonb,text,text
) from public, anon;
grant execute on function public.upsert_ai_provider_configuration(
  text,text,text,text,text,text,jsonb,text,text
) to authenticated, service_role;

commit;
