create or replace function public.configure_universal_geography(
  p_geography_id uuid,
  p_parent_id uuid,
  p_level_id uuid,
  p_canonical_name text,
  p_country_code text,
  p_boundary_geojson jsonb,
  p_source text,
  p_external_reference text,
  p_status text default 'draft',
  p_aliases jsonb default '[]'::jsonb,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $function$
declare
  resolved_id uuid;
  boundary extensions.geography(MultiPolygon,4326);
  normalized_name_value text;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.has_permission('platform.geography.manage', null) then
    raise exception using errcode = '42501',
      message = 'geography management permission required';
  end if;

  if nullif(btrim(p_canonical_name), '') is null
     or p_country_code is null
     or p_country_code !~ '^[A-Z]{2}$'
     or nullif(btrim(p_source), '') is null
     or p_status is null
     or p_status not in ('draft', 'active', 'inactive', 'retired')
     or jsonb_typeof(coalesce(p_aliases, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_metadata, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023',
      message = 'valid geography fields are required';
  end if;

  if not exists (
    select 1
    from public.geography_levels
    where id = p_level_id
      and status = 'active'
  ) then
    raise exception using errcode = '22023',
      message = 'active geography level is required';
  end if;

  normalized_name_value := public.normalize_geography_token(p_canonical_name);
  if normalized_name_value is null then
    raise exception using errcode = '22023',
      message = 'geography name must contain searchable characters';
  end if;

  if p_boundary_geojson is not null then
    begin
      boundary := extensions.st_multi(
        extensions.st_setsrid(
          extensions.st_geomfromgeojson(p_boundary_geojson::text),
          4326
        )
      )::extensions.geography;
    exception when others then
      raise exception using errcode = '22023',
        message = 'boundary must be valid Polygon or MultiPolygon GeoJSON';
    end;
  end if;

  if p_geography_id is null then
    select geography.id
    into resolved_id
    from public.geographies geography
    where geography.parent_id is not distinct from p_parent_id
      and geography.geography_level_id = p_level_id
      and geography.country_code = p_country_code
      and geography.normalized_name = normalized_name_value
      and geography.status <> 'retired'
    order by
      case geography.status
        when 'active' then 0
        when 'draft' then 1
        when 'inactive' then 2
        else 3
      end,
      geography.created_at,
      geography.id
    limit 1
    for update;

    if resolved_id is not null then
      update public.geographies geography
      set boundary_geometry = coalesce(geography.boundary_geometry, boundary),
          centroid = case
            when geography.boundary_geometry is null and boundary is not null
              then extensions.st_pointonsurface(boundary::extensions.geometry)::extensions.geography
            else geography.centroid
          end,
          status = case
            when geography.status = 'active' then 'active'
            else p_status
          end,
          updated_at = timezone('utc', now())
      where geography.id = resolved_id;

      return resolved_id;
    end if;

    begin
      insert into public.geographies (
        parent_id,
        geography_level_id,
        canonical_name,
        normalized_name,
        country_code,
        boundary_geometry,
        centroid,
        source,
        external_reference,
        aliases,
        metadata,
        status
      )
      values (
        p_parent_id,
        p_level_id,
        btrim(p_canonical_name),
        normalized_name_value,
        p_country_code,
        boundary,
        case
          when boundary is null then null
          else extensions.st_pointonsurface(boundary::extensions.geometry)::extensions.geography
        end,
        btrim(p_source),
        nullif(btrim(p_external_reference), ''),
        coalesce(p_aliases, '[]'::jsonb),
        coalesce(p_metadata, '{}'::jsonb),
        p_status
      )
      returning id into resolved_id;
    exception when unique_violation then
      select geography.id
      into resolved_id
      from public.geographies geography
      where geography.parent_id is not distinct from p_parent_id
        and geography.geography_level_id = p_level_id
        and geography.country_code = p_country_code
        and geography.normalized_name = normalized_name_value
        and geography.status = 'active'
      order by geography.created_at, geography.id
      limit 1
      for update;

      if resolved_id is null then
        raise;
      end if;
    end;
  else
    update public.geographies geography
    set parent_id = p_parent_id,
        geography_level_id = p_level_id,
        canonical_name = btrim(p_canonical_name),
        normalized_name = normalized_name_value,
        country_code = p_country_code,
        boundary_geometry = coalesce(boundary, geography.boundary_geometry),
        centroid = case
          when boundary is null then geography.centroid
          else extensions.st_pointonsurface(boundary::extensions.geometry)::extensions.geography
        end,
        source = btrim(p_source),
        external_reference = nullif(btrim(p_external_reference), ''),
        aliases = coalesce(p_aliases, '[]'::jsonb),
        metadata = coalesce(p_metadata, '{}'::jsonb),
        status = p_status,
        updated_at = timezone('utc', now())
    where geography.id = p_geography_id
    returning geography.id into resolved_id;

    if resolved_id is null then
      raise exception using errcode = 'P0002',
        message = 'geography was not found';
    end if;
  end if;

  return resolved_id;
end;
$function$;
