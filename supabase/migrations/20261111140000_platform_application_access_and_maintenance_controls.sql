begin;

create table if not exists public.platform_application_access_rules (
  id uuid primary key default gen_random_uuid(),
  application_key text not null check (application_key in ('driver', 'station')),
  scope_type text not null check (scope_type in ('global', 'geography')),
  geography_id uuid references public.geographies(id) on delete restrict,
  access_effect text not null default 'block' check (access_effect in ('block', 'allow')),
  title text not null default 'Applications temporarily unavailable',
  message text not null,
  status text not null default 'paused' check (status in ('active', 'paused', 'retired')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint platform_application_access_scope_target_check check (
    (scope_type = 'global' and geography_id is null)
    or (scope_type = 'geography' and geography_id is not null)
  ),
  constraint platform_application_access_message_check check (
    length(btrim(title)) between 3 and 120
    and length(btrim(message)) between 3 and 1500
  ),
  constraint platform_application_access_effective_window_check check (
    ends_at is null or starts_at is null or ends_at > starts_at
  )
);

create unique index if not exists platform_application_access_global_unique
  on public.platform_application_access_rules(application_key)
  where scope_type = 'global' and status <> 'retired';

create unique index if not exists platform_application_access_geography_unique
  on public.platform_application_access_rules(application_key, geography_id)
  where scope_type = 'geography' and status <> 'retired';

create index if not exists platform_application_access_active_lookup_idx
  on public.platform_application_access_rules(application_key, status, starts_at, ends_at);

create table if not exists public.platform_service_maintenance_notices (
  id uuid primary key default gen_random_uuid(),
  service_key text not null check (service_key ~ '^[a-z][a-z0-9_.:-]{1,79}$'),
  scope_type text not null default 'global' check (scope_type in ('global', 'geography')),
  geography_id uuid references public.geographies(id) on delete restrict,
  is_enabled boolean not null default false,
  impact text not null default 'notice' check (impact in ('notice', 'degraded', 'unavailable')),
  title text not null default 'Service update',
  message text not null,
  status text not null default 'paused' check (status in ('active', 'paused', 'retired')),
  starts_at timestamptz,
  ends_at timestamptz,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint platform_service_maintenance_scope_target_check check (
    (scope_type = 'global' and geography_id is null)
    or (scope_type = 'geography' and geography_id is not null)
  ),
  constraint platform_service_maintenance_message_check check (
    length(btrim(title)) between 3 and 120
    and length(btrim(message)) between 3 and 1500
  ),
  constraint platform_service_maintenance_effective_window_check check (
    ends_at is null or starts_at is null or ends_at > starts_at
  )
);

create unique index if not exists platform_service_maintenance_global_unique
  on public.platform_service_maintenance_notices(service_key)
  where scope_type = 'global' and status <> 'retired';

create unique index if not exists platform_service_maintenance_geography_unique
  on public.platform_service_maintenance_notices(service_key, geography_id)
  where scope_type = 'geography' and status <> 'retired';

create index if not exists platform_service_maintenance_active_lookup_idx
  on public.platform_service_maintenance_notices(service_key, status, starts_at, ends_at);

alter table public.platform_application_access_rules enable row level security;
alter table public.platform_service_maintenance_notices enable row level security;

-- Authenticated clients have no direct table privileges. These policies provide
-- a second boundary for privileged operator access and keep row-level security
-- configured even when access is routed through guarded SECURITY DEFINER RPCs.
drop policy if exists platform_application_access_rules_admin_read
  on public.platform_application_access_rules;
create policy platform_application_access_rules_admin_read
  on public.platform_application_access_rules
  for select to authenticated
  using (
    public.has_permission('platform.configuration.read', null)
    or public.has_permission('platform.configuration.manage', null)
  );

drop policy if exists platform_service_maintenance_notices_admin_read
  on public.platform_service_maintenance_notices;
create policy platform_service_maintenance_notices_admin_read
  on public.platform_service_maintenance_notices
  for select to authenticated
  using (
    public.has_permission('platform.configuration.read', null)
    or public.has_permission('platform.configuration.manage', null)
  );

revoke all on public.platform_application_access_rules from anon, authenticated;
revoke all on public.platform_service_maintenance_notices from anon, authenticated;
grant all on public.platform_application_access_rules to service_role;
grant all on public.platform_service_maintenance_notices to service_role;

create or replace function public.resolve_platform_availability_geographies(
  target_latitude double precision default null,
  target_longitude double precision default null,
  target_geography_ids uuid[] default array[]::uuid[],
  target_geography_names text[] default array[]::text[],
  target_country_code text default null
)
returns table (
  geography_id uuid,
  parent_id uuid,
  canonical_name text,
  specificity_rank integer
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  point_4326 geometry;
begin
  if (target_latitude is null) <> (target_longitude is null) then
    raise exception using errcode = '22023', message = 'latitude and longitude must be provided together';
  end if;

  if target_latitude is not null
     and (target_latitude < -90 or target_latitude > 90
       or target_longitude < -180 or target_longitude > 180) then
    raise exception using errcode = '22023', message = 'valid latitude and longitude are required';
  end if;

  if target_latitude is not null then
    point_4326 := extensions.st_setsrid(
      extensions.st_makepoint(target_longitude, target_latitude),
      4326
    );
  end if;

  return query
  with recursive supplied_names as (
    select distinct lower(btrim(value)) as name
    from unnest(coalesce(target_geography_names, array[]::text[])) value
    where nullif(btrim(value), '') is not null
      and length(btrim(value)) <= 160
  ),
  matched as (
    select geography.id
    from public.geographies geography
    where geography.status = 'active'
      and geography.id = any(coalesce(target_geography_ids, array[]::uuid[]))
      and (
        target_country_code is null
        or geography.country_code = upper(btrim(target_country_code))
      )

    union

    select geography.id
    from public.geographies geography
    where target_latitude is not null
      and geography.status = 'active'
      and geography.boundary_geometry is not null
      and extensions.st_srid(geography.boundary_geometry::geometry) > 0
      and extensions.st_covers(
        geography.boundary_geometry::geometry,
        case
          when extensions.st_srid(geography.boundary_geometry::geometry) = 4326 then point_4326
          else extensions.st_transform(point_4326, extensions.st_srid(geography.boundary_geometry::geometry))
        end
      )
      and (
        target_country_code is null
        or geography.country_code = upper(btrim(target_country_code))
      )

    union

    select geography.id
    from public.geographies geography
    join supplied_names supplied
      on supplied.name = lower(btrim(geography.canonical_name))
      or supplied.name = lower(btrim(geography.normalized_name))
      or (
        jsonb_typeof(geography.aliases) = 'array'
        and exists (
          select 1
          from jsonb_array_elements_text(geography.aliases) alias_value
          where lower(btrim(alias_value)) = supplied.name
        )
      )
    where geography.status = 'active'
      and (
        target_country_code is null
        or geography.country_code = upper(btrim(target_country_code))
      )
  ),
  lineage(id, parent_id) as (
    select geography.id, geography.parent_id
    from public.geographies geography
    join matched on matched.id = geography.id

    union all

    select parent.id, parent.parent_id
    from public.geographies parent
    join lineage child on child.parent_id = parent.id
    where parent.status = 'active'
  )
  select distinct
    geography.id,
    geography.parent_id,
    geography.canonical_name,
    level.specificity_rank
  from lineage
  join public.geographies geography on geography.id = lineage.id
  join public.geography_levels level on level.id = geography.geography_level_id
  where geography.status = 'active'
    and level.status = 'active';
end;
$function$;

revoke all on function public.resolve_platform_availability_geographies(double precision, double precision, uuid[], text[], text)
  from public, anon, authenticated;

create or replace function public.read_platform_availability_controls()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  access_rules jsonb;
  maintenance_notices jsonb;
begin
  if auth.uid() is null
     or (
       not public.has_permission('platform.configuration.read', null)
       and not public.has_permission('platform.configuration.manage', null)
     ) then
    raise exception using errcode = '42501', message = 'Platform configuration permission is required';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', rule.id,
      'applicationKey', rule.application_key,
      'scopeType', rule.scope_type,
      'geographyId', rule.geography_id,
      'geographyName', geography.canonical_name,
      'countryCode', geography.country_code,
      'accessEffect', rule.access_effect,
      'title', rule.title,
      'message', rule.message,
      'status', rule.status,
      'startsAt', rule.starts_at,
      'endsAt', rule.ends_at,
      'updatedAt', rule.updated_at
    ) order by rule.application_key, rule.scope_type, geography.canonical_name nulls first, rule.updated_at desc
  ), '[]'::jsonb)
  into access_rules
  from public.platform_application_access_rules rule
  left join public.geographies geography on geography.id = rule.geography_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', notice.id,
      'serviceKey', notice.service_key,
      'scopeType', notice.scope_type,
      'geographyId', notice.geography_id,
      'geographyName', geography.canonical_name,
      'countryCode', geography.country_code,
      'isEnabled', notice.is_enabled,
      'impact', notice.impact,
      'title', notice.title,
      'message', notice.message,
      'status', notice.status,
      'startsAt', notice.starts_at,
      'endsAt', notice.ends_at,
      'updatedAt', notice.updated_at
    ) order by notice.service_key, notice.scope_type, geography.canonical_name nulls first, notice.updated_at desc
  ), '[]'::jsonb)
  into maintenance_notices
  from public.platform_service_maintenance_notices notice
  left join public.geographies geography on geography.id = notice.geography_id;

  return jsonb_build_object(
    'applicationAccessRules', access_rules,
    'maintenanceNotices', maintenance_notices,
    'canManage', public.has_permission('platform.configuration.manage', null)
  );
end;
$function$;

revoke all on function public.read_platform_availability_controls() from public, anon;
grant execute on function public.read_platform_availability_controls() to authenticated;

create or replace function public.save_platform_application_access_rule(
  target_rule_id uuid,
  target_application_key text,
  target_scope_type text,
  target_geography_id uuid,
  target_access_effect text,
  target_title text,
  target_message text,
  target_status text,
  target_starts_at timestamptz default null,
  target_ends_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  resolved_id uuid;
  before_record jsonb;
  after_record jsonb;
begin
  if auth.uid() is null or not public.has_permission('platform.configuration.manage', null) then
    raise exception using errcode = '42501', message = 'Platform configuration management permission is required';
  end if;

  if target_application_key not in ('driver', 'station')
     or target_scope_type not in ('global', 'geography')
     or target_access_effect not in ('block', 'allow')
     or target_status not in ('active', 'paused', 'retired')
     or (target_scope_type = 'global' and target_geography_id is not null)
     or (target_scope_type = 'geography' and target_geography_id is null)
     or length(btrim(coalesce(target_title, ''))) not between 3 and 120
     or length(btrim(coalesce(target_message, ''))) not between 3 and 1500
     or (target_ends_at is not null and target_starts_at is not null and target_ends_at <= target_starts_at) then
    raise exception using errcode = '22023', message = 'Valid application access rule details are required';
  end if;

  if target_scope_type = 'geography'
     and not exists (
       select 1
       from public.geographies geography
       join public.geography_levels level on level.id = geography.geography_level_id
       where geography.id = target_geography_id
         and geography.status = 'active'
         and level.status = 'active'
     ) then
    raise exception using errcode = '22023', message = 'Choose an active geography';
  end if;

  if target_rule_id is null then
    insert into public.platform_application_access_rules (
      application_key, scope_type, geography_id, access_effect,
      title, message, status, starts_at, ends_at, created_by, updated_by
    )
    values (
      target_application_key, target_scope_type, target_geography_id, target_access_effect,
      btrim(target_title), btrim(target_message), target_status, target_starts_at, target_ends_at,
      auth.uid(), auth.uid()
    )
    returning id into resolved_id;
  else
    select to_jsonb(rule) into before_record
    from public.platform_application_access_rules rule
    where rule.id = target_rule_id;

    if before_record is null then
      raise exception using errcode = 'P0002', message = 'Application access rule was not found';
    end if;

    update public.platform_application_access_rules
    set application_key = target_application_key,
        scope_type = target_scope_type,
        geography_id = target_geography_id,
        access_effect = target_access_effect,
        title = btrim(target_title),
        message = btrim(target_message),
        status = target_status,
        starts_at = target_starts_at,
        ends_at = target_ends_at,
        updated_by = auth.uid(),
        updated_at = timezone('utc', now())
    where id = target_rule_id
    returning id into resolved_id;
  end if;

  select to_jsonb(rule) into after_record
  from public.platform_application_access_rules rule
  where rule.id = resolved_id;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id,
    before_state, after_state, metadata
  )
  values (
    auth.uid(),
    'platform.application_access_rule.saved',
    'platform_application_access_rules',
    resolved_id,
    before_record,
    after_record,
    jsonb_build_object('applicationKey', target_application_key, 'scopeType', target_scope_type)
  );

  return resolved_id;
end;
$function$;

revoke all on function public.save_platform_application_access_rule(uuid, text, text, uuid, text, text, text, text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.save_platform_application_access_rule(uuid, text, text, uuid, text, text, text, text, timestamptz, timestamptz)
  to authenticated;

create or replace function public.save_platform_service_maintenance_notice(
  target_notice_id uuid,
  target_service_key text,
  target_scope_type text,
  target_geography_id uuid,
  target_is_enabled boolean,
  target_impact text,
  target_title text,
  target_message text,
  target_status text,
  target_starts_at timestamptz default null,
  target_ends_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  resolved_id uuid;
  before_record jsonb;
  after_record jsonb;
begin
  if auth.uid() is null or not public.has_permission('platform.configuration.manage', null) then
    raise exception using errcode = '42501', message = 'Platform configuration management permission is required';
  end if;

  if target_service_key !~ '^[a-z][a-z0-9_.:-]{1,79}$'
     or target_scope_type not in ('global', 'geography')
     or target_impact not in ('notice', 'degraded', 'unavailable')
     or target_status not in ('active', 'paused', 'retired')
     or (target_scope_type = 'global' and target_geography_id is not null)
     or (target_scope_type = 'geography' and target_geography_id is null)
     or target_is_enabled is null
     or length(btrim(coalesce(target_title, ''))) not between 3 and 120
     or length(btrim(coalesce(target_message, ''))) not between 3 and 1500
     or (target_ends_at is not null and target_starts_at is not null and target_ends_at <= target_starts_at) then
    raise exception using errcode = '22023', message = 'Valid service maintenance notice details are required';
  end if;

  if target_scope_type = 'geography'
     and not exists (
       select 1
       from public.geographies geography
       join public.geography_levels level on level.id = geography.geography_level_id
       where geography.id = target_geography_id
         and geography.status = 'active'
         and level.status = 'active'
     ) then
    raise exception using errcode = '22023', message = 'Choose an active geography';
  end if;

  if target_notice_id is null then
    insert into public.platform_service_maintenance_notices (
      service_key, scope_type, geography_id, is_enabled, impact,
      title, message, status, starts_at, ends_at, created_by, updated_by
    )
    values (
      lower(btrim(target_service_key)), target_scope_type, target_geography_id, target_is_enabled,
      target_impact, btrim(target_title), btrim(target_message), target_status,
      target_starts_at, target_ends_at, auth.uid(), auth.uid()
    )
    returning id into resolved_id;
  else
    select to_jsonb(notice) into before_record
    from public.platform_service_maintenance_notices notice
    where notice.id = target_notice_id;

    if before_record is null then
      raise exception using errcode = 'P0002', message = 'Service maintenance notice was not found';
    end if;

    update public.platform_service_maintenance_notices
    set service_key = lower(btrim(target_service_key)),
        scope_type = target_scope_type,
        geography_id = target_geography_id,
        is_enabled = target_is_enabled,
        impact = target_impact,
        title = btrim(target_title),
        message = btrim(target_message),
        status = target_status,
        starts_at = target_starts_at,
        ends_at = target_ends_at,
        updated_by = auth.uid(),
        updated_at = timezone('utc', now())
    where id = target_notice_id
    returning id into resolved_id;
  end if;

  select to_jsonb(notice) into after_record
  from public.platform_service_maintenance_notices notice
  where notice.id = resolved_id;

  insert into public.audit_logs (
    actor_user_id, action, entity_type, entity_id,
    before_state, after_state, metadata
  )
  values (
    auth.uid(),
    'platform.service_maintenance_notice.saved',
    'platform_service_maintenance_notices',
    resolved_id,
    before_record,
    after_record,
    jsonb_build_object('serviceKey', lower(btrim(target_service_key)), 'scopeType', target_scope_type)
  );

  return resolved_id;
end;
$function$;

revoke all on function public.save_platform_service_maintenance_notice(uuid, text, text, uuid, boolean, text, text, text, text, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.save_platform_service_maintenance_notice(uuid, text, text, uuid, boolean, text, text, text, text, timestamptz, timestamptz)
  to authenticated;

create or replace function public.read_customer_application_access(
  target_application_key text,
  target_latitude double precision default null,
  target_longitude double precision default null,
  target_geography_ids uuid[] default array[]::uuid[],
  target_geography_names text[] default array[]::text[],
  target_country_code text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  matched_ids uuid[];
  best_rule record;
  needs_location boolean := false;
begin
  if target_application_key not in ('driver', 'station') then
    raise exception using errcode = '22023', message = 'A valid application type is required';
  end if;

  select coalesce(array_agg(context.geography_id), array[]::uuid[])
  into matched_ids
  from public.resolve_platform_availability_geographies(
    target_latitude, target_longitude, target_geography_ids, target_geography_names, target_country_code
  ) context;

  select
    rule.id,
    rule.access_effect,
    rule.title,
    rule.message,
    rule.scope_type,
    geography.id as geography_id,
    geography.canonical_name as geography_name
  into best_rule
  from public.platform_application_access_rules rule
  left join public.geographies geography on geography.id = rule.geography_id
  left join public.geography_levels level on level.id = geography.geography_level_id
  where rule.application_key = target_application_key
    and rule.status = 'active'
    and (rule.starts_at is null or rule.starts_at <= timezone('utc', now()))
    and (rule.ends_at is null or rule.ends_at > timezone('utc', now()))
    and (
      rule.scope_type = 'global'
      or rule.geography_id = any(matched_ids)
    )
  order by
    case when rule.scope_type = 'global' then 0 else coalesce(level.specificity_rank, 0) end desc,
    rule.updated_at desc,
    rule.id
  limit 1;

  if cardinality(matched_ids) = 0 then
    -- A supplied point/address that cannot be matched is not proof that the
    -- applicant is outside all overrides. Require a resolvable area only when
    -- active geographic rules exist in the supplied country (or country is
    -- unknown). Rules in other countries do not affect this applicant.
    select exists (
      select 1
      from public.platform_application_access_rules rule
      left join public.geographies geography on geography.id = rule.geography_id
      where rule.application_key = target_application_key
        and rule.scope_type = 'geography'
        and rule.status = 'active'
        and (rule.starts_at is null or rule.starts_at <= timezone('utc', now()))
        and (rule.ends_at is null or rule.ends_at > timezone('utc', now()))
        and (
          target_country_code is null
          or geography.country_code is null
          or geography.country_code = upper(btrim(target_country_code))
        )
    ) into needs_location;
  end if;

  return jsonb_build_object(
    'applicationKey', target_application_key,
    'blocked', coalesce(best_rule.access_effect = 'block', false),
    'title', coalesce(best_rule.title, 'Applications are available'),
    'message', coalesce(best_rule.message, ''),
    'accessEffect', best_rule.access_effect,
    'scopeType', best_rule.scope_type,
    'geographyId', best_rule.geography_id,
    'geographyName', best_rule.geography_name,
    'requiresLocation', needs_location,
    'matchedGeographyIds', to_jsonb(matched_ids)
  );
end;
$function$;

revoke all on function public.read_customer_application_access(text, double precision, double precision, uuid[], text[], text)
  from public;
grant execute on function public.read_customer_application_access(text, double precision, double precision, uuid[], text[], text)
  to anon, authenticated;

create or replace function public.read_customer_service_maintenance(
  target_service_keys text[],
  target_latitude double precision default null,
  target_longitude double precision default null,
  target_geography_ids uuid[] default array[]::uuid[],
  target_geography_names text[] default array[]::text[],
  target_country_code text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  matched_ids uuid[];
  result_items jsonb;
  needs_location boolean := false;
begin
  if coalesce(cardinality(target_service_keys), 0) > 20 then
    raise exception using errcode = '22023', message = 'No more than twenty services can be checked at once';
  end if;

  if exists (
    select 1
    from unnest(coalesce(target_service_keys, array[]::text[])) service_key
    where service_key !~ '^[a-z][a-z0-9_.:-]{1,79}$'
  ) then
    raise exception using errcode = '22023', message = 'Service identifiers must use valid lowercase keys';
  end if;

  select coalesce(array_agg(context.geography_id), array[]::uuid[])
  into matched_ids
  from public.resolve_platform_availability_geographies(
    target_latitude, target_longitude, target_geography_ids, target_geography_names, target_country_code
  ) context;

  with requested as (
    select distinct service_key
    from unnest(coalesce(target_service_keys, array[]::text[])) service_key
  ),
  ranked as (
    select distinct on (notice.service_key)
      notice.service_key,
      notice.is_enabled,
      notice.impact,
      notice.title,
      notice.message,
      notice.scope_type,
      geography.id as geography_id,
      geography.canonical_name as geography_name,
      notice.starts_at,
      notice.ends_at,
      notice.updated_at
    from requested
    join public.platform_service_maintenance_notices notice
      on notice.service_key = requested.service_key
    left join public.geographies geography on geography.id = notice.geography_id
    left join public.geography_levels level on level.id = geography.geography_level_id
    where notice.status = 'active'
      and (notice.starts_at is null or notice.starts_at <= timezone('utc', now()))
      and (notice.ends_at is null or notice.ends_at > timezone('utc', now()))
      and (
        notice.scope_type = 'global'
        or notice.geography_id = any(matched_ids)
      )
    order by
      notice.service_key,
      case when notice.scope_type = 'global' then 0 else coalesce(level.specificity_rank, 0) end desc,
      notice.updated_at desc,
      notice.id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'serviceKey', ranked.service_key,
    'impact', ranked.impact,
    'title', ranked.title,
    'message', ranked.message,
    'scopeType', ranked.scope_type,
    'geographyId', ranked.geography_id,
    'geographyName', ranked.geography_name,
    'startsAt', ranked.starts_at,
    'endsAt', ranked.ends_at,
    'updatedAt', ranked.updated_at
  ) order by ranked.service_key), '[]'::jsonb)
  into result_items
  from ranked
  where ranked.is_enabled = true;

  if cardinality(matched_ids) = 0 then
    select exists (
      select 1
      from public.platform_service_maintenance_notices notice
      left join public.geographies geography on geography.id = notice.geography_id
      where notice.service_key = any(coalesce(target_service_keys, array[]::text[]))
        and notice.scope_type = 'geography'
        and notice.status = 'active'
        and (notice.starts_at is null or notice.starts_at <= timezone('utc', now()))
        and (notice.ends_at is null or notice.ends_at > timezone('utc', now()))
        and (
          target_country_code is null
          or geography.country_code is null
          or geography.country_code = upper(btrim(target_country_code))
        )
    ) into needs_location;
  end if;

  return jsonb_build_object(
    'items', result_items,
    'requiresLocation', needs_location
  );
end;
$function$;

revoke all on function public.read_customer_service_maintenance(text[], double precision, double precision, uuid[], text[], text)
  from public;
grant execute on function public.read_customer_service_maintenance(text[], double precision, double precision, uuid[], text[], text)
  to anon, authenticated;

create or replace function public.guard_application_submission_platform_access()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  application_type_key text;
  application_payload jsonb;
  location_payload jsonb;
  station_payload jsonb;
  address_payload jsonb;
  target_application_key text;
  target_latitude double precision;
  target_longitude double precision;
  target_country_code text;
  target_names text[];
  target_geography_ids uuid[];
  service_payload jsonb;
  access_result jsonb;
begin
  if coalesce(auth.role(), '') = 'service_role' then
    return new;
  end if;

  if new.status <> 'submitted'
     or coalesce(old.status, '') not in ('draft', 'incomplete') then
    -- A pause only stops first-time application submissions. Applicants who
    -- already submitted and were asked for corrections can still resubmit.
    return new;
  end if;

  select
    application_type.key
  into application_type_key
  from public.application_type_definitions application_type
  where application_type.id = new.application_type_id;

  if application_type_key = 'application.lpg.driver.phase-one' then
    target_application_key := 'driver';
  elsif application_type_key = 'application.lpg.station.phase-one' then
    target_application_key := 'station';
  else
    return new;
  end if;

  select coalesce(version.payload, '{}'::jsonb)
  into application_payload
  from public.application_versions version
  where version.application_id = new.id
    and version.version = new.active_version;

  application_payload := coalesce(application_payload, '{}'::jsonb);
  location_payload := coalesce(application_payload -> 'location', '{}'::jsonb);
  station_payload := coalesce(application_payload -> 'station', '{}'::jsonb);
  address_payload := coalesce(location_payload -> 'address', '{}'::jsonb);
  service_payload := coalesce(application_payload -> 'service', '{}'::jsonb);

  select coalesce(array_agg(distinct request.geography_id), array[]::uuid[])
  into target_geography_ids
  from (
    select (request.value ->> 'geographyId')::uuid as geography_id
    from jsonb_array_elements(
      case
        when jsonb_typeof(service_payload -> 'coverageRequests') = 'array'
          then service_payload -> 'coverageRequests'
        else '[]'::jsonb
      end
    ) request(value)
    where coalesce(request.value ->> 'geographyId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

    union all

    select legacy_id.value::uuid as geography_id
    from jsonb_array_elements_text(
      case
        when jsonb_typeof(service_payload -> 'serviceAreaIds') = 'array'
          then service_payload -> 'serviceAreaIds'
        when jsonb_typeof(service_payload -> 'service_area_ids') = 'array'
          then service_payload -> 'service_area_ids'
        else '[]'::jsonb
      end
    ) legacy_id(value)
    where legacy_id.value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ) request;

  target_latitude := coalesce(
    nullif(location_payload ->> 'latitude', '')::double precision,
    nullif(station_payload ->> 'latitude', '')::double precision
  );
  target_longitude := coalesce(
    nullif(location_payload ->> 'longitude', '')::double precision,
    nullif(station_payload ->> 'longitude', '')::double precision
  );

  if (target_latitude is null) <> (target_longitude is null) then
    raise exception using errcode = '55000',
      message = 'Confirm the operating location before submitting this application.';
  end if;

  target_country_code := upper(coalesce(
    nullif(address_payload ->> 'countryCode', ''),
    nullif(address_payload ->> 'country_code', ''),
    nullif(address_payload ->> 'isoCountryCode', ''),
    nullif(location_payload ->> 'countryCode', ''),
    nullif(station_payload ->> 'countryCode', '')
  ));

  if target_country_code is not null and length(target_country_code) <> 2 then
    target_country_code := null;
  end if;

  target_names := array_remove(array[
    nullif(address_payload ->> 'country', ''),
    nullif(address_payload ->> 'region', ''),
    nullif(address_payload ->> 'state', ''),
    nullif(address_payload ->> 'lga', ''),
    nullif(address_payload ->> 'city', ''),
    nullif(address_payload ->> 'district', ''),
    nullif(address_payload ->> 'town', ''),
    nullif(address_payload ->> 'locality', ''),
    nullif(location_payload ->> 'formattedAddress', ''),
    nullif(station_payload ->> 'formattedAddress', '')
  ], null);

  access_result := public.read_customer_application_access(
    target_application_key,
    target_latitude,
    target_longitude,
    target_geography_ids,
    target_names,
    target_country_code
  );

  if coalesce((access_result ->> 'requiresLocation')::boolean, false) then
    raise exception using errcode = '55000',
      message = 'Confirm your operating location so SKIMA can check application availability in your area.';
  end if;

  if coalesce((access_result ->> 'blocked')::boolean, false) then
    raise exception using errcode = '55000',
      message = coalesce(access_result ->> 'message', 'New applications are not available in this area right now.');
  end if;

  return new;
end;
$function$;

revoke all on function public.guard_application_submission_platform_access() from public, anon, authenticated;

drop trigger if exists application_submission_platform_access_guard
  on public.application_records;
create trigger application_submission_platform_access_guard
before update of status on public.application_records
for each row
execute function public.guard_application_submission_platform_access();

comment on function public.guard_application_submission_platform_access() is
  'Blocks driver and station application submission where an active geographic or global application access override disallows it.';

comment on table public.platform_application_access_rules is
  'Admin-governed driver/station application access rules. Geographic rules inherit through the shared geography parent hierarchy; a more specific allow or block overrides broader rules.';

comment on table public.platform_service_maintenance_notices is
  'Admin-governed, service-specific customer maintenance notices. Disabled geographic rules can suppress broader notices for a more specific location.';

comment on function public.read_customer_application_access(text, double precision, double precision, uuid[], text[], text) is
  'Returns the effective public application access override for a driver or station applicant without exposing admin configuration internals.';

comment on function public.read_customer_service_maintenance(text[], double precision, double precision, uuid[], text[], text) is
  'Returns active customer-visible maintenance notices for the requested services, applying the most-specific geography override.';

commit;
