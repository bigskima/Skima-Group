create or replace function public.can_manage_lpg_service_coverage()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    coalesce(auth.role(), '') = 'service_role'
    or exists (
      select 1
      from public.user_roles assigned_role
      join public.roles role_record on role_record.id = assigned_role.role_id
      join public.role_permissions role_permission on role_permission.role_id = role_record.id
      join public.permissions permission_record on permission_record.id = role_permission.permission_id
      where assigned_role.user_id = auth.uid()
        and assigned_role.organization_id is null
        and assigned_role.branch_id is null
        and assigned_role.status = 'active'
        and role_record.organization_id is null
        and role_record.status = 'active'
        and permission_record.key = 'lpg.config.manage'
        and (assigned_role.ends_at is null or assigned_role.ends_at > timezone('utc', now()))
    );
$$;

revoke all on function public.can_manage_lpg_service_coverage() from public, anon;
grant execute on function public.can_manage_lpg_service_coverage() to authenticated, service_role;

create or replace function public.service_area_generated_key(
  target_area_type text,
  target_display_name text,
  target_country_code text,
  target_country_name text,
  target_state_name text,
  target_lga_name text,
  target_city_name text,
  target_town_name text,
  target_locality_name text,
  target_latitude double precision,
  target_longitude double precision,
  target_radius_meters double precision,
  target_polygon_geojson jsonb
)
returns text
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  raw_key text;
  normalized_key text;
begin
  raw_key := case target_area_type
    when 'country' then concat_ws('.', 'geo', 'country', coalesce(target_country_code, target_country_name, target_display_name))
    when 'state' then concat_ws('.', 'geo', 'state', coalesce(target_country_code, target_country_name), target_state_name)
    when 'lga' then concat_ws('.', 'geo', 'lga', coalesce(target_country_code, target_country_name), target_state_name, target_lga_name)
    when 'city' then concat_ws('.', 'geo', 'city', coalesce(target_country_code, target_country_name), target_state_name, target_city_name)
    when 'town' then concat_ws('.', 'geo', 'town', coalesce(target_country_code, target_country_name), target_state_name, target_town_name)
    when 'locality' then concat_ws('.', 'geo', 'locality', coalesce(target_country_code, target_country_name), target_state_name, target_locality_name)
    when 'radius' then concat_ws('.', 'geo', 'radius', target_display_name, substr(md5(concat_ws(':', target_latitude::text, target_longitude::text, target_radius_meters::text)), 1, 12))
    when 'polygon' then concat_ws('.', 'geo', 'polygon', target_display_name, substr(md5(coalesce(target_polygon_geojson::text, '')), 1, 12))
    else concat_ws('.', 'geo', coalesce(target_area_type, 'area'), target_display_name)
  end;

  normalized_key := lower(regexp_replace(raw_key, '[^a-zA-Z0-9_.:-]+', '.', 'g'));
  normalized_key := regexp_replace(normalized_key, '\.{2,}', '.', 'g');
  normalized_key := trim(both '.' from normalized_key);

  if normalized_key = '' or normalized_key !~ '^[a-z]' then
    normalized_key := 'geo.area.' || substr(md5(coalesce(raw_key, target_display_name, 'service-area')), 1, 16);
  end if;

  return left(normalized_key, 160);
end;
$$;

revoke all on function public.service_area_generated_key(text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,jsonb) from public, anon, authenticated;
grant execute on function public.service_area_generated_key(text,text,text,text,text,text,text,text,text,double precision,double precision,double precision,jsonb) to service_role;

create or replace function public.read_lpg_service_coverage()
returns table (
  area_id uuid,
  area_key text,
  display_name text,
  parent_area_id uuid,
  area_type text,
  country_code text,
  country_name text,
  state_name text,
  lga_name text,
  city_name text,
  town_name text,
  locality_name text,
  center_latitude double precision,
  center_longitude double precision,
  radius_meters double precision,
  polygon_geojson jsonb,
  area_priority integer,
  area_status text,
  rule_id uuid,
  effect text,
  rule_priority integer,
  rule_status text,
  effective_from timestamptz,
  effective_until timestamptz,
  area_metadata jsonb,
  rule_metadata jsonb,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.can_manage_lpg_service_coverage() then
    raise exception using errcode = '42501', message = 'LPG service coverage management permission is required';
  end if;

  return query
  select
    area.id,
    area.key,
    area.display_name,
    area.parent_area_id,
    area.area_type,
    area.country_code,
    area.country_name,
    area.state_name,
    area.lga_name,
    area.city_name,
    area.town_name,
    area.locality_name,
    area.center_latitude,
    area.center_longitude,
    area.radius_meters,
    area.polygon_geojson,
    area.priority,
    area.status,
    current_rule.id,
    current_rule.effect,
    current_rule.priority,
    current_rule.status,
    current_rule.effective_from,
    current_rule.effective_until,
    area.metadata,
    current_rule.metadata,
    area.created_at,
    area.updated_at
  from public.service_areas area
  left join lateral (
    select rule.*
    from public.lpg_service_area_rules rule
    where rule.area_id = area.id
    order by
      case
        when rule.status = 'active'
          and (rule.effective_from is null or rule.effective_from <= timezone('utc', now()))
          and (rule.effective_until is null or rule.effective_until > timezone('utc', now()))
          then 0
        when rule.status = 'active' then 1
        else 2
      end,
      rule.created_at desc
    limit 1
  ) current_rule on true
  order by
    case area.area_type
      when 'country' then 10
      when 'state' then 20
      when 'lga' then 30
      when 'city' then 40
      when 'town' then 50
      when 'locality' then 60
      when 'radius' then 70
      when 'polygon' then 80
      else 90
    end,
    area.display_name asc;
end;
$$;

revoke all on function public.read_lpg_service_coverage() from public, anon;
grant execute on function public.read_lpg_service_coverage() to authenticated, service_role;

create or replace function public.configure_lpg_service_coverage(
  target_display_name text,
  target_area_type text,
  target_effect text,
  target_idempotency_key text,
  target_area_id uuid default null,
  target_area_key text default null,
  target_parent_area_id uuid default null,
  target_country_code text default null,
  target_country_name text default null,
  target_state_name text default null,
  target_lga_name text default null,
  target_city_name text default null,
  target_town_name text default null,
  target_locality_name text default null,
  target_center_latitude double precision default null,
  target_center_longitude double precision default null,
  target_radius_meters double precision default null,
  target_polygon_geojson jsonb default null,
  target_area_priority integer default 0,
  target_rule_priority integer default 0,
  target_area_status text default 'active',
  target_rule_status text default 'active',
  target_effective_from timestamptz default null,
  target_effective_until timestamptz default null,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.service_coverage_admin'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_area_id uuid;
  resolved_area_key text;
  resolved_rule_id uuid;
  existing_rule_id uuid;
begin
  if not public.can_manage_lpg_service_coverage() then
    raise exception using errcode = '42501', message = 'LPG service coverage management permission is required';
  end if;

  if target_display_name is null or btrim(target_display_name) = '' then
    raise exception using errcode = '22023', message = 'coverage area name is required';
  end if;
  if target_area_type not in ('country','state','lga','city','town','locality','radius','polygon') then
    raise exception using errcode = '22023', message = 'coverage area type is not supported';
  end if;
  if target_effect not in ('include','exclude') then
    raise exception using errcode = '22023', message = 'coverage effect must be include or exclude';
  end if;
  if target_area_status not in ('active','inactive') or target_rule_status not in ('active','inactive') then
    raise exception using errcode = '22023', message = 'coverage status must be active or inactive';
  end if;
  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception using errcode = '22023', message = 'idempotency key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception using errcode = '22023', message = 'coverage metadata must be an object';
  end if;
  if target_effective_until is not null and target_effective_from is not null and target_effective_until <= target_effective_from then
    raise exception using errcode = '22023', message = 'coverage end time must be after its start time';
  end if;

  resolved_area_key := coalesce(
    nullif(btrim(target_area_key), ''),
    public.service_area_generated_key(
      target_area_type,
      target_display_name,
      upper(nullif(btrim(target_country_code), '')),
      nullif(btrim(target_country_name), ''),
      nullif(btrim(target_state_name), ''),
      nullif(btrim(target_lga_name), ''),
      nullif(btrim(target_city_name), ''),
      nullif(btrim(target_town_name), ''),
      nullif(btrim(target_locality_name), ''),
      target_center_latitude,
      target_center_longitude,
      target_radius_meters,
      target_polygon_geojson
    )
  );

  if target_area_id is not null then
    select id into resolved_area_id from public.service_areas where id = target_area_id for update;
    if not found then
      raise exception using errcode = '22023', message = 'coverage area could not be found';
    end if;
  else
    select id into resolved_area_id from public.service_areas where key = resolved_area_key for update;
  end if;

  if resolved_area_id is null then
    insert into public.service_areas (
      key, display_name, parent_area_id, area_type,
      country_code, country_name, state_name, lga_name, city_name, town_name, locality_name,
      center_latitude, center_longitude, radius_meters, polygon_geojson,
      priority, status, metadata, source, idempotency_key
    ) values (
      resolved_area_key, btrim(target_display_name), target_parent_area_id, target_area_type,
      upper(nullif(btrim(target_country_code), '')), nullif(btrim(target_country_name), ''),
      nullif(btrim(target_state_name), ''), nullif(btrim(target_lga_name), ''),
      nullif(btrim(target_city_name), ''), nullif(btrim(target_town_name), ''),
      nullif(btrim(target_locality_name), ''), target_center_latitude, target_center_longitude,
      target_radius_meters, target_polygon_geojson, target_area_priority, target_area_status,
      target_metadata, target_source, target_idempotency_key || ':area'
    )
    returning id into resolved_area_id;
  else
    update public.service_areas
    set
      display_name = btrim(target_display_name),
      parent_area_id = target_parent_area_id,
      area_type = target_area_type,
      country_code = upper(nullif(btrim(target_country_code), '')),
      country_name = nullif(btrim(target_country_name), ''),
      state_name = nullif(btrim(target_state_name), ''),
      lga_name = nullif(btrim(target_lga_name), ''),
      city_name = nullif(btrim(target_city_name), ''),
      town_name = nullif(btrim(target_town_name), ''),
      locality_name = nullif(btrim(target_locality_name), ''),
      center_latitude = target_center_latitude,
      center_longitude = target_center_longitude,
      radius_meters = target_radius_meters,
      polygon_geojson = target_polygon_geojson,
      priority = target_area_priority,
      status = target_area_status,
      metadata = coalesce(metadata, '{}'::jsonb) || target_metadata,
      updated_at = timezone('utc', now())
    where id = resolved_area_id;

    select key into resolved_area_key from public.service_areas where id = resolved_area_id;
  end if;

  select id into existing_rule_id
  from public.lpg_service_area_rules
  where source = target_source
    and idempotency_key = target_idempotency_key || ':rule'
  limit 1;

  if existing_rule_id is not null then
    return jsonb_build_object(
      'areaId', resolved_area_id,
      'areaKey', resolved_area_key,
      'ruleId', existing_rule_id,
      'effect', target_effect,
      'status', target_rule_status
    );
  end if;

  if target_rule_status = 'active' then
    update public.lpg_service_area_rules
    set status = 'inactive', updated_at = timezone('utc', now())
    where area_id = resolved_area_id
      and status = 'active';
  end if;

  insert into public.lpg_service_area_rules (
    area_id, effect, priority, status, effective_from, effective_until,
    metadata, source, idempotency_key
  ) values (
    resolved_area_id, target_effect, target_rule_priority, target_rule_status,
    target_effective_from, target_effective_until,
    target_metadata, target_source, target_idempotency_key || ':rule'
  ) returning id into resolved_rule_id;

  return jsonb_build_object(
    'areaId', resolved_area_id,
    'areaKey', resolved_area_key,
    'ruleId', resolved_rule_id,
    'effect', target_effect,
    'status', target_rule_status
  );
end;
$$;

revoke all on function public.configure_lpg_service_coverage(text,text,text,text,uuid,text,uuid,text,text,text,text,text,text,text,double precision,double precision,double precision,jsonb,integer,integer,text,text,timestamptz,timestamptz,jsonb,text) from public, anon;
grant execute on function public.configure_lpg_service_coverage(text,text,text,text,uuid,text,uuid,text,text,text,text,text,text,text,double precision,double precision,double precision,jsonb,integer,integer,text,text,timestamptz,timestamptz,jsonb,text) to authenticated, service_role;

create or replace function public.set_lpg_service_coverage_status(
  target_area_id uuid,
  target_status text,
  target_reason text,
  target_idempotency_key text,
  target_source text default 'skima.lpg.service_coverage_admin'
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not public.can_manage_lpg_service_coverage() then
    raise exception using errcode = '42501', message = 'LPG service coverage management permission is required';
  end if;
  if target_status not in ('active','inactive') then
    raise exception using errcode = '22023', message = 'coverage status must be active or inactive';
  end if;
  if target_reason is null or btrim(target_reason) = '' then
    raise exception using errcode = '22023', message = 'reason is required';
  end if;

  update public.service_areas
  set
    status = target_status,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'lastStatusReason', btrim(target_reason),
      'lastStatusChangedAt', timezone('utc', now()),
      'lastStatusChangedBy', auth.uid()
    ),
    updated_at = timezone('utc', now())
  where id = target_area_id;

  if not found then
    raise exception using errcode = '22023', message = 'coverage area could not be found';
  end if;

  update public.lpg_service_area_rules
  set
    status = target_status,
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'lastStatusReason', btrim(target_reason),
      'statusChangeIdempotencyKey', target_idempotency_key,
      'statusChangeSource', target_source
    ),
    updated_at = timezone('utc', now())
  where area_id = target_area_id
    and status <> target_status;

  return target_area_id;
end;
$$;

revoke all on function public.set_lpg_service_coverage_status(uuid,text,text,text,text) from public, anon;
grant execute on function public.set_lpg_service_coverage_status(uuid,text,text,text,text) to authenticated, service_role;
