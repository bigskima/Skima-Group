begin;

update public.driver_participation_programs
set display_name='SKIMA Managed Driver',
    public_label='SKIMA Managed Driver',
    updated_at=timezone('utc',now())
where key='driver.skima_special';

update public.driver_participation_programs
set display_name='Independent Driver',
    public_label='Independent Driver',
    updated_at=timezone('utc',now())
where key='driver.independent';

alter table public.lpg_internal_driver_earnings
  add column if not exists paid_amount numeric(28,8) not null default 0;

update public.lpg_internal_driver_earnings
set paid_amount=earning_amount
where status='paid' and paid_amount=0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='lpg_internal_driver_earnings_paid_amount_check'
      and conrelid='public.lpg_internal_driver_earnings'::regclass
  ) then
    alter table public.lpg_internal_driver_earnings
      add constraint lpg_internal_driver_earnings_paid_amount_check
      check (paid_amount>=0 and paid_amount<=earning_amount);
  end if;
end
$$;

create table if not exists public.lpg_internal_driver_payouts (
  id uuid primary key default gen_random_uuid(),
  driver_profile_id uuid not null references public.driver_profiles(id) on delete restrict,
  driver_wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  total_amount numeric(28,8) not null check (total_amount>0),
  status text not null default 'posted' check (status in ('posted','void')),
  financial_transaction_id uuid not null unique references public.financial_transactions(id) on delete restrict,
  payout_reference text not null unique,
  paid_by uuid references public.profiles(id) on delete set null,
  paid_at timestamptz not null default timezone('utc',now()),
  note text,
  source text not null default 'lpg.managed_driver_payout',
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  unique(source,idempotency_key)
);

create table if not exists public.lpg_internal_driver_payout_allocations (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.lpg_internal_driver_payouts(id) on delete restrict,
  earning_id uuid not null references public.lpg_internal_driver_earnings(id) on delete restrict,
  amount numeric(28,8) not null check (amount>0),
  created_at timestamptz not null default timezone('utc',now()),
  unique(payout_id,earning_id)
);

create index if not exists lpg_internal_driver_payouts_driver_time_idx
  on public.lpg_internal_driver_payouts(driver_profile_id,paid_at desc);
create index if not exists lpg_internal_driver_payout_allocations_earning_idx
  on public.lpg_internal_driver_payout_allocations(earning_id);

alter table public.lpg_internal_driver_payouts enable row level security;
alter table public.lpg_internal_driver_payout_allocations enable row level security;
revoke all on table public.lpg_internal_driver_payouts from public,anon,authenticated;
revoke all on table public.lpg_internal_driver_payout_allocations from public,anon,authenticated;
grant all on table public.lpg_internal_driver_payouts to service_role;
grant all on table public.lpg_internal_driver_payout_allocations to service_role;

drop trigger if exists audit_lpg_internal_driver_payouts on public.lpg_internal_driver_payouts;
create trigger audit_lpg_internal_driver_payouts
after insert or update or delete on public.lpg_internal_driver_payouts
for each row execute function public.record_table_audit();

drop trigger if exists audit_lpg_internal_driver_payout_allocations on public.lpg_internal_driver_payout_allocations;
create trigger audit_lpg_internal_driver_payout_allocations
after insert or update or delete on public.lpg_internal_driver_payout_allocations
for each row execute function public.record_table_audit();

create or replace function public.set_lpg_managed_driver_assignment(
  target_driver_profile_id uuid,
  target_managed boolean,
  target_reason text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  membership_id uuid;
  resolved_program_key text;
  driver_record public.driver_profiles%rowtype;
begin
  if auth.role()<>'service_role' and not public.has_permission('platform.drivers.manage',null) then
    raise exception using errcode='42501',message='driver management permission required';
  end if;
  if target_driver_profile_id is null then raise exception using errcode='22023',message='driver is required'; end if;
  if target_managed is null then raise exception using errcode='22023',message='driver type is required'; end if;
  if char_length(btrim(coalesce(target_reason,'')))<3 then raise exception using errcode='22023',message='reason is required'; end if;
  if coalesce(btrim(target_idempotency_key),'')='' then raise exception using errcode='22023',message='idempotency key is required'; end if;
  if target_metadata is null or jsonb_typeof(target_metadata)<>'object' then raise exception using errcode='22023',message='metadata must be an object'; end if;

  select * into driver_record from public.driver_profiles where id=target_driver_profile_id;
  if not found then raise exception using errcode='22023',message='driver profile not found'; end if;
  if target_managed and driver_record.verification_status<>'approved' then
    raise exception using errcode='55000',message='Only an approved Driver can be added to the SKIMA Managed Driver team.';
  end if;

  resolved_program_key:=case when target_managed then
    coalesce(public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key','driver.skima_special')
  else 'driver.independent' end;

  membership_id:=public.set_driver_participation_program(
    target_driver_profile_id,
    resolved_program_key,
    target_reason,
    target_idempotency_key,
    target_metadata||jsonb_build_object('managedDriver',target_managed,'adminLabel',case when target_managed then 'SKIMA Managed Driver' else 'Independent Driver' end),
    'skima.admin.managed_drivers'
  );

  return jsonb_build_object(
    'driverProfileId',target_driver_profile_id,
    'managed',target_managed,
    'membershipId',membership_id,
    'label',case when target_managed then 'SKIMA Managed Driver' else 'Independent Driver' end
  );
end
$$;

create or replace function public.read_lpg_managed_driver_admin(
  target_driver_profile_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  result jsonb;
  managed_key text;
begin
  if auth.role()<>'service_role'
    and not public.has_permission('platform.drivers.read',null)
    and not public.has_permission('platform.drivers.manage',null)
    and not public.has_permission('platform.financial.read',null)
    and not public.has_permission('platform.financial.manage',null)
    and not public.can_manage_lpg_operations()
    and not public.is_platform_super_admin() then
    raise exception using errcode='42501',message='managed Driver read permission is required';
  end if;

  managed_key:=coalesce(public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key','driver.skima_special');

  select coalesce(jsonb_agg(row_data order by display_name asc),'[]'::jsonb)
  into result
  from (
    select
      coalesce(driver.driver_display_name,driver.public_driver_id,'SKIMA Driver') as display_name,
      jsonb_build_object(
        'driverProfileId',driver.id,
        'userId',driver.user_id,
        'displayName',coalesce(driver.driver_display_name,'SKIMA Driver'),
        'publicDriverId',driver.public_driver_id,
        'verificationStatus',driver.verification_status,
        'operationalStatus',driver.operational_status,
        'isManaged',coalesce(membership.program_key=managed_key,false),
        'driverTypeLabel',case when membership.program_key=managed_key then 'SKIMA Managed Driver' else 'Independent Driver' end,
        'managedSince',case when membership.program_key=managed_key then membership.starts_at else null end,
        'activeVehicleCount',coalesce(vehicle_summary.active_vehicle_count,0),
        'serviceAreaCount',coalesce(area_summary.service_area_count,0),
        'vehicleReady',coalesce(vehicle_summary.vehicle_ready,false),
        'coverageReady',coalesce(coverage_summary.coverage_ready,false),
        'pendingEarnings',coalesce(earnings.pending_earnings,0),
        'availableForPayout',coalesce(earnings.available_for_payout,0),
        'paidToWallet',coalesce(earnings.paid_to_wallet,0),
        'lifetimeEarnings',coalesce(earnings.lifetime_earnings,0),
        'driverWalletId',wallet.id,
        'driverWalletBalance',coalesce(balance.balance,0),
        'currencyCode','NGN',
        'lastPaidAt',payout.last_paid_at
      ) as row_data
    from public.driver_profiles driver
    left join lateral (
      select m.*
      from public.driver_program_memberships m
      where m.driver_profile_id=driver.id
        and m.status='active'
        and m.starts_at<=timezone('utc',now())
        and (m.ends_at is null or m.ends_at>timezone('utc',now()))
      order by m.starts_at desc
      limit 1
    ) membership on true
    left join lateral (
      select
        count(*)::integer as active_vehicle_count,
        coalesce(bool_or(
          vehicle.status='active'
          and coalesce((public.evaluate_driver_vehicle_eligibility(driver.id,vehicle.id,'lpg')->>'eligible')::boolean,false)
        ),false) as vehicle_ready
      from public.driver_vehicle_links link
      join public.vehicles vehicle on vehicle.id=link.vehicle_id
      where link.driver_profile_id=driver.id
        and link.status='active'
        and link.starts_at<=timezone('utc',now())
        and (link.ends_at is null or link.ends_at>timezone('utc',now()))
    ) vehicle_summary on true
    left join lateral (
      select count(*)::integer as service_area_count
      from public.driver_service_areas area
      where area.driver_profile_id=driver.id and area.status='active'
    ) area_summary on true
    left join lateral (
      select exists(
        select 1
        from public.operational_coverage_assignments coverage
        where coverage.entity_type='DRIVER'
          and coverage.entity_id=driver.id
          and coverage.service_key='lpg'
          and coverage.status in ('approved','active')
          and coverage.approved_at is not null
          and (coverage.valid_from is null or coverage.valid_from<=timezone('utc',now()))
          and (coverage.valid_to is null or coverage.valid_to>timezone('utc',now()))
      ) as coverage_ready
    ) coverage_summary on true
    left join lateral (
      select
        coalesce(sum(case when e.status='accrued' then greatest(e.earning_amount-e.paid_amount,0) else 0 end),0) as pending_earnings,
        coalesce(sum(case when e.status='approved' then greatest(e.earning_amount-e.paid_amount,0) else 0 end),0) as available_for_payout,
        coalesce(sum(e.paid_amount),0) as paid_to_wallet,
        coalesce(sum(e.earning_amount),0) as lifetime_earnings
      from public.lpg_internal_driver_earnings e
      where e.driver_profile_id=driver.id and e.currency_code='NGN' and e.status<>'void'
    ) earnings on true
    left join lateral (
      select w.* from public.wallet_accounts w
      where w.wallet_type='driver' and w.owner_entity_type='driver'
        and w.owner_entity_id=driver.id and w.currency_code='NGN' and w.status='active'
      order by w.created_at asc limit 1
    ) wallet on true
    left join public.wallet_balances balance on balance.wallet_id=wallet.id
    left join lateral (
      select max(p.paid_at) as last_paid_at
      from public.lpg_internal_driver_payouts p
      where p.driver_profile_id=driver.id and p.currency_code='NGN' and p.status='posted'
    ) payout on true
    where target_driver_profile_id is null or driver.id=target_driver_profile_id
  ) rows;

  return result;
end
$$;

create or replace function public.read_lpg_internal_service_area_options()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare result jsonb;
begin
  if auth.role()<>'service_role'
    and not public.has_permission('platform.dispatch.read',null)
    and not public.has_permission('platform.dispatch.manage',null)
    and not public.has_permission('platform.financial_policy.read',null)
    and not public.has_permission('platform.financial_policy.manage',null)
    and not public.is_platform_super_admin() then
    raise exception using errcode='42501',message='LPG setup read permission is required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'key',area.key,
    'label',area.display_name,
    'areaType',area.area_type,
    'stateName',area.state_name,
    'lgaName',area.lga_name,
    'cityName',area.city_name,
    'townName',area.town_name,
    'referencePricePerKg',nullif(policy.configuration->>'amount_per_kg','')::numeric,
    'estimatedRouteKm',nullif(policy.configuration->>'estimated_route_km','')::numeric,
    'maxSupplierVariancePercent',nullif(policy.configuration->>'max_supplier_variance_percent','')::numeric,
    'priceConfigured',policy.id is not null
  ) order by area.priority desc,area.display_name asc),'[]'::jsonb)
  into result
  from public.service_areas area
  left join lateral (
    select version.id,version.configuration
    from public.financial_policy_versions version
    join public.financial_policy_definitions definition on definition.id=version.policy_definition_id
    join public.business_modules module on module.id=version.module_id
    where definition.key='pricing.lpg.internal_reference_per_kg'
      and module.key='lpg'
      and version.service_key='lpg.refill.internal'
      and version.currency_code='NGN'
      and version.geography_type='service_area'
      and version.geography_key=area.key
      and version.lifecycle_status='active'
      and version.effective_from<=timezone('utc',now())
      and (version.effective_until is null or version.effective_until>timezone('utc',now()))
    order by version.version desc
    limit 1
  ) policy on true
  where area.status='active';

  return result;
end
$$;

create or replace function public.pay_lpg_managed_driver_to_wallet(
  target_driver_profile_id uuid,
  target_amount numeric,
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
  driver_record public.driver_profiles%rowtype;
  existing_payout public.lpg_internal_driver_payouts%rowtype;
  managed_key text;
  available_amount numeric(28,8):=0;
  remaining numeric(28,8);
  allocation_amount numeric(28,8);
  liability_wallet_id uuid;
  liability_balance numeric(28,8):=0;
  driver_wallet_id uuid;
  driver_wallet_created boolean:=false;
  transaction_id uuid;
  payout_id uuid:=gen_random_uuid();
  payout_reference text;
  unpaid_after numeric(28,8):=0;
  wallet_balance_after numeric(28,8):=0;
  earning_record public.lpg_internal_driver_earnings%rowtype;
begin
  if auth.role()<>'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.financial.manage',null) then
    raise exception using errcode='42501',message='financial management permission is required to pay a managed Driver';
  end if;
  if target_driver_profile_id is null then raise exception using errcode='22023',message='Driver is required'; end if;
  if target_amount is null or target_amount<=0 then raise exception using errcode='22023',message='Payment amount must be greater than zero'; end if;
  if coalesce(btrim(target_idempotency_key),'')='' then raise exception using errcode='22023',message='idempotency key is required'; end if;
  if target_currency_code is null or target_currency_code !~ '^[A-Z0-9]{3,12}$' then raise exception using errcode='22023',message='valid currency is required'; end if;
  if target_metadata is null or jsonb_typeof(target_metadata)<>'object' then raise exception using errcode='22023',message='metadata must be an object'; end if;

  select * into existing_payout
  from public.lpg_internal_driver_payouts
  where source='lpg.managed_driver_payout' and idempotency_key=target_idempotency_key;
  if found then
    select coalesce(balance,0) into wallet_balance_after from public.wallet_balances where wallet_id=existing_payout.driver_wallet_id;
    select coalesce(sum(greatest(e.earning_amount-e.paid_amount,0)),0) into unpaid_after
    from public.lpg_internal_driver_earnings e
    where e.driver_profile_id=existing_payout.driver_profile_id and e.currency_code=existing_payout.currency_code and e.status='approved';
    return jsonb_build_object('payoutId',existing_payout.id,'driverProfileId',existing_payout.driver_profile_id,'amount',existing_payout.total_amount,'currencyCode',existing_payout.currency_code,'payoutReference',existing_payout.payout_reference,'unpaidAfter',unpaid_after,'walletBalanceAfter',coalesce(wallet_balance_after,0),'driverWalletId',existing_payout.driver_wallet_id);
  end if;

  select * into driver_record from public.driver_profiles where id=target_driver_profile_id for update;
  if not found then raise exception using errcode='22023',message='Driver profile was not found'; end if;
  if driver_record.verification_status<>'approved' then raise exception using errcode='55000',message='Only an approved Driver can receive managed Driver payout'; end if;

  managed_key:=coalesce(public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key','driver.skima_special');
  if not exists(
    select 1 from public.driver_program_memberships m
    where m.driver_profile_id=driver_record.id and m.program_key=managed_key and m.status='active'
      and m.starts_at<=timezone('utc',now()) and (m.ends_at is null or m.ends_at>timezone('utc',now()))
  ) then raise exception using errcode='55000',message='Driver is not currently a SKIMA Managed Driver'; end if;

  select coalesce(sum(greatest(e.earning_amount-e.paid_amount,0)),0)
  into available_amount
  from public.lpg_internal_driver_earnings e
  where e.driver_profile_id=driver_record.id and e.currency_code=target_currency_code and e.status='approved';

  if target_amount>available_amount then
    raise exception using errcode='22023',message='Payment amount is greater than the Driver available earnings';
  end if;

  liability_wallet_id:=public.ensure_platform_liability_wallet(target_currency_code,'lpg.managed_driver_payout',target_idempotency_key||':liability-wallet');
  select coalesce(balance,0) into liability_balance from public.wallet_balances where wallet_id=liability_wallet_id;
  if liability_balance<target_amount then
    raise exception using errcode='55000',message='SKIMA liability wallet does not contain enough settled Driver funds for this payment';
  end if;

  select w.id into driver_wallet_id
  from public.wallet_accounts w
  where w.wallet_type='driver' and w.owner_entity_type='driver' and w.owner_entity_id=driver_record.id
    and w.currency_code=target_currency_code and w.status='active'
  order by w.created_at asc limit 1;

  if driver_wallet_id is null then
    insert into public.wallet_accounts(wallet_type,owner_entity_type,owner_entity_id,currency_code,status,metadata,created_by,source,idempotency_key)
    values('driver','driver',driver_record.id,target_currency_code,'active',jsonb_build_object('managedDriverWallet',true),auth.uid(),'lpg.managed_driver_payout',target_idempotency_key||':driver-wallet')
    on conflict do nothing returning id into driver_wallet_id;
    if driver_wallet_id is not null then driver_wallet_created:=true; end if;
    if driver_wallet_id is null then
      select w.id into driver_wallet_id from public.wallet_accounts w
      where w.wallet_type='driver' and w.owner_entity_type='driver' and w.owner_entity_id=driver_record.id
        and w.currency_code=target_currency_code and w.status='active'
      order by w.created_at asc limit 1;
    end if;
    if driver_wallet_id is null then raise exception using errcode='55000',message='Driver SKIMA Wallet could not be created'; end if;
    if driver_wallet_created then
      insert into public.wallet_account_events(wallet_account_id,event_type,status,idempotency_key,metadata)
      values(driver_wallet_id,'created','active',target_idempotency_key||':driver-wallet:created',jsonb_build_object('source','lpg.managed_driver_payout','managedDriverWallet',true))
      on conflict do nothing;
    end if;
  end if;

  payout_reference:='MDP-'||upper(substr(replace(payout_id::text,'-',''),1,12));

  transaction_id:=public.post_financial_transaction(
    'transfer',target_currency_code,'lpg.managed_driver_payout','managed_driver_payout',payout_id,
    jsonb_build_array(
      jsonb_build_object('wallet_id',liability_wallet_id,'direction','debit','amount',target_amount,'entry_type','commission','metadata',jsonb_build_object('role','managed_driver_payable','driverProfileId',driver_record.id,'payoutReference',payout_reference)),
      jsonb_build_object('wallet_id',driver_wallet_id,'direction','credit','amount',target_amount,'entry_type','commission','metadata',jsonb_build_object('role','managed_driver_wallet_credit','driverProfileId',driver_record.id,'payoutReference',payout_reference))
    ),
    target_idempotency_key||':financial',null,payout_reference,'{}'::jsonb,
    target_metadata||jsonb_build_object('driverProfileId',driver_record.id,'payoutReference',payout_reference,'destination','SKIMA Driver Wallet')
  );

  insert into public.lpg_internal_driver_payouts(
    id,driver_profile_id,driver_wallet_id,currency_code,total_amount,status,financial_transaction_id,payout_reference,paid_by,paid_at,note,source,idempotency_key,metadata
  ) values(
    payout_id,driver_record.id,driver_wallet_id,target_currency_code,target_amount,'posted',transaction_id,payout_reference,auth.uid(),timezone('utc',now()),nullif(btrim(coalesce(target_note,'')),''),'lpg.managed_driver_payout',target_idempotency_key,target_metadata
  );

  remaining:=target_amount;
  for earning_record in
    select * from public.lpg_internal_driver_earnings e
    where e.driver_profile_id=driver_record.id and e.currency_code=target_currency_code and e.status='approved' and e.paid_amount<e.earning_amount
    order by coalesce(e.approved_at,e.created_at) asc,e.created_at asc
    for update
  loop
    exit when remaining<=0;
    allocation_amount:=least(remaining,earning_record.earning_amount-earning_record.paid_amount);
    if allocation_amount<=0 then continue; end if;

    insert into public.lpg_internal_driver_payout_allocations(payout_id,earning_id,amount)
    values(payout_id,earning_record.id,allocation_amount);

    update public.lpg_internal_driver_earnings
    set paid_amount=paid_amount+allocation_amount,
        status=case when paid_amount+allocation_amount>=earning_amount then 'paid' else 'approved' end,
        paid_by=auth.uid(),paid_at=timezone('utc',now()),payment_reference=payout_reference,
        metadata=metadata||jsonb_build_object('lastPayoutId',payout_id,'lastPayoutReference',payout_reference,'lastPaidAmount',allocation_amount),
        updated_at=timezone('utc',now())
    where id=earning_record.id;

    remaining:=remaining-allocation_amount;
  end loop;

  if remaining>0.000001 then
    raise exception using errcode='55000',message='Driver earnings allocation did not fully cover the requested payment';
  end if;

  select coalesce(sum(greatest(e.earning_amount-e.paid_amount,0)),0) into unpaid_after
  from public.lpg_internal_driver_earnings e
  where e.driver_profile_id=driver_record.id and e.currency_code=target_currency_code and e.status='approved';
  select coalesce(balance,0) into wallet_balance_after from public.wallet_balances where wallet_id=driver_wallet_id;

  return jsonb_build_object(
    'payoutId',payout_id,
    'driverProfileId',driver_record.id,
    'amount',target_amount,
    'currencyCode',target_currency_code,
    'payoutReference',payout_reference,
    'unpaidAfter',coalesce(unpaid_after,0),
    'walletBalanceAfter',coalesce(wallet_balance_after,0),
    'driverWalletId',driver_wallet_id
  );
end
$$;

create or replace function public.read_lpg_managed_driver_payouts(
  target_driver_profile_id uuid default null,
  target_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare result jsonb;
begin
  if auth.role()<>'service_role'
    and not public.has_permission('platform.drivers.read',null)
    and not public.has_permission('platform.financial.read',null)
    and not public.has_permission('platform.financial.manage',null)
    and not public.can_manage_lpg_operations()
    and not public.is_platform_super_admin() then
    raise exception using errcode='42501',message='managed Driver payout read permission is required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'payoutId',p.id,
    'driverProfileId',p.driver_profile_id,
    'displayName',coalesce(d.driver_display_name,'SKIMA Driver'),
    'publicDriverId',d.public_driver_id,
    'amount',p.total_amount,
    'currencyCode',p.currency_code,
    'status',p.status,
    'payoutReference',p.payout_reference,
    'paidAt',p.paid_at,
    'note',p.note,
    'driverWalletId',p.driver_wallet_id,
    'financialTransactionId',p.financial_transaction_id
  ) order by p.paid_at desc),'[]'::jsonb)
  into result
  from (
    select * from public.lpg_internal_driver_payouts
    where target_driver_profile_id is null or driver_profile_id=target_driver_profile_id
    order by paid_at desc
    limit least(greatest(coalesce(target_limit,50),1),200)
  ) p
  join public.driver_profiles d on d.id=p.driver_profile_id;

  return result;
end
$$;

revoke all on function public.set_lpg_managed_driver_assignment(uuid,boolean,text,text,jsonb) from public,anon;
revoke all on function public.read_lpg_managed_driver_admin(uuid) from public,anon;
revoke all on function public.read_lpg_internal_service_area_options() from public,anon;
revoke all on function public.pay_lpg_managed_driver_to_wallet(uuid,numeric,text,text,text,jsonb) from public,anon;
revoke all on function public.read_lpg_managed_driver_payouts(uuid,integer) from public,anon;

grant execute on function public.set_lpg_managed_driver_assignment(uuid,boolean,text,text,jsonb) to authenticated,service_role;
grant execute on function public.read_lpg_managed_driver_admin(uuid) to authenticated,service_role;
grant execute on function public.read_lpg_internal_service_area_options() to authenticated,service_role;
grant execute on function public.pay_lpg_managed_driver_to_wallet(uuid,numeric,text,text,text,jsonb) to authenticated,service_role;
grant execute on function public.read_lpg_managed_driver_payouts(uuid,integer) to authenticated,service_role;

commit;
