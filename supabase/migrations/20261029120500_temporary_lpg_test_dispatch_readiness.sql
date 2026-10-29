begin;

-- Enable explicitly temporary, test-funded LPG lifecycle actors without making
-- these synthetic actors eligible for ordinary customer orders.
do $test_dispatch_readiness$
declare
  v_batch_id uuid;
  v_latitude numeric;
  v_longitude numeric;
  v_driver_ids uuid[];
  v_vehicle_ids uuid[];
  v_function_sql text;
  v_before text;
  v_after text;
begin
  select id into v_batch_id
  from public.wallet_test_funding_batches
  where label='skima-lpg-flow-test-20261029' and status='active'
  order by created_at desc
  limit 1;

  -- This is an opt-in, temporary production test fixture migration. Clean
  -- local/CI databases may not contain the manually issued active test batch;
  -- do not make all subsequent application migrations fail in those environments.
  if v_batch_id is null then
    return;
  end if;

  -- Use the live test order's saved pickup location, not a hard-coded order ID.
  select pickup.latitude,pickup.longitude
    into v_latitude,v_longitude
  from public.lpg_refill_orders target_order
  join public.lpg_customer_locations pickup on pickup.id=target_order.pickup_location_id
  join public.wallet_accounts customer_wallet
    on customer_wallet.owner_entity_type='user'
   and customer_wallet.owner_entity_id=target_order.customer_user_id
   and customer_wallet.wallet_type='customer'
   and customer_wallet.currency_code=target_order.currency_code
  join public.wallet_test_funding_allocations allocation
    on allocation.wallet_id=customer_wallet.id
   and allocation.batch_id=v_batch_id
   and allocation.remaining_amount>0
  where target_order.status='awaiting_payment'
  order by target_order.created_at desc
  limit 1;

  -- Awka launch-area fallback, only used if no funded test order is pending.
  v_latitude := coalesce(v_latitude,6.2284411);
  v_longitude := coalesce(v_longitude,7.0813507);

  select array_agg(driver.id order by driver.id),
         array_agg(distinct link.vehicle_id order by link.vehicle_id)
    into v_driver_ids,v_vehicle_ids
  from public.driver_profiles driver
  join public.driver_vehicle_links link
    on link.driver_profile_id=driver.id
   and link.relationship_type='driver_owned'
   and link.status='active'
   and link.starts_at<=timezone('utc',now())
   and (link.ends_at is null or link.ends_at>timezone('utc',now()))
  join public.vehicles vehicle
    on vehicle.id=link.vehicle_id
   and vehicle.status='active'
  where driver.metadata->>'gate'='lpg_lifecycle'
    and driver.verification_status='approved'
    and driver.operational_status in ('available','busy')
    and vehicle.metadata->>'gate'='lpg_lifecycle';

  if coalesce(cardinality(v_driver_ids),0)=0 or coalesce(cardinality(v_vehicle_ids),0)=0 then
    raise exception 'Expected pre-seeded LPG lifecycle test drivers and vehicles were not found';
  end if;

  update public.driver_profiles
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'temporary_lpg_test_fixture',true,
    'temporary_lpg_test_batch_id',v_batch_id,
    'temporary_lpg_test_location',jsonb_build_object('latitude',v_latitude,'longitude',v_longitude)
  ),
  updated_at=timezone('utc',now())
  where id=any(v_driver_ids);

  update public.vehicles
  set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
    'temporary_lpg_test_fixture',true,
    'temporary_lpg_test_batch_id',v_batch_id
  ),
  updated_at=timezone('utc',now())
  where id=any(v_vehicle_ids);

  -- The existing lifecycle fixtures are intentionally test identities.
  -- Record clearly marked synthetic compliance evidence for lifecycle testing;
  -- these rows are only eligible for orders backed by the active test batch.
  insert into public.compliance_evidence(
    requirement_key,subject_type,subject_id,status,valid_from,valid_until,metadata
  )
  select requirement.key,'driver',driver.id,'valid',current_date,current_date+30,
    jsonb_build_object(
      'temporary_lpg_test_fixture',true,
      'temporary_lpg_test_batch_id',v_batch_id,
      'note','Synthetic test-fixture evidence; not a real-world verification'
    )
  from public.driver_profiles driver
  join public.compliance_requirement_definitions requirement
    on requirement.subject_type='driver'
   and requirement.status='active'
   and requirement.required
   and (requirement.module_key is null or requirement.module_key='lpg')
  where driver.id=any(v_driver_ids)
    and not exists(
      select 1 from public.compliance_evidence existing
      where existing.requirement_key=requirement.key
        and existing.subject_type='driver'
        and existing.subject_id=driver.id
        and existing.status='valid'
        and (existing.valid_from is null or existing.valid_from<=current_date)
        and (existing.valid_until is null or existing.valid_until>=current_date)
    );

  insert into public.compliance_evidence(
    requirement_key,subject_type,subject_id,status,valid_from,valid_until,metadata
  )
  select requirement.key,'vehicle',vehicle.id,'valid',current_date,current_date+30,
    jsonb_build_object(
      'temporary_lpg_test_fixture',true,
      'temporary_lpg_test_batch_id',v_batch_id,
      'note','Synthetic test-fixture evidence; not a real-world verification'
    )
  from public.vehicles vehicle
  join public.compliance_requirement_definitions requirement
    on requirement.subject_type='vehicle'
   and requirement.status='active'
   and requirement.required
   and (requirement.module_key is null or requirement.module_key='lpg')
  where vehicle.id=any(v_vehicle_ids)
    and not exists(
      select 1 from public.compliance_evidence existing
      where existing.requirement_key=requirement.key
        and existing.subject_type='vehicle'
        and existing.subject_id=vehicle.id
        and existing.status='valid'
        and (existing.valid_from is null or existing.valid_from<=current_date)
        and (existing.valid_until is null or existing.valid_until>=current_date)
    );

  insert into public.entity_capabilities(entity_type,entity_id,capability_key,status,verified_at,constraints)
  select 'driver',driver_id,'capability.driver.cylinder-handling','active',timezone('utc',now()),
         jsonb_build_object('temporary_lpg_test_fixture',true,'batch_id',v_batch_id)
  from unnest(v_driver_ids) as fixture(driver_id)
  where not exists(
    select 1 from public.entity_capabilities existing
    where existing.entity_type='driver'
      and existing.entity_id=fixture.driver_id
      and existing.capability_key='capability.driver.cylinder-handling'
      and existing.status='active'
  );

  insert into public.entity_capabilities(entity_type,entity_id,capability_key,status,verified_at,constraints)
  select 'vehicle',vehicle_id,'capability.cargo.pressurized-cylinder','active',timezone('utc',now()),
         jsonb_build_object('temporary_lpg_test_fixture',true,'batch_id',v_batch_id)
  from unnest(v_vehicle_ids) as fixture(vehicle_id)
  where not exists(
    select 1 from public.entity_capabilities existing
    where existing.entity_type='vehicle'
      and existing.entity_id=fixture.vehicle_id
      and existing.capability_key='capability.cargo.pressurized-cylinder'
      and existing.status='active'
  );

  -- Give only the lifecycle fixture drivers a clearly labelled synthetic test
  -- location. The dispatch guard below keeps this location out of normal orders.
  insert into public.driver_location_state(
    driver_id,point,captured_at,received_at,status,metadata,updated_at
  )
  select driver.id,
         extensions.st_setsrid(extensions.st_makepoint(v_longitude,v_latitude),4326)::extensions.geography,
         timezone('utc',now()),timezone('utc',now()),'available',
         jsonb_build_object('temporary_lpg_test_fixture',true,'temporary_lpg_test_batch_id',v_batch_id,
                            'source','temporary_lpg-test-setup'),
         timezone('utc',now())
  from public.driver_profiles driver
  where driver.id=any(v_driver_ids)
  on conflict(driver_id) do update
    set point=excluded.point,
        captured_at=excluded.captured_at,
        received_at=excluded.received_at,
        status='available',
        metadata=public.driver_location_state.metadata||excluded.metadata,
        updated_at=timezone('utc',now());

  insert into public.operational_coverage_assignments(
    entity_type,entity_id,service_key,coverage_type,center_point,radius_meters,
    status,source,valid_from,approved_at,metadata
  )
  select 'DRIVER',driver_id,'lpg','RADIUS',
         extensions.st_setsrid(extensions.st_makepoint(v_longitude,v_latitude),4326)::extensions.geography,
         50000,'active','ADMIN_ASSIGNED',timezone('utc',now()),timezone('utc',now()),
         jsonb_build_object('temporary_lpg_test_fixture',true,'temporary_lpg_test_batch_id',v_batch_id,
                            'reason','Temporary controlled LPG flow testing')
  from unnest(v_driver_ids) as fixture(driver_id)
  where not exists(
    select 1 from public.operational_coverage_assignments existing
    where existing.entity_type='DRIVER'
      and existing.entity_id=fixture.driver_id
      and existing.service_key='lpg'
      and existing.metadata->>'temporary_lpg_test_batch_id'=v_batch_id::text
      and existing.status='active'
  );

  -- Test fixture drivers/vehicles are eligible only when the order belongs to
  -- a customer with an active, unspent allocation in the temporary test batch.
  -- Non-test orders retain the normal driver qualification, coverage and
  -- location-freshness requirements.
  v_function_sql:=pg_get_functiondef('public.dispatch_lpg_order(uuid,integer,text,text)'::regprocedure);

  if position('temporary_lpg_test_fixture' in v_function_sql)=0 then
    v_before:='where driver.verification_status=''approved''';
    v_after:=$replacement$
where (
        coalesce(driver.metadata->>'temporary_lpg_test_fixture','false') <> 'true'
        or exists (
          select 1
          from public.wallet_accounts test_wallet
          join public.wallet_test_funding_allocations test_allocation on test_allocation.wallet_id=test_wallet.id
          join public.wallet_test_funding_batches test_batch on test_batch.id=test_allocation.batch_id
          where test_wallet.owner_entity_type='user'
            and test_wallet.owner_entity_id=order_record.customer_user_id
            and test_wallet.wallet_type='customer'
            and test_wallet.currency_code=order_record.currency_code
            and test_batch.status='active'
            and test_allocation.remaining_amount>0
        )
      )
      and driver.verification_status='approved'
$replacement$;
    if position(v_before in v_function_sql)=0 then
      raise exception 'Could not safely apply the temporary test actor guard to dispatch_lpg_order';
    end if;
    v_function_sql:=replace(v_function_sql,v_before,v_after);

    v_before:='and state.captured_at>=timezone(''utc'',now())-make_interval(secs=>freshness_seconds)';
    v_after:=$replacement$
and (
            state.captured_at>=timezone('utc',now())-make_interval(secs=>freshness_seconds)
            or (
              coalesce(driver.metadata->>'temporary_lpg_test_fixture','false')='true'
              and exists (
                select 1
                from public.wallet_accounts test_wallet
                join public.wallet_test_funding_allocations test_allocation on test_allocation.wallet_id=test_wallet.id
                join public.wallet_test_funding_batches test_batch on test_batch.id=test_allocation.batch_id
                where test_wallet.owner_entity_type='user'
                  and test_wallet.owner_entity_id=order_record.customer_user_id
                  and test_wallet.wallet_type='customer'
                  and test_wallet.currency_code=order_record.currency_code
                  and test_batch.status='active'
                  and test_allocation.remaining_amount>0
              )
            )
          )
$replacement$;
    if position(v_before in v_function_sql)=0 then
      raise exception 'Could not safely apply the test-location freshness guard to dispatch_lpg_order';
    end if;
    v_function_sql:=replace(v_function_sql,v_before,v_after);
    execute v_function_sql;
  end if;

  v_function_sql:=pg_get_functiondef('public.dispatch_lpg_internal_order(uuid,integer,text,text)'::regprocedure);

  if position('temporary_lpg_test_fixture' in v_function_sql)=0 then
    v_before:='where driver.verification_status=''approved''';
    v_after:=$replacement$
where (
        coalesce(driver.metadata->>'temporary_lpg_test_fixture','false') <> 'true'
        or exists (
          select 1
          from public.wallet_accounts test_wallet
          join public.wallet_test_funding_allocations test_allocation on test_allocation.wallet_id=test_wallet.id
          join public.wallet_test_funding_batches test_batch on test_batch.id=test_allocation.batch_id
          where test_wallet.owner_entity_type='user'
            and test_wallet.owner_entity_id=order_record.customer_user_id
            and test_wallet.wallet_type='customer'
            and test_wallet.currency_code=order_record.currency_code
            and test_batch.status='active'
            and test_allocation.remaining_amount>0
        )
      )
      and driver.verification_status='approved'
$replacement$;
    if position(v_before in v_function_sql)=0 then
      raise exception 'Could not safely apply the temporary test actor guard to dispatch_lpg_internal_order';
    end if;
    v_function_sql:=replace(v_function_sql,v_before,v_after);

    v_before:='and state.captured_at>=timezone(''utc'',now())-make_interval(secs=>freshness_seconds)';
    v_after:=$replacement$
and (
        state.captured_at>=timezone('utc',now())-make_interval(secs=>freshness_seconds)
        or (
          coalesce(driver.metadata->>'temporary_lpg_test_fixture','false')='true'
          and exists (
            select 1
            from public.wallet_accounts test_wallet
            join public.wallet_test_funding_allocations test_allocation on test_allocation.wallet_id=test_wallet.id
            join public.wallet_test_funding_batches test_batch on test_batch.id=test_allocation.batch_id
            where test_wallet.owner_entity_type='user'
              and test_wallet.owner_entity_id=order_record.customer_user_id
              and test_wallet.wallet_type='customer'
              and test_wallet.currency_code=order_record.currency_code
              and test_batch.status='active'
              and test_allocation.remaining_amount>0
          )
        )
      )
$replacement$;
    if position(v_before in v_function_sql)=0 then
      raise exception 'Could not safely apply the test-location freshness guard to dispatch_lpg_internal_order';
    end if;
    v_function_sql:=replace(v_function_sql,v_before,v_after);
    execute v_function_sql;
  end if;
end
$test_dispatch_readiness$;

comment on function public.dispatch_lpg_order(uuid,integer,text,text) is
  'LPG marketplace dispatch; temporary lifecycle test drivers are restricted to customers with an active unspent temporary LPG test-funding allocation.';
comment on function public.dispatch_lpg_internal_order(uuid,integer,text,text) is
  'SKIMA internal LPG dispatch; temporary lifecycle test drivers are restricted to customers with an active unspent temporary LPG test-funding allocation.';

notify pgrst,'reload schema';
commit;
