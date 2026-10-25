begin;

-- Keep the original commission transaction immutable for audit and store any
-- clawback as a separate double-entry transaction.
alter table public.lpg_station_affiliate_earnings
  add column if not exists reversal_transaction_id uuid references public.financial_transactions(id) on delete set null;
alter table public.lpg_station_affiliate_earnings
  add column if not exists reversed_at timestamptz;
alter table public.lpg_station_affiliate_earnings
  add column if not exists reversal_reason text;

create table if not exists public.lpg_station_affiliate_reversal_failures (
  id uuid primary key default gen_random_uuid(),
  earning_id uuid not null unique references public.lpg_station_affiliate_earnings(id) on delete restrict,
  lpg_order_id uuid not null references public.lpg_refill_orders(id) on delete restrict,
  required_amount numeric(28,8) not null check (required_amount>0),
  available_amount numeric(28,8) not null default 0 check (available_amount>=0),
  last_error text not null,
  attempt_count integer not null default 1 check (attempt_count>0),
  status text not null default 'pending' check (status in ('pending','resolved','dismissed')),
  first_attempt_at timestamptz not null default timezone('utc',now()),
  last_attempt_at timestamptz not null default timezone('utc',now()),
  resolved_at timestamptz,
  resolved_by uuid references public.profiles(id) on delete set null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object')
);
create index if not exists lpg_station_affiliate_reversal_failures_status_idx
  on public.lpg_station_affiliate_reversal_failures(status,last_attempt_at desc);

alter table public.lpg_station_affiliate_reversal_failures enable row level security;
revoke all on public.lpg_station_affiliate_reversal_failures from public,anon,authenticated;
grant select,insert,update,delete on public.lpg_station_affiliate_reversal_failures to service_role;

create or replace function public.apply_lpg_station_affiliate_reversal(
  target_earning_id uuid,
  target_reason text,
  target_origin text default 'admin'
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  earning public.lpg_station_affiliate_earnings%rowtype;
  order_record public.lpg_refill_orders%rowtype;
  commission_wallet public.wallet_accounts%rowtype;
  revenue_wallet public.wallet_accounts%rowtype;
  available_balance numeric(28,8):=0;
  posting_id uuid;
  failure_message text;
begin
  if target_earning_id is null
    or char_length(btrim(coalesce(target_reason,'')))<5
    or char_length(btrim(coalesce(target_reason,'')))>500
    or target_origin not in ('admin','order_refund','admin_retry') then
    raise exception using errcode='22023',message='earning, a 5-500 character reason, and a supported reversal origin are required';
  end if;

  select * into earning from public.lpg_station_affiliate_earnings
  where id=target_earning_id for update;
  if not found then
    return jsonb_build_object('status','not_found','earningId',target_earning_id);
  end if;
  if earning.status='reversed' and earning.reversal_transaction_id is not null then
    return jsonb_build_object('status','reversed','earningId',earning.id,'transactionId',earning.reversal_transaction_id);
  end if;
  if earning.status<>'posted' or earning.financial_transaction_id is null then
    return jsonb_build_object('status','not_eligible','earningId',earning.id,'earningStatus',earning.status);
  end if;

  select * into order_record from public.lpg_refill_orders where id=earning.lpg_order_id;
  if not found then
    return jsonb_build_object('status','order_not_found','earningId',earning.id);
  end if;
  if target_origin='order_refund' and order_record.status<>'refunded' then
    return jsonb_build_object('status','not_refunded','earningId',earning.id);
  end if;

  select * into commission_wallet from public.wallet_accounts
  where id=earning.commission_wallet_id and wallet_type='commission'
    and owner_entity_type='user' and owner_entity_id=(select affiliate.affiliate_user_id
      from public.lpg_station_affiliates affiliate where affiliate.id=earning.affiliate_id)
    and currency_code=earning.currency_code and status='active';
  select wallet.* into revenue_wallet
  from public.wallet_ledger_entries ledger
  join public.wallet_accounts wallet on wallet.id=ledger.wallet_id
  where ledger.transaction_id=earning.classification_transaction_id
    and wallet.wallet_type='platform_revenue'
    and wallet.owner_entity_type='platform'
    and wallet.currency_code=earning.currency_code
    and ledger.direction='credit'
    and ledger.metadata->>'lpg_order_id'=earning.lpg_order_id::text
  order by ledger.created_at
  limit 1;

  if commission_wallet.id is null or revenue_wallet.id is null then
    failure_message:='The affiliate commission or originating platform revenue wallet is unavailable.';
    insert into public.lpg_station_affiliate_reversal_failures(
      earning_id,lpg_order_id,required_amount,available_amount,last_error,status,metadata
    ) values (
      earning.id,earning.lpg_order_id,earning.amount,0,failure_message,'pending',
      jsonb_build_object('origin',target_origin,'reason',btrim(target_reason))
    ) on conflict(earning_id) do update set
      required_amount=excluded.required_amount,available_amount=0,last_error=excluded.last_error,
      attempt_count=public.lpg_station_affiliate_reversal_failures.attempt_count+1,
      status='pending',last_attempt_at=timezone('utc',now()),
      metadata=public.lpg_station_affiliate_reversal_failures.metadata||excluded.metadata;
    return jsonb_build_object('status','pending_recovery','earningId',earning.id,'requiredAmount',earning.amount,'availableAmount',0);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(commission_wallet.id::text,0));
  select coalesce(balance.balance,0)::numeric(28,8) into available_balance
  from public.wallet_balances balance
  where balance.wallet_id=commission_wallet.id and balance.currency_code=earning.currency_code;
  available_balance:=coalesce(available_balance,0);

  if available_balance<earning.amount then
    failure_message:='Affiliate wallet balance is below the commission reversal amount; manual recovery or a later retry is required.';
    insert into public.lpg_station_affiliate_reversal_failures(
      earning_id,lpg_order_id,required_amount,available_amount,last_error,status,metadata
    ) values (
      earning.id,earning.lpg_order_id,earning.amount,available_balance,failure_message,'pending',
      jsonb_build_object('origin',target_origin,'reason',btrim(target_reason),'commissionWalletId',commission_wallet.id,'revenueWalletId',revenue_wallet.id)
    ) on conflict(earning_id) do update set
      required_amount=excluded.required_amount,available_amount=excluded.available_amount,last_error=excluded.last_error,
      attempt_count=public.lpg_station_affiliate_reversal_failures.attempt_count+1,
      status='pending',last_attempt_at=timezone('utc',now()),
      metadata=public.lpg_station_affiliate_reversal_failures.metadata||excluded.metadata;
    return jsonb_build_object('status','pending_recovery','earningId',earning.id,'requiredAmount',earning.amount,'availableAmount',available_balance);
  end if;

  begin
    posting_id:=public.post_financial_transaction(
      'refund',earning.currency_code,'lpg.station_affiliate.reversal','lpg_station_affiliate_earning',earning.id,
      jsonb_build_array(
        jsonb_build_object(
          'wallet_id',commission_wallet.id,'direction','debit','amount',earning.amount,'entry_type','commission',
          'metadata',jsonb_build_object('role','affiliate_commission_reversal','affiliate_id',earning.affiliate_id,'referral_id',earning.referral_id,'lpg_order_id',earning.lpg_order_id)
        ),
        jsonb_build_object(
          'wallet_id',revenue_wallet.id,'direction','credit','amount',earning.amount,'entry_type','commission',
          'metadata',jsonb_build_object('role','skima_revenue_recovery','affiliate_id',earning.affiliate_id,'referral_id',earning.referral_id,'lpg_order_id',earning.lpg_order_id)
        )
      ),
      'lpg-station-affiliate-reversal:'||earning.id::text,
      null,order_record.public_reference,
      jsonb_build_object('policyKey','commission.lpg.station_affiliate','policyVersionId',earning.policy_version_id,'reversal',true),
      jsonb_build_object(
        'earningId',earning.id,'originalCommissionTransactionId',earning.financial_transaction_id,
        'classificationTransactionId',earning.classification_transaction_id,'orderId',earning.lpg_order_id,
        'origin',target_origin,'reason',btrim(target_reason),'amount',earning.amount
      )
    );
  exception when others then
    failure_message:=left(sqlerrm,2000);
    insert into public.lpg_station_affiliate_reversal_failures(
      earning_id,lpg_order_id,required_amount,available_amount,last_error,status,metadata
    ) values (
      earning.id,earning.lpg_order_id,earning.amount,available_balance,failure_message,'pending',
      jsonb_build_object('origin',target_origin,'reason',btrim(target_reason),'commissionWalletId',commission_wallet.id,'revenueWalletId',revenue_wallet.id)
    ) on conflict(earning_id) do update set
      required_amount=excluded.required_amount,available_amount=excluded.available_amount,last_error=excluded.last_error,
      attempt_count=public.lpg_station_affiliate_reversal_failures.attempt_count+1,
      status='pending',last_attempt_at=timezone('utc',now()),
      metadata=public.lpg_station_affiliate_reversal_failures.metadata||excluded.metadata;
    return jsonb_build_object('status','pending_recovery','earningId',earning.id,'requiredAmount',earning.amount,'availableAmount',available_balance,'error',failure_message);
  end;

  update public.lpg_station_affiliate_earnings
  set status='reversed',reversal_transaction_id=posting_id,reversed_at=timezone('utc',now()),
      reversal_reason=btrim(target_reason),updated_at=timezone('utc',now()),
      metadata=metadata||jsonb_build_object('reversalOrigin',target_origin,'reversalReason',btrim(target_reason))
  where id=earning.id;
  update public.lpg_station_affiliate_reversal_failures
  set status='resolved',resolved_at=timezone('utc',now()),resolved_by=auth.uid(),
      available_amount=earning.amount,last_error='Reversal posted successfully.',last_attempt_at=timezone('utc',now())
  where earning_id=earning.id and status='pending';

  return jsonb_build_object('status','reversed','earningId',earning.id,'transactionId',posting_id,'amount',earning.amount);
end
$$;

create or replace function public.reverse_lpg_station_affiliate_commission(
  target_earning_id uuid,
  target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if auth.role()<>'service_role' and not public.is_platform_super_admin()
    and not (public.has_permission('platform.financial.manage',null) and public.has_permission('platform.wallets.manage',null)) then
    raise exception using errcode='42501',message='financial and wallet management permissions are required to reverse affiliate commission';
  end if;
  return public.apply_lpg_station_affiliate_reversal(target_earning_id,target_reason,'admin');
end
$$;

create or replace function public.retry_lpg_station_affiliate_reversal(
  target_earning_id uuid,
  target_reason text
)
returns jsonb
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare existing_failure public.lpg_station_affiliate_reversal_failures%rowtype;
begin
  if auth.role()<>'service_role' and not public.is_platform_super_admin()
    and not (public.has_permission('platform.financial.manage',null) and public.has_permission('platform.wallets.manage',null)) then
    raise exception using errcode='42501',message='financial and wallet management permissions are required to retry affiliate reversal';
  end if;
  if char_length(btrim(coalesce(target_reason,'')))<5 or char_length(btrim(coalesce(target_reason,'')))>500 then
    raise exception using errcode='22023',message='a reason of 5-500 characters is required';
  end if;
  select * into existing_failure from public.lpg_station_affiliate_reversal_failures
  where earning_id=target_earning_id and status='pending' for update;
  if not found then
    if exists(select 1 from public.lpg_station_affiliate_earnings where id=target_earning_id and status='reversed') then
      return jsonb_build_object('status','reversed','earningId',target_earning_id);
    end if;
    raise exception using errcode='P0002',message='pending affiliate reversal was not found';
  end if;
  return public.apply_lpg_station_affiliate_reversal(target_earning_id,target_reason,'admin_retry');
end
$$;

create or replace function public.reverse_lpg_station_affiliate_commission_on_order_refund()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare earning_record record;
begin
  if new.status='refunded' and old.status is distinct from new.status then
    for earning_record in
      select id from public.lpg_station_affiliate_earnings
      where lpg_order_id=new.id and status='posted'
      order by created_at
    loop
      begin
        perform public.apply_lpg_station_affiliate_reversal(
          earning_record.id,'Automatic reversal following full LPG order refund','order_refund'
        );
      exception when others then
        insert into public.lpg_station_affiliate_reversal_failures(
          earning_id,lpg_order_id,required_amount,available_amount,last_error,status,metadata
        )
        select earning.id,earning.lpg_order_id,earning.amount,0,left(sqlerrm,2000),'pending',
          jsonb_build_object('origin','order_refund','reason','Automatic reversal following full LPG order refund')
        from public.lpg_station_affiliate_earnings earning
        where earning.id=earning_record.id
        on conflict(earning_id) do update set
          last_error=excluded.last_error,
          attempt_count=public.lpg_station_affiliate_reversal_failures.attempt_count+1,
          status='pending',last_attempt_at=timezone('utc',now()),
          metadata=public.lpg_station_affiliate_reversal_failures.metadata||excluded.metadata;
      end;
    end loop;
  end if;
  return new;
end
$$;

drop trigger if exists trg_reverse_lpg_station_affiliate_commission_on_order_refund on public.lpg_refill_orders;
create trigger trg_reverse_lpg_station_affiliate_commission_on_order_refund
after update of status on public.lpg_refill_orders
for each row
when (new.status='refunded' and old.status is distinct from new.status)
execute function public.reverse_lpg_station_affiliate_commission_on_order_refund();

-- Preserve the already-implemented affiliate/earnings workspace and extend its
-- result with recovery exceptions without recursively calling the replacement.
alter function public.read_lpg_station_affiliate_admin_workspace()
  rename to read_lpg_station_affiliate_admin_workspace_base;

-- The admin workspace exposes unresolved reversal recoveries alongside posting failures.
create or replace function public.read_lpg_station_affiliate_admin_workspace()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare workspace_result jsonb; reversal_result jsonb;
begin
  workspace_result:=public.read_lpg_station_affiliate_admin_workspace_base();
  select jsonb_set(
    workspace_result,
    '{earnings}',
    coalesce((
      select jsonb_agg(item.value||jsonb_build_object(
        'reversalTransactionId',earning.reversal_transaction_id,
        'reversedAt',earning.reversed_at,
        'reversalReason',earning.reversal_reason
      ) order by earning.created_at desc)
      from jsonb_array_elements(coalesce(workspace_result->'earnings','[]'::jsonb)) as item(value)
      left join public.lpg_station_affiliate_earnings earning on earning.id=(item.value->>'id')::uuid
    ),'[]'::jsonb)
  ) into workspace_result;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',failure.id,'earningId',failure.earning_id,'orderId',failure.lpg_order_id,
    'publicReference',order_record.public_reference,'affiliateId',earning.affiliate_id,
    'affiliateName',profile.display_name,'stationName',station.display_name,
    'requiredAmount',failure.required_amount,'availableAmount',failure.available_amount,
    'lastError',failure.last_error,'attemptCount',failure.attempt_count,
    'status',failure.status,'lastAttemptAt',failure.last_attempt_at
  ) order by failure.last_attempt_at desc),'[]'::jsonb)
  into reversal_result
  from (
    select * from public.lpg_station_affiliate_reversal_failures
    where status='pending'
    order by last_attempt_at desc
    limit 100
  ) failure
  join public.lpg_station_affiliate_earnings earning on earning.id=failure.earning_id
  join public.lpg_station_affiliates affiliate on affiliate.id=earning.affiliate_id
  join public.profiles profile on profile.id=affiliate.affiliate_user_id
  join public.lpg_station_branches station on station.id=earning.station_branch_id
  join public.lpg_refill_orders order_record on order_record.id=earning.lpg_order_id;
  return coalesce(workspace_result,'{}'::jsonb)||jsonb_build_object('reversalFailures',reversal_result);
end
$$;

revoke all on function public.apply_lpg_station_affiliate_reversal(uuid,text,text) from public,anon,authenticated;
revoke all on function public.reverse_lpg_station_affiliate_commission(uuid,text) from public,anon;
revoke all on function public.retry_lpg_station_affiliate_reversal(uuid,text) from public,anon;
revoke all on function public.reverse_lpg_station_affiliate_commission_on_order_refund() from public,anon,authenticated;
revoke all on function public.read_lpg_station_affiliate_admin_workspace_base() from public,anon,authenticated;
revoke all on function public.read_lpg_station_affiliate_admin_workspace() from public,anon;
grant execute on function public.apply_lpg_station_affiliate_reversal(uuid,text,text) to service_role;
grant execute on function public.reverse_lpg_station_affiliate_commission(uuid,text) to authenticated,service_role;
grant execute on function public.retry_lpg_station_affiliate_reversal(uuid,text) to authenticated,service_role;
grant execute on function public.read_lpg_station_affiliate_admin_workspace() to authenticated,service_role;

comment on function public.apply_lpg_station_affiliate_reversal(uuid,text,text) is
  'Uses a separate double-entry transaction to reverse a posted affiliate commission; if the affiliate wallet cannot fund the reversal, the earning remains posted and a recoverable exception is queued.';
comment on function public.reverse_lpg_station_affiliate_commission_on_order_refund() is
  'Automatically requests reversal of posted station affiliate commission after a full LPG order refund without blocking the customer refund if recovery fails.';

drop policy if exists lpg_station_affiliate_reversal_failures_service_role_only on public.lpg_station_affiliate_reversal_failures;
create policy lpg_station_affiliate_reversal_failures_service_role_only
on public.lpg_station_affiliate_reversal_failures
for all
to service_role
using (true)
with check (true);

notify pgrst,'reload schema';
commit;
