begin;

-- One existing quick-route registry also drives app download and deep-link CTAs.
alter table public.customer_service_discovery_links
  add column if not exists android_deep_link_url text,
  add column if not exists ios_deep_link_url text,
  add column if not exists android_deep_link_enabled boolean not null default false,
  add column if not exists ios_deep_link_enabled boolean not null default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'customer_service_discovery_links_android_deep_link_url_check'
      and conrelid = 'public.customer_service_discovery_links'::regclass
  ) then
    alter table public.customer_service_discovery_links
      add constraint customer_service_discovery_links_android_deep_link_url_check
      check (android_deep_link_url is null or android_deep_link_url ~ '^[a-z][a-z0-9+.-]*:');
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'customer_service_discovery_links_ios_deep_link_url_check'
      and conrelid = 'public.customer_service_discovery_links'::regclass
  ) then
    alter table public.customer_service_discovery_links
      add constraint customer_service_discovery_links_ios_deep_link_url_check
      check (ios_deep_link_url is null or ios_deep_link_url ~ '^[a-z][a-z0-9+.-]*:');
  end if;
end;
$$;

-- Cross-app referrals. Each user receives one reusable code; campaign attribution
-- and app scope are recorded once per referred account.
alter table public.profiles
  add column if not exists referral_leaderboard_opt_in boolean not null default false;

create table if not exists public.referral_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_key text not null unique check (campaign_key ~ '^[a-z][a-z0-9_.:-]{2,100}$'),
  display_name text not null check (char_length(btrim(display_name)) between 2 and 120),
  description text not null default '',
  status text not null default 'draft' check (status in ('draft','active','paused','ended','archived')),
  target_app_keys text[] not null default array['refill','store','logistics','bills']::text[],
  starts_at timestamptz,
  ends_at timestamptz,
  priority integer not null default 100,
  referrer_reward jsonb not null default '{}'::jsonb check (jsonb_typeof(referrer_reward) = 'object'),
  referred_reward jsonb not null default '{}'::jsonb check (jsonb_typeof(referred_reward) = 'object'),
  terms text,
  maximum_referrals_per_user integer check (maximum_referrals_per_user is null or maximum_referrals_per_user > 0),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (target_app_keys <@ array['refill','store','logistics','bills']::text[]),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);

create table if not exists public.user_referral_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles(id) on delete cascade,
  referral_code text not null unique check (referral_code ~ '^[A-Z0-9]{8,16}$'),
  is_enabled boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.user_referrals (
  id uuid primary key default gen_random_uuid(),
  referral_code_id uuid not null references public.user_referral_codes(id) on delete restrict,
  campaign_id uuid references public.referral_campaigns(id) on delete set null,
  referrer_user_id uuid not null references public.profiles(id) on delete restrict,
  referred_user_id uuid not null unique references public.profiles(id) on delete restrict,
  app_key text not null check (app_key in ('refill','store','logistics','bills')),
  referral_code_snapshot text not null,
  status text not null default 'attributed' check (status in ('attributed','qualified','rejected','reversed')),
  source text not null default 'signup',
  qualified_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (referrer_user_id <> referred_user_id)
);

create index if not exists user_referrals_referrer_created_idx
  on public.user_referrals (referrer_user_id, created_at desc);
create index if not exists user_referrals_campaign_app_status_idx
  on public.user_referrals (campaign_id, app_key, status, created_at desc);

create table if not exists public.referral_reward_entries (
  id uuid primary key default gen_random_uuid(),
  referral_id uuid not null references public.user_referrals(id) on delete restrict,
  beneficiary_user_id uuid not null references public.profiles(id) on delete restrict,
  reward_side text not null check (reward_side in ('referrer','referred')),
  reward_definition jsonb not null default '{}'::jsonb check (jsonb_typeof(reward_definition) = 'object'),
  status text not null default 'pending' check (status in ('pending','approved','posted','rejected','cancelled')),
  financial_transaction_id uuid references public.financial_transactions(id),
  approved_by uuid references public.profiles(id),
  approved_at timestamptz,
  posted_at timestamptz,
  idempotency_key text not null unique,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (referral_id, reward_side)
);

-- Create a user's reusable code and process an optional signup code. Invalid,
-- disabled, self-referrals and out-of-scope codes never block account creation.
create or replace function public.provision_profile_referral_code()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  raw_metadata jsonb;
  input_code text;
  app_value text;
  code_record public.user_referral_codes%rowtype;
  campaign_record public.referral_campaigns%rowtype;
  new_code text;
  attempt integer := 0;
begin
  select coalesce(user_record.raw_user_meta_data, '{}'::jsonb)
    into raw_metadata
  from auth.users user_record
  where user_record.id = new.id;

  loop
    attempt := attempt + 1;
    new_code := 'SK' || upper(substr(encode(gen_random_bytes(8), 'hex'), 1, 10));
    insert into public.user_referral_codes (user_id, referral_code)
    values (new.id, new_code)
    on conflict (user_id) do nothing;
    exit when exists (select 1 from public.user_referral_codes where user_id = new.id);
    exit when attempt >= 5;
  end loop;

  input_code := upper(regexp_replace(coalesce(raw_metadata->>'referral_code',''), '[^A-Z0-9]', '', 'g'));
  app_value := lower(coalesce(raw_metadata->>'referral_app_key',''));
  if app_value not in ('refill','store','logistics','bills') then
    app_value := case
      when coalesce(raw_metadata->>'source','') ilike '%lpg%' then 'refill'
      when coalesce(raw_metadata->>'source','') ilike '%store%' then 'store'
      when coalesce(raw_metadata->>'source','') ilike '%logistics%' then 'logistics'
      when coalesce(raw_metadata->>'source','') ilike '%bills%' then 'bills'
      else null
    end;
  end if;

  if input_code <> '' and app_value is not null then
    select * into code_record
    from public.user_referral_codes
    where referral_code = input_code and is_enabled = true;

    if found and code_record.user_id <> new.id then
      select campaign.* into campaign_record
      from public.referral_campaigns campaign
      where campaign.status = 'active'
        and app_value = any(campaign.target_app_keys)
        and (campaign.starts_at is null or campaign.starts_at <= timezone('utc', now()))
        and (campaign.ends_at is null or campaign.ends_at > timezone('utc', now()))
        and (
          campaign.maximum_referrals_per_user is null
          or (select count(*) from public.user_referrals referral
              where referral.referrer_user_id = code_record.user_id
                and referral.campaign_id = campaign.id
                and referral.status in ('attributed','qualified')) < campaign.maximum_referrals_per_user
        )
      order by campaign.priority asc, campaign.starts_at desc nulls last, campaign.created_at asc
      limit 1;

      insert into public.user_referrals (
        referral_code_id, campaign_id, referrer_user_id, referred_user_id,
        app_key, referral_code_snapshot, status, metadata
      )
      values (
        code_record.id,
        campaign_record.id,
        code_record.user_id,
        new.id,
        app_value,
        code_record.referral_code,
        'attributed',
        jsonb_build_object('attribution_source','optional_signup_code')
      )
      on conflict (referred_user_id) do nothing;
    end if;
  end if;
  return new;
exception when others then
  -- Referral attribution must not fail signup or profile provisioning.
  return new;
end;
$$;

drop trigger if exists provision_profile_referral_code on public.profiles;
create trigger provision_profile_referral_code
after insert on public.profiles
for each row execute function public.provision_profile_referral_code();

insert into public.user_referral_codes (user_id, referral_code)
select profile.id, 'SK' || upper(substr(replace(profile.id::text,'-',''),1,10))
from public.profiles profile
on conflict (user_id) do nothing;

alter table public.referral_campaigns enable row level security;
alter table public.user_referral_codes enable row level security;
alter table public.user_referrals enable row level security;
alter table public.referral_reward_entries enable row level security;

drop policy if exists referral_campaigns_active_read on public.referral_campaigns;
create policy referral_campaigns_active_read on public.referral_campaigns
for select to authenticated using (
  status = 'active'
  or public.is_platform_super_admin()
  or public.has_permission('platform.content.manage', null)
);
drop policy if exists referral_campaigns_admin_write on public.referral_campaigns;
create policy referral_campaigns_admin_write on public.referral_campaigns
for all to authenticated using (
  public.is_platform_super_admin() or public.has_permission('platform.content.manage', null)
) with check (
  public.is_platform_super_admin() or public.has_permission('platform.content.manage', null)
);

drop policy if exists user_referral_codes_owner_read on public.user_referral_codes;
create policy user_referral_codes_owner_read on public.user_referral_codes
for select to authenticated using (user_id = auth.uid());

drop policy if exists user_referrals_participant_read on public.user_referrals;
create policy user_referrals_participant_read on public.user_referrals
for select to authenticated using (referrer_user_id = auth.uid() or referred_user_id = auth.uid());

drop policy if exists referral_reward_entries_owner_read on public.referral_reward_entries;
create policy referral_reward_entries_owner_read on public.referral_reward_entries
for select to authenticated using (beneficiary_user_id = auth.uid());

revoke all on table public.user_referral_codes from anon, authenticated;
revoke all on table public.user_referrals from anon, authenticated;
revoke all on table public.referral_reward_entries from anon, authenticated;
grant select on public.user_referral_codes, public.user_referrals, public.referral_reward_entries to authenticated;
grant select, insert, update on public.referral_campaigns to authenticated;

create or replace function public.read_my_referral_dashboard(target_campaign_id uuid default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $
declare
  actor uuid := auth.uid();
  code_value text;
  campaigns_value jsonb;
  referrals_value jsonb;
  leaderboard_value jsonb;
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
    'leaderboard', leaderboard_value,
    'leaderboardOptIn', coalesce((select referral_leaderboard_opt_in from public.profiles where id = actor), false)
  );
end;
$$;

create or replace function public.set_my_referral_leaderboard_visibility(target_visible boolean)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'authentication is required'; end if;
  update public.profiles
  set referral_leaderboard_opt_in = coalesce(target_visible, false)
  where id = auth.uid();
  return coalesce(target_visible, false);
end;
$$;

revoke all on function public.read_my_referral_dashboard(uuid) from public, anon;
revoke all on function public.set_my_referral_leaderboard_visibility(boolean) from public, anon;
grant execute on function public.read_my_referral_dashboard(uuid) to authenticated;
grant execute on function public.set_my_referral_leaderboard_visibility(boolean) to authenticated;

-- Device registrations are scoped to a signed-in person and a single app
-- installation. The OS prompt remains authoritative for permission.
create table if not exists public.push_device_registrations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  app_key text not null check (app_key in ('refill','store','logistics','bills')),
  platform text not null check (platform in ('ios','android')),
  provider text not null default 'expo' check (provider = 'expo'),
  expo_push_token text not null check (expo_push_token ~ '^(ExpoPushToken|ExponentPushToken)\[[^\]]+\]$'),
  expo_project_id text,
  installation_id text not null check (char_length(installation_id) between 8 and 160),
  permission_status text not null default 'granted' check (permission_status in ('granted','denied','undetermined')),
  app_version text,
  device_name text,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default timezone('utc', now()),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (user_id, app_key, installation_id),
  unique (app_key, expo_push_token)
);
create index if not exists push_device_registrations_user_app_idx
  on public.push_device_registrations (user_id, app_key, is_active);

create table if not exists public.push_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  notification_message_id uuid references public.notification_messages(id) on delete set null,
  registration_id uuid references public.push_device_registrations(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  app_key text not null check (app_key in ('refill','store','logistics','bills')),
  expo_push_token text not null,
  expo_project_id text,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  status text not null default 'queued' check (status in ('queued','sending','sent','delivered','failed','receipt_error')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default timezone('utc', now()),
  provider_ticket_id text,
  provider_receipt_status text,
  provider_response jsonb not null default '{}'::jsonb,
  last_error text,
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc', now()),
  sent_at timestamptz,
  updated_at timestamptz not null default timezone('utc', now())
);
create index if not exists push_notification_outbox_queue_idx
  on public.push_notification_outbox (next_attempt_at, created_at)
  where status in ('queued','failed');

alter table public.push_device_registrations enable row level security;
alter table public.push_notification_outbox enable row level security;
alter table public.push_notification_outbox enable row level security;
drop policy if exists push_device_registrations_owner_read on public.push_device_registrations;
create policy push_device_registrations_owner_read on public.push_device_registrations
for select to authenticated using (user_id = auth.uid());
revoke all on table public.push_device_registrations from anon, authenticated;
grant select on public.push_device_registrations to authenticated;
revoke all on table public.push_notification_outbox from anon, authenticated;

create or replace function public.register_skima_push_device(
  target_app_key text,
  target_platform text,
  target_expo_push_token text,
  target_expo_project_id text,
  target_installation_id text,
  target_permission_status text default 'granted',
  target_app_version text default null,
  target_device_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  result_id uuid;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_app_key not in ('refill','store','logistics','bills')
    or target_platform not in ('ios','android')
    or target_permission_status not in ('granted','denied','undetermined')
    or target_expo_push_token !~ '^(ExpoPushToken|ExponentPushToken)\[[^\]]+\]$'
    or target_installation_id is null
    or char_length(target_installation_id) not between 8 and 160 then
    raise exception 'valid app, platform, Expo push token, installation id and permission are required';
  end if;

  -- Expo tokens can move to a new account after sign-out on a shared device,
  -- and a token can rotate after reinstall. Keep one active owner per app/token.
  delete from public.push_device_registrations registration
  where registration.app_key = target_app_key
    and registration.expo_push_token = target_expo_push_token
    and (
      registration.user_id <> actor
      or registration.installation_id <> target_installation_id
    );

  insert into public.push_device_registrations (
    user_id, app_key, platform, expo_push_token, expo_project_id,
    installation_id, permission_status, app_version, device_name, is_active, last_seen_at
  )
  values (
    actor, target_app_key, target_platform, target_expo_push_token,
    nullif(target_expo_project_id,''), target_installation_id,
    target_permission_status, nullif(target_app_version,''), nullif(target_device_name,''),
    target_permission_status = 'granted', timezone('utc', now())
  )
  on conflict (user_id, app_key, installation_id) do update
  set platform = excluded.platform,
      expo_push_token = excluded.expo_push_token,
      expo_project_id = excluded.expo_project_id,
      permission_status = excluded.permission_status,
      app_version = excluded.app_version,
      device_name = excluded.device_name,
      is_active = excluded.is_active,
      last_seen_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  returning id into result_id;
  return result_id;
end;
$$;

create or replace function public.queue_skima_push_notification(
  target_user_id uuid,
  target_app_key text,
  target_title text,
  target_body text,
  target_data jsonb default '{}'::jsonb,
  target_idempotency_key text default null,
  target_notification_message_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted_count integer;
begin
  if auth.role() <> 'service_role'
    and not public.has_permission('platform.notifications.manage', null) then
    raise exception 'notification dispatch permission is required';
  end if;
  if target_user_id is null
    or target_app_key not in ('refill','store','logistics','bills')
    or nullif(btrim(target_title),'') is null
    or nullif(btrim(target_body),'') is null
    or target_data is null or jsonb_typeof(target_data) <> 'object'
    or nullif(btrim(target_idempotency_key),'') is null then
    raise exception 'valid recipient, app, title, body, data and idempotency key are required';
  end if;

  insert into public.push_notification_outbox (
    notification_message_id, registration_id, user_id, app_key,
    expo_push_token, expo_project_id, title, body, data, idempotency_key
  )
  select
    target_notification_message_id, registration.id, target_user_id, target_app_key,
    registration.expo_push_token, registration.expo_project_id,
    btrim(target_title), btrim(target_body), target_data,
    target_idempotency_key || ':' || registration.id::text
  from public.push_device_registrations registration
  where registration.user_id = target_user_id
    and registration.app_key = target_app_key
    and registration.is_active = true
    and registration.permission_status = 'granted'
  on conflict (idempotency_key) do nothing;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

revoke all on function public.register_skima_push_device(text,text,text,text,text,text,text,text) from public, anon;
revoke all on function public.queue_skima_push_notification(uuid,text,text,text,jsonb,text,uuid) from public, anon, authenticated;
grant execute on function public.register_skima_push_device(text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.queue_skima_push_notification(uuid,text,text,text,jsonb,text,uuid) to service_role;

-- Product analytics are app-scoped and show posted financial movements and
-- ledger flows separately. These are not described as unique customer GMV.
create or replace function public.read_platform_product_financial_analytics(
  target_currency_code text default 'NGN',
  target_from timestamptz default null,
  target_until timestamptz default null,
  target_limit integer default 20
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor_can_read boolean;
  actor_can_read_revenue boolean;
  app_rows jsonb;
  recent_rows jsonb;
  selected_currency text := upper(coalesce(nullif(target_currency_code,''),'NGN'));
  limit_value integer := greatest(1, least(coalesce(target_limit,20),100));

begin
  if auth.uid() is null then raise exception 'authentication is required'; end if;
  actor_can_read := public.is_platform_super_admin()
    or public.has_permission('platform.financial.read', null)
    or public.has_permission('platform.financial.manage', null);
  if not actor_can_read then raise exception 'platform financial read permission is required'; end if;
  actor_can_read_revenue := public.is_platform_super_admin()
    or public.has_permission('platform.revenue.read', null)
    or public.has_permission('platform.revenue.manage', null);

  with classified as (
    select transaction.*,
      case
        when transaction.source ilike 'skima.store.%'
          or transaction.metadata->>'storefront_module' = 'store'
          or transaction.metadata->>'module_key' = 'store' then 'store'
        when transaction.source ilike '%logistics%'
          or transaction.metadata->>'module_key' = 'logistics_network' then 'logistics'
        when transaction.source ilike '%utility%'
          or transaction.source ilike '%bills%'
          or transaction.subject_type ilike '%utility%'
          or transaction.subject_type ilike '%bill%'
          or transaction.metadata->>'bounded_context' in ('utility_billing','bills')
          or transaction.metadata->>'module_key' in ('bills','utility_billing') then 'bills'
        when transaction.source ilike 'skima.lpg.%'
          or transaction.source ilike 'lpg.%'
          or transaction.source ilike 'platform.fuel.%'
          or transaction.metadata->>'bounded_context' = 'lpg'
          or transaction.metadata->>'module_key' in ('lpg','fuel') then 'refill'
        else 'unclassified'
      end as app_key
    from public.financial_transactions transaction
    where transaction.currency_code = selected_currency
      and (target_from is null or transaction.created_at >= target_from)
      and (target_until is null or transaction.created_at < target_until)
  ),
  transaction_totals as (
    select app_key,
      count(*)::integer as transaction_count,
      count(*) filter (where status='posted')::integer as posted_count,
      coalesce(sum(total_amount) filter (where status='posted'),0) as posted_amount,
      coalesce(sum(total_amount) filter (where status='posted' and transaction_type='hold'),0) as held_amount,
      coalesce(sum(total_amount) filter (where status='posted' and transaction_type in ('release','settlement')),0) as released_amount,
      coalesce(sum(total_amount) filter (where status='posted' and transaction_type in ('refund','reversal')),0) as refund_reversal_amount,
      coalesce(sum(total_amount) filter (where status='posted' and transaction_type='transfer'),0) as transfer_amount
    from classified
    group by app_key
  ),
  ledger_totals as (
    select classified.app_key,
      count(ledger.id)::integer as ledger_entry_count,
      coalesce(sum(ledger.amount) filter (where ledger.direction='credit'),0) as ledger_credits,
      coalesce(sum(ledger.amount) filter (where ledger.direction='debit'),0) as ledger_debits,
      coalesce(sum(case when ledger.direction='credit' then ledger.amount else -ledger.amount end),0) as ledger_net
    from classified
    join public.wallet_ledger_entries ledger on ledger.transaction_id=classified.id
    group by classified.app_key
  ),
  app_keys(app_key,display_name,sort_order) as (
    values ('refill','Refill',10),('store','Store',20),('logistics','Logistics',30),('bills','Bills',40),('unclassified','Unclassified',50)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'appKey', app_keys.app_key,
    'displayName', app_keys.display_name,
    'currencyCode', selected_currency,
    'transactionCount', coalesce(transaction_totals.transaction_count,0),
    'postedCount', coalesce(transaction_totals.posted_count,0),
    'postedAmount', case when actor_can_read_revenue then coalesce(transaction_totals.posted_amount,0) else null end,
    'heldAmount', case when actor_can_read_revenue then coalesce(transaction_totals.held_amount,0) else null end,
    'releasedAmount', case when actor_can_read_revenue then coalesce(transaction_totals.released_amount,0) else null end,
    'refundReversalAmount', case when actor_can_read_revenue then coalesce(transaction_totals.refund_reversal_amount,0) else null end,
    'transferAmount', case when actor_can_read_revenue then coalesce(transaction_totals.transfer_amount,0) else null end,
    'ledgerEntryCount', coalesce(ledger_totals.ledger_entry_count,0),
    'ledgerCredits', case when actor_can_read_revenue then coalesce(ledger_totals.ledger_credits,0) else null end,
    'ledgerDebits', case when actor_can_read_revenue then coalesce(ledger_totals.ledger_debits,0) else null end,
    'ledgerNet', case when actor_can_read_revenue then coalesce(ledger_totals.ledger_net,0) else null end
  ) order by app_keys.sort_order), '[]'::jsonb)
  into app_rows
  from app_keys
  left join transaction_totals on transaction_totals.app_key=app_keys.app_key
  left join ledger_totals on ledger_totals.app_key=app_keys.app_key
  where app_keys.app_key <> 'unclassified'
     or coalesce(transaction_totals.transaction_count,0) > 0;

  with classified as (
    select transaction.id, transaction.created_at, transaction.source, transaction.transaction_type,
      transaction.status, transaction.currency_code, transaction.total_amount, transaction.subject_type,
      transaction.subject_id, transaction.external_reference, transaction.metadata,
      case
        when transaction.source ilike 'skima.store.%' or transaction.metadata->>'storefront_module'='store'
          or transaction.metadata->>'module_key'='store' then 'store'
        when transaction.source ilike '%logistics%' or transaction.metadata->>'module_key'='logistics_network' then 'logistics'
        when transaction.source ilike '%utility%' or transaction.source ilike '%bills%'
          or transaction.subject_type ilike '%utility%' or transaction.subject_type ilike '%bill%'
          or transaction.metadata->>'bounded_context' in ('utility_billing','bills')
          or transaction.metadata->>'module_key' in ('bills','utility_billing') then 'bills'
        when transaction.source ilike 'skima.lpg.%' or transaction.source ilike 'lpg.%'
          or transaction.source ilike 'platform.fuel.%' or transaction.metadata->>'bounded_context'='lpg'
          or transaction.metadata->>'module_key' in ('lpg','fuel') then 'refill'
        else 'unclassified'
      end as app_key
    from public.financial_transactions transaction
    where transaction.currency_code=selected_currency
      and (target_from is null or transaction.created_at>=target_from)
      and (target_until is null or transaction.created_at<target_until)
      and (actor_can_read_revenue or not public.financial_transaction_touches_revenue(transaction.id))
    order by transaction.created_at desc
    limit limit_value
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'transactionId', id,
    'appKey', app_key,
    'createdAt', created_at,
    'source', source,
    'type', transaction_type,
    'status', status,
    'currencyCode', currency_code,
    'amount', total_amount,
    'subjectType', subject_type,
    'subjectId', subject_id,
    'reference', external_reference,
    'metadata', metadata
  ) order by created_at desc), '[]'::jsonb)
  into recent_rows
  from classified;

  return jsonb_build_object(
    'currencyCode', selected_currency,
    'from', target_from,
    'until', target_until,
    'canReadRevenue', actor_can_read_revenue,
    'byApplication', app_rows,
    'recentTransactions', recent_rows,
    'disclaimer', 'Transaction totals are ledger posting movements, not unique customer orders or recognized revenue. Holds, releases and transfers are reported separately.'
  );
end;
$$;

revoke all on function public.read_platform_product_financial_analytics(text,timestamptz,timestamptz,integer) from public, anon;
grant execute on function public.read_platform_product_financial_analytics(text,timestamptz,timestamptz,integer) to authenticated;

commit;
