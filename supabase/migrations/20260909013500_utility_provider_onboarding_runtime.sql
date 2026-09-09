begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Reconcile the provider kind registry. Utility and inventory were added by
-- earlier domains, then accidentally dropped when verification expanded the
-- same constraint. Keep the union of every currently supported provider kind.
alter table public.provider_adapters
  drop constraint if exists provider_adapters_provider_kind_check;

alter table public.provider_adapters
  add constraint provider_adapters_provider_kind_check
  check (
    provider_kind in (
      'payment',
      'storage',
      'maps',
      'notification',
      'ai',
      'queue',
      'cache',
      'observability',
      'inventory',
      'utility',
      'verification'
    )
  );

create or replace function public.configure_utility_provider_adapter(
  target_key text,
  target_display_name text,
  target_status text default 'inactive',
  target_secret_ref text default null,
  target_provider_family text default null,
  target_environment text default 'production',
  target_base_url text default null,
  target_website_url text default null,
  target_documentation_url text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  configured_id uuid;
  normalized_secret_ref text;
  existing_runtime_ready boolean := false;
begin
  if not (
    public.has_permission('platform.billing.manage', null)
    or public.is_platform_super_admin()
  ) then
    raise exception using errcode = '42501',
      message = 'bill service management permission is required';
  end if;

  if target_key is null
     or target_key !~ '^provider\.utility\.[a-z0-9][a-z0-9_.:-]{1,90}$' then
    raise exception 'provider key must look like provider.utility.example';
  end if;

  if target_display_name is null
     or length(btrim(target_display_name)) < 2
     or length(btrim(target_display_name)) > 140 then
    raise exception 'provider display name is invalid';
  end if;

  if target_status not in ('inactive','active','degraded','disabled') then
    raise exception 'provider status is not supported';
  end if;

  if target_environment not in ('sandbox','production') then
    raise exception 'provider environment must be sandbox or production';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'provider metadata must be a JSON object';
  end if;

  normalized_secret_ref := nullif(btrim(target_secret_ref), '');
  if normalized_secret_ref is not null
     and normalized_secret_ref !~ '^SUPABASE_SECRET:[A-Z][A-Z0-9_]{2,100}$' then
    raise exception 'provider secret reference must use SUPABASE_SECRET:NAME';
  end if;

  select coalesce((adapter.config ->> 'runtimeReady')::boolean, false)
  into existing_runtime_ready
  from public.provider_adapters adapter
  where adapter.provider_kind = 'utility'
    and adapter.key = target_key;

  insert into public.provider_adapters (
    provider_kind,
    key,
    display_name,
    status,
    config,
    secret_ref,
    created_by
  )
  values (
    'utility',
    target_key,
    btrim(target_display_name),
    target_status,
    jsonb_build_object(
      'providerFamily', nullif(btrim(target_provider_family), ''),
      'environment', target_environment,
      'baseUrl', nullif(btrim(target_base_url), ''),
      'websiteUrl', nullif(btrim(target_website_url), ''),
      'documentationUrl', nullif(btrim(target_documentation_url), ''),
      'runtimeReady', false,
      'credentialSource', case
        when normalized_secret_ref is null then null
        else 'supabase_edge_function_secret'
      end
    ) || target_metadata,
    normalized_secret_ref,
    auth.uid()
  )
  on conflict (provider_kind, key) do update
  set display_name = excluded.display_name,
      status = excluded.status,
      secret_ref = excluded.secret_ref,
      config = (
        public.provider_adapters.config
        || excluded.config
        || jsonb_build_object(
          'runtimeReady',
          coalesce(existing_runtime_ready, false)
        )
      ),
      updated_at = timezone('utc', now())
  returning id into configured_id;

  insert into public.audit_logs (
    actor_user_id,
    action,
    entity_type,
    entity_id,
    after_state,
    metadata
  )
  values (
    auth.uid(),
    'utility.provider.configured',
    'provider_adapter',
    configured_id,
    jsonb_build_object(
      'providerKind', 'utility',
      'key', target_key,
      'displayName', btrim(target_display_name),
      'status', target_status,
      'environment', target_environment,
      'secretReferenceConfigured', normalized_secret_ref is not null
    ),
    jsonb_build_object(
      'source', 'skima.admin.utility_billing'
    )
  );

  return configured_id;
end;
$$;

revoke all on function public.configure_utility_provider_adapter(
  text,text,text,text,text,text,text,text,text,jsonb
) from public, anon;

grant execute on function public.configure_utility_provider_adapter(
  text,text,text,text,text,text,text,text,text,jsonb
) to authenticated, service_role;

create or replace function public.configure_utility_provider_route(
  target_product_key text,
  target_provider_adapter_key text,
  target_provider_product_code text,
  target_priority integer default 100,
  target_status text default 'inactive',
  target_fixed_fee numeric default 0
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  product_record_id uuid;
  provider_record public.provider_adapters%rowtype;
  configured_id uuid;
begin
  if not (
    public.has_permission('platform.billing.manage', null)
    or public.is_platform_super_admin()
  ) then
    raise exception using errcode='42501',
      message='bill service management permission is required';
  end if;

  if target_status not in ('active','inactive') then
    raise exception 'connection status must be active or inactive';
  end if;

  if target_priority is null or target_priority < 1 or target_priority > 10000 then
    raise exception 'connection priority must be between 1 and 10000';
  end if;

  if target_fixed_fee is null or target_fixed_fee < 0 then
    raise exception 'customer fee cannot be negative';
  end if;

  select id
  into product_record_id
  from public.utility_products
  where key = target_product_key;

  select *
  into provider_record
  from public.provider_adapters
  where key = target_provider_adapter_key
    and provider_kind = 'utility';

  if product_record_id is null then
    raise exception 'choose a valid bill product';
  end if;

  if provider_record.id is null then
    raise exception 'choose a valid bill service provider';
  end if;

  if target_status = 'active' then
    if provider_record.status <> 'active' then
      raise exception 'activate and test the bill service provider before exposing this plan';
    end if;
    if provider_record.secret_ref is null then
      raise exception 'configure the provider Edge secret reference before exposing this plan';
    end if;
    if coalesce((provider_record.config ->> 'runtimeReady')::boolean, false) is not true then
      raise exception 'this provider has no live SKIMA fulfillment adapter yet; keep the connection unavailable';
    end if;
  end if;

  insert into public.utility_provider_routes (
    product_id,
    provider_adapter_id,
    priority,
    status,
    provider_product_code,
    fee_config
  )
  values (
    product_record_id,
    provider_record.id,
    target_priority,
    target_status,
    btrim(target_provider_product_code),
    jsonb_build_object('fixedAmount', target_fixed_fee)
  )
  on conflict (product_id, provider_adapter_id) do update
  set priority = excluded.priority,
      status = excluded.status,
      provider_product_code = excluded.provider_product_code,
      fee_config = excluded.fee_config,
      updated_at = timezone('utc', now())
  returning id into configured_id;

  return configured_id;
end;
$$;

revoke all on function public.configure_utility_provider_route(
  text,text,text,integer,text,numeric
) from public, anon;

grant execute on function public.configure_utility_provider_route(
  text,text,text,integer,text,numeric
) to authenticated, service_role;

create or replace function public.read_utility_admin_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (
    public.has_permission('platform.billing.read', null)
    or public.is_platform_super_admin()
  ) then
    raise exception using errcode='42501',
      message='bill service access is required';
  end if;

  return jsonb_build_object(
    'categories',
      coalesce((
        select jsonb_agg(row_to_json(item) order by item.sort_order,item.display_name)
        from public.utility_service_categories item
      ), '[]'::jsonb),
    'billers',
      coalesce((
        select jsonb_agg(row_to_json(item) order by item.display_name)
        from public.utility_billers item
      ), '[]'::jsonb),
    'products',
      coalesce((
        select jsonb_agg(row_to_json(item) order by item.sort_order,item.display_name)
        from public.utility_products item
      ), '[]'::jsonb),
    'routes',
      coalesce((
        select jsonb_agg(row_to_json(item) order by item.priority)
        from public.utility_provider_routes item
      ), '[]'::jsonb),
    'providers',
      coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'id', item.id,
            'key', item.key,
            'display_name', item.display_name,
            'status', item.status,
            'provider_family', item.config ->> 'providerFamily',
            'environment', item.config ->> 'environment',
            'base_url', item.config ->> 'baseUrl',
            'website_url', item.config ->> 'websiteUrl',
            'documentation_url', item.config ->> 'documentationUrl',
            'runtime_ready', coalesce((item.config ->> 'runtimeReady')::boolean, false),
            'secret_configured', item.secret_ref is not null
          )
          order by item.display_name
        )
        from public.provider_adapters item
        where item.provider_kind = 'utility'
      ), '[]'::jsonb),
    'promotions',
      coalesce((
        select jsonb_agg(row_to_json(item) order by item.created_at desc)
        from public.utility_promotions item
      ), '[]'::jsonb),
    'cashbacks',
      coalesce((
        select jsonb_agg(row_to_json(item) order by item.created_at desc)
        from public.utility_reward_policies item
      ), '[]'::jsonb),
    'payments',
      coalesce((
        select jsonb_agg(row_to_json(item) order by item.created_at desc)
        from (
          select *
          from public.utility_payment_requests
          order by created_at desc
          limit 200
        ) item
      ), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.read_utility_admin_configuration()
from public, anon;

grant execute on function public.read_utility_admin_configuration()
to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
