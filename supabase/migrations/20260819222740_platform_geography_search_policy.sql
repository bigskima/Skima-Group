begin;

insert into public.configuration_entries (
  namespace,
  key,
  scope_type,
  scope_id,
  version,
  status,
  value,
  effective_from
)
select
  'platform.geography',
  'search_policy',
  'global',
  null,
  1,
  'active',
  jsonb_build_object(
    'selection_source', 'configuration',
    'default_country_code', 'NG',
    'default_country_name', 'Nigeria',
    'search_country_codes', jsonb_build_array('NG'),
    'modules_hardcode_country', false
  ),
  timezone('utc', now())
where not exists (
  select 1
  from public.configuration_entries
  where namespace = 'platform.geography'
    and key = 'search_policy'
    and scope_type = 'global'
    and status = 'active'
);

create or replace function public.read_lpg_runtime_config()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  return jsonb_build_object(
    'cylinderTypeProfiles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', profile.id,
        'key', profile.key,
        'displayName', profile.display_name,
        'sizeKg', profile.size_kg,
        'maxCapacityKg', profile.max_capacity_kg,
        'refillToleranceKg', profile.refill_tolerance_kg,
        'status', profile.status,
        'metadata', profile.metadata
      ) order by profile.size_kg asc)
      from public.lpg_cylinder_type_profiles profile where profile.status = 'active'
    ), '[]'::jsonb),
    'policies', coalesce((
      select jsonb_object_agg(policy.key, jsonb_build_object(
        'kind', policy.policy_kind,
        'displayName', policy.display_name,
        'policy', policy.policy,
        'metadata', policy.metadata
      )) from public.lpg_operation_policies policy where policy.status = 'active'
    ), '{}'::jsonb),
    'stationRolePresets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', preset.key,
        'displayName', preset.display_name,
        'roleKey', preset.role_key,
        'membershipType', preset.membership_type,
        'permissionKeys', preset.permission_keys,
        'metadata', preset.metadata
      ) order by preset.key)
      from public.lpg_station_role_presets preset where preset.status = 'active'
    ), '[]'::jsonb),
    'pricing', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', pricing.id,
        'stationBranchId', pricing.station_branch_id,
        'currencyCode', pricing.currency_code,
        'pricePerKg', pricing.price_per_kg,
        'deliveryBaseFee', pricing.delivery_base_fee,
        'platformFeeAmount', pricing.platform_fee_amount,
        'taxRatePercent', pricing.tax_rate_percent,
        'driverCommissionAmount', pricing.driver_commission_amount,
        'minKg', pricing.min_kg,
        'maxKg', pricing.max_kg,
        'status', pricing.status
      ) order by pricing.station_branch_id nulls last, pricing.effective_from desc)
      from public.lpg_refill_pricing pricing
      where pricing.status = 'active'
        and pricing.effective_from <= timezone('utc', now())
        and (pricing.effective_until is null or pricing.effective_until > timezone('utc', now()))
    ), '[]'::jsonb),
    'safetyIncidentTypes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', definition.key,
        'displayName', definition.display_name,
        'priority', definition.priority,
        'metadata', definition.metadata
      ) order by definition.priority, definition.key)
      from public.lpg_safety_incident_type_definitions definition where definition.status = 'active'
    ), '[]'::jsonb),
    'safetySeverities', coalesce((
      select jsonb_agg(jsonb_build_object(
        'key', definition.key,
        'displayName', definition.display_name,
        'priority', definition.priority,
        'metadata', definition.metadata
      ) order by definition.priority, definition.key)
      from public.lpg_safety_severity_definitions definition where definition.status = 'active'
    ), '[]'::jsonb),
    'geography', coalesce((
      select entry.value
      from public.configuration_entries entry
      where entry.namespace = 'platform.geography'
        and entry.key = 'search_policy'
        and entry.scope_type = 'global'
        and entry.status = 'active'
        and (entry.effective_from is null or entry.effective_from <= timezone('utc', now()))
        and (entry.effective_until is null or entry.effective_until > timezone('utc', now()))
      order by entry.version desc, entry.updated_at desc
      limit 1
    ), '{}'::jsonb)
  );
end;
$$;

revoke all on function public.read_lpg_runtime_config() from public, anon;
grant execute on function public.read_lpg_runtime_config() to authenticated, service_role;

commit;
