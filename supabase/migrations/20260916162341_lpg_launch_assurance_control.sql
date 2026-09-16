begin;

alter table public.lpg_refill_quotes
  alter column pricing_id drop not null;

alter table public.lpg_refill_quotes
  add column if not exists fulfillment_channel text not null default 'marketplace';

alter table public.lpg_refill_orders
  add column if not exists fulfillment_channel text not null default 'marketplace';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lpg_refill_quotes'::regclass
      and conname = 'lpg_refill_quotes_fulfillment_channel_check'
  ) then
    alter table public.lpg_refill_quotes
      add constraint lpg_refill_quotes_fulfillment_channel_check
      check (fulfillment_channel in ('marketplace','skima_internal'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.lpg_refill_orders'::regclass
      and conname = 'lpg_refill_orders_fulfillment_channel_check'
  ) then
    alter table public.lpg_refill_orders
      add constraint lpg_refill_orders_fulfillment_channel_check
      check (fulfillment_channel in ('marketplace','skima_internal'));
  end if;
end
$$;

create index if not exists lpg_refill_quotes_fulfillment_channel_idx
  on public.lpg_refill_quotes (fulfillment_channel, created_at desc);
create index if not exists lpg_refill_orders_fulfillment_channel_idx
  on public.lpg_refill_orders (fulfillment_channel, status, updated_at desc);

insert into public.financial_policy_definitions(
  key, display_name, policy_family, value_schema, approval_required,
  allow_partner_delegation, status, metadata
)
values
(
  'pricing.lpg.internal_reference_per_kg',
  'LPG Internal Reference Price Per Kg',
  'pricing',
  jsonb_build_object(
    'type','object',
    'required',jsonb_build_array('amount_per_kg','estimated_route_km','max_supplier_variance_percent')
  ),
  true, false, 'active',
  jsonb_build_object(
    'purpose','Geography-scoped customer LPG reference price for SKIMA internal fulfillment',
    'adminSurface','launch_assurance'
  )
),
(
  'payout.lpg.internal_driver',
  'LPG Internal Driver Compensation',
  'payout',
  jsonb_build_object(
    'type','object',
    'required',jsonb_build_array('calculation_kind','percentage')
  ),
  true, false, 'active',
  jsonb_build_object(
    'purpose','Internal driver accrued earning policy; never a self-withdrawable driver wallet payout',
    'adminSurface','launch_assurance'
  )
),
(
  'settlement.lpg.internal',
  'LPG Internal Fulfillment Settlement',
  'settlement',
  jsonb_build_object('type','object'),
  true, false, 'active',
  jsonb_build_object(
    'purpose','Internal fulfillment accounting contract',
    'adminSurface','launch_assurance'
  )
)
on conflict (key) do update
set display_name = excluded.display_name,
    value_schema = excluded.value_schema,
    metadata = public.financial_policy_definitions.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

insert into public.financial_policy_versions(
  policy_definition_id, version, lifecycle_status, module_id, service_key,
  geography_type, geography_key, currency_code, priority, configuration,
  effective_from, change_reason, validation_snapshot,
  submitted_at, approved_at, activated_at
)
select
  definition.id, 1, 'active', module.id, 'lpg.refill.internal',
  'global', null, 'NGN', 100,
  jsonb_build_object(
    'calculation_kind','percentage_of_delivery_fee',
    'percentage',0,
    'allow_zero_amount',false
  ),
  timezone('utc', now()),
  'Launch assurance foundation seed; requires explicit admin compensation setup.',
  public.validate_financial_policy_configuration(
    'payout',
    jsonb_build_object(
      'calculation_kind','percentage_of_delivery_fee',
      'percentage',0,
      'allow_zero_amount',false
    )
  ),
  timezone('utc', now()), timezone('utc', now()), timezone('utc', now())
from public.financial_policy_definitions definition
join public.business_modules module on module.key='lpg'
where definition.key='payout.lpg.internal_driver'
  and not exists (
    select 1 from public.financial_policy_versions existing
    where existing.policy_definition_id=definition.id
  );

insert into public.financial_policy_versions(
  policy_definition_id, version, lifecycle_status, module_id, service_key,
  geography_type, geography_key, currency_code, priority, configuration,
  effective_from, change_reason, validation_snapshot,
  submitted_at, approved_at, activated_at
)
select
  definition.id, 1, 'active', module.id, 'lpg.refill.internal.settlement',
  'global', null, 'NGN', 100,
  jsonb_build_object(
    'customer_funds_destination','skima_internal_clearing',
    'supplier_procurement_record_required',true,
    'driver_earning_mode','accrued_internal',
    'driver_self_withdrawal',false
  ),
  timezone('utc', now()),
  'Launch assurance internal settlement contract.',
  public.validate_financial_policy_configuration(
    'settlement',
    jsonb_build_object(
      'customer_funds_destination','skima_internal_clearing',
      'supplier_procurement_record_required',true,
      'driver_earning_mode','accrued_internal',
      'driver_self_withdrawal',false
    )
  ),
  timezone('utc', now()), timezone('utc', now()), timezone('utc', now())
from public.financial_policy_definitions definition
join public.business_modules module on module.key='lpg'
where definition.key='settlement.lpg.internal'
  and not exists (
    select 1 from public.financial_policy_versions existing
    where existing.policy_definition_id=definition.id
  );

insert into public.settlement_policies(
  key, display_name, scope_type, scope_id, flow_schema, beneficiary_schema,
  release_policy, status, version
)
select
  'settlement.lpg.escrow.skima-internal.v1',
  'LPG SKIMA Internal Escrow Settlement',
  'module',
  module.id,
  jsonb_build_object(
    'intake','customer_to_platform_gateway',
    'holding_wallet','escrow',
    'physical_supplier_is_platform_beneficiary',false,
    'direct_driver_payment',false,
    'driver_self_withdrawal',false
  ),
  jsonb_build_object(
    'beneficiaries',
    jsonb_build_array(
      jsonb_build_object(
        'role','platform_internal_operations',
        'amount_source','accepted_internal_quote',
        'release_event','event.delivery.completed'
      ),
      jsonb_build_object(
        'role','internal_driver',
        'amount_source','internal_driver_compensation_policy',
        'accounting_mode','accrual_only'
      )
    )
  ),
  jsonb_build_object(
    'release_controller','workflow_engine',
    'supplier_payment_controller','internal_procurement',
    'refund_controller','escrow_engine',
    'dispute_controller','policy_engine'
  ),
  'active',
  1
from public.business_modules module
where module.key='lpg'
  and not exists (
    select 1 from public.settlement_policies policy
    where policy.key='settlement.lpg.escrow.skima-internal.v1'
      and policy.version=1
  );

insert into public.lpg_operation_policies(
  key, display_name, policy_kind, priority, policy, status, source,
  idempotency_key, metadata
)
values(
  'lpg.fulfillment.launch_assurance',
  'LPG Launch Assurance Fulfillment',
  'config',
  100,
  jsonb_build_object(
    'enabled',false,
    'mode','hybrid',
    'priority','marketplace_first',
    'marketplace_first_fallback_only',true,
    'internal_driver_program_key','driver.skima_special',
    'digital_station_id','00000000-0000-0000-0000-000000000001',
    'digital_station_label','SKIMA Fulfillment',
    'require_supplier_receipt',true
  ),
  'active',
  'lpg.launch_assurance',
  'lpg-launch-assurance-v1',
  jsonb_build_object(
    'additive',true,
    'marketplace_unchanged',true,
    'disabled_by_default',true
  )
)
on conflict (key) do update
set metadata=public.lpg_operation_policies.metadata || excluded.metadata,
    updated_at=timezone('utc',now());

create or replace function public.read_lpg_launch_assurance_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  config public.lpg_operation_policies%rowtype;
  driver_policy jsonb;
begin
  if auth.role()<>'service_role'
    and not public.has_permission('platform.dispatch.read',null)
    and not public.has_permission('platform.dispatch.manage',null)
    and not public.has_permission('platform.financial_policy.read',null)
    and not public.is_platform_super_admin() then
    raise exception using errcode='42501',message='LPG launch assurance read permission is required';
  end if;

  select * into config
  from public.lpg_operation_policies
  where key='lpg.fulfillment.launch_assurance' and status='active'
  limit 1;

  if not found then
    raise exception using errcode='55000',message='active LPG launch assurance configuration is required';
  end if;

  driver_policy:=public.resolve_financial_policy(
    'payout.lpg.internal_driver','NGN',timezone('utc',now()),
    'lpg',null,'lpg.refill.internal','global',null
  );

  return jsonb_build_object(
    'enabled',coalesce((config.policy->>'enabled')::boolean,false),
    'mode',coalesce(config.policy->>'mode','hybrid'),
    'priority',coalesce(config.policy->>'priority','marketplace_first'),
    'marketplaceFirstFallbackOnly',coalesce((config.policy->>'marketplace_first_fallback_only')::boolean,true),
    'internalDriverProgramKey',coalesce(config.policy->>'internal_driver_program_key','driver.skima_special'),
    'digitalStationId',coalesce(config.policy->>'digital_station_id','00000000-0000-0000-0000-000000000001'),
    'digitalStationLabel',coalesce(config.policy->>'digital_station_label','SKIMA Fulfillment'),
    'requireSupplierReceipt',coalesce((config.policy->>'require_supplier_receipt')::boolean,true),
    'driverCompensation',driver_policy,
    'updatedAt',config.updated_at
  );
end
$$;

create or replace function public.set_lpg_launch_assurance_configuration(
  target_enabled boolean,
  target_mode text,
  target_priority text,
  target_marketplace_first_fallback_only boolean,
  target_reason text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  config public.lpg_operation_policies%rowtype;
begin
  if auth.role()<>'service_role'
    and not public.has_permission('platform.dispatch.manage',null)
    and not public.is_platform_super_admin() then
    raise exception using errcode='42501',message='dispatch management permission is required';
  end if;
  if target_enabled is null then
    raise exception using errcode='22023',message='enabled setting is required';
  end if;
  if target_mode not in ('marketplace_only','internal_only','hybrid') then
    raise exception using errcode='22023',message='mode must be marketplace_only, internal_only, or hybrid';
  end if;
  if target_priority not in ('marketplace_first','internal_first') then
    raise exception using errcode='22023',message='priority must be marketplace_first or internal_first';
  end if;
  if char_length(btrim(coalesce(target_reason,'')))<3
    or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='change reason and idempotency key are required';
  end if;

  select * into config
  from public.lpg_operation_policies
  where key='lpg.fulfillment.launch_assurance' and status='active'
  for update;
  if not found then
    raise exception using errcode='55000',message='active LPG launch assurance configuration is required';
  end if;

  if config.metadata->>'lastIdempotencyKey'=target_idempotency_key then
    return public.read_lpg_launch_assurance_configuration();
  end if;

  update public.lpg_operation_policies
  set policy=policy || jsonb_build_object(
        'enabled',target_enabled,
        'mode',target_mode,
        'priority',target_priority,
        'marketplace_first_fallback_only',coalesce(target_marketplace_first_fallback_only,true)
      ),
      metadata=metadata || jsonb_build_object(
        'lastReason',btrim(target_reason),
        'lastIdempotencyKey',target_idempotency_key,
        'lastChangedBy',auth.uid(),
        'lastChangedAt',timezone('utc',now())
      ),
      updated_at=timezone('utc',now())
  where id=config.id;

  return public.read_lpg_launch_assurance_configuration();
end
$$;

create or replace function public.set_lpg_internal_driver_compensation(
  target_percentage numeric,
  target_reason text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if auth.role()<>'service_role'
    and not public.has_permission('platform.financial_policy.draft',null)
    and not public.is_platform_super_admin() then
    raise exception using errcode='42501',message='financial policy management permission is required';
  end if;
  if target_percentage is null or target_percentage<=0 or target_percentage>100 then
    raise exception using errcode='22023',message='internal driver percentage must be greater than 0 and no more than 100';
  end if;

  return public.set_active_financial_policy_configuration(
    'payout.lpg.internal_driver',
    jsonb_build_object(
      'calculation_kind','percentage_of_delivery_fee',
      'percentage',round(target_percentage,4),
      'allow_zero_amount',false
    ),
    target_reason,
    target_idempotency_key,
    'NGN',
    'lpg',
    'lpg.refill.internal',
    null,
    'global',
    null
  );
end
$$;

create or replace function public.set_lpg_internal_reference_price(
  target_geography_type text,
  target_geography_key text,
  target_price_per_kg numeric,
  target_estimated_route_km numeric,
  target_max_supplier_variance_percent numeric,
  target_reason text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  definition_record public.financial_policy_definitions%rowtype;
  module_id uuid;
  current_version public.financial_policy_versions%rowtype;
  new_version_id uuid;
  next_version integer;
  now_at timestamptz:=timezone('utc',now());
  config jsonb;
  validation jsonb;
begin
  if auth.role()<>'service_role'
    and not public.has_permission('platform.financial_policy.draft',null)
    and not public.is_platform_super_admin() then
    raise exception using errcode='42501',message='financial policy management permission is required';
  end if;
  if target_geography_type <> 'service_area' then
    raise exception using errcode='22023',message='internal LPG reference price must be scoped to a configured service_area';
  end if;
  if coalesce(btrim(target_geography_key),'')='' then
    raise exception using errcode='22023',message='geography key is required';
  end if;
  if target_price_per_kg is null or target_price_per_kg<=0 then
    raise exception using errcode='22023',message='price per kg must be greater than zero';
  end if;
  if target_estimated_route_km is null or target_estimated_route_km<0 then
    raise exception using errcode='22023',message='estimated route kilometres cannot be negative';
  end if;
  if target_max_supplier_variance_percent is null
    or target_max_supplier_variance_percent<0
    or target_max_supplier_variance_percent>100 then
    raise exception using errcode='22023',message='supplier variance percent must be between 0 and 100';
  end if;
  if char_length(btrim(coalesce(target_reason,'')))<3
    or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='change reason and idempotency key are required';
  end if;

  select * into definition_record
  from public.financial_policy_definitions
  where key='pricing.lpg.internal_reference_per_kg' and status='active'
  for update;
  if not found then
    raise exception using errcode='55000',message='internal LPG reference price policy definition is missing';
  end if;

  select id into module_id from public.business_modules where key='lpg' and status='active';
  if module_id is null then
    raise exception using errcode='55000',message='active LPG module is required';
  end if;

  if exists (
    select 1
    from public.financial_policy_events event
    join public.financial_policy_versions version on version.id=event.policy_version_id
    where version.policy_definition_id=definition_record.id
      and event.idempotency_key=target_idempotency_key||':activated'
  ) then
    select jsonb_build_object(
      'changed',false,
      'policyKey',definition_record.key,
      'policyVersionId',version.id,
      'version',version.version,
      'configuration',version.configuration,
      'geographyType',version.geography_type,
      'geographyKey',version.geography_key,
      'effectiveFrom',version.effective_from
    )
    into config
    from public.financial_policy_events event
    join public.financial_policy_versions version on version.id=event.policy_version_id
    where version.policy_definition_id=definition_record.id
      and event.idempotency_key=target_idempotency_key||':activated'
    order by event.created_at desc
    limit 1;
    return config;
  end if;

  config:=jsonb_build_object(
    'amount_per_kg',round(target_price_per_kg,2),
    'estimated_route_km',round(target_estimated_route_km,3),
    'max_supplier_variance_percent',round(target_max_supplier_variance_percent,4)
  );
  validation:=public.validate_financial_policy_configuration('pricing',config);

  select * into current_version
  from public.financial_policy_versions version
  where version.policy_definition_id=definition_record.id
    and version.currency_code='NGN'
    and version.module_id=module_id
    and version.organization_id is null
    and version.service_key='lpg.refill.internal'
    and version.geography_type=target_geography_type
    and version.geography_key=target_geography_key
    and version.lifecycle_status='active'
    and version.effective_from<=now_at
    and (version.effective_until is null or version.effective_until>now_at)
  order by version.effective_from desc,version.version desc
  limit 1
  for update;

  if current_version.id is not null and current_version.configuration=config then
    return jsonb_build_object(
      'changed',false,
      'policyKey',definition_record.key,
      'policyVersionId',current_version.id,
      'version',current_version.version,
      'configuration',current_version.configuration,
      'geographyType',current_version.geography_type,
      'geographyKey',current_version.geography_key,
      'effectiveFrom',current_version.effective_from
    );
  end if;

  select coalesce(max(version),0)+1 into next_version
  from public.financial_policy_versions
  where policy_definition_id=definition_record.id;

  if current_version.id is not null then
    update public.financial_policy_versions
    set lifecycle_status='superseded',
        effective_until=now_at,
        updated_at=now_at
    where id=current_version.id;
  end if;

  insert into public.financial_policy_versions(
    policy_definition_id,version,lifecycle_status,organization_id,module_id,service_key,
    geography_type,geography_key,currency_code,priority,configuration,effective_from,
    change_reason,validation_snapshot,based_on_version_id,supersedes_version_id,
    submitted_by,submitted_at,approved_by,approved_at,activated_by,activated_at,created_by
  ) values(
    definition_record.id,next_version,'active',null,module_id,'lpg.refill.internal',
    target_geography_type,target_geography_key,'NGN',100,config,now_at,
    btrim(target_reason),validation,current_version.id,current_version.id,
    auth.uid(),now_at,auth.uid(),now_at,auth.uid(),now_at,auth.uid()
  )
  returning id into new_version_id;

  if current_version.id is not null then
    insert into public.financial_policy_events(
      policy_version_id,event_type,actor_user_id,previous_state,new_state,reason,idempotency_key
    ) values(
      current_version.id,'superseded',auth.uid(),to_jsonb(current_version),
      jsonb_build_object('lifecycle_status','superseded','effective_until',now_at,'supersededByPolicyVersionId',new_version_id),
      btrim(target_reason),target_idempotency_key||':superseded'
    ) on conflict(policy_version_id,idempotency_key) do nothing;
  end if;

  insert into public.financial_policy_events(
    policy_version_id,event_type,actor_user_id,previous_state,new_state,reason,idempotency_key
  ) values(
    new_version_id,'activated',auth.uid(),null,
    jsonb_build_object(
      'changed',true,'policyKey',definition_record.key,'policyVersionId',new_version_id,
      'version',next_version,'configuration',config,'geographyType',target_geography_type,
      'geographyKey',target_geography_key,'effectiveFrom',now_at
    ),
    btrim(target_reason),target_idempotency_key||':activated'
  ) on conflict(policy_version_id,idempotency_key) do nothing;

  return jsonb_build_object(
    'changed',true,
    'policyKey',definition_record.key,
    'policyVersionId',new_version_id,
    'version',next_version,
    'configuration',config,
    'geographyType',target_geography_type,
    'geographyKey',target_geography_key,
    'effectiveFrom',now_at
  );
end
$$;

notify pgrst,'reload schema';
commit;
