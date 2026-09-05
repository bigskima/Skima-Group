begin;

-- Deterministic service-area expansion intelligence for SKIMA.
-- This runtime combines canonical customer expansion interest with real driver/station
-- application coverage requests. It is review-only and never enables coverage, modifies
-- geography, approves an application, or changes dispatch/service availability.

create table if not exists public.ai_expansion_intelligence_rules (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  status text not null default 'active'
    check (status in ('draft','active','paused','retired')),
  config jsonb not null default '{}'::jsonb
    check (jsonb_typeof(config) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.ai_expansion_opportunities (
  id uuid primary key default gen_random_uuid(),
  opportunity_key text not null unique
    check (opportunity_key ~ '^[a-z][a-z0-9_.:-]{2,180}$'),
  rule_id uuid not null references public.ai_expansion_intelligence_rules(id) on delete restrict,
  service_key text not null,
  capability_key text not null,
  geography_id uuid references public.geographies(id) on delete set null,
  geography_name text not null,
  opportunity_type text not null
    check (opportunity_type in (
      'expansion_review',
      'policy_review',
      'configuration_review',
      'partner_supply_review',
      'monitor'
    )),
  review_priority text not null
    check (review_priority in ('high','medium','low','monitor')),
  score numeric(18,4) not null default 0 check (score >= 0),
  customer_request_count bigint not null default 0 check (customer_request_count >= 0),
  customer_interest_user_count bigint not null default 0 check (customer_interest_user_count >= 0),
  customer_not_launched_user_count bigint not null default 0 check (customer_not_launched_user_count >= 0),
  customer_excluded_user_count bigint not null default 0 check (customer_excluded_user_count >= 0),
  customer_policy_conflict_user_count bigint not null default 0 check (customer_policy_conflict_user_count >= 0),
  customer_available_user_count bigint not null default 0 check (customer_available_user_count >= 0),
  pending_driver_applicant_count bigint not null default 0 check (pending_driver_applicant_count >= 0),
  pending_station_applicant_count bigint not null default 0 check (pending_station_applicant_count >= 0),
  approved_driver_applicant_count bigint not null default 0 check (approved_driver_applicant_count >= 0),
  approved_station_applicant_count bigint not null default 0 check (approved_station_applicant_count >= 0),
  latest_signal_at timestamptz,
  evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(evidence) = 'object'),
  recommended_action text not null,
  status text not null default 'current'
    check (status in ('current','stale')),
  generated_at timestamptz not null default timezone('utc', now()),
  valid_until timestamptz not null,
  version integer not null default 1 check (version > 0),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_expansion_opportunities_priority_idx
on public.ai_expansion_opportunities (status, review_priority, score desc, latest_signal_at desc);

create index if not exists ai_expansion_opportunities_geography_idx
on public.ai_expansion_opportunities (geography_id, status);

alter table public.ai_expansion_intelligence_rules enable row level security;
alter table public.ai_expansion_opportunities enable row level security;

drop policy if exists ai_expansion_rules_read_privileged on public.ai_expansion_intelligence_rules;
create policy ai_expansion_rules_read_privileged
on public.ai_expansion_intelligence_rules
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.has_permission('platform.coverage.read', null)
);

drop policy if exists ai_expansion_rules_manage_privileged on public.ai_expansion_intelligence_rules;
create policy ai_expansion_rules_manage_privileged
on public.ai_expansion_intelligence_rules
for all to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
)
with check (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.manage', null)
);

drop policy if exists ai_expansion_opportunities_read_privileged on public.ai_expansion_opportunities;
create policy ai_expansion_opportunities_read_privileged
on public.ai_expansion_opportunities
for select to authenticated
using (
  public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
  or public.has_permission('platform.coverage.read', null)
);

drop policy if exists ai_expansion_opportunities_no_direct_insert on public.ai_expansion_opportunities;
create policy ai_expansion_opportunities_no_direct_insert
on public.ai_expansion_opportunities
for insert to authenticated
with check (false);

drop policy if exists ai_expansion_opportunities_no_direct_update on public.ai_expansion_opportunities;
create policy ai_expansion_opportunities_no_direct_update
on public.ai_expansion_opportunities
for update to authenticated
using (false)
with check (false);

drop policy if exists ai_expansion_opportunities_no_direct_delete on public.ai_expansion_opportunities;
create policy ai_expansion_opportunities_no_direct_delete
on public.ai_expansion_opportunities
for delete to authenticated
using (false);

grant select on public.ai_expansion_intelligence_rules, public.ai_expansion_opportunities to authenticated;
grant all on public.ai_expansion_intelligence_rules, public.ai_expansion_opportunities to service_role;

insert into public.ai_expansion_intelligence_rules (
  key, display_name, status, config
)
values (
  'ai.expansion.lpg.review',
  'LPG service-area expansion review',
  'active',
  '{
    "control": "review_only",
    "service_key": "lpg",
    "capability_key": "customer_ordering",
    "snapshot_valid_minutes": 60,
    "recent_signal_days": 14,
    "weights": {
      "customer_not_launched_user": 5,
      "pending_driver_applicant": 2,
      "pending_station_applicant": 4,
      "approved_driver_applicant": 1,
      "approved_station_applicant": 2,
      "recent_signal_bonus": 3
    },
    "priority_thresholds": {
      "high": 25,
      "medium": 12,
      "low": 1
    }
  }'::jsonb
)
on conflict (key) do update
set display_name = excluded.display_name,
    config = public.ai_expansion_intelligence_rules.config || excluded.config,
    updated_at = timezone('utc', now());

create or replace function public.validate_ai_expansion_intelligence_rule_config()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  value numeric;
  high_threshold numeric;
  medium_threshold numeric;
  low_threshold numeric;
begin
  if jsonb_typeof(new.config) <> 'object' then
    raise exception 'expansion intelligence configuration must be an object';
  end if;

  if coalesce(new.config ->> 'control', '') <> 'review_only' then
    raise exception 'expansion intelligence control must remain review_only';
  end if;

  if coalesce(new.config ->> 'service_key', '') !~ '^[a-z][a-z0-9_.:-]{2,120}$'
    or coalesce(new.config ->> 'capability_key', '') !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'expansion intelligence requires valid service and capability keys';
  end if;

  if coalesce(new.config ->> 'snapshot_valid_minutes', '') !~ '^[0-9]+$'
    or (new.config ->> 'snapshot_valid_minutes')::integer not between 5 and 1440 then
    raise exception 'expansion intelligence snapshot_valid_minutes must be between 5 and 1440';
  end if;

  if coalesce(new.config ->> 'recent_signal_days', '') !~ '^[0-9]+$'
    or (new.config ->> 'recent_signal_days')::integer not between 1 and 365 then
    raise exception 'expansion intelligence recent_signal_days must be between 1 and 365';
  end if;

  if jsonb_typeof(new.config -> 'weights') <> 'object'
    or jsonb_typeof(new.config -> 'priority_thresholds') <> 'object' then
    raise exception 'expansion intelligence weights and thresholds must be objects';
  end if;

  foreach value in array array[
    coalesce((new.config #>> '{weights,customer_not_launched_user}')::numeric, -1),
    coalesce((new.config #>> '{weights,pending_driver_applicant}')::numeric, -1),
    coalesce((new.config #>> '{weights,pending_station_applicant}')::numeric, -1),
    coalesce((new.config #>> '{weights,approved_driver_applicant}')::numeric, -1),
    coalesce((new.config #>> '{weights,approved_station_applicant}')::numeric, -1),
    coalesce((new.config #>> '{weights,recent_signal_bonus}')::numeric, -1)
  ] loop
    if value < 0 or value > 100 then
      raise exception 'expansion intelligence weights must be between 0 and 100';
    end if;
  end loop;

  high_threshold := coalesce((new.config #>> '{priority_thresholds,high}')::numeric, -1);
  medium_threshold := coalesce((new.config #>> '{priority_thresholds,medium}')::numeric, -1);
  low_threshold := coalesce((new.config #>> '{priority_thresholds,low}')::numeric, -1);

  if low_threshold < 0
    or medium_threshold < low_threshold
    or high_threshold < medium_threshold then
    raise exception 'expansion intelligence priority thresholds must satisfy high >= medium >= low >= 0';
  end if;

  return new;
exception
  when invalid_text_representation then
    raise exception 'expansion intelligence numeric configuration is invalid';
end;
$$;

drop trigger if exists validate_ai_expansion_intelligence_rule_config
on public.ai_expansion_intelligence_rules;

create trigger validate_ai_expansion_intelligence_rule_config
before insert or update of config
on public.ai_expansion_intelligence_rules
for each row
execute function public.validate_ai_expansion_intelligence_rule_config();

update public.ai_expansion_intelligence_rules
set config = config,
    updated_at = updated_at
where key = 'ai.expansion.lpg.review';

create or replace function public.refresh_ai_expansion_opportunities()
returns jsonb
language plpgsql
security invoker
set search_path = public, extensions, pg_temp
as $$
declare
  rule_record public.ai_expansion_intelligence_rules%rowtype;
  service_value text;
  capability_value text;
  valid_minutes integer;
  recent_days integer;
  weight_customer numeric;
  weight_pending_driver numeric;
  weight_pending_station numeric;
  weight_approved_driver numeric;
  weight_approved_station numeric;
  weight_recent numeric;
  high_threshold numeric;
  medium_threshold numeric;
  low_threshold numeric;
  now_at timestamptz := timezone('utc', now());
  refreshed_count integer := 0;
  stale_count integer := 0;
begin
  select *
  into rule_record
  from public.ai_expansion_intelligence_rules
  where key = 'ai.expansion.lpg.review'
    and status = 'active';

  if rule_record.id is null then
    return jsonb_build_object(
      'status', 'skipped',
      'reason', 'expansion_intelligence_rule_inactive',
      'control', 'review_only',
      'refreshedAt', now_at
    );
  end if;

  service_value := rule_record.config ->> 'service_key';
  capability_value := rule_record.config ->> 'capability_key';
  valid_minutes := (rule_record.config ->> 'snapshot_valid_minutes')::integer;
  recent_days := (rule_record.config ->> 'recent_signal_days')::integer;
  weight_customer := (rule_record.config #>> '{weights,customer_not_launched_user}')::numeric;
  weight_pending_driver := (rule_record.config #>> '{weights,pending_driver_applicant}')::numeric;
  weight_pending_station := (rule_record.config #>> '{weights,pending_station_applicant}')::numeric;
  weight_approved_driver := (rule_record.config #>> '{weights,approved_driver_applicant}')::numeric;
  weight_approved_station := (rule_record.config #>> '{weights,approved_station_applicant}')::numeric;
  weight_recent := (rule_record.config #>> '{weights,recent_signal_bonus}')::numeric;
  high_threshold := (rule_record.config #>> '{priority_thresholds,high}')::numeric;
  medium_threshold := (rule_record.config #>> '{priority_thresholds,medium}')::numeric;
  low_threshold := (rule_record.config #>> '{priority_thresholds,low}')::numeric;

  with demand_projection as (
    select *
    from public.read_expansion_demand(service_value, null)
  ),
  customer_demand as (
    select
      demand.geography_id,
      max(demand.geography_name) geography_name,
      sum(demand.request_count) filter (where demand.interest_type = 'CUSTOMER')::bigint customer_request_count,
      sum(demand.distinct_user_count) filter (where demand.interest_type = 'CUSTOMER')::bigint customer_interest_user_count,
      max(demand.last_requested_at) last_customer_signal_at
    from demand_projection demand
    group by demand.geography_id
  ),
  customer_point_decisions as (
    select
      matched.id geography_id,
      coalesce(matched.canonical_name, 'Unmapped coordinate') geography_name,
      interest.user_id,
      interest.created_at,
      decision.value ->> 'reason' reason,
      coalesce((decision.value ->> 'available')::boolean, false) available
    from public.expansion_interest interest
    join public.locations location on location.id = interest.location_id
    left join lateral (
      select geography.id, geography.canonical_name
      from public.geographies geography
      join public.geography_levels level on level.id = geography.geography_level_id
      where geography.status = 'active'
        and level.status = 'active'
        and geography.boundary_geometry is not null
        and extensions.st_covers(geography.boundary_geometry, location.point)
      order by level.specificity_rank desc, geography.id
      limit 1
    ) matched on true
    cross join lateral (
      select public.resolve_service_availability(
        service_value,
        capability_value,
        extensions.st_x(location.point::extensions.geometry),
        extensions.st_y(location.point::extensions.geometry),
        now_at
      ) value
    ) decision
    where interest.service_key = service_value
      and interest.interest_type = 'CUSTOMER'
  ),
  customer_decision_rollup as (
    select
      decision.geography_id,
      max(decision.geography_name) geography_name,
      count(distinct decision.user_id) filter (
        where decision.reason = 'SERVICE_NOT_LAUNCHED'
      )::bigint customer_not_launched_user_count,
      count(distinct decision.user_id) filter (
        where decision.reason = 'AREA_EXCLUDED'
      )::bigint customer_excluded_user_count,
      count(distinct decision.user_id) filter (
        where decision.reason = 'POLICY_CONFIGURATION_CONFLICT'
      )::bigint customer_policy_conflict_user_count,
      count(distinct decision.user_id) filter (
        where decision.available
      )::bigint customer_available_user_count,
      max(decision.created_at) last_customer_decision_at
    from customer_point_decisions decision
    group by decision.geography_id
  ),
  partner_request_points as (
    select
      request.id,
      request.applicant_user_id,
      request.entity_type,
      request.status,
      request.created_at,
      request.geography_id direct_geography_id,
      case request.coverage_type
        when 'RADIUS' then request.center_point
        when 'CUSTOM_ZONE' then
          extensions.st_pointonsurface(request.coverage_geometry::extensions.geometry)::extensions.geography
        else null
      end representative_point
    from public.application_operational_coverage_requests request
    where request.service_key = service_value
      and request.status in ('REQUESTED','APPROVED')
  ),
  partner_mapped as (
    select
      request.*,
      coalesce(request.direct_geography_id, matched.id) geography_id,
      coalesce(direct_geography.canonical_name, matched.canonical_name, 'Unmapped coordinate') geography_name
    from partner_request_points request
    left join public.geographies direct_geography
      on direct_geography.id = request.direct_geography_id
    left join lateral (
      select geography.id, geography.canonical_name
      from public.geographies geography
      join public.geography_levels level on level.id = geography.geography_level_id
      where request.direct_geography_id is null
        and request.representative_point is not null
        and geography.status = 'active'
        and level.status = 'active'
        and geography.boundary_geometry is not null
        and extensions.st_covers(geography.boundary_geometry, request.representative_point)
      order by level.specificity_rank desc, geography.id
      limit 1
    ) matched on true
  ),
  partner_rollup as (
    select
      partner.geography_id,
      max(partner.geography_name) geography_name,
      count(distinct partner.applicant_user_id) filter (
        where partner.entity_type = 'DRIVER' and partner.status = 'REQUESTED'
      )::bigint pending_driver_applicant_count,
      count(distinct partner.applicant_user_id) filter (
        where partner.entity_type = 'STATION' and partner.status = 'REQUESTED'
      )::bigint pending_station_applicant_count,
      count(distinct partner.applicant_user_id) filter (
        where partner.entity_type = 'DRIVER' and partner.status = 'APPROVED'
      )::bigint approved_driver_applicant_count,
      count(distinct partner.applicant_user_id) filter (
        where partner.entity_type = 'STATION' and partner.status = 'APPROVED'
      )::bigint approved_station_applicant_count,
      max(partner.created_at) last_partner_signal_at
    from partner_mapped partner
    group by partner.geography_id
  ),
  opportunity_geographies as (
    select geography_id from customer_demand
    union
    select geography_id from customer_decision_rollup
    union
    select geography_id from partner_rollup
  ),
  combined as (
    select
      geography_key.geography_id,
      coalesce(
        customer.geography_name,
        decision.geography_name,
        partner.geography_name,
        geography.canonical_name,
        'Unmapped coordinate'
      ) geography_name,
      coalesce(customer.customer_request_count, 0) customer_request_count,
      coalesce(customer.customer_interest_user_count, 0) customer_interest_user_count,
      coalesce(decision.customer_not_launched_user_count, 0) customer_not_launched_user_count,
      coalesce(decision.customer_excluded_user_count, 0) customer_excluded_user_count,
      coalesce(decision.customer_policy_conflict_user_count, 0) customer_policy_conflict_user_count,
      coalesce(decision.customer_available_user_count, 0) customer_available_user_count,
      coalesce(partner.pending_driver_applicant_count, 0) pending_driver_applicant_count,
      coalesce(partner.pending_station_applicant_count, 0) pending_station_applicant_count,
      coalesce(partner.approved_driver_applicant_count, 0) approved_driver_applicant_count,
      coalesce(partner.approved_station_applicant_count, 0) approved_station_applicant_count,
      greatest(
        customer.last_customer_signal_at,
        decision.last_customer_decision_at,
        partner.last_partner_signal_at
      ) latest_signal_at
    from opportunity_geographies geography_key
    left join customer_demand customer
      on customer.geography_id is not distinct from geography_key.geography_id
    left join customer_decision_rollup decision
      on decision.geography_id is not distinct from geography_key.geography_id
    left join partner_rollup partner
      on partner.geography_id is not distinct from geography_key.geography_id
    left join public.geographies geography on geography.id = geography_key.geography_id
  ),
  scored as (
    select
      combined.*,
      (
        combined.customer_not_launched_user_count * weight_customer
        + combined.pending_driver_applicant_count * weight_pending_driver
        + combined.pending_station_applicant_count * weight_pending_station
        + combined.approved_driver_applicant_count * weight_approved_driver
        + combined.approved_station_applicant_count * weight_approved_station
        + case
            when combined.latest_signal_at >= now_at - make_interval(days => recent_days)
              then weight_recent
            else 0
          end
      )::numeric(18,4) score,
      case
        when combined.customer_policy_conflict_user_count > 0 then 'configuration_review'
        when combined.customer_not_launched_user_count > 0 then 'expansion_review'
        when combined.customer_excluded_user_count > 0 then 'policy_review'
        when combined.pending_driver_applicant_count > 0
          or combined.pending_station_applicant_count > 0 then 'partner_supply_review'
        else 'monitor'
      end opportunity_type
    from combined
  ),
  prepared as (
    select
      scored.*,
      case
        when scored.opportunity_type = 'configuration_review' then 'high'
        when scored.score >= high_threshold then 'high'
        when scored.score >= medium_threshold then 'medium'
        when scored.score >= low_threshold then 'low'
        else 'monitor'
      end review_priority,
      case scored.opportunity_type
        when 'configuration_review' then
          'Review the conflicting coverage policies in Geography & Service Coverage. Do not enable service until the authoritative policy conflict is resolved.'
        when 'policy_review' then
          'Customer interest exists in an intentionally excluded area. Review the exclusion reason and policy evidence; do not override the exclusion automatically.'
        when 'expansion_review' then
          'Review this geography in Geography & Service Coverage, then confirm station, driver, inventory and operational readiness before any human-approved launch decision.'
        when 'partner_supply_review' then
          'Review pending driver or station coverage requests and local demand evidence before deciding whether this geography should enter expansion planning.'
        else
          'Keep this geography under observation. Current evidence does not justify a coverage change.'
      end recommended_action
    from scored
  ),
  upserted as (
    insert into public.ai_expansion_opportunities (
      opportunity_key,
      rule_id,
      service_key,
      capability_key,
      geography_id,
      geography_name,
      opportunity_type,
      review_priority,
      score,
      customer_request_count,
      customer_interest_user_count,
      customer_not_launched_user_count,
      customer_excluded_user_count,
      customer_policy_conflict_user_count,
      customer_available_user_count,
      pending_driver_applicant_count,
      pending_station_applicant_count,
      approved_driver_applicant_count,
      approved_station_applicant_count,
      latest_signal_at,
      evidence,
      recommended_action,
      status,
      generated_at,
      valid_until,
      version
    )
    select
      service_value || '.' || capability_value || '.' || coalesce(prepared.geography_id::text, 'unmapped'),
      rule_record.id,
      service_value,
      capability_value,
      prepared.geography_id,
      prepared.geography_name,
      prepared.opportunity_type,
      prepared.review_priority,
      prepared.score,
      prepared.customer_request_count,
      prepared.customer_interest_user_count,
      prepared.customer_not_launched_user_count,
      prepared.customer_excluded_user_count,
      prepared.customer_policy_conflict_user_count,
      prepared.customer_available_user_count,
      prepared.pending_driver_applicant_count,
      prepared.pending_station_applicant_count,
      prepared.approved_driver_applicant_count,
      prepared.approved_station_applicant_count,
      prepared.latest_signal_at,
      jsonb_build_object(
        'control', 'review_only',
        'demandSource', 'read_expansion_demand',
        'customerAvailabilitySource', 'resolve_service_availability',
        'partnerSupplySource', 'application_operational_coverage_requests',
        'serviceKey', service_value,
        'capabilityKey', capability_value,
        'customerNotLaunchedUsers', prepared.customer_not_launched_user_count,
        'customerExcludedUsers', prepared.customer_excluded_user_count,
        'customerPolicyConflictUsers', prepared.customer_policy_conflict_user_count,
        'customerAvailableUsers', prepared.customer_available_user_count,
        'pendingDriverApplicants', prepared.pending_driver_applicant_count,
        'pendingStationApplicants', prepared.pending_station_applicant_count,
        'approvedDriverApplicants', prepared.approved_driver_applicant_count,
        'approvedStationApplicants', prepared.approved_station_applicant_count,
        'changesCoveragePolicy', false,
        'changesOperationalCoverage', false,
        'approvesApplication', false,
        'changesDispatch', false
      ),
      prepared.recommended_action,
      'current',
      now_at,
      now_at + make_interval(mins => valid_minutes),
      1
    from prepared
    on conflict (opportunity_key) do update
    set geography_id = excluded.geography_id,
        geography_name = excluded.geography_name,
        opportunity_type = excluded.opportunity_type,
        review_priority = excluded.review_priority,
        score = excluded.score,
        customer_request_count = excluded.customer_request_count,
        customer_interest_user_count = excluded.customer_interest_user_count,
        customer_not_launched_user_count = excluded.customer_not_launched_user_count,
        customer_excluded_user_count = excluded.customer_excluded_user_count,
        customer_policy_conflict_user_count = excluded.customer_policy_conflict_user_count,
        customer_available_user_count = excluded.customer_available_user_count,
        pending_driver_applicant_count = excluded.pending_driver_applicant_count,
        pending_station_applicant_count = excluded.pending_station_applicant_count,
        approved_driver_applicant_count = excluded.approved_driver_applicant_count,
        approved_station_applicant_count = excluded.approved_station_applicant_count,
        latest_signal_at = excluded.latest_signal_at,
        evidence = excluded.evidence,
        recommended_action = excluded.recommended_action,
        status = 'current',
        generated_at = excluded.generated_at,
        valid_until = excluded.valid_until,
        version = public.ai_expansion_opportunities.version + 1,
        updated_at = timezone('utc', now())
    returning opportunity_key
  )
  select count(*) into refreshed_count from upserted;

  update public.ai_expansion_opportunities opportunity
  set status = 'stale',
      updated_at = now_at
  where opportunity.rule_id = rule_record.id
    and opportunity.status = 'current'
    and opportunity.generated_at < now_at;

  get diagnostics stale_count = row_count;

  return jsonb_build_object(
    'status', 'completed',
    'refreshedCount', refreshed_count,
    'staleCount', stale_count,
    'control', 'review_only',
    'refreshedAt', now_at
  );
end;
$$;

revoke all on function public.refresh_ai_expansion_opportunities()
from public, anon, authenticated;
grant execute on function public.refresh_ai_expansion_opportunities()
to service_role;

create or replace function public.read_ai_expansion_opportunities(
  target_limit integer default 100
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if not (
    public.is_platform_super_admin()
    or public.has_permission('platform.ai.read', null)
    or public.has_permission('platform.ai.manage', null)
    or public.has_permission('platform.coverage.read', null)
  ) then
    raise exception using errcode = '42501',
      message = 'expansion intelligence read permission is required';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', opportunity.id,
        'opportunityKey', opportunity.opportunity_key,
        'serviceKey', opportunity.service_key,
        'capabilityKey', opportunity.capability_key,
        'geographyId', opportunity.geography_id,
        'geographyName', opportunity.geography_name,
        'opportunityType', opportunity.opportunity_type,
        'reviewPriority', opportunity.review_priority,
        'score', opportunity.score,
        'customerRequestCount', opportunity.customer_request_count,
        'customerInterestUserCount', opportunity.customer_interest_user_count,
        'customerNotLaunchedUserCount', opportunity.customer_not_launched_user_count,
        'customerExcludedUserCount', opportunity.customer_excluded_user_count,
        'customerPolicyConflictUserCount', opportunity.customer_policy_conflict_user_count,
        'customerAvailableUserCount', opportunity.customer_available_user_count,
        'pendingDriverApplicantCount', opportunity.pending_driver_applicant_count,
        'pendingStationApplicantCount', opportunity.pending_station_applicant_count,
        'approvedDriverApplicantCount', opportunity.approved_driver_applicant_count,
        'approvedStationApplicantCount', opportunity.approved_station_applicant_count,
        'latestSignalAt', opportunity.latest_signal_at,
        'evidence', opportunity.evidence,
        'recommendedAction', opportunity.recommended_action,
        'generatedAt', opportunity.generated_at,
        'validUntil', opportunity.valid_until,
        'version', opportunity.version
      )
      order by
        case opportunity.review_priority
          when 'high' then 4
          when 'medium' then 3
          when 'low' then 2
          else 1
        end desc,
        opportunity.score desc,
        opportunity.latest_signal_at desc nulls last
    ),
    '[]'::jsonb
  )
  into result
  from (
    select opportunity.*
    from public.ai_expansion_opportunities opportunity
    where opportunity.status = 'current'
    order by
      case opportunity.review_priority
        when 'high' then 4
        when 'medium' then 3
        when 'low' then 2
        else 1
      end desc,
      opportunity.score desc,
      opportunity.latest_signal_at desc nulls last
    limit least(greatest(coalesce(target_limit, 100), 1), 500)
  ) opportunity;

  return result;
end;
$$;

revoke all on function public.read_ai_expansion_opportunities(integer)
from public, anon;
grant execute on function public.read_ai_expansion_opportunities(integer)
to authenticated, service_role;

commit;
