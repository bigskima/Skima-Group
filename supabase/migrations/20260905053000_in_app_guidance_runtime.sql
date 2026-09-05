-- Database-driven in-app onboarding for SKIMA LPG.
-- Guides are role/workspace specific, versioned, frequency controlled and user-progress aware.

create table if not exists public.in_app_guides (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  workspace text not null check (workspace in ('customer','driver','station')),
  title text not null,
  description text not null default '',
  policy_key text,
  version integer not null default 1 check (version > 0),
  status text not null default 'active' check (status in ('draft','active','paused','archived')),
  frequency_days integer not null default 30 check (frequency_days between 1 and 365),
  max_shows_per_period integer not null default 1 check (max_shows_per_period between 1 and 12),
  min_interval_days integer not null default 7 check (min_interval_days between 0 and 365),
  allow_snooze boolean not null default true,
  max_snooze_days integer not null default 30 check (max_snooze_days between 1 and 365),
  starts_at timestamptz,
  ends_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.in_app_guide_steps (
  id uuid primary key default gen_random_uuid(),
  guide_id uuid not null references public.in_app_guides(id) on delete cascade,
  step_order integer not null check (step_order > 0),
  route text not null,
  target_key text not null,
  title text not null,
  body text not null,
  placement text not null default 'auto' check (placement in ('auto','top','bottom','left','right')),
  action_label text not null default 'Next',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (guide_id, step_order),
  unique (guide_id, target_key)
);

create table if not exists public.user_in_app_guide_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  guide_id uuid not null references public.in_app_guides(id) on delete cascade,
  guide_version integer not null,
  status text not null default 'new' check (status in ('new','in_progress','completed','skipped','snoozed')),
  last_step_order integer not null default 0 check (last_step_order >= 0),
  period_started_at timestamptz,
  shown_count integer not null default 0 check (shown_count >= 0),
  first_shown_at timestamptz,
  last_shown_at timestamptz,
  completed_at timestamptz,
  snoozed_until timestamptz,
  last_event text,
  updated_at timestamptz not null default timezone('utc', now()),
  primary key (user_id, guide_id)
);

create index if not exists in_app_guides_workspace_active_idx
  on public.in_app_guides(workspace, status, starts_at, ends_at);
create index if not exists in_app_guide_steps_guide_order_idx
  on public.in_app_guide_steps(guide_id, step_order);
create index if not exists user_in_app_guide_state_due_idx
  on public.user_in_app_guide_state(user_id, snoozed_until, period_started_at);

alter table public.in_app_guides enable row level security;
alter table public.in_app_guide_steps enable row level security;
alter table public.user_in_app_guide_state enable row level security;

drop policy if exists in_app_guides_authenticated_read on public.in_app_guides;
create policy in_app_guides_authenticated_read
  on public.in_app_guides for select
  to authenticated
  using (true);

drop policy if exists in_app_guide_steps_authenticated_read on public.in_app_guide_steps;
create policy in_app_guide_steps_authenticated_read
  on public.in_app_guide_steps for select
  to authenticated
  using (
    exists (
      select 1
      from public.in_app_guides g
      where g.id = guide_id
    )
  );

drop policy if exists user_in_app_guide_state_read_own on public.user_in_app_guide_state;
create policy user_in_app_guide_state_read_own
  on public.user_in_app_guide_state for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists user_in_app_guide_state_insert_own on public.user_in_app_guide_state;
create policy user_in_app_guide_state_insert_own
  on public.user_in_app_guide_state for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists user_in_app_guide_state_update_own on public.user_in_app_guide_state;
create policy user_in_app_guide_state_update_own
  on public.user_in_app_guide_state for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on table public.in_app_guides from anon;
revoke all on table public.in_app_guide_steps from anon;
revoke all on table public.user_in_app_guide_state from anon;
grant select on table public.in_app_guides to authenticated;
grant select on table public.in_app_guide_steps to authenticated;
grant select, insert, update on table public.user_in_app_guide_state to authenticated;
grant all on table public.in_app_guides, public.in_app_guide_steps, public.user_in_app_guide_state to service_role;

create or replace function public.read_active_in_app_guide(target_workspace text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  guide_record public.in_app_guides%rowtype;
  state_record public.user_in_app_guide_state%rowtype;
  guide_steps jsonb := '[]'::jsonb;
  eligible boolean := false;
  period_due_at timestamptz;
  interval_due_at timestamptz;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if target_workspace not in ('customer','driver','station') then
    raise exception using errcode = '22023', message = 'Unsupported workspace';
  end if;

  select g.*
  into guide_record
  from public.in_app_guides g
  where g.workspace = target_workspace
    and g.status = 'active'
    and (g.starts_at is null or g.starts_at <= timezone('utc', now()))
    and (g.ends_at is null or g.ends_at > timezone('utc', now()))
  order by g.version desc, g.updated_at desc
  limit 1;

  if guide_record.id is null then
    return jsonb_build_object('eligible', false, 'guide', null, 'steps', '[]'::jsonb, 'state', null);
  end if;

  select s.*
  into state_record
  from public.user_in_app_guide_state s
  where s.user_id = current_user_id
    and s.guide_id = guide_record.id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', step.id,
        'order', step.step_order,
        'route', step.route,
        'targetKey', step.target_key,
        'title', step.title,
        'body', step.body,
        'placement', step.placement,
        'actionLabel', step.action_label,
        'metadata', step.metadata
      )
      order by step.step_order
    ),
    '[]'::jsonb
  )
  into guide_steps
  from public.in_app_guide_steps step
  where step.guide_id = guide_record.id;

  if state_record.user_id is null or state_record.guide_version <> guide_record.version then
    eligible := true;
  elsif state_record.snoozed_until is not null and state_record.snoozed_until > timezone('utc', now()) then
    eligible := false;
  elsif state_record.period_started_at is null then
    eligible := true;
  else
    period_due_at := state_record.period_started_at + make_interval(days => guide_record.frequency_days);
    interval_due_at := coalesce(state_record.last_shown_at, state_record.period_started_at)
      + make_interval(days => guide_record.min_interval_days);
    eligible := period_due_at <= timezone('utc', now())
      or (
        state_record.shown_count < guide_record.max_shows_per_period
        and interval_due_at <= timezone('utc', now())
      );
  end if;

  return jsonb_build_object(
    'eligible', eligible,
    'guide', jsonb_build_object(
      'id', guide_record.id,
      'key', guide_record.key,
      'workspace', guide_record.workspace,
      'title', guide_record.title,
      'description', guide_record.description,
      'policyKey', guide_record.policy_key,
      'version', guide_record.version,
      'frequencyDays', guide_record.frequency_days,
      'maxShowsPerPeriod', guide_record.max_shows_per_period,
      'minIntervalDays', guide_record.min_interval_days,
      'allowSnooze', guide_record.allow_snooze,
      'maxSnoozeDays', guide_record.max_snooze_days,
      'metadata', guide_record.metadata
    ),
    'steps', guide_steps,
    'state', case
      when state_record.user_id is null then null
      else jsonb_build_object(
        'status', state_record.status,
        'lastStepOrder', state_record.last_step_order,
        'shownCount', state_record.shown_count,
        'periodStartedAt', state_record.period_started_at,
        'lastShownAt', state_record.last_shown_at,
        'completedAt', state_record.completed_at,
        'snoozedUntil', state_record.snoozed_until
      )
    end
  );
end;
$$;

create or replace function public.record_in_app_guide_event(
  target_guide_key text,
  target_event text,
  target_step_order integer default null,
  target_snooze_days integer default null
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  guide_record public.in_app_guides%rowtype;
  state_record public.user_in_app_guide_state%rowtype;
  now_utc timestamptz := timezone('utc', now());
  reset_period boolean := false;
  state_was_new boolean := false;
  snooze_days integer;
begin
  if current_user_id is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  select g.*
  into guide_record
  from public.in_app_guides g
  where g.key = target_guide_key
  limit 1;

  if guide_record.id is null then
    raise exception using errcode = '22023', message = 'Guide not found';
  end if;

  if target_event not in ('shown','progress','completed','skipped','snoozed','policy_skipped') then
    raise exception using errcode = '22023', message = 'Unsupported guide event';
  end if;

  select s.*
  into state_record
  from public.user_in_app_guide_state s
  where s.user_id = current_user_id
    and s.guide_id = guide_record.id
  for update;

  if state_record.user_id is null then
    insert into public.user_in_app_guide_state (
      user_id, guide_id, guide_version, status, period_started_at, shown_count,
      first_shown_at, last_shown_at, last_step_order, last_event
    )
    values (
      current_user_id,
      guide_record.id,
      guide_record.version,
      case when target_event = 'snoozed' then 'snoozed' else 'new' end,
      now_utc,
      case when target_event = 'shown' then 1 else 0 end,
      case when target_event = 'shown' then now_utc else null end,
      case when target_event = 'shown' then now_utc else null end,
      coalesce(target_step_order, 0),
      target_event
    )
    returning * into state_record;
    state_was_new := true;
  end if;

  reset_period :=
    state_record.guide_version <> guide_record.version
    or state_record.period_started_at is null
    or state_record.period_started_at + make_interval(days => guide_record.frequency_days) <= now_utc;

  if target_event = 'shown' then
    update public.user_in_app_guide_state
    set
      guide_version = guide_record.version,
      status = 'in_progress',
      last_step_order = 0,
      period_started_at = case when reset_period or state_was_new then now_utc else period_started_at end,
      shown_count = case when reset_period or state_was_new then 1 else shown_count + 1 end,
      first_shown_at = coalesce(first_shown_at, now_utc),
      last_shown_at = now_utc,
      completed_at = case when state_record.guide_version <> guide_record.version then null else completed_at end,
      snoozed_until = null,
      last_event = target_event,
      updated_at = now_utc
    where user_id = current_user_id and guide_id = guide_record.id;
  elsif target_event = 'progress' then
    update public.user_in_app_guide_state
    set
      status = 'in_progress',
      last_step_order = greatest(last_step_order, coalesce(target_step_order, last_step_order)),
      last_event = target_event,
      updated_at = now_utc
    where user_id = current_user_id and guide_id = guide_record.id;
  elsif target_event = 'completed' then
    update public.user_in_app_guide_state
    set
      status = 'completed',
      last_step_order = greatest(last_step_order, coalesce(target_step_order, last_step_order)),
      completed_at = now_utc,
      snoozed_until = null,
      last_event = target_event,
      updated_at = now_utc
    where user_id = current_user_id and guide_id = guide_record.id;
  elsif target_event = 'skipped' then
    update public.user_in_app_guide_state
    set
      status = 'skipped',
      last_step_order = greatest(last_step_order, coalesce(target_step_order, last_step_order)),
      last_event = target_event,
      updated_at = now_utc
    where user_id = current_user_id and guide_id = guide_record.id;
  elsif target_event = 'snoozed' then
    snooze_days := least(greatest(coalesce(target_snooze_days, 7), 1), guide_record.max_snooze_days);
    update public.user_in_app_guide_state
    set
      status = 'snoozed',
      snoozed_until = now_utc + make_interval(days => snooze_days),
      last_event = target_event,
      updated_at = now_utc
    where user_id = current_user_id and guide_id = guide_record.id;
  elsif target_event = 'policy_skipped' then
    update public.user_in_app_guide_state
    set
      last_event = target_event,
      updated_at = now_utc
    where user_id = current_user_id and guide_id = guide_record.id;
  end if;

  select s.*
  into state_record
  from public.user_in_app_guide_state s
  where s.user_id = current_user_id
    and s.guide_id = guide_record.id;

  return jsonb_build_object(
    'status', state_record.status,
    'lastStepOrder', state_record.last_step_order,
    'shownCount', state_record.shown_count,
    'periodStartedAt', state_record.period_started_at,
    'lastShownAt', state_record.last_shown_at,
    'completedAt', state_record.completed_at,
    'snoozedUntil', state_record.snoozed_until
  );
end;
$$;

revoke all on function public.read_active_in_app_guide(text) from public, anon;
revoke all on function public.record_in_app_guide_event(text,text,integer,integer) from public, anon;
grant execute on function public.read_active_in_app_guide(text) to authenticated, service_role;
grant execute on function public.record_in_app_guide_event(text,text,integer,integer) to authenticated, service_role;

insert into public.in_app_guides (
  id, key, workspace, title, description, policy_key, version,
  frequency_days, max_shows_per_period, min_interval_days, allow_snooze, max_snooze_days, metadata
)
values
(
  '91000000-0000-4000-8000-000000000001',
  'lpg.customer.core-tour',
  'customer',
  'Customer app guide',
  'A practical tour of the controls used to request refills, follow orders and manage the customer account.',
  'policy.customer.terms',
  1, 30, 1, 7, true, 30,
  '{"surface":"lpg-mobile","purpose":"core-navigation"}'::jsonb
),
(
  '91000000-0000-4000-8000-000000000002',
  'lpg.driver.core-tour',
  'driver',
  'Driver app guide',
  'A practical tour of the controls used for availability, jobs, scanning, earnings and account management.',
  'policy.partner.participation',
  1, 30, 1, 7, true, 30,
  '{"surface":"lpg-mobile","purpose":"core-navigation"}'::jsonb
),
(
  '91000000-0000-4000-8000-000000000003',
  'lpg.station.core-tour',
  'station',
  'Station app guide',
  'A practical tour of reception, queue, scanning, settlement and station account controls.',
  'policy.partner.participation',
  1, 30, 1, 7, true, 30,
  '{"surface":"lpg-mobile","purpose":"core-navigation"}'::jsonb
)
on conflict (key) do update
set
  workspace = excluded.workspace,
  title = excluded.title,
  description = excluded.description,
  policy_key = excluded.policy_key,
  frequency_days = excluded.frequency_days,
  max_shows_per_period = excluded.max_shows_per_period,
  min_interval_days = excluded.min_interval_days,
  allow_snooze = excluded.allow_snooze,
  max_snooze_days = excluded.max_snooze_days,
  metadata = excluded.metadata,
  updated_at = timezone('utc', now());

insert into public.in_app_guide_steps (guide_id, step_order, route, target_key, title, body, action_label)
values
('91000000-0000-4000-8000-000000000001',1,'/(customer)','common.workspace-switcher','Your SKIMA workspace','Use this switcher when SKIMA has approved more than one workspace for your account.','Next'),
('91000000-0000-4000-8000-000000000001',2,'/(customer)','customer.location','Pickup and return location','This is the address SKIMA uses to collect and return your cylinder. Tap it whenever you need to change the active location.','Next'),
('91000000-0000-4000-8000-000000000001',3,'/(customer)','customer.primary-action','Your next refill action','This action changes with your journey. It can register your first cylinder, start a refill, or take you back to a live order.','Next'),
('91000000-0000-4000-8000-000000000001',4,'/(customer)/cylinders','nav.cylinders','Cylinders','Keep your registered cylinders and their identification details here.','Next'),
('91000000-0000-4000-8000-000000000001',5,'/(customer)/orders','nav.orders','Orders','See active and previous refill orders, status and tracking from here.','Next'),
('91000000-0000-4000-8000-000000000001',6,'/(customer)/wallet','nav.wallet','Wallet','Payments, balances and transaction activity live in your wallet.','Next'),
('91000000-0000-4000-8000-000000000001',7,'/(customer)/account','nav.account','Account','Manage your profile, notifications, support, partner applications, policies and guide settings here.','Finish'),

('91000000-0000-4000-8000-000000000002',1,'/(driver)','common.workspace-switcher','Driver workspace','Use this switcher to move between approved SKIMA workspaces without signing out.','Next'),
('91000000-0000-4000-8000-000000000002',2,'/(driver)','driver.operations','Your live driver controls','Your home screen keeps the controls for scanning, availability and the current route close to the work you are doing.','Next'),
('91000000-0000-4000-8000-000000000002',3,'/(driver)/jobs','nav.jobs','Jobs','Assigned and upcoming delivery work is organised here.','Next'),
('91000000-0000-4000-8000-000000000002',4,'/(driver)/scan','nav.scan','Scan','Use the scanner only at the required hand-off points to verify the correct cylinder and order.','Next'),
('91000000-0000-4000-8000-000000000002',5,'/(driver)/earnings','nav.earnings','Earnings','See earned commissions, payout status and related money activity here.','Next'),
('91000000-0000-4000-8000-000000000002',6,'/(driver)/account','nav.account','Driver account','Your vehicle, documents, service area, support, policies and guide settings are available from Account.','Finish'),

('91000000-0000-4000-8000-000000000003',1,'/(station)','common.workspace-switcher','Station workspace','Use this switcher when your account can access more than one SKIMA workspace.','Next'),
('91000000-0000-4000-8000-000000000003',2,'/(station)','station.operations','Reception controls','The station home screen keeps verification and refill actions tied to the current reception queue.','Next'),
('91000000-0000-4000-8000-000000000003',3,'/(station)/jobs','nav.jobs','Reception queue','Incoming cylinders and their processing state are organised in the queue.','Next'),
('91000000-0000-4000-8000-000000000003',4,'/(station)/scan','nav.scan','Scan','Use scanning at the required reception hand-off to match the driver, order and cylinder.','Next'),
('91000000-0000-4000-8000-000000000003',5,'/(station)/settlements','nav.settlements','Money','Completed refill earnings and settlement activity are available here.','Next'),
('91000000-0000-4000-8000-000000000003',6,'/(station)/account','nav.account','Station account','Manage station tools, staff access, policies, support and guide settings from Account.','Finish')
on conflict (guide_id, step_order) do update
set
  route = excluded.route,
  target_key = excluded.target_key,
  title = excluded.title,
  body = excluded.body,
  action_label = excluded.action_label,
  updated_at = timezone('utc', now());
