-- Fix SQLSTATE 42702 while saving the SKIMA Managed LPG buying reference.
-- The local module_id name collided with financial_policy_versions.module_id.
begin;
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
  resolved_module_id uuid;
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

  select id into resolved_module_id from public.business_modules where key='lpg' and status='active';
  if resolved_module_id is null then
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
    and version.module_id=resolved_module_id
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
    definition_record.id,next_version,'active',null,resolved_module_id,'lpg.refill.internal',
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
commit;
