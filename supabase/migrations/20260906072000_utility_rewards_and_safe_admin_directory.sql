begin;

create table if not exists public.utility_reward_policies (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.-]{2,120}$'),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 140),
  reward_kind text not null default 'cashback' check (reward_kind in ('cashback')),
  calculation_kind text not null check (calculation_kind in ('fixed','percentage')),
  reward_value numeric(28,8) not null check (reward_value > 0),
  maximum_reward numeric(28,8),
  minimum_spend numeric(28,8),
  category_id uuid references public.utility_service_categories(id) on delete cascade,
  biller_id uuid references public.utility_billers(id) on delete cascade,
  product_id uuid references public.utility_products(id) on delete cascade,
  starts_at timestamptz,
  ends_at timestamptz,
  total_award_limit integer,
  per_customer_limit integer,
  status text not null default 'draft' check (status in ('draft','active','inactive')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (calculation_kind <> 'percentage' or reward_value <= 100),
  check (maximum_reward is null or maximum_reward > 0),
  check (minimum_spend is null or minimum_spend >= 0),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.utility_reward_awards (
  id uuid primary key default gen_random_uuid(),
  payment_request_id uuid not null references public.utility_payment_requests(id) on delete restrict,
  reward_policy_id uuid not null references public.utility_reward_policies(id) on delete restrict,
  customer_user_id uuid not null references auth.users(id) on delete restrict,
  wallet_id uuid not null references public.wallet_accounts(id) on delete restrict,
  currency_code text not null references public.currency_definitions(code),
  reward_amount numeric(28,8) not null check (reward_amount > 0),
  status text not null default 'pending' check (status in ('pending','earned','credited','cancelled')),
  credit_transaction_id uuid references public.financial_transactions(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(payment_request_id, reward_policy_id)
);

alter table public.utility_reward_policies enable row level security;
alter table public.utility_reward_awards enable row level security;
create policy utility_reward_policies_active_read on public.utility_reward_policies for select using (status='active' or public.has_permission('platform.billing.read',null) or public.is_platform_super_admin());
create policy utility_reward_awards_owner_read on public.utility_reward_awards for select using (customer_user_id=auth.uid() or public.has_permission('platform.billing.read',null) or public.is_platform_super_admin());
grant select on public.utility_reward_awards to authenticated;

create or replace function public.prepare_utility_reward_award()
returns trigger language plpgsql security definer set search_path=public as $$
declare policy_record record; biller_record record; calculated_reward numeric;
begin
  select biller.* into biller_record from public.utility_products product join public.utility_billers biller on biller.id=product.biller_id where product.id=new.product_id;
  select policy.* into policy_record
  from public.utility_reward_policies policy
  where policy.status='active'
    and (policy.starts_at is null or policy.starts_at<=now())
    and (policy.ends_at is null or policy.ends_at>now())
    and (policy.minimum_spend is null or new.total_amount>=policy.minimum_spend)
    and (policy.category_id is null or policy.category_id=biller_record.category_id)
    and (policy.biller_id is null or policy.biller_id=biller_record.id)
    and (policy.product_id is null or policy.product_id=new.product_id)
  order by policy.created_at desc limit 1 for update of policy;
  if not found then return new; end if;
  if policy_record.total_award_limit is not null and (select count(*) from public.utility_reward_awards award where award.reward_policy_id=policy_record.id and award.status<>'cancelled')>=policy_record.total_award_limit then return new; end if;
  if policy_record.per_customer_limit is not null and (select count(*) from public.utility_reward_awards award where award.reward_policy_id=policy_record.id and award.customer_user_id=new.customer_user_id and award.status<>'cancelled')>=policy_record.per_customer_limit then return new; end if;
  calculated_reward:=least(case when policy_record.calculation_kind='percentage' then new.total_amount*policy_record.reward_value/100 else policy_record.reward_value end,coalesce(policy_record.maximum_reward,new.total_amount));
  if calculated_reward>0 then insert into public.utility_reward_awards(payment_request_id,reward_policy_id,customer_user_id,wallet_id,currency_code,reward_amount) values(new.id,policy_record.id,new.customer_user_id,new.wallet_id,new.currency_code,calculated_reward) on conflict do nothing; end if;
  return new;
end;
$$;
create trigger prepare_utility_reward_award after insert on public.utility_payment_requests for each row execute function public.prepare_utility_reward_award();

create or replace function public.sync_utility_reward_award_status()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.status='succeeded' and old.status is distinct from new.status then update public.utility_reward_awards set status='earned',updated_at=now() where payment_request_id=new.id and status='pending';
  elsif new.status in ('failed','reversed') and old.status is distinct from new.status then update public.utility_reward_awards set status='cancelled',updated_at=now() where payment_request_id=new.id and status in ('pending','earned'); end if;
  return new;
end;
$$;
create trigger sync_utility_reward_award_status after update of status on public.utility_payment_requests for each row execute function public.sync_utility_reward_award_status();

create or replace function public.configure_utility_cashback(target_key text,target_display_name text,target_calculation_kind text,target_reward_value numeric,target_maximum_reward numeric default null,target_minimum_spend numeric default null,target_total_award_limit integer default null,target_per_customer_limit integer default null,target_status text default 'draft')
returns uuid language plpgsql security definer set search_path=public as $$
declare configured_id uuid;
begin
 if not(public.has_permission('platform.billing.manage',null) or public.is_platform_super_admin()) then raise exception using errcode='42501',message='bill service management permission is required'; end if;
 insert into public.utility_reward_policies(key,display_name,calculation_kind,reward_value,maximum_reward,minimum_spend,total_award_limit,per_customer_limit,status)
 values(target_key,target_display_name,target_calculation_kind,target_reward_value,target_maximum_reward,target_minimum_spend,target_total_award_limit,target_per_customer_limit,target_status)
 on conflict(key) do update set display_name=excluded.display_name,calculation_kind=excluded.calculation_kind,reward_value=excluded.reward_value,maximum_reward=excluded.maximum_reward,minimum_spend=excluded.minimum_spend,total_award_limit=excluded.total_award_limit,per_customer_limit=excluded.per_customer_limit,status=excluded.status,updated_at=now()
 returning id into configured_id; return configured_id;
end;
$$;
grant execute on function public.configure_utility_cashback(text,text,text,numeric,numeric,numeric,integer,integer,text) to authenticated;

create or replace function public.read_active_utility_offers()
returns table(offer_key text,offer_name text,offer_type text,value_label text,minimum_spend numeric,ends_at timestamptz)
language sql stable security definer set search_path=public as $$
 select promotion.key,promotion.display_name,'discount'::text,
  case when promotion.discount_kind='percentage' then trim(to_char(promotion.discount_value,'FM999999990.##'))||'% off' else 'Save '||trim(to_char(promotion.discount_value,'FM999999990.##'))||' NGN' end,
  promotion.minimum_spend,promotion.ends_at
 from public.utility_promotions promotion where promotion.status='active' and (promotion.starts_at is null or promotion.starts_at<=now()) and (promotion.ends_at is null or promotion.ends_at>now())
 union all
 select reward.key,reward.display_name,'cashback'::text,
  case when reward.calculation_kind='percentage' then trim(to_char(reward.reward_value,'FM999999990.##'))||'% cashback' else trim(to_char(reward.reward_value,'FM999999990.##'))||' NGN cashback' end,
  reward.minimum_spend,reward.ends_at
 from public.utility_reward_policies reward where reward.status='active' and (reward.starts_at is null or reward.starts_at<=now()) and (reward.ends_at is null or reward.ends_at>now());
$$;
grant execute on function public.read_active_utility_offers() to authenticated;

create or replace function public.read_utility_admin_configuration()
returns jsonb language plpgsql stable security definer set search_path=public as $$
begin
 if not(public.has_permission('platform.billing.read',null) or public.is_platform_super_admin()) then raise exception using errcode='42501',message='bill service access is required'; end if;
 return jsonb_build_object(
  'categories',coalesce((select jsonb_agg(row_to_json(item) order by item.sort_order,item.display_name) from public.utility_service_categories item),'[]'::jsonb),
  'billers',coalesce((select jsonb_agg(row_to_json(item) order by item.display_name) from public.utility_billers item),'[]'::jsonb),
  'products',coalesce((select jsonb_agg(row_to_json(item) order by item.sort_order,item.display_name) from public.utility_products item),'[]'::jsonb),
  'routes',coalesce((select jsonb_agg(row_to_json(item) order by item.priority) from public.utility_provider_routes item),'[]'::jsonb),
  'providers',coalesce((select jsonb_agg(jsonb_build_object('id',item.id,'key',item.key,'display_name',item.display_name,'status',item.status,'website_url',item.config->>'websiteUrl','documentation_url',item.config->>'documentationUrl') order by item.display_name) from public.provider_adapters item where item.provider_kind='utility'),'[]'::jsonb),
  'promotions',coalesce((select jsonb_agg(row_to_json(item) order by item.created_at desc) from public.utility_promotions item),'[]'::jsonb),
  'cashbacks',coalesce((select jsonb_agg(row_to_json(item) order by item.created_at desc) from public.utility_reward_policies item),'[]'::jsonb),
  'payments',coalesce((select jsonb_agg(row_to_json(item) order by item.created_at desc) from(select * from public.utility_payment_requests order by created_at desc limit 200)item),'[]'::jsonb)
 );
end;
$$;

commit;
