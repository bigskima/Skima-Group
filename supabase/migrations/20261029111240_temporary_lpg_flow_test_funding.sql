-- Temporary, ledger-backed LPG flow-test funding.
-- These balances are synthetic, non-cash credits intended only for production-flow testing.
-- They remain spendable inside the application but cannot be withdrawn as NGN.
-- The allocation tracker follows each credit through double-entry transfers so a batch can be burned later.

create table if not exists public.wallet_test_funding_batches (
  id uuid primary key default gen_random_uuid(),
  label text not null unique,
  currency_code text not null references public.currency_definitions(code),
  amount_per_wallet numeric(28,8) not null check (amount_per_wallet > 0),
  target_wallet_count integer not null check (target_wallet_count > 0),
  total_amount numeric(28,8) not null check (total_amount > 0),
  status text not null default 'active' check (status in ('active','burned','cancelled')),
  credit_transaction_id uuid references public.financial_transactions(id),
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc',now()),
  burned_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object')
);

create table if not exists public.wallet_test_funding_allocations (
  batch_id uuid not null references public.wallet_test_funding_batches(id),
  wallet_id uuid not null references public.wallet_accounts(id),
  credited_amount numeric(28,8) not null default 0 check (credited_amount >= 0),
  remaining_amount numeric(28,8) not null default 0 check (remaining_amount >= 0),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  primary key (batch_id,wallet_id),
  check (remaining_amount <= credited_amount)
);

create index if not exists wallet_test_funding_allocations_wallet_active_idx
  on public.wallet_test_funding_allocations(wallet_id,batch_id)
  where remaining_amount > 0;

alter table public.wallet_test_funding_batches enable row level security;
alter table public.wallet_test_funding_allocations enable row level security;
revoke all on public.wallet_test_funding_batches from public, anon, authenticated;
revoke all on public.wallet_test_funding_allocations from public, anon, authenticated;
grant all on public.wallet_test_funding_batches to service_role;
grant all on public.wallet_test_funding_allocations to service_role;

create or replace function public.track_temporary_test_funding_transfers()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $track$
declare
  v_txid uuid;
  v_subject_type text;
  v_tx_metadata jsonb;
  v_debit record;
  v_credit record;
  v_alloc record;
  v_total_credit numeric(28,8);
  v_credit_count integer;
  v_credit_index integer;
  v_left numeric(28,8);
  v_take numeric(28,8);
  v_batch_id uuid;
  v_batch_amount numeric(28,8);
  v_share numeric(28,8);
  v_previous_share numeric(28,8);
  v_batch_consumed jsonb;
  v_batch_credited jsonb;
  v_test_debit_total numeric(28,8);
begin
  for v_txid in
    select distinct inserted.transaction_id
    from inserted_entries inserted
    where inserted.transaction_id is not null
    order by inserted.transaction_id
  loop
    select transaction.subject_type, transaction.metadata
      into v_subject_type, v_tx_metadata
    from public.financial_transactions transaction
    where transaction.id = v_txid;

    if coalesce(v_tx_metadata ->> 'temporary_test_funding_action','') in ('credit','burn')
       or v_subject_type = 'wallet_withdrawal' then
      continue;
    end if;

    select coalesce(sum(inserted.amount),0),count(*)
      into v_total_credit,v_credit_count
    from inserted_entries inserted
    where inserted.transaction_id = v_txid
      and inserted.direction = 'credit';

    if v_total_credit <= 0 or v_credit_count <= 0 then
      continue;
    end if;

    v_batch_consumed := '{}'::jsonb;

    for v_debit in
      select inserted.wallet_id,inserted.amount
      from inserted_entries inserted
      where inserted.transaction_id = v_txid
        and inserted.direction = 'debit'
      order by inserted.wallet_id,inserted.id
    loop
      v_left := v_debit.amount;

      for v_alloc in
        select allocation.batch_id,allocation.remaining_amount
        from public.wallet_test_funding_allocations allocation
        join public.wallet_test_funding_batches batch
          on batch.id = allocation.batch_id
        where allocation.wallet_id = v_debit.wallet_id
          and allocation.remaining_amount > 0
          and batch.status = 'active'
        order by batch.created_at,allocation.batch_id
        for update of allocation
      loop
        exit when v_left <= 0;
        v_take := least(v_left,v_alloc.remaining_amount);
        if v_take > 0 then
          update public.wallet_test_funding_allocations
          set remaining_amount = remaining_amount - v_take,
              updated_at = timezone('utc',now())
          where batch_id = v_alloc.batch_id
            and wallet_id = v_debit.wallet_id;

          v_batch_amount := coalesce((v_batch_consumed ->> v_alloc.batch_id::text)::numeric,0) + v_take;
          v_batch_consumed := jsonb_set(
            v_batch_consumed,
            array[v_alloc.batch_id::text],
            to_jsonb(v_batch_amount),
            true
          );
          v_left := v_left - v_take;
        end if;
      end loop;
    end loop;

    select coalesce(sum(value::numeric),0)
      into v_test_debit_total
    from jsonb_each_text(v_batch_consumed);

    if v_test_debit_total <= 0 then
      continue;
    end if;

    v_batch_credited := '{}'::jsonb;
    v_credit_index := 0;

    for v_credit in
      select inserted.wallet_id,inserted.amount
      from inserted_entries inserted
      where inserted.transaction_id = v_txid
        and inserted.direction = 'credit'
      order by inserted.id
    loop
      v_credit_index := v_credit_index + 1;

      for v_batch_id,v_batch_amount in
        select item.key::uuid,item.value::numeric
        from jsonb_each_text(v_batch_consumed) item
      loop
        if v_credit_index = v_credit_count then
          v_previous_share := coalesce((v_batch_credited ->> v_batch_id::text)::numeric,0);
          v_share := v_batch_amount - v_previous_share;
        else
          v_share := round(v_batch_amount * v_credit.amount / v_total_credit,8);
        end if;

        if v_share > 0 then
          insert into public.wallet_test_funding_allocations(
            batch_id,wallet_id,credited_amount,remaining_amount
          )
          select v_batch_id,v_credit.wallet_id,v_share,v_share
          where exists (
            select 1 from public.wallet_test_funding_batches batch
            where batch.id=v_batch_id and batch.status='active'
          )
          on conflict (batch_id,wallet_id) do update
          set credited_amount = public.wallet_test_funding_allocations.credited_amount + excluded.credited_amount,
              remaining_amount = public.wallet_test_funding_allocations.remaining_amount + excluded.remaining_amount,
              updated_at = timezone('utc',now());

          v_previous_share := coalesce((v_batch_credited ->> v_batch_id::text)::numeric,0) + v_share;
          v_batch_credited := jsonb_set(
            v_batch_credited,
            array[v_batch_id::text],
            to_jsonb(v_previous_share),
            true
          );
        end if;
      end loop;
    end loop;
  end loop;

  return null;
end
$track$;

revoke all on function public.track_temporary_test_funding_transfers() from public, anon, authenticated;
drop trigger if exists track_temporary_test_funding_transfers on public.wallet_ledger_entries;
create trigger track_temporary_test_funding_transfers
after insert on public.wallet_ledger_entries
referencing new table as inserted_entries
for each statement execute function public.track_temporary_test_funding_transfers();

create or replace function public.guard_temporary_test_fund_withdrawal()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $guard$
declare
  v_subject_type text;
  v_balance numeric(28,8);
  v_test_remaining numeric(28,8);
  v_cash_available numeric(28,8);
begin
  if new.direction <> 'debit' then
    return new;
  end if;

  select transaction.subject_type
    into v_subject_type
  from public.financial_transactions transaction
  where transaction.id = new.transaction_id;

  if v_subject_type <> 'wallet_withdrawal' then
    return new;
  end if;

  select coalesce(balance.balance,0)
    into v_balance
  from public.wallet_accounts wallet
  left join public.wallet_balances balance
    on balance.wallet_id=wallet.id
   and balance.currency_code=wallet.currency_code
  where wallet.id=new.wallet_id;

  select coalesce(sum(allocation.remaining_amount),0)
    into v_test_remaining
  from public.wallet_test_funding_allocations allocation
  join public.wallet_test_funding_batches batch on batch.id=allocation.batch_id
  where allocation.wallet_id=new.wallet_id
    and allocation.remaining_amount>0
    and batch.status='active';

  v_cash_available := coalesce(v_balance,0) - coalesce(v_test_remaining,0);
  if v_cash_available + 0.00000001 < new.amount then
    raise exception using errcode='55000',
      message=format(
        'Withdrawal blocked: temporary test credits are not cash. Non-test funds available: %s %s.',
        greatest(v_cash_available,0),new.currency_code
      );
  end if;

  return new;
end
$guard$;

revoke all on function public.guard_temporary_test_fund_withdrawal() from public, anon, authenticated;
drop trigger if exists guard_temporary_test_fund_withdrawal on public.wallet_ledger_entries;
create trigger guard_temporary_test_fund_withdrawal
before insert on public.wallet_ledger_entries
for each row execute function public.guard_temporary_test_fund_withdrawal();

create or replace function public.guard_temporary_test_fund_withdrawal_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $request_guard$
declare
  v_balance numeric(28,8);
  v_test_remaining numeric(28,8);
  v_required numeric(28,8);
begin
  if new.status <> 'requested' then
    return new;
  end if;

  select coalesce(balance.balance,0)
    into v_balance
  from public.wallet_accounts wallet
  left join public.wallet_balances balance
    on balance.wallet_id=wallet.id
   and balance.currency_code=wallet.currency_code
  where wallet.id=new.wallet_id;

  select coalesce(sum(allocation.remaining_amount),0)
    into v_test_remaining
  from public.wallet_test_funding_allocations allocation
  join public.wallet_test_funding_batches batch on batch.id=allocation.batch_id
  where allocation.wallet_id=new.wallet_id
    and allocation.remaining_amount>0
    and batch.status='active';

  v_required := coalesce(new.total_debit_amount,new.amount + coalesce(new.fee_amount,0));

  if coalesce(v_balance,0)-coalesce(v_test_remaining,0) + 0.00000001 < v_required then
    raise exception using errcode='55000',
      message=format(
        'Withdrawal request blocked: test credits are non-cash and cannot be withdrawn. Non-test funds available: %s %s.',
        greatest(coalesce(v_balance,0)-coalesce(v_test_remaining,0),0),new.currency_code
      );
  end if;

  return new;
end
$request_guard$;

revoke all on function public.guard_temporary_test_fund_withdrawal_request() from public, anon, authenticated;
drop trigger if exists guard_temporary_test_fund_withdrawal_request on public.withdrawal_requests;
create trigger guard_temporary_test_fund_withdrawal_request
before insert on public.withdrawal_requests
for each row execute function public.guard_temporary_test_fund_withdrawal_request();

create or replace function public.fund_temporary_lpg_test_batch(
  target_label text,
  target_wallet_ids uuid[],
  target_amount numeric default 100000
)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $fund$
declare
  v_batch_id uuid;
  v_source_wallet_id uuid;
  v_transaction_id uuid;
  v_wallet_count integer;
  v_valid_wallets boolean;
  v_total numeric(28,8);
  v_entries jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role'
     and current_user not in ('postgres','supabase_admin') then
    raise exception using errcode='42501',message='Privileged service access is required to fund a temporary test batch';
  end if;

  if nullif(btrim(target_label),'') is null then
    raise exception using errcode='22023',message='A unique test batch label is required';
  end if;
  if target_wallet_ids is null or cardinality(target_wallet_ids)=0 then
    raise exception using errcode='22023',message='At least one target wallet is required';
  end if;
  if target_amount is null or target_amount<=0 or target_amount>100000000
     or target_amount<>round(target_amount,2) then
    raise exception using errcode='22023',message='Funding amount must be positive, at most NGN 100,000,000 per wallet, and have no more than two decimal places';
  end if;
  if not exists (
    select 1 from public.currency_definitions currency
    where currency.code='NGN' and currency.status='enabled'
  ) then
    raise exception using errcode='23514',message='NGN must be enabled before test funding';
  end if;
  if cardinality(target_wallet_ids) <> (
    select count(distinct target_wallet_id) from unnest(target_wallet_ids) target_wallet_id
  ) then
    raise exception using errcode='22023',message='Duplicate wallet IDs are not allowed in one funding batch';
  end if;

  select count(*),coalesce(bool_and(
      (wallet.wallet_type='customer' and wallet.owner_entity_type='user')
      or (wallet.wallet_type='driver' and wallet.owner_entity_type='driver')
      or (wallet.wallet_type='partner' and wallet.owner_entity_type in ('organization','partner'))
    ),false)
    into v_wallet_count,v_valid_wallets
  from public.wallet_accounts wallet
  where wallet.id=any(target_wallet_ids)
    and wallet.currency_code='NGN'
    and wallet.status='active';

  if v_wallet_count <> cardinality(target_wallet_ids) or not v_valid_wallets then
    raise exception using errcode='23514',message='Every target must be an active NGN customer, driver, station-organization, or partner wallet';
  end if;

  v_total := target_amount * v_wallet_count;

  select wallet.id into v_source_wallet_id
  from public.wallet_accounts wallet
  where wallet.wallet_type='platform_campaign'
    and wallet.owner_entity_type='platform'
    and wallet.currency_code='NGN'
    and wallet.status='active'
    and wallet.metadata->>'wallet_purpose'='temporary_lpg_test_funding_source'
  order by wallet.created_at
  limit 1
  for update;

  if v_source_wallet_id is null then
    insert into public.wallet_accounts(
      wallet_type,owner_entity_type,owner_entity_id,currency_code,status,metadata,
      created_by,source,idempotency_key
    ) values (
      'platform_campaign','platform',null,'NGN','active',
      jsonb_build_object(
        'wallet_purpose','temporary_lpg_test_funding_source',
        'temporary_test_funds_only',true,
        'cash_backed',false,
        'withdrawals_disabled',true
      ),
      auth.uid(),'platform.test_funding','temporary-lpg-test-funding-source:NGN'
    ) returning id into v_source_wallet_id;
  end if;

  insert into public.wallet_test_funding_batches(
    label,currency_code,amount_per_wallet,target_wallet_count,total_amount,status,created_by,metadata
  ) values (
    btrim(target_label),'NGN',target_amount,v_wallet_count,v_total,'active',auth.uid(),
    jsonb_build_object('purpose','temporary LPG flow testing','cash_backed',false,'withdrawals_disabled',true)
  ) returning id into v_batch_id;

  v_entries := jsonb_build_array(jsonb_build_object(
    'wallet_id',v_source_wallet_id,'direction','debit','amount',v_total,
    'entry_type','adjustment',
    'metadata',jsonb_build_object('temporary_test_funding_batch_id',v_batch_id,'temporary_test_funding_action','credit_source')
  ));

  v_entries := v_entries || coalesce((
    select jsonb_agg(jsonb_build_object(
      'wallet_id',wallet.id,'direction','credit','amount',target_amount,
      'entry_type','adjustment',
      'metadata',jsonb_build_object(
        'temporary_test_funding_batch_id',v_batch_id,
        'temporary_test_funding',true,
        'cash_backed',false,
        'withdrawals_disabled',true
      )
    ) order by wallet.id)
    from public.wallet_accounts wallet
    where wallet.id=any(target_wallet_ids)
  ),'[]'::jsonb);

  v_transaction_id := public.post_financial_transaction(
    'adjustment','NGN','platform.test_funding','temporary_test_funding',v_batch_id,
    v_entries,'temporary-test-funding:'||v_batch_id::text,null,null,'{}'::jsonb,
    jsonb_build_object(
      'temporary_test_funding_action','credit',
      'temporary_test_funding_batch_id',v_batch_id,
      'cash_backed',false,
      'withdrawals_disabled',true
    )
  );

  update public.wallet_test_funding_batches
  set credit_transaction_id=v_transaction_id
  where id=v_batch_id;

  insert into public.wallet_test_funding_allocations(
    batch_id,wallet_id,credited_amount,remaining_amount
  )
  select v_batch_id,wallet.id,target_amount,target_amount
  from public.wallet_accounts wallet
  where wallet.id=any(target_wallet_ids);

  return jsonb_build_object(
    'batchId',v_batch_id,
    'label',btrim(target_label),
    'status','active',
    'currencyCode','NGN',
    'amountPerWallet',target_amount,
    'walletCount',v_wallet_count,
    'totalIssued',v_total,
    'cashBacked',false,
    'withdrawalsDisabled',true,
    'creditTransactionId',v_transaction_id
  );
end
$fund$;

create or replace function public.burn_temporary_lpg_test_batch(target_batch_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = public, pg_temp
as $burn$
declare
  v_batch public.wallet_test_funding_batches%rowtype;
  v_sink_wallet_id uuid;
  v_transaction_id uuid;
  v_burn_total numeric(28,8);
  v_entries jsonb;
begin
  if coalesce(auth.role(),'') <> 'service_role'
     and current_user not in ('postgres','supabase_admin') then
    raise exception using errcode='42501',message='Privileged service access is required to burn temporary test funds';
  end if;

  select * into v_batch
  from public.wallet_test_funding_batches
  where id=target_batch_id
  for update;

  if not found then
    raise exception using errcode='22023',message='Temporary test funding batch was not found';
  end if;
  if v_batch.status='burned' then
    return jsonb_build_object('batchId',target_batch_id,'status','burned','alreadyBurned',true,'amountBurned',0);
  end if;
  if v_batch.status<>'active' then
    raise exception using errcode='55000',message='Only an active temporary test funding batch can be burned';
  end if;

  perform allocation.batch_id
  from public.wallet_test_funding_allocations allocation
  where allocation.batch_id=target_batch_id
  order by allocation.wallet_id
  for update;

  select coalesce(sum(allocation.remaining_amount),0)
  into v_burn_total
  from public.wallet_test_funding_allocations allocation
  where allocation.batch_id=target_batch_id
    and allocation.remaining_amount>0;

  if v_burn_total>0 then
    select wallet.id into v_sink_wallet_id
    from public.wallet_accounts wallet
    where wallet.wallet_type='platform_campaign'
      and wallet.owner_entity_type='platform'
      and wallet.currency_code='NGN'
      and wallet.status='active'
      and wallet.metadata->>'wallet_purpose'='temporary_lpg_test_funding_burn_sink'
    order by wallet.created_at
    limit 1
    for update;

    if v_sink_wallet_id is null then
      insert into public.wallet_accounts(
        wallet_type,owner_entity_type,owner_entity_id,currency_code,status,metadata,
        created_by,source,idempotency_key
      ) values (
        'platform_campaign','platform',null,'NGN','active',
        jsonb_build_object(
          'wallet_purpose','temporary_lpg_test_funding_burn_sink',
          'temporary_test_funds_only',true,
          'cash_backed',false,
          'withdrawals_disabled',true
        ),
        auth.uid(),'platform.test_funding','temporary-lpg-test-funding-burn-sink:NGN'
      ) returning id into v_sink_wallet_id;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'wallet_id',allocation.wallet_id,
      'direction','debit',
      'amount',allocation.remaining_amount,
      'entry_type','adjustment',
      'metadata',jsonb_build_object(
        'temporary_test_funding_batch_id',target_batch_id,
        'temporary_test_funding_action','burn',
        'cash_backed',false
      )
    ) order by allocation.wallet_id),'[]'::jsonb)
    into v_entries
    from public.wallet_test_funding_allocations allocation
    where allocation.batch_id=target_batch_id
      and allocation.remaining_amount>0;

    v_entries := v_entries || jsonb_build_array(jsonb_build_object(
      'wallet_id',v_sink_wallet_id,'direction','credit','amount',v_burn_total,
      'entry_type','adjustment',
      'metadata',jsonb_build_object(
        'temporary_test_funding_batch_id',target_batch_id,
        'temporary_test_funding_action','burn_sink',
        'cash_backed',false,
        'withdrawals_disabled',true
      )
    ));

    v_transaction_id := public.post_financial_transaction(
      'adjustment','NGN','platform.test_funding','temporary_test_funding_burn',target_batch_id,
      v_entries,'temporary-test-burn:'||target_batch_id::text,null,null,'{}'::jsonb,
      jsonb_build_object(
        'temporary_test_funding_action','burn',
        'temporary_test_funding_batch_id',target_batch_id,
        'cash_backed',false,
        'withdrawals_disabled',true
      )
    );

    update public.wallet_test_funding_allocations
    set remaining_amount=0,updated_at=timezone('utc',now())
    where batch_id=target_batch_id;
  end if;

  update public.wallet_test_funding_batches
  set status='burned',burned_at=timezone('utc',now()),
      metadata=metadata || jsonb_build_object(
        'burned_amount',v_burn_total,
        'burn_transaction_id',v_transaction_id,
        'burned_at',timezone('utc',now())
      )
  where id=target_batch_id;

  return jsonb_build_object(
    'batchId',target_batch_id,
    'status','burned',
    'amountBurned',v_burn_total,
    'burnTransactionId',v_transaction_id
  );
end
$burn$;

revoke all on function public.fund_temporary_lpg_test_batch(text,uuid[],numeric) from public, anon, authenticated;
revoke all on function public.burn_temporary_lpg_test_batch(uuid) from public, anon, authenticated;
grant execute on function public.fund_temporary_lpg_test_batch(text,uuid[],numeric) to service_role;
grant execute on function public.burn_temporary_lpg_test_batch(uuid) to service_role;
