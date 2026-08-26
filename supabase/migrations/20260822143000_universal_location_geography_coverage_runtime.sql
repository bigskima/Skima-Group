begin;

create schema if not exists extensions;
create extension if not exists postgis with schema extensions;

insert into public.permissions (key, description, risk_level)
values
  ('platform.geography.read', 'Read configured geographic hierarchy and boundaries.', 'standard'),
  ('platform.geography.manage', 'Manage geographic hierarchy and boundaries.', 'critical'),
  ('platform.coverage.read', 'Read service and operational coverage.', 'high'),
  ('platform.coverage.manage', 'Manage service and operational coverage.', 'critical'),
  ('platform.location_evidence.read', 'Read sensitive application location evidence.', 'high'),
  ('platform.location_evidence.override', 'Override a location verification warning.', 'critical'),
  ('platform.tracking.admin.read', 'Read operational live-location state.', 'critical')
on conflict (key) do update set
  description = excluded.description,
  risk_level = excluded.risk_level,
  updated_at = timezone('utc', now());

create table public.geography_levels (
  id uuid primary key default gen_random_uuid(),
  key text not null check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  country_code text,
  display_name text not null,
  plural_display_name text not null,
  depth integer not null check (depth >= 0),
  specificity_rank integer not null check (specificity_rank >= 0),
  parent_level_id uuid references public.geography_levels(id) on delete restrict,
  is_service_selectable boolean not null default true,
  is_address_level boolean not null default true,
  status text not null default 'active' check (status in ('active', 'inactive', 'retired')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (country_code is null or country_code ~ '^[A-Z]{2}$')
);
create unique index geography_levels_scope_key_unique on public.geography_levels
  (coalesce(country_code, ''), key);

create table public.geographies (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references public.geographies(id) on delete restrict,
  geography_level_id uuid not null references public.geography_levels(id) on delete restrict,
  canonical_name text not null,
  normalized_name text not null,
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  boundary_geometry extensions.geography(MultiPolygon, 4326),
  centroid extensions.geography(Point, 4326),
  source text not null,
  external_reference text,
  aliases jsonb not null default '[]'::jsonb check (jsonb_typeof(aliases) = 'array'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  status text not null default 'active' check (status in ('draft', 'active', 'inactive', 'retired')),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (source, external_reference)
);
create index geographies_parent_idx on public.geographies(parent_id);
create index geographies_level_status_idx on public.geographies(geography_level_id, status);
create index geographies_boundary_gist_idx on public.geographies using gist(boundary_geometry);
create index geographies_centroid_gist_idx on public.geographies using gist(centroid);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  point extensions.geography(Point, 4326) not null,
  accuracy_meters numeric check (accuracy_meters is null or accuracy_meters >= 0),
  formatted_address text,
  country text,
  country_code text check (country_code is null or country_code ~ '^[A-Z]{2}$'),
  admin_area_1 text,
  admin_area_2 text,
  locality text,
  sublocality text,
  street text,
  house_number text,
  postal_code text,
  landmark text,
  capture_source text not null check (capture_source in ('DEVICE_GPS','MAP_PIN','MANUAL_ADDRESS','GEOCODED','IMPORTED','ADMIN_VERIFIED')),
  geocoder_provider text,
  geocoder_reference text,
  geocoder_raw jsonb,
  captured_at timestamptz,
  confirmed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (geocoder_raw is null or jsonb_typeof(geocoder_raw) = 'object')
);
create index locations_point_gist_idx on public.locations using gist(point);
create index locations_creator_idx on public.locations(created_by, created_at desc);

create table public.entity_locations (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  entity_id uuid not null,
  location_id uuid not null references public.locations(id) on delete restrict,
  purpose text not null check (purpose ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  is_current boolean not null default true,
  valid_from timestamptz not null default timezone('utc', now()),
  valid_to timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (valid_to is null or valid_to > valid_from)
);
create unique index entity_locations_one_current_idx on public.entity_locations(entity_type, entity_id, purpose)
  where is_current;
create index entity_locations_history_idx on public.entity_locations(entity_type, entity_id, purpose, valid_from desc);

create table public.service_coverage_policies (
  id uuid primary key default gen_random_uuid(),
  service_key text not null check (service_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  capability_key text not null check (capability_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  target_geography_id uuid not null references public.geographies(id) on delete restrict,
  effect text not null check (effect in ('ALLOW', 'DENY')),
  priority integer not null default 0,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'retired')),
  starts_at timestamptz,
  ends_at timestamptz,
  reason text,
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (ends_at is null or starts_at is null or ends_at > starts_at)
);
create index service_coverage_resolution_idx on public.service_coverage_policies
  (service_key, capability_key, status, target_geography_id, priority desc, starts_at, ends_at);

create table public.operational_coverage_assignments (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  entity_id uuid not null,
  service_key text not null check (service_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  coverage_type text not null check (coverage_type in ('ADMIN_GEOGRAPHY', 'RADIUS', 'CUSTOM_ZONE')),
  geography_id uuid references public.geographies(id) on delete restrict,
  center_point extensions.geography(Point, 4326),
  radius_meters numeric,
  coverage_geometry extensions.geography(MultiPolygon, 4326),
  status text not null default 'requested' check (status in ('requested','approved','active','paused','rejected','expired','retired')),
  source text not null check (source in ('REQUESTED','ADMIN_ASSIGNED','SYSTEM_ASSIGNED')),
  valid_from timestamptz,
  valid_to timestamptz,
  approved_by uuid references public.profiles(id) on delete set null,
  approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (valid_to is null or valid_from is null or valid_to > valid_from),
  check ((status in ('approved','active','paused','expired','retired')) = (approved_at is not null)),
  check (
    (coverage_type = 'ADMIN_GEOGRAPHY' and geography_id is not null and center_point is null and radius_meters is null and coverage_geometry is null)
    or (coverage_type = 'RADIUS' and geography_id is null and center_point is not null and radius_meters > 0 and coverage_geometry is null)
    or (coverage_type = 'CUSTOM_ZONE' and geography_id is null and center_point is null and radius_meters is null and coverage_geometry is not null)
  )
);
create index operational_coverage_entity_idx on public.operational_coverage_assignments(entity_type, entity_id, service_key, status);
create index operational_coverage_geography_idx on public.operational_coverage_assignments(geography_id) where geography_id is not null;
create index operational_coverage_center_gist_idx on public.operational_coverage_assignments using gist(center_point);
create index operational_coverage_geometry_gist_idx on public.operational_coverage_assignments using gist(coverage_geometry);

create table public.driver_location_state (
  driver_id uuid primary key references public.driver_profiles(id) on delete cascade,
  point extensions.geography(Point, 4326) not null,
  accuracy_meters numeric check (accuracy_meters is null or accuracy_meters >= 0),
  heading numeric,
  speed numeric,
  captured_at timestamptz not null,
  received_at timestamptz not null default timezone('utc', now()),
  status text not null default 'available' check (status in ('available','unavailable','stale','offline')),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  updated_at timestamptz not null default timezone('utc', now())
);
create index driver_location_state_point_gist_idx on public.driver_location_state using gist(point);
create index driver_location_state_status_time_idx on public.driver_location_state(status, captured_at desc);

create table public.expansion_interest (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete set null,
  service_key text not null check (service_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  interest_type text not null check (interest_type in ('CUSTOMER','DRIVER','STATION')),
  location_id uuid not null references public.locations(id) on delete restrict,
  created_at timestamptz not null default timezone('utc', now())
);
create index expansion_interest_service_time_idx on public.expansion_interest(service_key, interest_type, created_at desc);
create index expansion_interest_location_idx on public.expansion_interest(location_id);

create or replace function public.resolve_service_availability(
  p_service_key text,
  p_capability_key text,
  p_longitude double precision,
  p_latitude double precision,
  p_at timestamptz default timezone('utc', now())
) returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare winner record; tied_count integer;
begin
  if auth.uid() is null and coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_service_key is null or p_capability_key is null
     or p_latitude is null or p_longitude is null
     or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    return jsonb_build_object('available', false, 'reason', 'LOCATION_REQUIRED');
  end if;
  with candidates as (
    select policy.id policy_id, policy.effect, policy.priority, geography.id geography_id,
      level.specificity_rank
    from public.service_coverage_policies policy
    join public.geographies geography on geography.id = policy.target_geography_id and geography.status = 'active'
    join public.geography_levels level on level.id = geography.geography_level_id and level.status = 'active'
    where policy.service_key = p_service_key and policy.capability_key = p_capability_key
      and policy.status = 'active'
      and (policy.starts_at is null or policy.starts_at <= p_at)
      and (policy.ends_at is null or policy.ends_at > p_at)
      and geography.boundary_geometry is not null
      and extensions.st_covers(geography.boundary_geometry, extensions.st_setsrid(extensions.st_makepoint(p_longitude, p_latitude),4326)::extensions.geography)
  ), ranked as (
    select *, dense_rank() over (order by specificity_rank desc, priority desc) choice_rank from candidates
  )
  select *, count(*) over () into winner from ranked where choice_rank = 1 limit 1;
  if not found then
    return jsonb_build_object('available', false, 'reason', 'SERVICE_NOT_LAUNCHED', 'matchedGeographyId', null, 'matchedPolicyId', null);
  end if;
  select count(*) into tied_count
  from public.service_coverage_policies p
  join public.geographies g on g.id=p.target_geography_id
  join public.geography_levels l on l.id=g.geography_level_id
  where p.service_key=p_service_key and p.capability_key=p_capability_key and p.status='active'
    and (p.starts_at is null or p.starts_at<=p_at) and (p.ends_at is null or p.ends_at>p_at)
    and l.specificity_rank=winner.specificity_rank and p.priority=winner.priority
    and g.status='active' and g.boundary_geometry is not null
    and extensions.st_covers(g.boundary_geometry, extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography);
  if tied_count > 1 then
    return jsonb_build_object('available', false, 'reason', 'POLICY_CONFIGURATION_CONFLICT', 'specificity', winner.specificity_rank, 'priority', winner.priority);
  end if;
  return jsonb_build_object('available', winner.effect='ALLOW',
    'reason', case winner.effect when 'ALLOW' then 'AVAILABLE' else 'AREA_EXCLUDED' end,
    'matchedGeographyId', winner.geography_id, 'matchedPolicyId', winner.policy_id);
end $$;

create or replace function public.resolve_operational_coverage_eligibility(
  p_entity_type text, p_entity_id uuid, p_service_key text,
  p_longitude double precision, p_latitude double precision,
  p_at timestamptz default timezone('utc', now())
) returns jsonb language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with target as (
    select extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography point
    where p_entity_type is not null and p_entity_id is not null and p_service_key is not null
      and p_latitude between -90 and 90 and p_longitude between -180 and 180
  ),
  matching as (
    select assignment.id, assignment.coverage_type
    from public.operational_coverage_assignments assignment cross join target
    left join public.geographies geography on geography.id=assignment.geography_id
    where assignment.entity_type=p_entity_type and assignment.entity_id=p_entity_id and assignment.service_key=p_service_key
      and assignment.status in ('approved','active') and assignment.approved_at is not null
      and (assignment.valid_from is null or assignment.valid_from<=p_at)
      and (assignment.valid_to is null or assignment.valid_to>p_at)
      and case assignment.coverage_type
        when 'ADMIN_GEOGRAPHY' then geography.status='active' and geography.boundary_geometry is not null and extensions.st_covers(geography.boundary_geometry,target.point)
        when 'RADIUS' then extensions.st_dwithin(assignment.center_point,target.point,assignment.radius_meters)
        when 'CUSTOM_ZONE' then extensions.st_covers(assignment.coverage_geometry,target.point)
        else false end
  )
  select jsonb_build_object('eligible', exists(select 1 from matching), 'matchedCoverage',
    coalesce((select jsonb_agg(jsonb_build_object('id',id,'type',coverage_type) order by id) from matching),'[]'::jsonb));
$$;

create or replace function public.find_covered_entities_near_point(
  p_entity_type text, p_service_key text, p_longitude double precision, p_latitude double precision,
  p_max_distance_meters double precision, p_limit integer default 25
) returns table(entity_id uuid, distance_meters double precision, matched_coverage_ids uuid[])
language sql stable security definer set search_path = public, extensions, pg_temp as $$
  with target as (
    select extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography point
    where p_entity_type is not null and p_service_key is not null
      and p_latitude between -90 and 90 and p_longitude between -180 and 180
      and p_max_distance_meters > 0 and p_limit between 1 and 100
  ), eligible as (
    select a.entity_id, a.id
    from public.operational_coverage_assignments a cross join target
    left join public.geographies g on g.id=a.geography_id
    where a.entity_type=p_entity_type and a.service_key=p_service_key and a.status in ('approved','active') and a.approved_at is not null
      and (a.valid_from is null or a.valid_from<=timezone('utc',now())) and (a.valid_to is null or a.valid_to>timezone('utc',now()))
      and case a.coverage_type when 'ADMIN_GEOGRAPHY' then g.status='active' and extensions.st_covers(g.boundary_geometry,target.point)
        when 'RADIUS' then extensions.st_dwithin(a.center_point,target.point,a.radius_meters)
        when 'CUSTOM_ZONE' then extensions.st_covers(a.coverage_geometry,target.point) else false end
  )
  select e.entity_id, extensions.st_distance(d.point,t.point), array_agg(e.id order by e.id)
  from eligible e join public.driver_location_state d on p_entity_type='DRIVER' and d.driver_id=e.entity_id cross join target t
  where d.status='available' and extensions.st_dwithin(d.point,t.point,p_max_distance_meters)
  group by e.entity_id,d.point,t.point order by extensions.st_distance(d.point,t.point),e.entity_id limit greatest(1,least(p_limit,100));
$$;

do $$ declare table_name text; begin
  foreach table_name in array array['geography_levels','geographies','locations','entity_locations','service_coverage_policies','operational_coverage_assignments','driver_location_state','expansion_interest'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on public.%I from public, anon, authenticated',table_name);
    execute format('grant all on public.%I to service_role',table_name);
  end loop;
end $$;

grant select on public.geography_levels, public.geographies to authenticated;
grant select on public.locations, public.entity_locations, public.service_coverage_policies, public.operational_coverage_assignments to authenticated;
grant insert on public.locations, public.expansion_interest to authenticated;
grant insert, update, delete on public.geography_levels, public.geographies, public.service_coverage_policies, public.operational_coverage_assignments to authenticated;
grant select, insert, update on public.driver_location_state to authenticated;

create policy geography_read on public.geography_levels for select to authenticated using (status='active' or public.has_permission('platform.geography.read',null));
create policy geography_levels_manage on public.geography_levels for all to authenticated
  using (public.has_permission('platform.geography.manage',null))
  with check (public.has_permission('platform.geography.manage',null));
create policy geographies_read on public.geographies for select to authenticated using (status='active' or public.has_permission('platform.geography.read',null));
create policy geographies_manage on public.geographies for all to authenticated
  using (public.has_permission('platform.geography.manage',null))
  with check (public.has_permission('platform.geography.manage',null));
create policy locations_owner_read on public.locations for select to authenticated using (created_by=auth.uid() or public.has_permission('platform.location_evidence.read',null));
create policy locations_owner_insert on public.locations for insert to authenticated with check (created_by=auth.uid());
create policy entity_locations_privileged_read on public.entity_locations for select to authenticated using (public.has_permission('platform.location_evidence.read',null));
create policy service_coverage_privileged_read on public.service_coverage_policies for select to authenticated using (public.has_permission('platform.coverage.read',null));
create policy service_coverage_manage on public.service_coverage_policies for all to authenticated
  using (public.has_permission('platform.coverage.manage',null))
  with check (public.has_permission('platform.coverage.manage',null));
create policy operational_coverage_privileged_read on public.operational_coverage_assignments for select to authenticated using (public.has_permission('platform.coverage.read',null));
create policy operational_coverage_manage on public.operational_coverage_assignments for all to authenticated
  using (public.has_permission('platform.coverage.manage',null))
  with check (public.has_permission('platform.coverage.manage',null));
create policy expansion_interest_owner_insert on public.expansion_interest for insert to authenticated with check (
  (user_id is null or user_id=auth.uid())
  and exists(select 1 from public.locations l where l.id=location_id and l.created_by=auth.uid())
);
create policy driver_location_self_read on public.driver_location_state for select to authenticated using (
  exists(select 1 from public.driver_profiles d where d.id=driver_id and d.user_id=auth.uid()) or public.has_permission('platform.tracking.admin.read',null));
create policy driver_location_self_insert on public.driver_location_state for insert to authenticated with check (
  exists(select 1 from public.driver_profiles d where d.id=driver_id and d.user_id=auth.uid()));
create policy driver_location_self_update on public.driver_location_state for update to authenticated using (
  exists(select 1 from public.driver_profiles d where d.id=driver_id and d.user_id=auth.uid())) with check (
  exists(select 1 from public.driver_profiles d where d.id=driver_id and d.user_id=auth.uid()));

revoke all on function public.resolve_service_availability(text,text,double precision,double precision,timestamptz) from public,anon;
revoke all on function public.resolve_operational_coverage_eligibility(text,uuid,text,double precision,double precision,timestamptz) from public,anon,authenticated;
revoke all on function public.find_covered_entities_near_point(text,text,double precision,double precision,double precision,integer) from public,anon,authenticated;
grant execute on function public.resolve_service_availability(text,text,double precision,double precision,timestamptz) to authenticated,service_role;
grant execute on function public.resolve_operational_coverage_eligibility(text,uuid,text,double precision,double precision,timestamptz) to service_role;
grant execute on function public.find_covered_entities_near_point(text,text,double precision,double precision,double precision,integer) to service_role;

do $$ declare table_name text; begin
  foreach table_name in array array['geography_levels','geographies','locations','entity_locations','service_coverage_policies','operational_coverage_assignments','driver_location_state'] loop
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', 'set_' || table_name || '_updated_at', table_name);
    -- The shared audit trigger requires an `id` column. Current driver state intentionally uses
    -- driver_id as its key and is transient; durable tracking belongs in a retention-bound sample
    -- stream rather than the immutable profile/location audit log.
    if table_name <> 'driver_location_state' then
      execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.record_table_audit()', 'audit_' || table_name || '_mutations', table_name);
    end if;
  end loop;
end $$;

create or replace function public.prevent_stale_driver_location_state()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.captured_at < old.captured_at then
    raise exception using errcode = '22023', message = 'driver location capture time cannot move backwards';
  end if;
  if new.driver_id is distinct from old.driver_id then
    raise exception using errcode = '22023', message = 'driver location owner cannot be changed';
  end if;
  return new;
end $$;

create trigger protect_driver_location_state_sequence
before update on public.driver_location_state
for each row execute function public.prevent_stale_driver_location_state();

-- Reconcile the existing LPG call sites with the universal authority. Address strings are
-- deliberately ignored: legacy order and quote functions now receive their decision from the
-- coordinate-only capability resolver while retaining their established response contract.
create or replace function public.resolve_lpg_serviceability(
  p_latitude double precision,
  p_longitude double precision,
  p_geography jsonb default '{}'::jsonb
) returns jsonb language plpgsql stable security definer set search_path = public, extensions, pg_temp as $$
declare
  customer_resolution jsonb;
  driver_resolution jsonb;
  station_resolution jsonb;
begin
  customer_resolution := public.resolve_service_availability(
    'lpg', 'customer_ordering', p_longitude, p_latitude, timezone('utc', now())
  );
  driver_resolution := public.resolve_service_availability(
    'lpg', 'driver_onboarding', p_longitude, p_latitude, timezone('utc', now())
  );
  station_resolution := public.resolve_service_availability(
    'lpg', 'station_onboarding', p_longitude, p_latitude, timezone('utc', now())
  );
  return jsonb_build_object(
    'serviceable', coalesce((customer_resolution->>'available')::boolean, false),
    'status', case when coalesce((customer_resolution->>'available')::boolean, false) then 'available' else 'unavailable' end,
    'reason', customer_resolution->>'reason',
    'matchedArea', case when customer_resolution->>'matchedGeographyId' is null then null else jsonb_build_object(
      'id', customer_resolution->>'matchedGeographyId',
      'policyId', customer_resolution->>'matchedPolicyId'
    ) end,
    'partnerOpportunity', coalesce((driver_resolution->>'available')::boolean, false) or coalesce((station_resolution->>'available')::boolean, false),
    'partnerOpportunities', jsonb_build_object(
      'driver', coalesce((driver_resolution->>'available')::boolean, false),
      'station', coalesce((station_resolution->>'available')::boolean, false)
    )
  );
end $$;

revoke all on function public.prevent_stale_driver_location_state() from public,anon,authenticated;
revoke all on function public.resolve_lpg_serviceability(double precision,double precision,jsonb) from public,anon;
grant execute on function public.resolve_lpg_serviceability(double precision,double precision,jsonb) to authenticated,service_role;

comment on function public.resolve_service_availability is 'Authoritative, coordinate-based, capability-specific service policy resolver. Boundary points are inside via ST_Covers; tied specificity and priority fail closed.';
comment on table public.operational_coverage_assignments is 'Reusable union of approved administrative, radius, and custom-zone operating coverage. Requested rows never grant eligibility.';
comment on table public.locations is 'Canonical point and normalized display-address evidence shared by web, Android, and iOS clients.';

commit;
