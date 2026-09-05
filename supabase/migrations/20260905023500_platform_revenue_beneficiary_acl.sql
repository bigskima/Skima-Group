begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

create or replace function public.guard_platform_revenue_beneficiary_write()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_wallet_type text;
  target_owner_type text;
begin
  select wallet.wallet_type, wallet.owner_entity_type
  into target_wallet_type, target_owner_type
  from public.wallet_accounts wallet
  where wallet.id = new.wallet_id;

  if target_wallet_type = 'platform_revenue'
     and target_owner_type = 'platform'
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_super_admin() then
    raise exception using errcode = '42501',
      message = 'Only the active Super Admin can configure the SKIMA revenue payout account';
  end if;

  return new;
end;
$$;

drop trigger if exists guard_platform_revenue_beneficiary_write
on public.withdrawal_beneficiaries;

create trigger guard_platform_revenue_beneficiary_write
before insert or update on public.withdrawal_beneficiaries
for each row
execute function public.guard_platform_revenue_beneficiary_write();

comment on function public.guard_platform_revenue_beneficiary_write() is
  'Prevents non-Super-Admin authenticated actors from creating or changing payout beneficiaries attached to the protected SKIMA platform_revenue wallet. Service-role provider reconciliation remains allowed.';

commit;
