begin;

-- Fix the remaining internal-dispatch metadata reference after the earlier variable rename.
do $$
declare
  function_definition text;
begin
  select pg_get_functiondef(p.oid)
  into function_definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='dispatch_lpg_internal_order'
    and pg_get_function_identity_arguments(p.oid)='target_lpg_order_id uuid, target_candidate_limit integer, target_idempotency_key text, target_source text';

  if function_definition is null then
    raise exception 'dispatch_lpg_internal_order function was not found';
  end if;

  if position('''driver_participation_program_key'',program_key' in function_definition)>0 then
    function_definition:=replace(
      function_definition,
      '''driver_participation_program_key'',program_key',
      '''driver_participation_program_key'',v_program_key'
    );
    execute function_definition;
  end if;
end
$$;

create table if not exists public.lpg_internal_driver_payout_batches (
  id uuid primary key default gen_random_uuid(),
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  total_amount numeric(28,8) not null check (total_amount>0),
  payout_count integer not null check (payout_count>0),
  status text not null default 'posted' check (status in ('posted','void')),
  batch_reference text not null unique,
  paid_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz not null default timezone('utc',now()),
  note text,
  source text not null default 'lpg.managed_driver_batch_payout',
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  unique(source,idempotency_key)
);

alter table public.lpg_internal_driver_payouts
  add column if not exists batch_id uuid references public.lpg_internal_driver_payout_batches(id) on delete restrict;

create index if not exists lpg_internal_driver_payout_batches_currency_idx
  on public.lpg_internal_driver_payout_batches(currency_code);
create index if not exists lpg_internal_driver_payout_batches_paid_by_idx
  on public.lpg_internal_driver_payout_batches(paid_by) where paid_by is not null;
create index if not exists lpg_internal_driver_payouts_batch_idx
  on public.lpg_internal_driver_payouts(batch_id) where batch_id is not null;

alter table public.lpg_internal_driver_payout_batches enable row level security;
revoke all on table public.lpg_internal_driver_payout_batches from public,anon,authenticated;
grant all on table public.lpg_internal_driver_payout_batches to service_role;

drop trigger if exists audit_lpg_internal_driver_payout_batches on public.lpg_internal_driver_payout_batches;
create trigger audit_lpg_internal_driver_payout_batches
after insert or update or delete on public.lpg_internal_driver_payout_batches
for each row execute function public.record_table_audit();

create or replace function public.pay_lpg_managed_driver_batch_to_wallet(
  target_payments jsonb,
  target_idempotency_key text,
  target_note text default null,
  target_currency_code text default 'NGN',
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  batch_id uuid:=gen_random_uuid();
  existing_batch public.lpg_internal_driver_payout_batches%rowtype;
  batch_reference text;
  payment jsonb;
  driver_id uuid;
  payment_amount numeric(28,8);
  payment_result jsonb;
  payout_id uuid;
  payout_ids uuid[]:='{}'::uuid[];
  seen_driver_ids uuid[]:='{}'::uuid[];
  total_amount numeric(28,8):=0;
  payout_count integer:=0;
begin
  if auth.role()<>'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.financial.manage',null) then
    raise exception using errcode='42501',message='financial management permission is required to pay managed Drivers';
  end if;
  if coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='idempotency key is required';
  end if;
  if target_payments is null or jsonb_typeof(target_payments)<>'array' or jsonb_array_length(target_payments)<1 then
    raise exception using errcode='22023',message='Choose at least one Driver payment';
  end if;
  if jsonb_array_length(target_payments)>200 then
    raise exception using errcode='22023',message='A batch can contain at most 200 Driver payments';
  end if;
  if target_currency_code is null or target_currency_code !~ '^[A-Z0-9]{3,12}$' then
    raise exception using errcode='22023',message='valid currency is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='metadata must be an object';
  end if;

  select * into existing_batch
  from public.lpg_internal_driver_payout_batches
  where source='lpg.managed_driver_batch_payout' and idempotency_key=target_idempotency_key;
  if found then
    return jsonb_build_object(
      'batchId',existing_batch.id,
      'batchReference',existing_batch.batch_reference,
      'totalAmount',existing_batch.total_amount,
      'payoutCount',existing_batch.payout_count,
      'currencyCode',existing_batch.currency_code,
      'status',existing_batch.status
    );
  end if;

  for payment in select value from jsonb_array_elements(target_payments)
  loop
    if jsonb_typeof(payment)<>'object' then
      raise exception using errcode='22023',message='Each Driver payment must be an object';
    end if;
    begin
      driver_id:=(payment->>'driverProfileId')::uuid;
      payment_amount:=(payment->>'amount')::numeric;
    exception when others then
      raise exception using errcode='22023',message='Each Driver payment needs a valid Driver and amount';
    end;
    if driver_id is null or payment_amount is null or payment_amount<=0 then
      raise exception using errcode='22023',message='Each Driver payment amount must be greater than zero';
    end if;
    if driver_id=any(seen_driver_ids) then
      raise exception using errcode='22023',message='A Driver can only appear once in one batch';
    end if;
    seen_driver_ids:=array_append(seen_driver_ids,driver_id);

    payment_result:=public.pay_lpg_managed_driver_to_wallet(
      driver_id,
      payment_amount,
      target_idempotency_key||':driver:'||driver_id::text,
      nullif(btrim(coalesce(target_note,'')),''),
      target_currency_code,
      target_metadata||jsonb_build_object('batchId',batch_id,'batchPayment',true)
    );
    payout_id:=(payment_result->>'payoutId')::uuid;
    payout_ids:=array_append(payout_ids,payout_id);
    total_amount:=total_amount+payment_amount;
    payout_count:=payout_count+1;
  end loop;

  batch_reference:='MDB-'||upper(substr(replace(batch_id::text,'-',''),1,12));
  insert into public.lpg_internal_driver_payout_batches(
    id,currency_code,total_amount,payout_count,status,batch_reference,paid_by,paid_at,note,source,idempotency_key,metadata
  ) values(
    batch_id,target_currency_code,total_amount,payout_count,'posted',batch_reference,auth.uid(),timezone('utc',now()),
    nullif(btrim(coalesce(target_note,'')),''),'lpg.managed_driver_batch_payout',target_idempotency_key,
    target_metadata||jsonb_build_object('payoutIds',to_jsonb(payout_ids))
  );

  update public.lpg_internal_driver_payouts
  set batch_id=batch_id,
      metadata=metadata||jsonb_build_object('batchReference',batch_reference)
  where id=any(payout_ids);

  return jsonb_build_object(
    'batchId',batch_id,
    'batchReference',batch_reference,
    'totalAmount',total_amount,
    'payoutCount',payout_count,
    'currencyCode',target_currency_code,
    'status','posted'
  );
end
$$;

create or replace function public.read_lpg_managed_driver_service_areas(
  target_driver_profile_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare result jsonb;
begin
  if target_driver_profile_id is null then
    raise exception using errcode='22023',message='Driver is required';
  end if;
  if auth.role()<>'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.drivers.read',null)
    and not public.has_permission('platform.drivers.manage',null)
    and not public.has_permission('platform.coverage.read',null)
    and not public.has_permission('platform.coverage.manage',null) then
    raise exception using errcode='42501',message='Driver coverage read permission is required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'serviceAreaKey',area.key,
    'label',area.display_name,
    'isPrimary',assignment.is_primary,
    'effectiveFrom',assignment.effective_from
  ) order by assignment.is_primary desc,area.display_name),'[]'::jsonb)
  into result
  from public.driver_service_areas assignment
  join public.service_areas area on area.id=assignment.service_area_id
  where assignment.driver_profile_id=target_driver_profile_id
    and assignment.status='active'
    and area.status='active';

  return result;
end
$$;

create or replace function public.set_lpg_managed_driver_service_area(
  target_driver_profile_id uuid,
  target_service_area_key text,
  target_active boolean,
  target_primary boolean,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare
  driver_record public.driver_profiles%rowtype;
  service_area public.service_areas%rowtype;
  geography_id uuid;
  coverage_assignment_id uuid;
  managed_key text;
begin
  if auth.role()<>'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.coverage.manage',null) then
    raise exception using errcode='42501',message='coverage management permission is required';
  end if;
  if target_driver_profile_id is null or coalesce(btrim(target_service_area_key),'')='' then
    raise exception using errcode='22023',message='Driver and service area are required';
  end if;
  if target_active is null or target_primary is null then
    raise exception using errcode='22023',message='coverage state is required';
  end if;
  if char_length(btrim(coalesce(target_reason,'')))<3 then
    raise exception using errcode='22023',message='reason is required';
  end if;
  if coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='idempotency key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='metadata must be an object';
  end if;

  select * into driver_record from public.driver_profiles where id=target_driver_profile_id;
  if not found then raise exception using errcode='22023',message='Driver profile was not found'; end if;
  if driver_record.verification_status<>'approved' then
    raise exception using errcode='55000',message='Only an approved Driver can receive managed coverage';
  end if;
  managed_key:=coalesce(public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key','driver.skima_special');
  if not exists(
    select 1 from public.driver_program_memberships m
    where m.driver_profile_id=driver_record.id and m.program_key=managed_key and m.status='active'
      and m.starts_at<=timezone('utc',now()) and (m.ends_at is null or m.ends_at>timezone('utc',now()))
  ) then
    raise exception using errcode='55000',message='Driver must first be added as a SKIMA Managed Driver';
  end if;

  select * into service_area from public.service_areas
  where key=target_service_area_key and status='active';
  if not found then raise exception using errcode='22023',message='Service area was not found'; end if;

  select mapping.geography_id into geography_id
  from public.geography_migration_mappings mapping
  join public.geographies geography on geography.id=mapping.geography_id
  where mapping.legacy_source='service_areas'
    and mapping.legacy_id=service_area.id
    and mapping.migration_status='verified'
    and geography.status='active'
    and geography.boundary_geometry is not null
  order by mapping.verified_at desc nulls last,mapping.created_at desc
  limit 1;

  if geography_id is null then
    raise exception using errcode='55000',message='This service area does not yet have a verified map boundary. Complete its service-area map setup first.';
  end if;

  select coverage.id into coverage_assignment_id
  from public.operational_coverage_assignments coverage
  where coverage.entity_type='DRIVER'
    and coverage.entity_id=driver_record.id
    and coverage.service_key='lpg'
    and coverage.metadata->>'managedDriverServiceAreaKey'=service_area.key
  order by coverage.updated_at desc
  limit 1;

  if target_active then
    if target_primary then
      update public.driver_service_areas
      set is_primary=false,updated_at=timezone('utc',now())
      where driver_profile_id=driver_record.id and status='active';
    end if;

    insert into public.driver_service_areas(
      driver_profile_id,service_area_id,is_primary,status,approved_by,effective_from,effective_until,metadata
    ) values(
      driver_record.id,service_area.id,target_primary,'active',auth.uid(),timezone('utc',now()),null,
      target_metadata||jsonb_build_object('source','skima_managed_driver_setup','serviceAreaKey',service_area.key)
    )
    on conflict(driver_profile_id,service_area_id) do update
    set is_primary=excluded.is_primary,status='active',approved_by=auth.uid(),effective_from=timezone('utc',now()),
        effective_until=null,metadata=public.driver_service_areas.metadata||excluded.metadata,updated_at=timezone('utc',now());

    coverage_assignment_id:=public.configure_operational_coverage_assignment(
      coverage_assignment_id,'DRIVER',driver_record.id,'lpg','ADMIN_GEOGRAPHY',geography_id,
      null,null,null,null,'active',timezone('utc',now()),null,btrim(target_reason),
      target_metadata||jsonb_build_object(
        'managedDriverServiceAreaKey',service_area.key,
        'managedDriverServiceAreaLabel',service_area.display_name,
        'managedDriverSetup',true,
        'idempotencyKey',target_idempotency_key
      )
    );
  else
    update public.driver_service_areas
    set status='inactive',is_primary=false,effective_until=timezone('utc',now()),
        metadata=metadata||jsonb_build_object('deactivatedReason',btrim(target_reason),'deactivatedAt',timezone('utc',now())),
        updated_at=timezone('utc',now())
    where driver_profile_id=driver_record.id and service_area_id=service_area.id and status='active';

    if coverage_assignment_id is not null then
      coverage_assignment_id:=public.configure_operational_coverage_assignment(
        coverage_assignment_id,'DRIVER',driver_record.id,'lpg','ADMIN_GEOGRAPHY',geography_id,
        null,null,null,null,'retired',null,timezone('utc',now()),btrim(target_reason),
        target_metadata||jsonb_build_object(
          'managedDriverServiceAreaKey',service_area.key,
          'managedDriverServiceAreaLabel',service_area.display_name,
          'managedDriverSetup',true,
          'idempotencyKey',target_idempotency_key
        )
      );
    end if;
  end if;

  return jsonb_build_object(
    'driverProfileId',driver_record.id,
    'serviceAreaKey',service_area.key,
    'serviceAreaLabel',service_area.display_name,
    'active',target_active,
    'primary',case when target_active then target_primary else false end,
    'coverageAssignmentId',coverage_assignment_id
  );
end
$$;

revoke all on function public.pay_lpg_managed_driver_batch_to_wallet(jsonb,text,text,text,jsonb) from public,anon;
revoke all on function public.read_lpg_managed_driver_service_areas(uuid) from public,anon;
revoke all on function public.set_lpg_managed_driver_service_area(uuid,text,boolean,boolean,text,text,jsonb) from public,anon;
grant execute on function public.pay_lpg_managed_driver_batch_to_wallet(jsonb,text,text,text,jsonb) to authenticated,service_role;
grant execute on function public.read_lpg_managed_driver_service_areas(uuid) to authenticated,service_role;
grant execute on function public.set_lpg_managed_driver_service_area(uuid,text,boolean,boolean,text,text,jsonb) to authenticated,service_role;

commit;
