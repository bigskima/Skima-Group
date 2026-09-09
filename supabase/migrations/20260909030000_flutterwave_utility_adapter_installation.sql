begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Install Flutterwave as the first provider plugin without making it the
-- platform default. Provider selection stays database-driven and every route
-- remains inactive until the account secret, live connectivity, economics and
-- fulfillment tests pass.
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
  'provider.utility.flutterwave',
  'Flutterwave Bills',
  'inactive',
  jsonb_build_object(
    'adapterKind', 'flutterwave-bills-v3',
    'providerFamily', 'flutterwave',
    'environment', 'production',
    'baseUrl', 'https://api.flutterwave.com/v3/',
    'country', 'NG',
    'runtimeInstalled', true,
    'runtimeReady', false,
    'catalogSyncReady', true,
    'connectionHealthy', false,
    'credentialSource', 'supabase_edge_function_secret',
    'documentationUrl', 'https://developer.flutterwave.com/v3.0/docs/bill-payment',
    'capabilities', jsonb_build_array(
      'catalog_sync',
      'customer_validation',
      'purchase',
      'status_query'
    ),
    'activationPolicy', jsonb_build_object(
      'requiresSecret', true,
      'requiresConnectionTest', true,
      'requiresLivePurchaseTest', true,
      'requiresEconomics', true
    )
  ),
  'SUPABASE_SECRET:FLUTTERWAVE_SECRET_KEY',
  null
)
on conflict (provider_kind, key) do update
set display_name = excluded.display_name,
    secret_ref = excluded.secret_ref,
    config = public.provider_adapters.config || excluded.config ||
      jsonb_build_object(
        'runtimeReady',
        coalesce((public.provider_adapters.config ->> 'runtimeReady')::boolean, false),
        'connectionHealthy',
        coalesce((public.provider_adapters.config ->> 'connectionHealthy')::boolean, false)
      ),
    updated_at = timezone('utc', now());

create or replace function public.read_utility_customer_validation_context(
  target_product_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'authenticated user is required';
  end if;

  select jsonb_build_object(
    'productId', product.id,
    'productKey', product.key,
    'productName', product.display_name,
    'categoryKey', category.key,
    'categoryName', category.display_name,
    'billerKey', biller.key,
    'billerName', biller.display_name,
    'providerKey', provider.key,
    'providerName', provider.display_name,
    'providerProductCode', route.provider_product_code,
    'providerBillerCode',
      coalesce(
        nullif(product.metadata ->> 'providerBillerCode', ''),
        nullif(route.metadata ->> 'providerBillerCode', '')
      ),
    'validationMode', biller.validation_mode,
    'customerIdentifierLabel', biller.customer_identifier_label,
    'customerIdentifierHint', biller.customer_identifier_hint
  )
  into result
  from public.utility_products product
  join public.utility_billers biller
    on biller.id = product.biller_id
  join public.utility_service_categories category
    on category.id = biller.category_id
  join public.utility_provider_routes route
    on route.product_id = product.id
  join public.provider_adapters provider
    on provider.id = route.provider_adapter_id
  join public.utility_route_economics economics
    on economics.route_id = route.id
   and economics.status = 'active'
  where product.id = target_product_id
    and product.status = 'active'
    and biller.status = 'active'
    and category.status = 'active'
    and route.status = 'active'
    and provider.status = 'active'
    and provider.provider_kind = 'utility'
    and provider.secret_ref is not null
    and coalesce((provider.config ->> 'runtimeReady')::boolean, false) = true
  order by route.priority
  limit 1;

  if result is null then
    raise exception 'this bill service is not ready for customer validation';
  end if;

  if coalesce(result ->> 'providerBillerCode', '') = ''
     or coalesce(result ->> 'providerProductCode', '') = '' then
    raise exception 'this bill service is missing provider validation mapping';
  end if;

  return result;
end;
$$;

revoke all on function public.read_utility_customer_validation_context(uuid)
from public, anon;
grant execute on function public.read_utility_customer_validation_context(uuid)
to authenticated, service_role;

comment on function public.read_utility_customer_validation_context(uuid) is
  'Returns only the active provider routing fields required by the authenticated utility validation runtime. No provider credential value is exposed.';

notify pgrst, 'reload schema';

commit;
