begin;

-- Rewards are currency-scoped so a fixed cashback value can never cross wallet currencies.
alter table public.utility_reward_policies
  add column if not exists currency_code text references public.currency_definitions(code);

update public.utility_reward_policies set currency_code='NGN' where currency_code is null;
alter table public.utility_reward_policies alter column currency_code set not null;
alter table public.utility_reward_policies alter column currency_code set default 'NGN';

create or replace function public.prepare_utility_reward_award()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
declare policy_record record; biller_record record; calculated_reward numeric;
begin
  select biller.* into biller_record from public.utility_products product join public.utility_billers biller on biller.id=product.biller_id where product.id=new.product_id;
  select policy.* into policy_record
  from public.utility_reward_policies policy
  where policy.status='active' and policy.currency_code=new.currency_code
    and (policy.starts_at is null or policy.starts_at<=now()) and (policy.ends_at is null or policy.ends_at>now())
    and (policy.minimum_spend is null or new.total_amount>=policy.minimum_spend)
    and (policy.category_id is null or policy.category_id=biller_record.category_id)
    and (policy.biller_id is null or policy.biller_id=biller_record.id)
    and (policy.product_id is null or policy.product_id=new.product_id)
  order by policy.created_at desc limit 1 for update of policy;
  if not found then return new; end if;
  -- Only earned/credited awards consume campaign limits. Failed provider attempts cannot exhaust a promotion.
  if policy_record.total_award_limit is not null and (select count(*) from public.utility_reward_awards award where award.reward_policy_id=policy_record.id and award.status in ('earned','credited'))>=policy_record.total_award_limit then return new; end if;
  if policy_record.per_customer_limit is not null and (select count(*) from public.utility_reward_awards award where award.reward_policy_id=policy_record.id and award.customer_user_id=new.customer_user_id and award.status in ('earned','credited'))>=policy_record.per_customer_limit then return new; end if;
  calculated_reward:=least(case when policy_record.calculation_kind='percentage' then new.total_amount*policy_record.reward_value/100 else policy_record.reward_value end,coalesce(policy_record.maximum_reward,new.total_amount));
  if calculated_reward>0 then insert into public.utility_reward_awards(payment_request_id,reward_policy_id,customer_user_id,wallet_id,currency_code,reward_amount) values(new.id,policy_record.id,new.customer_user_id,new.wallet_id,new.currency_code,calculated_reward) on conflict do nothing; end if;
  return new;
end;
$$;

-- A funded refill must leave the transaction with an eligible driver selected. If dispatch cannot
-- select one, the exception rolls back the wallet hold as well as the order state.
create or replace function public.reserve_and_dispatch_lpg_refill_order(
  target_lpg_order_id uuid,
  target_actor_user_id uuid,
  target_idempotency_key text,
  target_customer_wallet_id uuid default null,
  target_escrow_wallet_id uuid default null,
  target_source text default 'lpg.payment_api',
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  resolved_order_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role is required to reserve and dispatch an LPG order';
  end if;

  resolved_order_id := public.reserve_lpg_refill_order_payment(
    target_lpg_order_id,
    target_actor_user_id,
    target_idempotency_key,
    target_customer_wallet_id,
    target_escrow_wallet_id,
    target_source,
    target_metadata
  );

  perform public.dispatch_lpg_order(
    resolved_order_id,
    null,
    target_idempotency_key || ':automatic-dispatch',
    'skima.lpg.automatic_dispatch'
  );

  perform public.queue_lpg_order_status_notifications(
    resolved_order_id,
    target_idempotency_key || ':driver-selected-notifications',
    'skima.lpg.automatic_dispatch'
  );

  return resolved_order_id;
exception
  when others then
    if sqlerrm ilike '%no eligible LPG driver%' then
      raise exception using
        errcode='P0001',
        message='No nearby driver is available right now. Your wallet was not charged. Please try again shortly.';
    end if;
    raise;
end;
$$;

revoke all on function public.reserve_and_dispatch_lpg_refill_order(uuid,uuid,text,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_and_dispatch_lpg_refill_order(uuid,uuid,text,uuid,uuid,text,jsonb) to service_role;

-- Job lists and job details now use the same organization-scoped station permissions.
create or replace function public.can_access_lpg_order(target_lpg_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select
    auth.role()='service_role'
    or public.can_manage_lpg_operations()
    or exists (
      select 1 from public.lpg_refill_orders target_order
      where target_order.id=target_lpg_order_id and target_order.customer_user_id=auth.uid()
    )
    or exists (
      select 1 from public.lpg_refill_orders target_order
      join public.driver_profiles driver on driver.id=target_order.driver_profile_id
      where target_order.id=target_lpg_order_id and driver.user_id=auth.uid()
    )
    or exists (
      select 1 from public.lpg_refill_orders target_order
      join public.lpg_station_branches station on station.id=target_order.station_branch_id
      where target_order.id=target_lpg_order_id
        and (
          public.is_organization_member(station.organization_id)
          or public.has_permission('lpg.stations.scan',station.organization_id)
          or public.has_permission('lpg.stations.pump',station.organization_id)
          or public.has_permission('lpg.stations.operations',station.organization_id)
        )
    );
$$;

commit;
