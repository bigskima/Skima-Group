begin;

-- Customer-safe read model for the product-specific per-litre fuel fee schedule.
-- These values are deliberately readable by authenticated customers because
-- the same amounts must be reflected in the checkout estimate and server quote.
create or replace function public.read_fuel_product_fee_schedule()
returns table(
  product_key text,
  fee_key text,
  display_name text,
  description text,
  currency_code text,
  amount_per_litre numeric,
  policy_version_id uuid,
  policy_version integer,
  effective_from timestamptz
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='Authentication is required to read Fuel pricing';
  end if;

  return query
  select
    control.metadata->>'product_key',
    control.key,
    control.display_name,
    control.description,
    currency.code,
    coalesce(nullif(active_version.configuration#>>control.configuration_path,'')::numeric,0),
    active_version.id,
    active_version.version,
    active_version.effective_from
  from public.platform_fee_controls control
  join public.financial_policy_definitions definition
    on definition.key=control.policy_key
   and definition.status='active'
  cross join public.currency_definitions currency
  left join lateral (
    select candidate.*
    from public.financial_policy_versions candidate
    where candidate.policy_definition_id=definition.id
      and candidate.currency_code=currency.code
      and candidate.lifecycle_status='active'
      and candidate.effective_from<=timezone('utc',now())
      and (candidate.effective_until is null or candidate.effective_until>timezone('utc',now()))
      and candidate.module_id=(select module.id from public.business_modules module where module.key='fuel' limit 1)
      and candidate.service_key='fuel.order'
      and candidate.geography_type='global'
    order by candidate.priority desc,candidate.effective_from desc,candidate.version desc
    limit 1
  ) active_version on true
  where control.status='active'
    and currency.status='enabled'
    and control.key in ('fuel_pms_fee_per_litre','fuel_ago_fee_per_litre','fuel_dpk_fee_per_litre')
  order by currency.code,control.display_order;
end;
$$;

revoke all on function public.read_fuel_product_fee_schedule() from public,anon;
grant execute on function public.read_fuel_product_fee_schedule() to authenticated;

-- Fuel platform administrators can change only the three Fuel fee policies.
-- Other platform fees continue to use the existing Super Admin-only editor.
create or replace function public.set_fuel_product_fee(
  target_product_key text,
  target_currency_code text,
  target_amount_per_litre numeric,
  target_reason text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  target_fee_key text;
  control_record record;
  current_version public.financial_policy_versions%rowtype;
  new_policy_version_id uuid;
  next_version integer;
  now_at timestamptz:=timezone('utc',now());
  next_configuration jsonb;
begin
  if auth.uid() is null or not public.can_manage_fuel_platform() then
    raise exception using errcode='42501',message='Platform Fuel management permission is required to change Fuel markups';
  end if;

  target_fee_key:=case target_product_key
    when 'fuel.pms' then 'fuel_pms_fee_per_litre'
    when 'fuel.ago' then 'fuel_ago_fee_per_litre'
    when 'fuel.dpk' then 'fuel_dpk_fee_per_litre'
    else null
  end;

  if target_fee_key is null
     or target_currency_code is null
     or target_amount_per_litre is null or target_amount_per_litre<0
     or coalesce(length(btrim(target_reason)),0)<5
     or coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='A supported Fuel product, currency, non-negative per-litre fee, reason and idempotency key are required';
  end if;

  if not exists(
    select 1 from public.currency_definitions currency
    where currency.code=upper(target_currency_code) and currency.status='enabled'
  ) then
    raise exception using errcode='23514',message='Fuel fee currency must be enabled';
  end if;

  select control.*,definition.id as definition_id,definition.policy_family
  into control_record
  from public.platform_fee_controls control
  join public.financial_policy_definitions definition on definition.key=control.policy_key
  where control.key=target_fee_key
    and control.status='active'
    and definition.status='active';

  if not found then
    raise exception using errcode='P0002',message='The Fuel product fee control is not configured';
  end if;

  select * into current_version
  from public.financial_policy_versions version_record
  where version_record.policy_definition_id=control_record.definition_id
    and version_record.currency_code=upper(target_currency_code)
    and version_record.lifecycle_status='active'
    and version_record.effective_from<=now_at
    and (version_record.effective_until is null or version_record.effective_until>now_at)
    and version_record.module_id=(select module.id from public.business_modules module where module.key='fuel' limit 1)
    and version_record.service_key='fuel.order'
    and version_record.geography_type='global'
  order by version_record.priority desc,version_record.effective_from desc,version_record.version desc
  limit 1
  for update;

  if current_version.id is null then
    raise exception using errcode='23514',message='The Fuel fee has no active policy version for this currency';
  end if;

  if exists(
    select 1 from public.financial_policy_events event
    where event.idempotency_key=target_idempotency_key
  ) then
    return (
      select event.new_state
      from public.financial_policy_events event
      where event.idempotency_key=target_idempotency_key
      order by event.created_at desc
      limit 1
    );
  end if;

  if coalesce(nullif(current_version.configuration#>>control_record.configuration_path,'')::numeric,0)=target_amount_per_litre then
    return jsonb_build_object(
      'changed',false,
      'productKey',target_product_key,
      'feeKey',target_fee_key,
      'amountPerLitre',target_amount_per_litre,
      'currencyCode',upper(target_currency_code),
      'policyVersionId',current_version.id,
      'effectiveFrom',current_version.effective_from
    );
  end if;

  next_configuration:=jsonb_set(
    current_version.configuration,
    control_record.configuration_path,
    to_jsonb(target_amount_per_litre),
    true
  );
  next_version:=(
    select coalesce(max(version_record.version),0)+1
    from public.financial_policy_versions version_record
    where version_record.policy_definition_id=control_record.definition_id
  );

  update public.financial_policy_versions
  set lifecycle_status='superseded',
      effective_until=now_at,
      updated_at=now_at
  where id=current_version.id;

  insert into public.financial_policy_versions(
    policy_definition_id,version,lifecycle_status,organization_id,module_id,service_key,
    geography_type,geography_key,currency_code,priority,configuration,effective_from,
    effective_until,change_reason,validation_snapshot,based_on_version_id,supersedes_version_id,
    submitted_by,submitted_at,approved_by,approved_at,activated_by,activated_at,created_by
  )
  values(
    control_record.definition_id,next_version,'active',
    current_version.organization_id,current_version.module_id,current_version.service_key,
    current_version.geography_type,current_version.geography_key,upper(target_currency_code),
    current_version.priority,next_configuration,now_at,null,btrim(target_reason),
    public.validate_financial_policy_configuration(control_record.policy_family,next_configuration),
    current_version.id,current_version.id,
    auth.uid(),now_at,auth.uid(),now_at,auth.uid(),now_at,auth.uid()
  )
  returning id into new_policy_version_id;

  insert into public.financial_policy_events(
    policy_version_id,event_type,previous_state,new_state,reason,idempotency_key
  )
  values(
    new_policy_version_id,
    'activated',
    to_jsonb(current_version),
    jsonb_build_object(
      'changed',true,
      'productKey',target_product_key,
      'feeKey',target_fee_key,
      'amountPerLitre',target_amount_per_litre,
      'currencyCode',upper(target_currency_code),
      'policyVersionId',new_policy_version_id,
      'effectiveFrom',now_at
    ),
    btrim(target_reason),
    target_idempotency_key
  );

  return jsonb_build_object(
    'changed',true,
    'productKey',target_product_key,
    'feeKey',target_fee_key,
    'amountPerLitre',target_amount_per_litre,
    'currencyCode',upper(target_currency_code),
    'policyVersionId',new_policy_version_id,
    'effectiveFrom',now_at
  );
end;
$$;

revoke all on function public.set_fuel_product_fee(text,text,numeric,text,text) from public,anon;
grant execute on function public.set_fuel_product_fee(text,text,numeric,text,text) to authenticated;

-- Safe customer-read model: expose only active offer stock availability, not
-- tank identifiers, physical storage details, safety reserves or stock ledgers.
create or replace function public.read_fuel_customer_stock_availability()
returns table(
  branch_id uuid,
  product_key text,
  currency_code text,
  available_litres numeric
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='Authentication is required to read Fuel availability';
  end if;

  return query
  select
    offer.branch_id,
    offer.product_key,
    offer.currency_code,
    greatest(
      coalesce(sum(
        greatest(
          storage.physical_stock_litres
          - storage.reserved_stock_litres
          - storage.safety_reserve_litres,
          0
        )
      ) filter (where storage.status='active'),0),
      0
    )::numeric
  from public.fuel_branch_product_offers offer
  join public.fuel_products product
    on product.key=offer.product_key and product.status='enabled'
  left join public.fuel_station_storage_units storage
    on storage.branch_id=offer.branch_id
   and storage.product_key=offer.product_key
   and storage.status='active'
  where offer.status='active'
    and offer.effective_from<=timezone('utc',now())
    and (offer.effective_until is null or offer.effective_until>timezone('utc',now()))
  group by offer.branch_id,offer.product_key,offer.currency_code
  order by offer.product_key,offer.currency_code,offer.branch_id;
end;
$$;

revoke all on function public.read_fuel_customer_stock_availability() from public,anon;
grant execute on function public.read_fuel_customer_stock_availability() to authenticated;

-- Do not create a customer Fuel order that the station cannot currently
-- prepare from recorded, unreserved stock. The later atomic reservation still
-- owns the concurrency guarantee; this check prevents quoting an empty tank.
do $patch$
declare
  function_sql text;
  old_guard text;
  new_guard text;
begin
  select pg_get_functiondef(
    'public.create_fuel_order_with_quote(uuid,text,numeric,text,text,text,text,text,uuid,text,jsonb)'::regprocedure
  ) into function_sql;

  old_guard:=$old$  if not target_fulfillment_mode=any(offer_record.fulfillment_modes) then
    raise exception using errcode='23514',message='The selected fulfilment mode is unavailable for this station and product';
  end if;$old$;

  new_guard:=$new$  if not target_fulfillment_mode=any(offer_record.fulfillment_modes) then
    raise exception using errcode='23514',message='The selected fulfilment mode is unavailable for this station and product';
  end if;

  if coalesce((
    select sum(greatest(
      storage.physical_stock_litres
      - storage.reserved_stock_litres
      - storage.safety_reserve_litres,
      0
    ))
    from public.fuel_station_storage_units storage
    where storage.branch_id=target_branch_id
      and storage.product_key=target_product_key
      and storage.status='active'
  ),0)<target_requested_litres then
    raise exception using errcode='55000',message='This station does not currently have enough recorded fuel stock to accept the requested litres';
  end if;$new$;

  if position(old_guard in function_sql)=0 then
    raise exception 'Fuel order availability guard changed; refusing an unsafe patch';
  end if;
  execute replace(function_sql,old_guard,new_guard);
end;
$patch$;

commit;
