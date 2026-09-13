begin;

create or replace function public.can_manage_public_entity_media(
  target_entity_type text,
  target_entity_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when auth.role() = 'service_role' then true
    when auth.uid() is null or target_entity_id is null then false
    when target_entity_type = 'profile' then target_entity_id = auth.uid()
    when target_entity_type = 'driver' then exists (
      select 1
      from public.driver_profiles driver
      where driver.id = target_entity_id
        and driver.user_id = auth.uid()
    )
    when target_entity_type = 'station' then public.user_can_operate_lpg_station_branch(
      auth.uid(),
      target_entity_id,
      'lpg.stations.manage'
    )
    else false
  end;
$$;

create or replace function public.set_public_entity_media(
  target_entity_type text,
  target_entity_id uuid,
  target_media_asset_id uuid,
  target_media_role text,
  target_fit text default 'cover',
  target_is_primary boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  media_record record;
  station_org_id uuid;
  link_id uuid;
  resolved_role text := lower(nullif(btrim(target_media_role), ''));
  resolved_fit text := lower(coalesce(nullif(btrim(target_fit), ''), 'cover'));
  resolved_source text := 'skima.public_entity_media';
begin
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'authentication is required';
  end if;

  if target_entity_type not in ('profile','driver','station') then
    raise exception 'public entity media type is not supported';
  end if;

  if target_entity_id is null or target_media_asset_id is null then
    raise exception 'entity and media identifiers are required';
  end if;

  if not public.can_manage_public_entity_media(target_entity_type, target_entity_id) then
    raise exception 'public entity media management permission is required';
  end if;

  if resolved_role is null or not (
    (target_entity_type = 'profile' and resolved_role = 'profile.photo.public')
    or (target_entity_type = 'driver' and resolved_role = 'driver.photo.public')
    or (target_entity_type = 'station' and resolved_role in ('station.logo.public','station.photo.public'))
  ) then
    raise exception 'public media role is not allowed for this entity';
  end if;

  if resolved_fit not in ('cover','contain','center') then
    raise exception 'target_fit must be cover, contain, or center';
  end if;

  select media.*
  into media_record
  from public.media_assets media
  where media.id = target_media_asset_id
    and media.status = 'active';

  if not found then
    raise exception 'active media asset was not found';
  end if;

  if auth.role() <> 'service_role' and media_record.owner_user_id <> auth.uid() then
    raise exception 'only the media owner can publish this image';
  end if;

  if coalesce(media_record.content_type, '') not like 'image/%' then
    raise exception 'public entity media must be an image';
  end if;

  -- Never allow an existing confidential verification/KYC asset to be silently
  -- repurposed as a public profile image. Public images must be uploaded through
  -- the dedicated public image flow and therefore start INTERNAL_ONLY or already
  -- belong to a public-profile class.
  if media_record.privacy_classification in ('PRIVATE_KYC','PRIVATE_VERIFICATION') then
    raise exception 'confidential verification media cannot be used as a public profile image';
  end if;

  if target_entity_type = 'station' then
    select station.organization_id
    into station_org_id
    from public.lpg_station_branches station
    where station.id = target_entity_id;

    if station_org_id is null then
      raise exception 'station branch was not found';
    end if;
  end if;

  update public.media_assets
  set privacy_classification = 'PUBLIC_APPROVED',
      metadata = metadata || jsonb_build_object(
        'publicEntityType', target_entity_type,
        'publicEntityId', target_entity_id,
        'publicMediaRole', resolved_role,
        'publicFit', resolved_fit
      ),
      updated_at = timezone('utc', now())
  where id = target_media_asset_id;

  if coalesce(target_is_primary, true) then
    update public.entity_media_links
    set is_primary = false,
        status = 'archived',
        updated_at = timezone('utc', now())
    where entity_type = target_entity_type
      and entity_id = target_entity_id
      and media_role = resolved_role
      and status = 'active';
  end if;

  insert into public.entity_media_links (
    organization_id,
    entity_type,
    entity_id,
    media_asset_id,
    media_role,
    is_primary,
    display_order,
    status,
    metadata,
    source,
    idempotency_key,
    created_by
  )
  values (
    station_org_id,
    target_entity_type,
    target_entity_id,
    target_media_asset_id,
    resolved_role,
    coalesce(target_is_primary, true),
    0,
    'active',
    jsonb_build_object(
      'fit', resolved_fit,
      'publicManagedByUser', auth.uid(),
      'publicManagedAt', timezone('utc', now())
    ),
    resolved_source,
    target_entity_type || ':' || target_entity_id::text || ':' || resolved_role || ':' || target_media_asset_id::text,
    auth.uid()
  )
  on conflict (entity_type, entity_id, media_asset_id, media_role)
  do update set
    organization_id = excluded.organization_id,
    is_primary = excluded.is_primary,
    display_order = excluded.display_order,
    status = 'active',
    metadata = public.entity_media_links.metadata || excluded.metadata,
    updated_at = timezone('utc', now())
  returning id into link_id;

  return link_id;
end;
$$;

create or replace function public.remove_public_entity_media(
  target_entity_type text,
  target_entity_id uuid,
  target_media_role text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_role text := lower(nullif(btrim(target_media_role), ''));
  affected integer := 0;
begin
  if auth.uid() is null and auth.role() <> 'service_role' then
    raise exception 'authentication is required';
  end if;

  if not public.can_manage_public_entity_media(target_entity_type, target_entity_id) then
    raise exception 'public entity media management permission is required';
  end if;

  if resolved_role is null or not (
    (target_entity_type = 'profile' and resolved_role = 'profile.photo.public')
    or (target_entity_type = 'driver' and resolved_role = 'driver.photo.public')
    or (target_entity_type = 'station' and resolved_role in ('station.logo.public','station.photo.public'))
  ) then
    raise exception 'public media role is not allowed for this entity';
  end if;

  with archived as (
    update public.entity_media_links
    set status = 'archived',
        is_primary = false,
        updated_at = timezone('utc', now())
    where entity_type = target_entity_type
      and entity_id = target_entity_id
      and media_role = resolved_role
      and status = 'active'
    returning media_asset_id
  )
  select count(*)::integer into affected from archived;

  -- If an image is no longer linked anywhere publicly, return the uploader-owned
  -- asset to INTERNAL_ONLY instead of leaving a stale PUBLIC_APPROVED object.
  update public.media_assets media
  set privacy_classification = 'INTERNAL_ONLY',
      updated_at = timezone('utc', now())
  where media.owner_user_id = auth.uid()
    and media.privacy_classification = 'PUBLIC_APPROVED'
    and not exists (
      select 1
      from public.entity_media_links link
      where link.media_asset_id = media.id
        and link.status = 'active'
        and link.media_role like '%.public'
    );

  return affected;
end;
$$;

revoke all on function public.can_manage_public_entity_media(text,uuid) from public, anon, authenticated;
grant execute on function public.can_manage_public_entity_media(text,uuid) to service_role;

revoke all on function public.set_public_entity_media(text,uuid,uuid,text,text,boolean) from public, anon;
grant execute on function public.set_public_entity_media(text,uuid,uuid,text,text,boolean) to authenticated, service_role;

revoke all on function public.remove_public_entity_media(text,uuid,text) from public, anon;
grant execute on function public.remove_public_entity_media(text,uuid,text) to authenticated, service_role;

commit;
