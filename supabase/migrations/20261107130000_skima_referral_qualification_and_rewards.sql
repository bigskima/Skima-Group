begin;

alter table public.referral_campaigns
  add column if not exists qualification_rules jsonb not null
    default '{"event":"first_payment_or_delivery","minimum_amount":0}'::jsonb
    check (jsonb_typeof(qualification_rules) = 'object');

alter table public.user_referrals
  add column if not exists qualified_transaction_id uuid references public.financial_transactions(id),
  add column if not exists qualifying_app_key text;

create unique index if not exists user_referrals_qualified_transaction_unique
  on public.user_referrals (qualified_transaction_id)
  where qualified_transaction_id is not null;

create or replace function public.qualify_skima_referral_for_transaction()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid;
  app_value text;
  candidate public.user_referrals%rowtype;
  campaign public.referral_campaigns%rowtype;
  minimum_amount numeric := 0;
  event_rule text;
  reward jsonb;
begin
  if new.status <> 'posted' or new.transaction_type in ('hold','transfer','refund','reversal','withdrawal') then
    return new;
  end if;
  if new.subject_type ilike '%wallet%deposit%' or new.subject_type ilike '%wallet%top%up%' then
    return new;
  end if;

  actor := new.actor_user_id;
  if actor is null and new.subject_id is not null then
    if new.subject_type ilike '%order%' then
      select requester_user_id into actor
      from public.order_records where id = new.subject_id;
    elsif new.subject_type ilike '%service_request%' then
      select requester_user_id into actor
      from public.service_requests where id = new.subject_id;
    end if;
  end if;
  if actor is null then return new; end if;

  app_value := case
    when new.source ilike 'skima.store.%'
      or new.metadata->>'storefront_module'='store'
      or new.metadata->>'module_key'='store' then 'store'
    when new.source ilike '%logistics%'
      or new.metadata->>'module_key'='logistics_network' then 'logistics'
    when new.source ilike '%utility%' or new.source ilike '%bills%'
      or new.subject_type ilike '%utility%' or new.subject_type ilike '%bill%'
      or new.metadata->>'bounded_context' in ('utility_billing','bills')
      or new.metadata->>'module_key' in ('bills','utility_billing') then 'bills'
    when new.source ilike 'skima.lpg.%' or new.source ilike 'lpg.%'
      or new.source ilike 'platform.fuel.%'
      or new.metadata->>'bounded_context'='lpg'
      or new.metadata->>'module_key' in ('lpg','fuel') then 'refill'
    else null
  end;
  if app_value is null then return new; end if;

  for candidate in
    select referral.*
    from public.user_referrals referral
    where referral.referred_user_id = actor
      and referral.status = 'attributed'
      and referral.qualified_transaction_id is null
    order by referral.created_at
    for update
  loop
    if candidate.campaign_id is null then
      event_rule := 'first_payment_or_delivery';
      minimum_amount := 0;
    else
      select * into campaign
      from public.referral_campaigns
      where id = candidate.campaign_id;
      if not found or not (app_value = any(campaign.target_app_keys)) then
        continue;
      end if;
      event_rule := coalesce(campaign.qualification_rules->>'event','first_payment_or_delivery');
      begin
        minimum_amount := greatest(0, coalesce((campaign.qualification_rules->>'minimum_amount')::numeric,0));
      exception when others then
        minimum_amount := 0;
      end;
    end if;

    if new.total_amount < minimum_amount then continue; end if;
    if event_rule = 'first_payment' and new.transaction_type <> 'payment' then continue; end if;
    if event_rule = 'first_payment_or_delivery'
      and new.transaction_type not in ('payment','release','commission','adjustment') then continue; end if;
    if event_rule not in ('first_payment','first_payment_or_delivery') then continue; end if;

    update public.user_referrals
    set status = 'qualified',
        qualified_at = timezone('utc', now()),
        qualified_transaction_id = new.id,
        qualifying_app_key = app_value,
        updated_at = timezone('utc', now())
    where id = candidate.id
      and status = 'attributed';

    if not found then continue; end if;

    if candidate.campaign_id is not null then
      if campaign.referrer_reward <> '{}'::jsonb then
        insert into public.referral_reward_entries (
          referral_id, beneficiary_user_id, reward_side, reward_definition,
          status, idempotency_key, metadata
        ) values (
          candidate.id, candidate.referrer_user_id, 'referrer',
          campaign.referrer_reward, 'pending',
          'referral:' || candidate.id::text || ':referrer',
          jsonb_build_object('qualifying_transaction_id',new.id,'qualifying_app_key',app_value)
        ) on conflict (idempotency_key) do nothing;
      end if;
      if campaign.referred_reward <> '{}'::jsonb then
        insert into public.referral_reward_entries (
          referral_id, beneficiary_user_id, reward_side, reward_definition,
          status, idempotency_key, metadata
        ) values (
          candidate.id, candidate.referred_user_id, 'referred',
          campaign.referred_reward, 'pending',
          'referral:' || candidate.id::text || ':referred',
          jsonb_build_object('qualifying_transaction_id',new.id,'qualifying_app_key',app_value)
        ) on conflict (idempotency_key) do nothing;
      end if;
    end if;
    exit;
  end loop;

  return new;
end;
$$;

drop trigger if exists qualify_skima_referral_for_transaction on public.financial_transactions;
create trigger qualify_skima_referral_for_transaction
after insert or update of status on public.financial_transactions
for each row
when (new.status = 'posted')
execute function public.qualify_skima_referral_for_transaction();

drop policy if exists referral_reward_entries_admin_read on public.referral_reward_entries;
create policy referral_reward_entries_admin_read on public.referral_reward_entries
for select to authenticated using (
  public.is_platform_super_admin()
  or public.has_permission('platform.content.manage', null)
);

drop policy if exists referral_reward_entries_admin_update on public.referral_reward_entries;
create policy referral_reward_entries_admin_update on public.referral_reward_entries
for update to authenticated using (
  public.is_platform_super_admin()
  or public.has_permission('platform.content.manage', null)
) with check (
  public.is_platform_super_admin()
  or public.has_permission('platform.content.manage', null)
);
grant select, update on public.referral_reward_entries to authenticated;

create or replace function public.review_skima_referral_reward(
  target_reward_entry_id uuid,
  target_decision text,
  target_reason text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  reward public.referral_reward_entries%rowtype;
begin
  if auth.uid() is null or not (
    public.is_platform_super_admin()
    or public.has_permission('platform.content.manage', null)
  ) then
    raise exception 'referral reward review permission is required';
  end if;
  if target_decision not in ('approved','rejected','cancelled') then
    raise exception 'unsupported reward review decision';
  end if;
  if target_reason is null or char_length(btrim(target_reason)) < 3 then
    raise exception 'a reward review reason is required';
  end if;

  select * into reward from public.referral_reward_entries
  where id = target_reward_entry_id for update;
  if not found or reward.status <> 'pending' then
    raise exception 'only a pending referral reward can be reviewed';
  end if;

  update public.referral_reward_entries
  set status = target_decision,
      approved_by = case when target_decision = 'approved' then auth.uid() else null end,
      approved_at = case when target_decision = 'approved' then timezone('utc',now()) else null end,
      updated_at = timezone('utc',now()),
      metadata = metadata || jsonb_build_object('review_reason',btrim(target_reason))
  where id = target_reward_entry_id;

  return target_reward_entry_id;
end;
$$;

revoke all on function public.qualify_skima_referral_for_transaction() from public, anon, authenticated;
revoke all on function public.review_skima_referral_reward(uuid,text,text) from public, anon;
grant execute on function public.review_skima_referral_reward(uuid,text,text) to authenticated;

create or replace function public.read_my_referral_dashboard(target_campaign_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  code_value text;
  campaigns_value jsonb;
  referrals_value jsonb;
  leaderboard_value jsonb;
  rewards_value jsonb;
begin
  if actor is null then raise exception 'authentication is required'; end if;

  select referral_code into code_value
  from public.user_referral_codes
  where user_id = actor and is_enabled = true;

  if code_value is null then
    insert into public.user_referral_codes (user_id, referral_code)
    values (actor, 'SK' || upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10)))
    on conflict (user_id) do update set is_enabled = true
    returning referral_code into code_value;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', campaign.id,
    'campaignKey', campaign.campaign_key,
    'displayName', campaign.display_name,
    'description', campaign.description,
    'targetAppKeys', campaign.target_app_keys,
    'startsAt', campaign.starts_at,
    'endsAt', campaign.ends_at,
    'terms', campaign.terms,
    'referrerReward', campaign.referrer_reward,
    'referredReward', campaign.referred_reward,
    'qualificationRules', campaign.qualification_rules,
    'myReferralCount', (select count(*) from public.user_referrals referral
      where referral.campaign_id = campaign.id
        and referral.referrer_user_id = actor
        and referral.status in ('attributed','qualified'))
  ) order by campaign.priority, campaign.starts_at nulls last), '[]'::jsonb)
  into campaigns_value
  from public.referral_campaigns campaign
  where campaign.status = 'active'
    and (campaign.starts_at is null or campaign.starts_at <= timezone('utc', now()))
    and (campaign.ends_at is null or campaign.ends_at > timezone('utc', now()))
    and (target_campaign_id is null or campaign.id = target_campaign_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', referral.id,
    'appKey', referral.app_key,
    'qualifyingAppKey', referral.qualifying_app_key,
    'status', referral.status,
    'createdAt', referral.created_at,
    'qualifiedAt', referral.qualified_at,
    'campaignName', campaign.display_name,
    'displayName', coalesce(profile.display_name, 'SKIMA member')
  ) order by referral.created_at desc), '[]'::jsonb)
  into referrals_value
  from public.user_referrals referral
  left join public.referral_campaigns campaign on campaign.id = referral.campaign_id
  left join public.profiles profile on profile.id = referral.referred_user_id
  where referral.referrer_user_id = actor;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', reward.id,
    'referralId', reward.referral_id,
    'rewardSide', reward.reward_side,
    'rewardDefinition', reward.reward_definition,
    'status', reward.status,
    'approvedAt', reward.approved_at,
    'postedAt', reward.posted_at,
    'createdAt', reward.created_at
  ) order by reward.created_at desc), '[]'::jsonb)
  into rewards_value
  from public.referral_reward_entries reward
  where reward.beneficiary_user_id = actor;

  select coalesce(jsonb_agg(jsonb_build_object(
    'rank', ranked.rank,
    'displayName', ranked.display_name,
    'referralCount', ranked.referral_count,
    'isMe', ranked.user_id = actor
  ) order by ranked.rank), '[]'::jsonb)
  into leaderboard_value
  from (
    select row_number() over(order by count(referral.id) desc, min(referral.created_at) asc) as rank,
      code.user_id, profile.display_name, count(referral.id)::integer as referral_count
    from public.user_referral_codes code
    join public.profiles profile on profile.id = code.user_id
    join public.user_referrals referral on referral.referrer_user_id = code.user_id
    where profile.referral_leaderboard_opt_in = true
      and referral.status in ('attributed','qualified')
      and (target_campaign_id is null or referral.campaign_id = target_campaign_id)
    group by code.user_id, profile.display_name
    order by count(referral.id) desc
    limit 50
  ) ranked;

  return jsonb_build_object(
    'referralCode', code_value,
    'referralUrl', null,
    'activeCampaigns', campaigns_value,
    'referrals', referrals_value,
    'rewards', rewards_value,
    'leaderboard', leaderboard_value,
    'leaderboardOptIn', coalesce((select referral_leaderboard_opt_in from public.profiles where id = actor), false)
  );
end;
$$;

revoke all on function public.read_my_referral_dashboard(uuid) from public, anon;
grant execute on function public.read_my_referral_dashboard(uuid) to authenticated;

commit;
