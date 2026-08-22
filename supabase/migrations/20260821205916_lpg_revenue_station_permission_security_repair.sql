begin;

-- Keep deployed platform-admin roles in sync with permissions added after the
-- role templates were originally materialized. Templates alone do not update
-- the live role_permissions rows used by authorization checks.
insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
cross join public.permissions permission_record
where role_record.key = 'platform.super_admin'
  and role_record.organization_id is null
  and role_record.status = 'active'
on conflict (role_id, permission_id) do nothing;

update public.platform_admin_role_templates template_record
set permission_keys = (
      select coalesce(
        array_agg(permission_record.key order by permission_record.key),
        array[]::text[]
      )
      from public.permissions permission_record
    ),
    metadata = template_record.metadata || jsonb_build_object(
      'permission_catalog_synchronized_at', timezone('utc', now())
    ),
    updated_at = timezone('utc', now())
where template_record.key = 'platform.super_admin'
  and template_record.status = 'active';

insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
join public.permissions permission_record
  on permission_record.key in ('platform.revenue.read', 'platform.revenue.manage')
where role_record.key = 'platform.finance_admin'
  and role_record.organization_id is null
  and role_record.status = 'active'
on conflict (role_id, permission_id) do nothing;

update public.platform_admin_role_templates template_record
set permission_keys = (
      select array(
        select distinct permission_key
        from unnest(
          coalesce(template_record.permission_keys, array[]::text[])
          || array['platform.revenue.read', 'platform.revenue.manage']::text[]
        ) permission_key
        order by permission_key
      )
    ),
    metadata = template_record.metadata || '{"revenue_authority":true}'::jsonb,
    updated_at = timezone('utc', now())
where template_record.key = 'platform.finance_admin'
  and template_record.status = 'active';

-- Preserve deployed station roles while moving authorization to the
-- business-scoped permission introduced by the partner-activation repair.
insert into public.role_permissions (role_id, permission_id, conditions)
select legacy_assignment.role_id, business_permission.id, legacy_assignment.conditions
from public.role_permissions legacy_assignment
join public.permissions legacy_permission
  on legacy_permission.id = legacy_assignment.permission_id
 and legacy_permission.key = 'platform.partner_price.manage'
join public.permissions business_permission
  on business_permission.key = 'business.partner_price.manage'
on conflict (role_id, permission_id) do nothing;

create or replace function public.can_manage_delegated_lpg_station_price(
  target_station_branch_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lpg_station_branches station
    where station.id = target_station_branch_id
      and station.approval_status = 'approved'
      and station.compliance_status = 'approved'
      and (
        auth.role() = 'service_role'
        or public.can_manage_lpg_operations()
        or public.has_permission_for_branch(
          'business.partner_price.manage',
          station.organization_id,
          station.branch_id
        )
      )
  );
$$;

-- Guard the delegated catalog invariant even when a caller reaches the generic
-- catalog engine instead of the station-price RPC.
create or replace function public.enforce_delegated_lpg_catalog_price()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  item_record public.catalog_items%rowtype;
  privileged_actor boolean;
  managed_lpg_price boolean;
begin
  select * into item_record
  from public.catalog_items
  where id = new.item_id;

  if not found then
    raise exception 'catalog price item is required';
  end if;

  if item_record.module_id is distinct from (
    select id from public.business_modules where key = 'lpg'
  ) then
    return new;
  end if;

  if new.organization_id <> item_record.organization_id
    or new.branch_id is distinct from item_record.branch_id then
    raise exception 'catalog price organization and branch must match its item';
  end if;

  privileged_actor := auth.role() = 'service_role'
    or public.can_manage_lpg_operations()
    or public.has_permission('platform.financial_policy.draft', null);

  managed_lpg_price := new.metadata ->> 'price_basis' = 'per_kg'
    or new.metadata ->> 'managed_field' = 'station_price_per_kg'
    or not privileged_actor;

  if managed_lpg_price and not exists (
    select 1
    from public.lpg_station_branches station
    where station.organization_id = new.organization_id
      and station.branch_id is not distinct from new.branch_id
      and station.approval_status = 'approved'
      and station.compliance_status = 'approved'
  ) then
    raise exception 'LPG station selling prices require an approved, compliant station branch';
  end if;

  if not privileged_actor and not public.has_permission_for_branch(
    'business.partner_price.manage', item_record.organization_id, item_record.branch_id
  ) then
    raise exception 'LPG station selling prices require delegated branch price permission';
  end if;

  if not managed_lpg_price then
    return new;
  end if;

  if new.amount <= 0
    or not exists (
      select 1
      from public.currency_definitions currency
      where currency.code = new.currency_code
        and currency.status = 'enabled'
    ) then
    raise exception 'delegated station price must be positive and use an enabled currency';
  end if;

  if not privileged_actor and (
    new.variant_id is not null
    or new.pricing_policy_id is not null
    or new.tax_behavior <> 'exempt'
    or new.status not in ('active', 'scheduled')
  ) then
    raise exception 'station users may manage only their branch LPG selling price per kilogram';
  end if;

  new.metadata := new.metadata || jsonb_build_object(
    'price_basis', 'per_kg',
    'managed_field', 'station_price_per_kg'
  );

  if exists (
    select 1
    from public.catalog_prices price
    join public.catalog_items item on item.id = price.item_id
    where price.id is distinct from new.id
      and price.organization_id = new.organization_id
      and price.branch_id is not distinct from new.branch_id
      and price.currency_code = new.currency_code
      and price.status in ('active', 'scheduled')
      and item.module_id = item_record.module_id
      and price.metadata ->> 'price_basis' = 'per_kg'
      and tstzrange(
        coalesce(price.effective_from, '-infinity'::timestamptz),
        price.effective_until,
        '[)'
      ) && tstzrange(
        coalesce(new.effective_from, '-infinity'::timestamptz),
        new.effective_until,
        '[)'
      )
  ) then
    raise exception 'LPG station catalog price conflicts with another effective per-kilogram price';
  end if;

  return new;
end;
$$;

-- Remove the second provisioning trigger introduced by the merged repair. The
-- canonical ensure_lpg_station_refill_catalog_item_after_write trigger remains.
drop trigger if exists provision_lpg_station_catalog_after_approval
on public.lpg_station_branches;
drop function if exists public.provision_lpg_station_catalog_after_approval();

-- SECURITY DEFINER changes current_user to the function owner. Authorization
-- must therefore use session_user plus the authenticated request context.
create or replace function public.ensure_lpg_station_refill_catalog_item(
  target_station_branch_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  station_record public.lpg_station_branches%rowtype;
  lpg_module_id uuid;
  item_id uuid;
  item_key text;
  item_idempotency_key text;
begin
  select * into station_record
  from public.lpg_station_branches
  where id = target_station_branch_id;

  if not found then
    raise exception 'target_station_branch_id must reference an LPG station';
  end if;

  if station_record.approval_status <> 'approved'
    or station_record.compliance_status <> 'approved' then
    return null;
  end if;

  if auth.role() <> 'service_role'
    and session_user not in ('postgres', 'supabase_admin')
    and not public.can_manage_lpg_operations()
    and not public.can_operate_lpg_station_branch(
      target_station_branch_id,
      'lpg.stations.manage'
    ) then
    raise exception 'LPG station management permission is required';
  end if;

  select module.id into lpg_module_id
  from public.business_modules module
  where module.key = 'lpg'
    and module.status = 'active'
  limit 1;

  if lpg_module_id is null then
    raise exception 'active LPG business module is required';
  end if;

  item_key := 'lpg.refill.' || replace(station_record.branch_id::text, '-', '');
  item_idempotency_key := 'station-refill:' || station_record.id::text;

  insert into public.catalog_items (
    organization_id,
    branch_id,
    module_id,
    category_id,
    key,
    item_type,
    display_name,
    description,
    fulfillment_methods,
    preparation_time_minutes,
    min_quantity,
    max_quantity,
    status,
    source,
    idempotency_key,
    metadata,
    created_by
  ) values (
    station_record.organization_id,
    station_record.branch_id,
    lpg_module_id,
    null,
    item_key,
    'service',
    'LPG Refill',
    'Per-kilogram LPG refill service supplied by this approved SKIMA station branch.',
    array['pickup_delivery']::text[],
    null,
    0.001,
    null,
    'active',
    'lpg.station_catalog_provisioning',
    item_idempotency_key,
    jsonb_build_object(
      'canonical_lpg_refill', true,
      'price_basis', 'per_kg',
      'station_branch_id', station_record.id,
      'managed_by', 'station_price_workflow'
    ),
    auth.uid()
  )
  on conflict (organization_id, key) do update
  set branch_id = excluded.branch_id,
      module_id = excluded.module_id,
      item_type = excluded.item_type,
      display_name = excluded.display_name,
      description = excluded.description,
      fulfillment_methods = excluded.fulfillment_methods,
      status = 'active',
      metadata = public.catalog_items.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into item_id;

  if item_id is null then
    select item.id into item_id
    from public.catalog_items item
    where item.organization_id = station_record.organization_id
      and item.key = item_key;
  end if;

  return item_id;
end;
$$;

revoke all on function public.ensure_lpg_station_refill_catalog_item(uuid)
from public, anon, authenticated;
grant execute on function public.ensure_lpg_station_refill_catalog_item(uuid)
to service_role;

revoke all on function public.ensure_lpg_station_refill_catalog_item_trigger()
from public, anon, authenticated;
grant execute on function public.ensure_lpg_station_refill_catalog_item_trigger()
to service_role;

-- This convenience RPC is a maker action only. It submits the new version to
-- the established financial-policy workflow and never self-reviews or activates
-- an approval-required commercial policy.
create or replace function public.configure_lpg_platform_revenue_rate(
  target_amount_per_kg numeric,
  target_reason text,
  target_idempotency_key text,
  target_effective_from timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_version public.financial_policy_versions%rowtype;
  requested_version public.financial_policy_versions%rowtype;
  requested_version_id uuid;
  lpg_module_id uuid;
  resolved_effective_from timestamptz;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.revenue.manage', null) then
    raise exception 'SKIMA revenue management permission is required';
  end if;

  if target_amount_per_kg is null or target_amount_per_kg < 0 then
    raise exception 'target_amount_per_kg must be zero or greater';
  end if;

  if target_reason is null or char_length(btrim(target_reason)) < 3 then
    raise exception 'a short reason is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select id into lpg_module_id
  from public.business_modules
  where key = 'lpg'
    and status = 'active'
  limit 1;

  if lpg_module_id is null then
    raise exception 'active LPG business module is required';
  end if;

  select version.*
  into current_version
  from public.financial_policy_versions version
  join public.financial_policy_definitions definition
    on definition.id = version.policy_definition_id
  where definition.key = 'pricing.lpg.platform_markup_per_kg'
    and version.currency_code = 'NGN'
    and version.module_id = lpg_module_id
    and version.organization_id is null
    and version.service_key = 'lpg.refill'
    and version.geography_type = 'global'
    and version.geography_key is null
    and version.lifecycle_status = 'active'
    and version.effective_from <= timezone('utc', now())
    and (
      version.effective_until is null
      or version.effective_until > timezone('utc', now())
    )
  order by version.priority desc, version.effective_from desc, version.version desc
  limit 1;

  if current_version.id is not null
    and nullif(current_version.configuration ->> 'amount_per_kg', '')::numeric
      = target_amount_per_kg then
    return public.read_lpg_platform_revenue_configuration('NGN')
      || jsonb_build_object(
        'changed', false,
        'pendingApproval', false,
        'pendingActivation', false,
        'requestStatus', 'active',
        'requestedAmountPerKg', target_amount_per_kg,
        'newPolicyVersionId', current_version.id
      );
  end if;

  select version.*
  into requested_version
  from public.financial_policy_versions version
  join public.financial_policy_definitions definition
    on definition.id = version.policy_definition_id
  where definition.key = 'pricing.lpg.platform_markup_per_kg'
    and version.currency_code = 'NGN'
    and version.module_id = lpg_module_id
    and version.organization_id is null
    and version.service_key = 'lpg.refill'
    and version.geography_type = 'global'
    and version.geography_key is null
    and version.lifecycle_status in ('submitted', 'approved', 'scheduled')
    and nullif(version.configuration ->> 'amount_per_kg', '')::numeric
      = target_amount_per_kg
  order by version.version desc
  limit 1;

  if requested_version.id is not null then
    return public.read_lpg_platform_revenue_configuration('NGN')
      || jsonb_build_object(
        'changed', true,
        'pendingApproval', requested_version.lifecycle_status = 'submitted',
        'pendingActivation', requested_version.lifecycle_status = 'approved',
        'requestStatus', requested_version.lifecycle_status,
        'requestedAmountPerKg', target_amount_per_kg,
        'newPolicyVersionId', requested_version.id
      );
  end if;

  resolved_effective_from := greatest(
    coalesce(target_effective_from, timezone('utc', now())),
    timezone('utc', now())
  );

  requested_version_id := public.create_financial_policy_version(
    target_policy_key => 'pricing.lpg.platform_markup_per_kg',
    target_display_name => 'LPG platform revenue per kilogram',
    target_policy_family => 'service_fee',
    target_currency_code => 'NGN',
    target_configuration => jsonb_build_object(
      'amount_per_kg', target_amount_per_kg,
      'component_key', 'lpg_platform_markup_per_kg',
      'quantity_sensitive', true
    ),
    target_effective_from => resolved_effective_from,
    target_change_reason => btrim(target_reason),
    target_idempotency_key => target_idempotency_key || ':draft',
    target_module_key => 'lpg',
    target_organization_id => null,
    target_service_key => 'lpg.refill',
    target_geography_type => 'global',
    target_geography_key => null,
    target_effective_until => null,
    target_priority => coalesce(current_version.priority, 100),
    target_approval_required => true,
    target_allow_partner_delegation => false,
    target_based_on_version_id => current_version.id,
    target_supersedes_version_id => current_version.id,
    target_rollback_of_version_id => null,
    target_metadata => jsonb_build_object(
      'simple_revenue_control', true,
      'approval_workflow_required', true
    )
  );

  select * into requested_version
  from public.financial_policy_versions
  where id = requested_version_id
  for update;

  if requested_version.lifecycle_status = 'draft' then
    perform public.submit_financial_policy_version(
      requested_version_id,
      btrim(target_reason),
      target_idempotency_key || ':submit'
    );
  end if;

  select * into requested_version
  from public.financial_policy_versions
  where id = requested_version_id;

  return public.read_lpg_platform_revenue_configuration('NGN')
    || jsonb_build_object(
      'changed', true,
      'pendingApproval', requested_version.lifecycle_status = 'submitted',
      'pendingActivation', requested_version.lifecycle_status = 'approved',
      'requestStatus', requested_version.lifecycle_status,
      'requestedAmountPerKg', target_amount_per_kg,
      'newPolicyVersionId', requested_version_id
    );
end;
$$;

revoke all on function public.configure_lpg_platform_revenue_rate(
  numeric, text, text, timestamptz
) from public, anon;
grant execute on function public.configure_lpg_platform_revenue_rate(
  numeric, text, text, timestamptz
) to authenticated, service_role;

-- Prefer the effective current price, then the nearest scheduled price. The
-- previous descending scheduled ordering selected the farthest future version.
create or replace function public.read_lpg_station_catalog_prices(
  target_station_branch_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  station_record public.lpg_station_branches%rowtype;
  lpg_module_id uuid;
begin
  select * into station_record
  from public.lpg_station_branches station
  where (target_station_branch_id is null or station.id = target_station_branch_id)
    and public.can_read_lpg_station_branch(station.id)
  order by station.created_at asc
  limit 1;

  if not found then
    raise exception 'branch-scoped LPG station access is required';
  end if;

  select id into lpg_module_id
  from public.business_modules
  where key = 'lpg'
    and status = 'active'
  limit 1;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id', catalog_price.id,
        'itemId', catalog_item.id,
        'itemKey', catalog_item.key,
        'displayName', catalog_item.display_name,
        'currencyCode', coalesce(catalog_price.currency_code, 'NGN'),
        'pricePerKg', catalog_price.amount,
        'status', coalesce(catalog_price.status, 'unpriced'),
        'priceConfigured', catalog_price.id is not null,
        'effectiveFrom', catalog_price.effective_from,
        'effectiveUntil', catalog_price.effective_until,
        'createdAt', coalesce(catalog_price.created_at, catalog_item.created_at)
      )
      order by catalog_item.display_name
    )
    from public.catalog_items catalog_item
    left join lateral (
      select price.*
      from public.catalog_prices price
      where price.organization_id = station_record.organization_id
        and price.branch_id is not distinct from station_record.branch_id
        and price.item_id = catalog_item.id
        and price.currency_code = 'NGN'
        and price.metadata ->> 'price_basis' = 'per_kg'
        and price.status in ('active', 'scheduled')
      order by
        case
          when price.status = 'active'
            and price.effective_from <= timezone('utc', now())
            and (
              price.effective_until is null
              or price.effective_until > timezone('utc', now())
            )
          then 0
          when price.effective_from > timezone('utc', now()) then 1
          else 2
        end,
        case
          when price.effective_from > timezone('utc', now())
          then price.effective_from
          else null
        end asc,
        price.effective_from desc
      limit 1
    ) catalog_price on true
    where catalog_item.organization_id = station_record.organization_id
      and catalog_item.branch_id is not distinct from station_record.branch_id
      and catalog_item.module_id = lpg_module_id
      and catalog_item.status = 'active'
      and catalog_item.metadata ->> 'price_basis' = 'per_kg'
  ), '[]'::jsonb);
end;
$$;

comment on column public.lpg_refill_orders.quoted_kg is
  'Accepted quote quantity retained on the order snapshot for financial reconciliation; populated and protected by the LPG order workflow.';

notify pgrst, 'reload schema';

commit;