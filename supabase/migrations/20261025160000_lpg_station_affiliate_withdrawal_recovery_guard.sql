begin;

-- A wallet with an unresolved commission clawback cannot start or approve a new
-- withdrawal until the reversal recovery is resolved. This prevents draining
-- an affiliate commission wallet while an already-triggered refund clawback is
-- waiting for the balance to recover.
create or replace function public.guard_lpg_station_affiliate_withdrawal_recovery()
returns trigger
language plpgsql
security definer
set search_path=public,pg_temp
as $$
begin
  if not exists (
    select 1
    from public.lpg_station_affiliates affiliate
    join public.lpg_station_affiliate_earnings earning
      on earning.affiliate_id=affiliate.id
      and earning.commission_wallet_id=new.wallet_id
    join public.lpg_station_affiliate_reversal_failures recovery
      on recovery.earning_id=earning.id
      and recovery.status='pending'
    where affiliate.commission_wallet_id=new.wallet_id
  ) then
    return new;
  end if;

  if tg_op='INSERT' then
    raise exception using errcode='55000',
      message='Affiliate withdrawals are temporarily held while a refund-related commission reversal is being recovered';
  end if;

  if tg_op='UPDATE' and new.status in ('approved','processing','succeeded')
    and old.status is distinct from new.status then
    raise exception using errcode='55000',
      message='Affiliate withdrawal approval is held until the pending commission reversal is resolved';
  end if;

  return new;
end
$$;

drop trigger if exists trg_guard_lpg_station_affiliate_withdrawal_recovery on public.withdrawal_requests;
create trigger trg_guard_lpg_station_affiliate_withdrawal_recovery
before insert or update of status on public.withdrawal_requests
for each row execute function public.guard_lpg_station_affiliate_withdrawal_recovery();

revoke all on function public.guard_lpg_station_affiliate_withdrawal_recovery() from public,anon,authenticated;

comment on function public.guard_lpg_station_affiliate_withdrawal_recovery() is
  'Temporarily prevents new/approved affiliate commission-wallet withdrawals while a refund-related commission reversal recovery is pending. It does not cancel an already approved transfer.';

notify pgrst,'reload schema';
commit;
