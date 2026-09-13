begin;

create or replace function public.sync_profile_avatar_from_public_media()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_profile_id uuid;
  target_entity_type text;
  target_media_role text;
begin
  if tg_op = 'DELETE' then
    target_profile_id := old.entity_id;
    target_entity_type := old.entity_type;
    target_media_role := old.media_role;
  else
    target_profile_id := new.entity_id;
    target_entity_type := new.entity_type;
    target_media_role := new.media_role;
  end if;

  if target_entity_type <> 'profile' or target_media_role <> 'profile.photo.public' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  update public.profiles profile
  set avatar_url = (
        select link.media_asset_id::text
        from public.entity_media_links link
        where link.entity_type = 'profile'
          and link.entity_id = target_profile_id
          and link.media_role = 'profile.photo.public'
          and link.status = 'active'
          and link.is_primary = true
        order by link.updated_at desc nulls last, link.created_at desc
        limit 1
      ),
      updated_at = timezone('utc', now())
  where profile.id = target_profile_id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.sync_profile_avatar_from_public_media() from public, anon, authenticated;
grant execute on function public.sync_profile_avatar_from_public_media() to service_role;

drop trigger if exists entity_media_links_sync_profile_avatar on public.entity_media_links;
create trigger entity_media_links_sync_profile_avatar
after insert or update or delete on public.entity_media_links
for each row execute function public.sync_profile_avatar_from_public_media();

-- Existing account avatars were uploaded through the dedicated profile-avatar flow.
-- Backfill only user-owned, active image assets that are not confidential KYC or
-- verification media; no arbitrary document/image is promoted by this migration.
update public.media_assets media
set privacy_classification = 'PUBLIC_APPROVED',
    metadata = coalesce(media.metadata, '{}'::jsonb) || jsonb_build_object(
      'publicEntityType', 'profile',
      'publicEntityId', profile.id,
      'publicMediaRole', 'profile.photo.public',
      'publicFit', 'cover',
      'compatibilityBackfill', true
    ),
    updated_at = timezone('utc', now())
from public.profiles profile
where media.id::text = profile.avatar_url
  and media.owner_user_id = profile.id
  and media.status = 'active'
  and coalesce(media.content_type, '') like 'image/%'
  and media.privacy_classification not in ('PRIVATE_KYC','PRIVATE_VERIFICATION');

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
select
  null,
  'profile',
  profile.id,
  media.id,
  'profile.photo.public',
  true,
  0,
  'active',
  jsonb_build_object(
    'fit', 'cover',
    'compatibilityBackfill', true,
    'publicManagedByUser', profile.id,
    'publicManagedAt', timezone('utc', now())
  ),
  'skima.profile_avatar_compat.backfill',
  'profile:' || profile.id::text || ':profile.photo.public:' || media.id::text,
  profile.id
from public.profiles profile
join public.media_assets media
  on media.id::text = profile.avatar_url
 and media.owner_user_id = profile.id
where media.status = 'active'
  and coalesce(media.content_type, '') like 'image/%'
  and media.privacy_classification not in ('PRIVATE_KYC','PRIVATE_VERIFICATION')
  and not exists (
    select 1
    from public.entity_media_links existing
    where existing.entity_type = 'profile'
      and existing.entity_id = profile.id
      and existing.media_role = 'profile.photo.public'
      and existing.status = 'active'
  )
on conflict (entity_type, entity_id, media_asset_id, media_role)
do update set
  is_primary = true,
  status = 'active',
  display_order = 0,
  metadata = public.entity_media_links.metadata || excluded.metadata,
  updated_at = timezone('utc', now());

with current_photos as (
  select distinct on (link.entity_id)
    link.entity_id,
    link.media_asset_id
  from public.entity_media_links link
  where link.entity_type = 'profile'
    and link.media_role = 'profile.photo.public'
    and link.status = 'active'
    and link.is_primary = true
  order by link.entity_id, link.updated_at desc nulls last, link.created_at desc
)
update public.profiles profile
set avatar_url = current_photo.media_asset_id::text,
    updated_at = timezone('utc', now())
from current_photos current_photo
where profile.id = current_photo.entity_id;

commit;
