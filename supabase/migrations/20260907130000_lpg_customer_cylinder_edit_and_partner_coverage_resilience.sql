begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Keep every live LPG partner application type projection-compatible, including
-- older type keys that predate the explicit operationalCoverage metadata.
update public.application_type_definitions
set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
  'operationalCoverage',
  jsonb_build_object(
    'entityType',
      case
        when coalesce(metadata ->> 'workspace', '') = 'station' or key like 'application.lpg.station%' then 'STATION'
        else 'DRIVER'
      end,
    'serviceKey', 'lpg'
  )
),
updated_at = timezone('utc', now())
where key like 'application.lpg.driver%'
   or key like 'application.lpg.station%';

create or replace function public.sync_universal_application_location_and_coverage()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  app record;
  service jsonb;
  item jsonb;
  point extensions.geography(Point,4326);
  polygon extensions.geography(MultiPolygon,4326);
  coverage_config jsonb;
  configured_entity_type text;
  configured_service_key text;
  workspace_key text;
begin
  select
    record.*,
    definition.key as application_type_key,
    definition.metadata as application_type_metadata
  into app
  from public.application_records record
  join public.application_type_definitions definition
    on definition.id = record.application_type_id
  where record.id = new.application_id;

  if not found then
    return new;
  end if;

  -- This projector belongs only to LPG partner applications. Other application
  -- families must never fail because they happen to store a service object.
  if app.application_type_key not like 'application.lpg.driver%'
     and app.application_type_key not like 'application.lpg.station%' then
    return new;
  end if;

  workspace_key := coalesce(
    nullif(app.application_type_metadata ->> 'workspace', ''),
    case
      when app.application_type_key like 'application.lpg.driver%' then 'driver'
      when app.application_type_key like 'application.lpg.station%' then 'station'
      else null
    end
  );

  coverage_config := coalesce(
    app.application_type_metadata -> 'operationalCoverage',
    '{}'::jsonb
  );
  configured_entity_type := coalesce(
    nullif(coverage_config ->> 'entityType', ''),
    case workspace_key
      when 'driver' then 'DRIVER'
      when 'station' then 'STATION'
      else null
    end
  );
  configured_service_key := coalesce(
    nullif(coverage_config ->> 'serviceKey', ''),
    'lpg'
  );

  if configured_entity_type not in ('DRIVER','STATION') then
    raise exception using errcode='23514',
      message='This LPG partner application could not resolve its service-area owner type.';
  end if;

  service := coalesce(new.payload -> 'service', '{}'::jsonb);
  if jsonb_typeof(service -> 'coverageRequests') is distinct from 'array' then
    return new;
  end if;

  delete from public.application_operational_coverage_requests
  where application_id = new.application_id
    and status = 'REQUESTED';

  for item in
    select value from jsonb_array_elements(service -> 'coverageRequests')
  loop
    point := null;
    polygon := null;

    if item ->> 'type' not in ('ADMIN_GEOGRAPHY','RADIUS','CUSTOM_ZONE') then
      raise exception using errcode='22023',
        message='A requested service area has an unsupported coverage type.';
    end if;

    if item ->> 'type' = 'RADIUS' then
      if nullif(item ->> 'latitude','') is null
         or nullif(item ->> 'longitude','') is null
         or nullif(item ->> 'radiusMeters','') is null then
        raise exception using errcode='22023',
          message='A radius service area requires latitude, longitude and radius.';
      end if;
      point := extensions.st_setsrid(
        extensions.st_makepoint(
          (item ->> 'longitude')::numeric,
          (item ->> 'latitude')::numeric
        ),
        4326
      )::extensions.geography;
    elsif item ->> 'type' = 'CUSTOM_ZONE' then
      if item -> 'geometry' is null then
        raise exception using errcode='22023',
          message='A custom service area requires geometry.';
      end if;
      polygon := extensions.st_multi(
        extensions.st_setsrid(
          extensions.st_geomfromgeojson((item -> 'geometry')::text),
          4326
        )
      )::extensions.geography;
    elsif nullif(item ->> 'geographyId','') is null then
      raise exception using errcode='22023',
        message='Choose a valid mapped service area.';
    end if;

    insert into public.application_operational_coverage_requests (
      application_id,
      application_version_id,
      applicant_user_id,
      entity_type,
      service_key,
      coverage_type,
      geography_id,
      center_point,
      radius_meters,
      coverage_geometry,
      request_snapshot
    )
    values (
      new.application_id,
      new.id,
      app.applicant_user_id,
      configured_entity_type,
      configured_service_key,
      item ->> 'type',
      case when item ->> 'type' = 'ADMIN_GEOGRAPHY'
        then nullif(item ->> 'geographyId','')::uuid
        else null
      end,
      point,
      case when item ->> 'type' = 'RADIUS'
        then nullif(item ->> 'radiusMeters','')::numeric
        else null
      end,
      polygon,
      item
    );
  end loop;

  return new;
end;
$$;

-- Existing cylinder media attachment used a history event label that is not
-- part of the canonical cylinder history contract. Keep the operation owner-
-- scoped and record the change as the canonical "updated" event.
create or replace function public.attach_lpg_cylinder_media(
  target_cylinder_id uuid,
  target_media_asset_id uuid,
  target_media_role text,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.mobile'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cylinder_record record;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='authenticated user is required';
  end if;

  if target_media_role not in ('image', 'ownership_proof') then
    raise exception using errcode='22023', message='target_media_role is not supported';
  end if;

  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception using errcode='22023', message='target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception using errcode='22023', message='target_metadata must be a JSON object';
  end if;

  select cylinder.*
  into cylinder_record
  from public.lpg_cylinders cylinder
  where cylinder.id = target_cylinder_id
  for update;

  if not found then
    raise exception using errcode='P0002', message='Cylinder was not found.';
  end if;

  if cylinder_record.owner_user_id is distinct from auth.uid()
     and not public.can_manage_lpg_operations() then
    raise exception using errcode='42501', message='Cylinder owner permission is required.';
  end if;

  if not exists (
    select 1
    from public.media_assets media
    where media.id = target_media_asset_id
      and media.status = 'active'
      and (
        media.owner_user_id = auth.uid()
        or public.can_manage_lpg_operations()
      )
  ) then
    raise exception using errcode='42501',
      message='The selected image is not an active media asset owned by this account.';
  end if;

  update public.lpg_cylinders
  set image_asset_ids = case
        when target_media_role = 'image' then
          array_append(
            array_remove(coalesce(image_asset_ids, array[]::uuid[]), target_media_asset_id),
            target_media_asset_id
          )
        else image_asset_ids
      end,
      ownership_proof_media_asset_id = case
        when target_media_role = 'ownership_proof' then target_media_asset_id
        else ownership_proof_media_asset_id
      end,
      metadata = metadata || target_metadata || jsonb_build_object(
        'last_media_source', target_source,
        'last_media_role', target_media_role
      ),
      updated_at = timezone('utc', now())
  where id = target_cylinder_id;

  perform public.record_lpg_cylinder_history(
    target_cylinder_id,
    'updated',
    target_idempotency_key || ':history',
    null,
    null,
    null,
    null,
    target_metadata || jsonb_build_object(
      'update_kind', 'media_attached',
      'media_asset_id', target_media_asset_id,
      'media_role', target_media_role,
      'source', target_source
    ),
    '{}'::jsonb
  );

  return target_cylinder_id;
end;
$$;

create or replace function public.set_customer_lpg_cylinder_primary_media(
  target_cylinder_id uuid,
  target_media_asset_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.customer_media'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cylinder_record record;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='authenticated user is required';
  end if;

  select *
  into cylinder_record
  from public.lpg_cylinders
  where id = target_cylinder_id
  for update;

  if not found then
    raise exception using errcode='P0002', message='Cylinder was not found.';
  end if;

  if cylinder_record.owner_user_id is distinct from auth.uid() then
    raise exception using errcode='42501', message='You can only update your own cylinder image.';
  end if;

  if not exists (
    select 1
    from public.media_assets media
    where media.id = target_media_asset_id
      and media.owner_user_id = auth.uid()
      and media.status = 'active'
  ) then
    raise exception using errcode='42501', message='Choose an image uploaded by this account.';
  end if;

  update public.lpg_cylinders
  set image_asset_ids = array_prepend(
        target_media_asset_id,
        array_remove(coalesce(image_asset_ids, array[]::uuid[]), target_media_asset_id)
      ),
      metadata = metadata || target_metadata || jsonb_build_object(
        'primary_image_asset_id', target_media_asset_id,
        'primary_image_updated_at', timezone('utc', now())
      ),
      updated_at = timezone('utc', now())
  where id = target_cylinder_id;

  perform public.record_lpg_cylinder_history(
    target_cylinder_id,
    'updated',
    target_idempotency_key || ':history',
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'update_kind', 'primary_image_changed',
      'media_asset_id', target_media_asset_id,
      'source', target_source
    ) || target_metadata,
    '{}'::jsonb
  );

  return target_cylinder_id;
end;
$$;

create or replace function public.update_customer_lpg_cylinder_details(
  target_cylinder_id uuid,
  target_idempotency_key text,
  target_display_name text default null,
  target_brand text default null,
  target_manufacturer text default null,
  target_colour text default null,
  target_serial_number text default null,
  target_condition_status text default null,
  target_valve_type text default null,
  target_notes text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  cylinder_record record;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='authenticated user is required';
  end if;

  if nullif(btrim(target_idempotency_key), '') is null then
    raise exception using errcode='22023', message='idempotency key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception using errcode='22023', message='metadata must be a JSON object';
  end if;

  select *
  into cylinder_record
  from public.lpg_cylinders
  where id = target_cylinder_id
  for update;

  if not found then
    raise exception using errcode='P0002', message='Cylinder was not found.';
  end if;

  if cylinder_record.owner_user_id is distinct from auth.uid() then
    raise exception using errcode='42501', message='You can only update your own cylinder.';
  end if;

  if target_display_name is not null
     and char_length(btrim(target_display_name)) < 2 then
    raise exception using errcode='22023', message='Cylinder name must contain at least two characters.';
  end if;

  if target_condition_status is not null
     and target_condition_status not in ('unknown','good','fair','damaged','unsafe','expired') then
    raise exception using errcode='22023', message='Cylinder condition is not supported.';
  end if;

  update public.lpg_cylinders
  set display_name = case
        when target_display_name is null then display_name
        else btrim(target_display_name)
      end,
      brand = case when target_brand is null then brand else nullif(btrim(target_brand),'') end,
      manufacturer = case when target_manufacturer is null then manufacturer else nullif(btrim(target_manufacturer),'') end,
      colour = case when target_colour is null then colour else nullif(btrim(target_colour),'') end,
      serial_number = case when target_serial_number is null then serial_number else nullif(btrim(target_serial_number),'') end,
      condition_status = coalesce(target_condition_status, condition_status),
      valve_type = case when target_valve_type is null then valve_type else nullif(btrim(target_valve_type),'') end,
      notes = case when target_notes is null then notes else nullif(btrim(target_notes),'') end,
      metadata = metadata || target_metadata || jsonb_build_object(
        'customer_details_updated_at', timezone('utc', now())
      ),
      updated_at = timezone('utc', now())
  where id = target_cylinder_id;

  perform public.record_lpg_cylinder_history(
    target_cylinder_id,
    'updated',
    target_idempotency_key || ':history',
    null,
    null,
    null,
    null,
    jsonb_build_object(
      'update_kind', 'customer_details_changed',
      'source', 'skima.lpg.customer'
    ),
    '{}'::jsonb
  );

  return target_cylinder_id;
end;
$$;

revoke all on function public.set_customer_lpg_cylinder_primary_media(uuid,uuid,text,jsonb,text)
from public, anon;
grant execute on function public.set_customer_lpg_cylinder_primary_media(uuid,uuid,text,jsonb,text)
to authenticated, service_role;

revoke all on function public.update_customer_lpg_cylinder_details(uuid,text,text,text,text,text,text,text,text,text,jsonb)
from public, anon;
grant execute on function public.update_customer_lpg_cylinder_details(uuid,text,text,text,text,text,text,text,text,text,jsonb)
to authenticated, service_role;

commit;
