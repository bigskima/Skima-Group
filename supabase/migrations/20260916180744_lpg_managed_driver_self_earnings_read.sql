begin;

create or replace function public.read_my_lpg_managed_driver_earnings()
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  driver_record public.driver_profiles%rowtype;
  managed_key text;
  is_managed boolean:=false;
  wallet_id uuid;
  wallet_balance numeric(28,8):=0;
  pending_earnings numeric(28,8):=0;
  available_for_payout numeric(28,8):=0;
  paid_to_wallet numeric(28,8):=0;
  lifetime_earnings numeric(28,8):=0;
  last_paid_at timestamptz;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='sign in is required';
  end if;

  select * into driver_record
  from public.driver_profiles
  where user_id=auth.uid()
  order by approved_at desc nulls last,created_at desc
  limit 1;

  if not found then
    return jsonb_build_object(
      'isManaged',false,'driverProfileId',null,'currencyCode','NGN',
      'pendingEarnings',0,'availableForPayout',0,'paidToWallet',0,'lifetimeEarnings',0,
      'driverWalletId',null,'driverWalletBalance',0,'lastPaidAt',null
    );
  end if;

  managed_key:=coalesce(public.lpg_policy_config('lpg.fulfillment.launch_assurance')->>'internal_driver_program_key','driver.skima_special');
  select exists(
    select 1 from public.driver_program_memberships m
    where m.driver_profile_id=driver_record.id and m.program_key=managed_key and m.status='active'
      and m.starts_at<=timezone('utc',now()) and (m.ends_at is null or m.ends_at>timezone('utc',now()))
  ) into is_managed;

  select
    coalesce(sum(case when e.status='accrued' then greatest(e.earning_amount-e.paid_amount,0) else 0 end),0),
    coalesce(sum(case when e.status='approved' then greatest(e.earning_amount-e.paid_amount,0) else 0 end),0),
    coalesce(sum(e.paid_amount),0),
    coalesce(sum(e.earning_amount),0)
  into pending_earnings,available_for_payout,paid_to_wallet,lifetime_earnings
  from public.lpg_internal_driver_earnings e
  where e.driver_profile_id=driver_record.id and e.currency_code='NGN' and e.status<>'void';

  select w.id into wallet_id
  from public.wallet_accounts w
  where w.wallet_type='driver' and w.owner_entity_type='driver' and w.owner_entity_id=driver_record.id
    and w.currency_code='NGN' and w.status='active'
  order by w.created_at asc limit 1;

  if wallet_id is not null then
    select coalesce(balance,0) into wallet_balance from public.wallet_balances where wallet_id=wallet_id;
  end if;

  select max(p.paid_at) into last_paid_at
  from public.lpg_internal_driver_payouts p
  where p.driver_profile_id=driver_record.id and p.currency_code='NGN' and p.status='posted';

  return jsonb_build_object(
    'isManaged',is_managed,
    'driverProfileId',driver_record.id,
    'currencyCode','NGN',
    'pendingEarnings',pending_earnings,
    'availableForPayout',available_for_payout,
    'paidToWallet',paid_to_wallet,
    'lifetimeEarnings',lifetime_earnings,
    'driverWalletId',wallet_id,
    'driverWalletBalance',wallet_balance,
    'lastPaidAt',last_paid_at
  );
end
$$;

revoke all on function public.read_my_lpg_managed_driver_earnings() from public,anon;
grant execute on function public.read_my_lpg_managed_driver_earnings() to authenticated,service_role;

commit;
