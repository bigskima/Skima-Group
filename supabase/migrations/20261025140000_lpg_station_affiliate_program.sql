begin;

create or replace function public.classify_lpg_platform_settlement_revenue(
  target_lpg_order_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  order_record public.lpg_refill_orders%rowtype;
  quote_record public.lpg_refill_quotes%rowtype;
  markup_policy jsonb;
  locked_markup_per_kg numeric(28, 8);
  actual_platform_markup numeric(28, 8);
  delivery_margin_amount numeric(28, 8);
  tax_amount_value numeric(28, 8);
  classification_total numeric(28, 8);
  clearing_wallet_id uuid;
  clearing_credit_amount numeric(28, 8);
  revenue_wallet_id uuid;
  liability_wallet_id uuid;
  transaction_entries jsonb;
  classification_transaction_id uuid;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.revenue.manage', null)
    and not public.has_permission('platform.settlement.execute', null) then
    raise exception 'LPG revenue classification permission is required';
  end if;

  select * into order_record
  from public.lpg_refill_orders
  where id = target_lpg_order_id
  for update;

  if not found then
    raise exception 'target_lpg_order_id must reference an LPG order';
  end if;

  if order_record.status <> 'station_settled'
    or order_record.station_settlement_execution_id is null
    or order_record.actual_kg is null then
    raise exception 'LPG revenue classification requires a completed station settlement';
  end if;

  if order_record.metadata ->> 'platform_revenue_classification_transaction_id' is not null then
    return (order_record.metadata ->> 'platform_revenue_classification_transaction_id')::uuid;
  end if;

  select * into quote_record
  from public.lpg_refill_quotes
  where id = order_record.lpg_refill_quote_id;

  if not found or quote_record.status <> 'accepted' then
    raise exception 'accepted LPG quote is required for revenue classification';
  end if;

  markup_policy := order_record.financial_policy_snapshot -> 'platformMarkup';
  locked_markup_per_kg := nullif(markup_policy -> 'configuration' ->> 'amount_per_kg', '')::numeric;

  if markup_policy is null or jsonb_typeof(markup_policy) <> 'object'
    or markup_policy ->> 'policyVersionId' is null
    or locked_markup_per_kg is null
    or locked_markup_per_kg < 0 then
    raise exception 'locked LPG platform markup policy is required for revenue classification';
  end if;

  actual_platform_markup := round(order_record.actual_kg * locked_markup_per_kg, 2);
  delivery_margin_amount := case
    when coalesce(order_record.fulfillment_mode, quote_record.fulfillment_mode, 'independent_driver') = 'station_managed' then 0
    else quote_record.delivery_fee_amount - quote_record.driver_commission_amount
  end;
  tax_amount_value := quote_record.tax_amount;

  if delivery_margin_amount < 0 or tax_amount_value < 0 then
    raise exception 'LPG settlement classification amounts cannot be negative';
  end if;

  classification_total := actual_platform_markup + delivery_margin_amount + tax_amount_value;

  if classification_total = 0 then
    return null;
  end if;

  select ledger.wallet_id, sum(ledger.amount)::numeric(28, 8)
  into clearing_wallet_id, clearing_credit_amount
  from public.settlement_executions execution
  join public.wallet_ledger_entries ledger
    on ledger.transaction_id = execution.transaction_id
  join public.wallet_accounts wallet
    on wallet.id = ledger.wallet_id
  where execution.id = order_record.station_settlement_execution_id
    and wallet.wallet_type = 'platform_clearing'
    and wallet.owner_entity_type = 'platform'
    and ledger.direction = 'credit'
    and ledger.metadata ->> 'role' = 'platform'
  group by ledger.wallet_id;

  if clearing_wallet_id is null then
    raise exception 'LPG station settlement is missing its platform clearing credit';
  end if;

  if clearing_credit_amount <> classification_total then
    raise exception 'LPG platform settlement classification does not match the posted clearing amount';
  end if;

  transaction_entries := jsonb_build_array(
    jsonb_build_object(
      'wallet_id', clearing_wallet_id,
      'direction', 'debit',
      'amount', classification_total,
      'entry_type', 'principal',
      'metadata', jsonb_build_object(
        'role', 'platform_settlement_classification',
        'lpg_order_id', order_record.id,
        'platform_markup_amount', actual_platform_markup,
        'delivery_margin_amount', delivery_margin_amount,
        'tax_amount', tax_amount_value
      )
    )
  );

  if actual_platform_markup > 0 or delivery_margin_amount > 0 then
    revenue_wallet_id := public.ensure_platform_revenue_wallet(
      order_record.currency_code,
      'lpg.revenue_classifier',
      'lpg-order:' || order_record.id::text || ':revenue-wallet'
    );
  end if;

  if actual_platform_markup > 0 then
    transaction_entries := transaction_entries || jsonb_build_array(
      jsonb_build_object(
        'wallet_id', revenue_wallet_id,
        'direction', 'credit',
        'amount', actual_platform_markup,
        'entry_type', 'fee',
        'metadata', jsonb_build_object(
          'role', 'skima_revenue',
          'revenue_stream', 'refill',
          'revenue_component', 'lpg_platform_markup',
          'module', 'lpg',
          'lpg_order_id', order_record.id,
          'actual_kg', order_record.actual_kg,
          'markup_policy_version_id', markup_policy ->> 'policyVersionId'
        )
      )
    );
  end if;

  if delivery_margin_amount > 0 then
    transaction_entries := transaction_entries || jsonb_build_array(
      jsonb_build_object(
        'wallet_id', revenue_wallet_id,
        'direction', 'credit',
        'amount', delivery_margin_amount,
        'entry_type', 'fee',
        'metadata', jsonb_build_object(
          'role', 'skima_revenue',
          'revenue_stream', 'delivery',
          'revenue_component', 'delivery_margin',
          'module', 'lpg',
          'lpg_order_id', order_record.id,
          'customer_delivery_fee_amount', quote_record.delivery_fee_amount,
          'driver_payout_amount', quote_record.driver_commission_amount
        )
      )
    );
  end if;

  if tax_amount_value > 0 then
    liability_wallet_id := public.ensure_platform_liability_wallet(
      order_record.currency_code,
      'lpg.revenue_classifier',
      'lpg-order:' || order_record.id::text || ':liability-wallet'
    );

    transaction_entries := transaction_entries || jsonb_build_array(
      jsonb_build_object(
        'wallet_id', liability_wallet_id,
        'direction', 'credit',
        'amount', tax_amount_value,
        'entry_type', 'tax',
        'metadata', jsonb_build_object(
          'role', 'platform_liability',
          'liability_component', 'tax',
          'module', 'lpg',
          'lpg_order_id', order_record.id
        )
      )
    );
  end if;

  classification_transaction_id := public.post_financial_transaction(
    'transfer',
    order_record.currency_code,
    'lpg.revenue_classifier',
    'lpg_refill_order',
    order_record.id,
    transaction_entries,
    'lpg-order:' || order_record.id::text || ':platform-classification',
    null,
    order_record.public_reference,
    order_record.financial_policy_snapshot,
    jsonb_build_object(
      'lpg_order_id', order_record.id,
      'station_settlement_execution_id', order_record.station_settlement_execution_id,
      'platform_markup_amount', actual_platform_markup,
      'delivery_margin_amount', delivery_margin_amount,
      'tax_amount', tax_amount_value
    )
  );

  update public.lpg_refill_orders
  set metadata = metadata || jsonb_build_object(
        'platform_revenue_classification_transaction_id', classification_transaction_id,
        'platform_revenue_classified_at', timezone('utc', now()),
        'platform_revenue_breakdown', jsonb_build_object(
          'refill', actual_platform_markup,
          'delivery', delivery_margin_amount,
          'tax_liability', tax_amount_value
        )
      ),
      updated_at = timezone('utc', now())
  where id = order_record.id;

  if order_record.station_settlement_statement_id is not null then
    update public.settlement_statements
    set metadata = metadata || jsonb_build_object(
          'platform_revenue_classification_transaction_id', classification_transaction_id,
          'platform_revenue_not_deducted_from_station', true,
          'platform_revenue_breakdown', jsonb_build_object(
            'refill', actual_platform_markup,
            'delivery', delivery_margin_amount
          ),
          'tax_liability_amount', tax_amount_value
        ),
        updated_at = timezone('utc', now())
    where id = order_record.station_settlement_statement_id;
  end if;

  return classification_transaction_id;
end;
$$;


-- Station affiliate programme uses the universal versioned financial policy engine.
insert into public.financial_policy_definitions(
  key,display_name,policy_family,value_schema,approval_required,allow_partner_delegation,status,metadata
) values (
  'commission.lpg.station_affiliate',
  'LPG Station Affiliate Commission',
  'affiliate',
  jsonb_build_object(
    'commission_percent',jsonb_build_object('type','number','minimum',0,'maximum',100),
    'earning_period_months',jsonb_build_object('type','integer','minimum',1,'maximum',36),
    'program_enabled',jsonb_build_object('type','boolean'),
    'eligible_revenue_streams',jsonb_build_object('type','array','items',jsonb_build_object('enum',jsonb_build_array('refill','delivery')))
  ),
  true,false,'active',
  jsonb_build_object('module','lpg','programme','station_affiliate','source','skima_nigeria_first_launch')
)
on conflict(key) do nothing;

do $$
begin
  if not exists(
    select 1 from public.financial_policy_definitions
    where key='commission.lpg.station_affiliate' and policy_family='affiliate' and status='active'
  ) then
    raise exception 'commission.lpg.station_affiliate policy definition must remain active and use affiliate family';
  end if;
end
$$;

create or replace function public.validate_lpg_station_affiliate_policy_version()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare policy_key text; config jsonb; allowed_streams text[];
begin
  select definition.key into policy_key
  from public.financial_policy_definitions definition
  where definition.id=new.policy_definition_id;
  if policy_key is distinct from 'commission.lpg.station_affiliate' then return new; end if;

  config:=new.configuration;
  if new.currency_code<>'NGN'
    or new.service_key is distinct from 'lpg.station.affiliate'
    or new.geography_type<>'country'
    or new.geography_key is distinct from 'NG'
    or new.module_id is distinct from (select id from public.business_modules where key='lpg') then
    raise exception using errcode='22023',message='Station Affiliate policy must be scoped to LPG / lpg.station.affiliate / Nigeria / NGN';
  end if;
  if jsonb_typeof(config->'program_enabled') is distinct from 'boolean'
    or jsonb_typeof(config->'commission_percent') is distinct from 'number'
    or jsonb_typeof(config->'earning_period_months') is distinct from 'number'
    or jsonb_typeof(config->'eligible_revenue_streams') is distinct from 'array' then
    raise exception using errcode='22023',message='Station Affiliate policy requires program_enabled, commission_percent, earning_period_months, eligible_revenue_streams';
  end if;
  if (config->>'commission_percent')::numeric<0 or (config->>'commission_percent')::numeric>100
    or ((config->>'program_enabled')::boolean and (config->>'commission_percent')::numeric<=0) then
    raise exception using errcode='22023',message='commission_percent must be between 0 and 100, and positive when enabled';
  end if;
  if (config->>'earning_period_months')::numeric<>trunc((config->>'earning_period_months')::numeric)
    or (config->>'earning_period_months')::integer<1
    or (config->>'earning_period_months')::integer>36 then
    raise exception using errcode='22023',message='earning_period_months must be an integer from 1 through 36';
  end if;
    select array_agg(value) into allowed_streams
  from jsonb_array_elements_text(config->'eligible_revenue_streams') as stream_item(value);
  if coalesce(cardinality(allowed_streams),0)=0
    or exists(select 1 from unnest(allowed_streams) stream where stream not in ('refill','delivery')) then
    raise exception using errcode='22023',message='eligible_revenue_streams must contain refill and/or delivery only';
  end if;
  return new;
end
$$;

drop trigger if exists trg_validate_lpg_station_affiliate_policy_version on public.financial_policy_versions;
create trigger trg_validate_lpg_station_affiliate_policy_version
before insert on public.financial_policy_versions
for each row execute function public.validate_lpg_station_affiliate_policy_version();

create table if not exists public.lpg_station_affiliates (
  id uuid primary key default gen_random_uuid(),
  affiliate_user_id uuid not null unique references public.profiles(id) on delete restrict,
  referral_code text not null unique check (referral_code ~ '^SK[A-F0-9]{10}$'),
  status text not null default 'pending' check (status in ('pending','active','suspended','rejected')),
  commission_wallet_id uuid references public.wallet_accounts(id) on delete restrict,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object')
);

create table if not exists public.lpg_station_referrals (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.lpg_station_affiliates(id) on delete restrict,
  application_id uuid not null unique references public.application_records(id) on delete restrict,
  applicant_user_id uuid not null references public.profiles(id) on delete restrict,
  station_branch_id uuid unique references public.lpg_station_branches(id) on delete restrict,
  referral_code_snapshot text not null,
  status text not null default 'submitted' check (status in ('submitted','activated','rejected','expired')),
  submitted_at timestamptz not null default timezone('utc',now()),
  activated_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  check ((status='activated' and station_branch_id is not null and activated_at is not null)
    or status<>'activated')
);

create index if not exists lpg_station_referrals_affiliate_status_idx
  on public.lpg_station_referrals(affiliate_id,status,submitted_at desc);
create index if not exists lpg_station_referrals_branch_idx
  on public.lpg_station_referrals(station_branch_id) where station_branch_id is not null;

create table if not exists public.lpg_station_affiliate_earnings (
  id uuid primary key default gen_random_uuid(),
  affiliate_id uuid not null references public.lpg_station_affiliates(id) on delete restrict,
  referral_id uuid not null references public.lpg_station_referrals(id) on delete restrict,
  station_branch_id uuid not null references public.lpg_station_branches(id) on delete restrict,
  lpg_order_id uuid not null unique references public.lpg_refill_orders(id) on delete restrict,
  classification_transaction_id uuid not null references public.financial_transactions(id) on delete restrict,
  financial_transaction_id uuid references public.financial_transactions(id) on delete restrict,
  commission_wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
  currency_code text not null references public.currency_definitions(code) on delete restrict,
  revenue_base_amount numeric(28,8) not null check (revenue_base_amount>=0),
  commission_percent numeric(9,6) not null check (commission_percent>0 and commission_percent<=100),
  amount numeric(28,8) not null check (amount>0),
  policy_version_id uuid not null references public.financial_policy_versions(id) on delete restrict,
  earning_period_start timestamptz not null,
  earning_period_end timestamptz not null,
  status text not null default 'posted' check (status in ('pending','posted','reversed')),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  check (earning_period_end>earning_period_start)
);

create index if not exists lpg_station_affiliate_earnings_affiliate_idx
  on public.lpg_station_affiliate_earnings(affiliate_id,status,created_at desc);

create table if not exists public.lpg_station_affiliate_commission_failures (
  id uuid primary key default gen_random_uuid(),
  lpg_order_id uuid not null unique references public.lpg_refill_orders(id) on delete restrict,
  classification_transaction_id uuid references public.financial_transactions(id) on delete set null,
  attempt_count integer not null default 1 check (attempt_count>0),
  last_error text not null,
  status text not null default 'pending' check (status in ('pending','resolved','dismissed')),
  first_attempt_at timestamptz not null default timezone('utc',now()),
  last_attempt_at timestamptz not null default timezone('utc',now()),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object')
);

alter table public.lpg_station_affiliates enable row level security;
alter table public.lpg_station_referrals enable row level security;
alter table public.lpg_station_affiliate_earnings enable row level security;
alter table public.lpg_station_affiliate_commission_failures enable row level security;

revoke all on public.lpg_station_affiliates, public.lpg_station_referrals,
  public.lpg_station_affiliate_earnings, public.lpg_station_affiliate_commission_failures
  from public,anon,authenticated;
grant all on public.lpg_station_affiliates, public.lpg_station_referrals,
  public.lpg_station_affiliate_earnings, public.lpg_station_affiliate_commission_failures
  to service_role;

revoke all on function public.validate_lpg_station_affiliate_policy_version() from public,anon,authenticated;

create or replace function public.request_lpg_station_affiliate()
returns jsonb
language plpgsql
security definer
set search_path=public,extensions,pg_temp
as $$
declare profile_id uuid:=auth.uid(); affiliate public.lpg_station_affiliates%rowtype; candidate_code text; attempt integer;
begin
  if profile_id is null then raise exception using errcode='42501',message='authentication required'; end if;
  if not exists(select 1 from public.profiles profile where profile.id=profile_id and profile.status='active') then
    raise exception using errcode='42501',message='an active SKIMA profile is required';
  end if;
  select * into affiliate from public.lpg_station_affiliates where affiliate_user_id=profile_id;
  if found then
    return jsonb_build_object('id',affiliate.id,'referralCode',affiliate.referral_code,'status',affiliate.status,'createdAt',affiliate.created_at);
  end if;

  for attempt in 1..8 loop
    candidate_code:='SK'||upper(substr(encode(extensions.gen_random_bytes(8),'hex'),1,10));
    insert into public.lpg_station_affiliates(affiliate_user_id,referral_code,status,metadata)
    values(profile_id,candidate_code,'pending',jsonb_build_object('source','self-service-affiliate-request'))
    on conflict do nothing
    returning * into affiliate;
    if found then
      return jsonb_build_object('id',affiliate.id,'referralCode',affiliate.referral_code,'status',affiliate.status,'createdAt',affiliate.created_at);
    end if;
    select * into affiliate from public.lpg_station_affiliates where affiliate_user_id=profile_id;
    if found then
      return jsonb_build_object('id',affiliate.id,'referralCode',affiliate.referral_code,'status',affiliate.status,'createdAt',affiliate.created_at);
    end if;
  end loop;
  raise exception using errcode='40001',message='could not allocate a unique affiliate code; retry';
end
$$;

create or replace function public.read_my_lpg_station_affiliate()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare affiliate public.lpg_station_affiliates%rowtype; wallet_id uuid; balance_amount numeric(28,8):=0;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  select * into affiliate from public.lpg_station_affiliates where affiliate_user_id=auth.uid();
  if not found then return jsonb_build_object('status','not_applied','referralCode',null,'commissionWalletId',null,'availableBalance',0,'referralCount',0,'activeReferrals',0,'totalEarned',0,'referrals','[]'::jsonb); end if;

  if affiliate.commission_wallet_id is not null then
    select wallet.id,coalesce(balance.balance,0) into wallet_id,balance_amount
    from public.wallet_accounts wallet
    left join public.wallet_balances balance on balance.wallet_id=wallet.id and balance.currency_code=wallet.currency_code
    where wallet.id=affiliate.commission_wallet_id and wallet.owner_entity_type='user' and wallet.owner_entity_id=auth.uid();
  end if;

  return jsonb_build_object(
    'id',affiliate.id,'status',affiliate.status,'referralCode',affiliate.referral_code,
    'commissionWalletId',wallet_id,'currencyCode','NGN','availableBalance',coalesce(balance_amount,0),
    'reviewReason',affiliate.review_reason,'createdAt',affiliate.created_at,
    'referralCount',(select count(*) from public.lpg_station_referrals referral where referral.affiliate_id=affiliate.id),
    'activeReferrals',(select count(*) from public.lpg_station_referrals referral where referral.affiliate_id=affiliate.id and referral.status='activated'),
    'totalEarned',coalesce((select sum(earning.amount) from public.lpg_station_affiliate_earnings earning where earning.affiliate_id=affiliate.id and earning.status='posted'),0),
    'referrals',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',referral.id,'status',referral.status,'submittedAt',referral.submitted_at,'activatedAt',referral.activated_at,
        'stationName',coalesce(station.display_name,organization.display_name,'Station application'),
        'earned',coalesce((select sum(earning.amount) from public.lpg_station_affiliate_earnings earning where earning.referral_id=referral.id and earning.status='posted'),0)
      ) order by referral.submitted_at desc)
      from public.lpg_station_referrals referral
      left join public.lpg_station_branches station on station.id=referral.station_branch_id
      left join public.organizations organization on organization.id=station.organization_id
      where referral.affiliate_id=affiliate.id
    ),'[]'::jsonb)
  );
end
$$;

create or replace function public.review_lpg_station_affiliate(
  target_affiliate_id uuid,
  target_decision text,
  target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare affiliate public.lpg_station_affiliates%rowtype; wallet_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  if not (public.is_platform_super_admin() or public.has_permission('platform.wallets.manage',null)) then
    raise exception using errcode='42501',message='platform wallet management permission is required to activate affiliates';
  end if;
  if target_decision not in ('active','rejected','suspended') or char_length(btrim(coalesce(target_reason,'')))<5 or char_length(btrim(target_reason))>500 then
    raise exception using errcode='22023',message='a supported decision and a 5-500 character reason are required';
  end if;
  select * into affiliate from public.lpg_station_affiliates where id=target_affiliate_id for update;
  if not found then raise exception using errcode='P0002',message='affiliate request not found'; end if;
  if target_decision='active' and affiliate.affiliate_user_id=auth.uid() then
    raise exception using errcode='42501',message='an affiliate cannot approve their own request';
  end if;
  if target_decision='active' then
    wallet_id:=public.ensure_wallet_account(
      'commission','user',affiliate.affiliate_user_id,'NGN','lpg.station_affiliate.wallet',
      jsonb_build_object('module','lpg','purpose','station_affiliate_commission'),
      'lpg-station-affiliate-wallet:'||affiliate.affiliate_user_id::text||':NGN'
    );
  end if;
  update public.lpg_station_affiliates set status=target_decision,
    commission_wallet_id=coalesce(wallet_id,commission_wallet_id),
    reviewed_by=auth.uid(),reviewed_at=timezone('utc',now()),review_reason=btrim(target_reason),
    updated_at=timezone('utc',now()),
    metadata=metadata||jsonb_build_object('lastDecision',target_decision,'lastReason',btrim(target_reason),'lastReviewedAt',timezone('utc',now()))
  where id=target_affiliate_id
  returning * into affiliate;
  return jsonb_build_object('id',affiliate.id,'referralCode',affiliate.referral_code,'status',affiliate.status,'reviewReason',affiliate.review_reason,'reviewedAt',affiliate.reviewed_at);
end
$$;

create or replace function public.validate_lpg_station_affiliate_referral_on_submission()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare application_type_key text; active_payload jsonb; code text; affiliate public.lpg_station_affiliates%rowtype;
begin
  if old.submitted_at is not null or new.submitted_at is null then return new; end if;
  select definition.key into application_type_key
  from public.application_type_definitions definition
  where definition.id=new.application_type_id;
  if application_type_key is distinct from 'application.lpg.station.phase-one' then return new; end if;

  select version.payload into active_payload from public.application_versions version
  where version.application_id=new.id and version.version=new.active_version;
  code:=upper(btrim(coalesce(active_payload->'station'->>'affiliateReferralCode','')));
  if code='' then return new; end if;

  select * into affiliate from public.lpg_station_affiliates
  where referral_code=code and status='active';
  if not found then
    raise exception using errcode='22023',message='Station referral code is not active or does not exist';
  end if;
  if affiliate.affiliate_user_id=new.applicant_user_id then
    raise exception using errcode='22023',message='You cannot use your own Station Affiliate referral code';
  end if;
  if exists(select 1 from public.lpg_station_referrals referral where referral.application_id=new.id) then
    raise exception using errcode='23505',message='a station application referral has already been recorded';
  end if;
  return new;
end
$$;

create or replace function public.record_lpg_station_affiliate_referral_on_submission()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare application_type_key text; active_payload jsonb; code text; affiliate public.lpg_station_affiliates%rowtype;
begin
  if old.submitted_at is not null or new.submitted_at is null then return new; end if;
  select definition.key into application_type_key
  from public.application_type_definitions definition
  where definition.id=new.application_type_id;
  if application_type_key is distinct from 'application.lpg.station.phase-one' then return new; end if;
  select version.payload into active_payload from public.application_versions version
  where version.application_id=new.id and version.version=new.active_version;
  code:=upper(btrim(coalesce(active_payload->'station'->>'affiliateReferralCode','')));
  if code='' then return new; end if;
  select * into affiliate from public.lpg_station_affiliates where referral_code=code and status='active';
  if not found or affiliate.affiliate_user_id=new.applicant_user_id then
    raise exception using errcode='22023',message='Station referral code is not valid for this application';
  end if;
  insert into public.lpg_station_referrals(affiliate_id,application_id,applicant_user_id,referral_code_snapshot,status,metadata)
  values(affiliate.id,new.id,new.applicant_user_id,affiliate.referral_code,'submitted',jsonb_build_object('source','station-application-referral'))
  on conflict(application_id) do nothing;
  return new;
end
$$;

create or replace function public.activate_lpg_station_affiliate_referral_for_branch()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare application_text text; application_id_value uuid;
begin
  if new.approval_status<>'approved'
    or new.compliance_status<>'approved'
    or new.availability_status<>'available' then
    return new;
  end if;
  application_text:=coalesce(new.metadata->>'source_application_id',new.metadata->>'activated_from_application_id');
  if application_text is null then return new; end if;
  begin application_id_value:=application_text::uuid;
  exception when others then return new;
  end;
  update public.lpg_station_referrals referral
  set station_branch_id=new.id,status='activated',
      activated_at=coalesce(referral.activated_at,nullif(new.metadata->>'operationally_activated_at','')::timestamptz,new.updated_at,timezone('utc',now())),
      metadata=referral.metadata||jsonb_build_object('branchActivatedAt',timezone('utc',now()))
  where referral.application_id=application_id_value and referral.status='submitted';
  return new;
end
$$;

drop trigger if exists trg_validate_lpg_station_affiliate_referral_on_submission on public.application_records;
create trigger trg_validate_lpg_station_affiliate_referral_on_submission
before update of submitted_at on public.application_records
for each row execute function public.validate_lpg_station_affiliate_referral_on_submission();

drop trigger if exists trg_record_lpg_station_affiliate_referral_on_submission on public.application_records;
create trigger trg_record_lpg_station_affiliate_referral_on_submission
after update of submitted_at on public.application_records
for each row execute function public.record_lpg_station_affiliate_referral_on_submission();

drop trigger if exists trg_activate_lpg_station_affiliate_referral_for_branch on public.lpg_station_branches;
create trigger trg_activate_lpg_station_affiliate_referral_for_branch
after insert or update of approval_status,compliance_status,availability_status,metadata on public.lpg_station_branches
for each row execute function public.activate_lpg_station_affiliate_referral_for_branch();

create or replace function public.award_lpg_station_affiliate_commission(
  target_lpg_order_id uuid,
  target_classification_transaction_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  order_record public.lpg_refill_orders%rowtype;
  referral public.lpg_station_referrals%rowtype;
  affiliate public.lpg_station_affiliates%rowtype;
  policy jsonb;
  policy_version_id uuid;
  config jsonb;
  commission_percent numeric;
  earning_months integer;
  streams jsonb;
  revenue_base numeric(28,8):=0;
  commission_amount numeric(28,8):=0;
  revenue_wallet_id uuid;
  commission_wallet_id uuid;
  earning_id uuid;
  posting_id uuid;
  existing_earning public.lpg_station_affiliate_earnings%rowtype;
  earning_start timestamptz;
  earning_end timestamptz;
begin
  select * into order_record from public.lpg_refill_orders where id=target_lpg_order_id for update;
  if not found or order_record.status<>'station_settled'
    or order_record.station_settlement_execution_id is null
    or order_record.metadata->>'platform_revenue_classification_transaction_id' is null
    or order_record.metadata->>'platform_revenue_classification_transaction_id'<>target_classification_transaction_id::text then
    return null;
  end if;
  if order_record.station_branch_id is null then return null; end if;

  select * into referral from public.lpg_station_referrals
  where station_branch_id=order_record.station_branch_id and status='activated';
  if not found or referral.activated_at is null then return null; end if;
  select * into affiliate from public.lpg_station_affiliates where id=referral.affiliate_id and status='active';
  if not found then return null; end if;
  if order_record.created_at<referral.activated_at then return null; end if;

  -- No policy means the optional affiliate programme is not enabled yet.
  if not exists(
    select 1 from public.financial_policy_definitions definition
    join public.financial_policy_versions version on version.policy_definition_id=definition.id
    where definition.key='commission.lpg.station_affiliate' and definition.status='active'
      and version.lifecycle_status in ('active','scheduled')
      and version.currency_code=order_record.currency_code
      and version.effective_from<=timezone('utc',now())
      and (version.effective_until is null or version.effective_until>timezone('utc',now()))
      and version.module_id=(select module.id from public.business_modules module where module.key='lpg')
      and version.service_key='lpg.station.affiliate'
      and version.geography_type='country' and version.geography_key='NG'
  ) then return null; end if;

  policy:=public.resolve_financial_policy(
    'commission.lpg.station_affiliate',order_record.currency_code,timezone('utc',now()),
    'lpg',null,'lpg.station.affiliate','country','NG'
  );
  config:=policy->'configuration';
  if not coalesce((config->>'program_enabled')::boolean,false) then return null; end if;
  commission_percent:=nullif(config->>'commission_percent','')::numeric;
  earning_months:=nullif(config->>'earning_period_months','')::integer;
  streams:=config->'eligible_revenue_streams';
  if commission_percent is null or commission_percent<=0 or commission_percent>100
    or earning_months is null or earning_months<1 or earning_months>36
    or jsonb_typeof(streams)<>'array' then
    raise exception using errcode='55000',message='active Station Affiliate financial policy is invalid';
  end if;
  earning_start:=referral.activated_at;
  earning_end:=earning_start+make_interval(months=>earning_months);
  if order_record.created_at>=earning_end then return null; end if;

  select coalesce(sum(ledger.amount),0)::numeric(28,8)
  into revenue_base
  from public.wallet_ledger_entries ledger
  join public.wallet_accounts wallet on wallet.id=ledger.wallet_id
  where ledger.transaction_id=target_classification_transaction_id
    and wallet.wallet_type='platform_revenue' and wallet.owner_entity_type='platform'
    and wallet.currency_code=order_record.currency_code and ledger.direction='credit'
    and ledger.metadata->>'lpg_order_id'=order_record.id::text
    and ledger.metadata->>'revenue_stream' in (select jsonb_array_elements_text(streams));
  if revenue_base<=0 then return null; end if;

  commission_amount:=round(revenue_base*commission_percent/100,2);
  if commission_amount<=0 then return null; end if;

  select ledger.wallet_id into revenue_wallet_id
  from public.wallet_ledger_entries ledger
  join public.wallet_accounts wallet on wallet.id=ledger.wallet_id
  where ledger.transaction_id=target_classification_transaction_id
    and wallet.wallet_type='platform_revenue' and wallet.owner_entity_type='platform'
    and wallet.currency_code=order_record.currency_code and ledger.direction='credit'
    and ledger.metadata->>'lpg_order_id'=order_record.id::text
  order by ledger.created_at
  limit 1;
  if revenue_wallet_id is null then return null; end if;

  commission_wallet_id:=affiliate.commission_wallet_id;
  if commission_wallet_id is null then
    commission_wallet_id:=public.ensure_wallet_account(
      'commission','user',affiliate.affiliate_user_id,order_record.currency_code,
      'lpg.station_affiliate.wallet',jsonb_build_object('module','lpg','purpose','station_affiliate_commission'),
      'lpg-station-affiliate-wallet:'||affiliate.affiliate_user_id::text||':'||order_record.currency_code
    );
    update public.lpg_station_affiliates set commission_wallet_id=commission_wallet_id,updated_at=timezone('utc',now())
    where id=affiliate.id;
  end if;

  insert into public.lpg_station_affiliate_earnings(
    affiliate_id,referral_id,station_branch_id,lpg_order_id,classification_transaction_id,
    commission_wallet_id,currency_code,revenue_base_amount,commission_percent,amount,
    policy_version_id,earning_period_start,earning_period_end,status,metadata
  ) values (
    affiliate.id,referral.id,order_record.station_branch_id,order_record.id,target_classification_transaction_id,
    commission_wallet_id,order_record.currency_code,revenue_base,commission_percent,commission_amount,
    (policy->>'policyVersionId')::uuid,earning_start,earning_end,'pending',
    jsonb_build_object('revenueStreams',streams,'policyKey','commission.lpg.station_affiliate','policyVersion',policy->>'version')
  ) on conflict(lpg_order_id) do nothing returning id into earning_id;

  if earning_id is null then
    select * into strict existing_earning
    from public.lpg_station_affiliate_earnings earning
    where earning.lpg_order_id=target_lpg_order_id;
    if existing_earning.financial_transaction_id is not null then return existing_earning.id; end if;
    earning_id:=existing_earning.id;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(revenue_wallet_id::text,0));
  if coalesce((select balance.balance from public.wallet_balances balance where balance.wallet_id=revenue_wallet_id),0)<commission_amount then
    raise exception using errcode='55000',message='SKIMA revenue wallet does not have sufficient available balance to post affiliate commission';
  end if;

  posting_id:=public.post_financial_transaction(
    'commission',order_record.currency_code,'lpg.station_affiliate','lpg_station_affiliate_earning',earning_id,
    jsonb_build_array(
      jsonb_build_object('wallet_id',revenue_wallet_id,'direction','debit','amount',commission_amount,'entry_type','commission',
        'metadata',jsonb_build_object('role','skima_revenue','revenue_stream','station_affiliate_commission','affiliate_id',affiliate.id,'lpg_order_id',order_record.id)),
      jsonb_build_object('wallet_id',commission_wallet_id,'direction','credit','amount',commission_amount,'entry_type','commission',
        'metadata',jsonb_build_object('role','affiliate_commission','affiliate_id',affiliate.id,'referral_id',referral.id,'station_branch_id',order_record.station_branch_id,'lpg_order_id',order_record.id))
    ),
    'lpg-station-affiliate:'||order_record.id::text,
    null,order_record.public_reference,policy,
    jsonb_build_object('lpgOrderId',order_record.id,'affiliateId',affiliate.id,'referralId',referral.id,'revenueBaseAmount',revenue_base,'commissionPercent',commission_percent,'amount',commission_amount)
  );

  update public.lpg_station_affiliate_earnings set status='posted',financial_transaction_id=posting_id,updated_at=timezone('utc',now())
  where id=earning_id;
  delete from public.lpg_station_affiliate_commission_failures where lpg_order_id=order_record.id;
  return earning_id;
end
$$;

create or replace function public.capture_lpg_station_affiliate_commission_failure()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare transaction_id uuid;
begin
  if old.metadata->>'platform_revenue_classification_transaction_id' is not distinct from new.metadata->>'platform_revenue_classification_transaction_id'
    or new.metadata->>'platform_revenue_classification_transaction_id' is null then return new; end if;
  transaction_id:=(new.metadata->>'platform_revenue_classification_transaction_id')::uuid;
  begin
    perform public.award_lpg_station_affiliate_commission(new.id,transaction_id);
  exception when others then
    insert into public.lpg_station_affiliate_commission_failures(lpg_order_id,classification_transaction_id,last_error,attempt_count,status,first_attempt_at,last_attempt_at,metadata)
    values(new.id,transaction_id,left(sqlerrm,2000),1,'pending',timezone('utc',now()),timezone('utc',now()),jsonb_build_object('source','revenue-classification-trigger'))
    on conflict(lpg_order_id) do update set
      classification_transaction_id=excluded.classification_transaction_id,
      last_error=excluded.last_error,
      attempt_count=public.lpg_station_affiliate_commission_failures.attempt_count+1,
      status='pending',last_attempt_at=timezone('utc',now()),metadata=public.lpg_station_affiliate_commission_failures.metadata||excluded.metadata;
  end;
  return new;
end
$$;

drop trigger if exists trg_capture_lpg_station_affiliate_commission on public.lpg_refill_orders;
create trigger trg_capture_lpg_station_affiliate_commission
after update of metadata on public.lpg_refill_orders
for each row execute function public.capture_lpg_station_affiliate_commission_failure();

create or replace function public.retry_lpg_station_affiliate_commission(
  target_lpg_order_id uuid,
  target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare failure public.lpg_station_affiliate_commission_failures%rowtype; transaction_id uuid; earning_id uuid;
begin
  if auth.role()<>'service_role' and (
    not public.has_permission('platform.financial.manage',null)
    or not public.has_permission('platform.wallets.manage',null)
  ) then
    raise exception using errcode='42501',message='financial and wallet management permissions are required to retry affiliate commission';
  end if;
  if char_length(btrim(coalesce(target_reason,'')))<5 or char_length(btrim(target_reason))>500 then
    raise exception using errcode='22023',message='a reason of 5-500 characters is required';
  end if;
  select * into failure from public.lpg_station_affiliate_commission_failures where lpg_order_id=target_lpg_order_id for update;
  if not found then raise exception using errcode='P0002',message='affiliate commission failure was not found'; end if;
  if failure.status='resolved' then
    return jsonb_build_object('status','resolved','lpgOrderId',target_lpg_order_id);
  end if;
  select (order_record.metadata->>'platform_revenue_classification_transaction_id')::uuid
  into transaction_id from public.lpg_refill_orders order_record where order_record.id=target_lpg_order_id;
  if transaction_id is null then raise exception using errcode='55000',message='LPG order has no platform revenue classification transaction'; end if;
  earning_id:=public.award_lpg_station_affiliate_commission(target_lpg_order_id,transaction_id);
  if earning_id is null then
    raise exception using errcode='55000',message='affiliate commission was not posted; confirm the referral, order eligibility and active approved policy before retrying';
  end if;
  update public.lpg_station_affiliate_commission_failures
  set status='resolved',resolved_at=timezone('utc',now()),resolved_by=auth.uid(),
      last_attempt_at=timezone('utc',now()),metadata=metadata||jsonb_build_object('resolvedReason',btrim(target_reason))
  where lpg_order_id=target_lpg_order_id;
  return jsonb_build_object('status','resolved','lpgOrderId',target_lpg_order_id,'earningId',earning_id);
end
$$;

create or replace function public.read_lpg_station_affiliate_admin_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare policy_result jsonb;
begin
  if auth.role()<>'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.dispatch.read',null)
    and not public.has_permission('platform.wallets.read',null)
    and not public.has_permission('platform.revenue.read',null)
    and not public.has_permission('platform.financial_policy.read',null)
    and not public.has_permission('platform.financial_policy.draft',null)
    and not public.has_permission('platform.financial_policy.approve',null)
    and not public.has_permission('platform.financial_policy.activate',null) then
    raise exception using errcode='42501',message='Station Affiliate administration read permission is required';
  end if;

  select jsonb_build_object(
    'policyKey',definition.key,
    'displayName',definition.display_name,
    'policyFamily',definition.policy_family,
    'definitionId',definition.id,
    'latestVersion',(
      select to_jsonb(latest.*) from public.financial_policy_versions latest
      where latest.policy_definition_id=definition.id
      order by latest.version desc limit 1
    ),
    'activeVersion',(
      select to_jsonb(active.*) from public.financial_policy_versions active
      where active.policy_definition_id=definition.id
        and active.lifecycle_status in ('active','scheduled')
        and active.effective_from<=timezone('utc',now())
        and (active.effective_until is null or active.effective_until>timezone('utc',now()))
      order by active.version desc limit 1
    )
  )
  into policy_result
  from public.financial_policy_definitions definition
  where definition.key='commission.lpg.station_affiliate';

  return jsonb_build_object(
    'policy',policy_result,
    'affiliates',coalesce((
      select jsonb_agg(jsonb_build_object(
        'id',affiliate.id,'affiliateUserId',affiliate.affiliate_user_id,'displayName',profile.display_name,
        'referralCode',affiliate.referral_code,'status',affiliate.status,'createdAt',affiliate.created_at,
        'reviewedAt',affiliate.reviewed_at,'reviewReason',affiliate.review_reason,
        'referralCount',(select count(*) from public.lpg_station_referrals referral where referral.affiliate_id=affiliate.id),
        'activeReferrals',(select count(*) from public.lpg_station_referrals referral where referral.affiliate_id=affiliate.id and referral.status='activated'),
        'earned',(select coalesce(sum(earning.amount),0) from public.lpg_station_affiliate_earnings earning where earning.affiliate_id=affiliate.id and earning.status='posted')
      ) order by affiliate.created_at desc)
      from public.lpg_station_affiliates affiliate join public.profiles profile on profile.id=affiliate.affiliate_user_id
    ),'[]'::jsonb),
    'referrals',coalesce((
      select jsonb_agg(jsonb_build_object('id',referral.id,'status',referral.status,'referralCode',referral.referral_code_snapshot,
        'stationBranchId',referral.station_branch_id,'stationName',coalesce(station.display_name,'Station pending activation'),
        'submittedAt',referral.submitted_at,'activatedAt',referral.activated_at,'affiliateId',affiliate.id,
        'affiliateName',profile.display_name,'earnings',coalesce((select sum(earning.amount) from public.lpg_station_affiliate_earnings earning where earning.referral_id=referral.id and earning.status='posted'),0))
      order by referral.submitted_at desc)
      from (
        select * from public.lpg_station_referrals
        order by submitted_at desc
        limit 100
      ) referral
      join public.lpg_station_affiliates affiliate on affiliate.id=referral.affiliate_id
      join public.profiles profile on profile.id=affiliate.affiliate_user_id
      left join public.lpg_station_branches station on station.id=referral.station_branch_id
    ),'[]'::jsonb),
    'earnings',coalesce((
      select jsonb_agg(jsonb_build_object('id',earning.id,'affiliateId',earning.affiliate_id,'affiliateName',profile.display_name,
        'referralId',earning.referral_id,'stationBranchId',earning.station_branch_id,'stationName',station.display_name,
        'orderId',earning.lpg_order_id,'publicReference',order_record.public_reference,'currencyCode',earning.currency_code,
        'revenueBaseAmount',earning.revenue_base_amount,'commissionPercent',earning.commission_percent,
        'amount',earning.amount,'status',earning.status,'createdAt',earning.created_at,'policyVersion',earning.metadata->>'policyVersion')
      order by earning.created_at desc)
      from (
        select * from public.lpg_station_affiliate_earnings
        order by created_at desc
        limit 100
      ) earning
      join public.lpg_station_affiliates affiliate on affiliate.id=earning.affiliate_id
      join public.profiles profile on profile.id=affiliate.affiliate_user_id
      join public.lpg_station_branches station on station.id=earning.station_branch_id
      join public.lpg_refill_orders order_record on order_record.id=earning.lpg_order_id
    ),'[]'::jsonb),
    'commissionFailures',coalesce((
      select jsonb_agg(jsonb_build_object('id',failure.id,'orderId',failure.lpg_order_id,'publicReference',order_record.public_reference,
        'classificationTransactionId',failure.classification_transaction_id,'attemptCount',failure.attempt_count,
        'lastError',failure.last_error,'status',failure.status,'lastAttemptAt',failure.last_attempt_at)
      order by failure.last_attempt_at desc)
      from (
        select * from public.lpg_station_affiliate_commission_failures
        where status='pending'
        order by last_attempt_at desc
        limit 100
      ) failure
      join public.lpg_refill_orders order_record on order_record.id=failure.lpg_order_id
    ),'[]'::jsonb)
  );
end
$$;

revoke all on function public.request_lpg_station_affiliate() from public,anon;
revoke all on function public.read_my_lpg_station_affiliate() from public,anon;
revoke all on function public.review_lpg_station_affiliate(uuid,text,text) from public,anon;
revoke all on function public.validate_lpg_station_affiliate_referral_on_submission() from public,anon,authenticated;
revoke all on function public.record_lpg_station_affiliate_referral_on_submission() from public,anon,authenticated;
revoke all on function public.activate_lpg_station_affiliate_referral_for_branch() from public,anon,authenticated;
revoke all on function public.award_lpg_station_affiliate_commission(uuid,uuid) from public,anon,authenticated;
revoke all on function public.capture_lpg_station_affiliate_commission_failure() from public,anon,authenticated;
revoke all on function public.retry_lpg_station_affiliate_commission(uuid,text) from public,anon;
revoke all on function public.read_lpg_station_affiliate_admin_workspace() from public,anon;

grant execute on function public.request_lpg_station_affiliate() to authenticated,service_role;
grant execute on function public.read_my_lpg_station_affiliate() to authenticated,service_role;
grant execute on function public.review_lpg_station_affiliate(uuid,text,text) to authenticated,service_role;
grant execute on function public.retry_lpg_station_affiliate_commission(uuid,text) to authenticated,service_role;
grant execute on function public.read_lpg_station_affiliate_admin_workspace() to authenticated,service_role;

comment on function public.award_lpg_station_affiliate_commission(uuid,uuid) is
  'Posts idempotent, time-limited station affiliate commissions only against eligible revenue credits actually posted to the SKIMA revenue wallet; no active governed policy means no commission.';

notify pgrst,'reload schema';

commit;
