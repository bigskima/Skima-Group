begin;

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
    raise exception 'authenticated user is required';
  end if;

  if target_media_role not in ('image', 'ownership_proof') then
    raise exception 'target_media_role is not supported';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select cylinder.*
  into cylinder_record
  from public.lpg_cylinders cylinder
  where cylinder.id = target_cylinder_id
  for update;

  if not found then
    raise exception 'target_cylinder_id must reference an LPG cylinder';
  end if;

  if cylinder_record.owner_user_id is distinct from auth.uid()
    and not public.can_manage_lpg_operations() then
    raise exception 'LPG cylinder owner permission is required';
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
    raise exception 'target_media_asset_id must reference an active owned media asset';
  end if;

  update public.lpg_cylinders
  set image_asset_ids = case
        when target_media_role = 'image' then (
          select array_agg(distinct media_id)
          from unnest(coalesce(image_asset_ids, array[]::uuid[]) || target_media_asset_id) media_id
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
    'media_attached',
    target_idempotency_key || ':history',
    null,
    null,
    null,
    null,
    target_metadata || jsonb_build_object(
      'media_asset_id', target_media_asset_id,
      'media_role', target_media_role,
      'source', target_source
    ),
    '{}'::jsonb
  );

  return target_cylinder_id;
end;
$$;

revoke all on function public.attach_lpg_cylinder_media(uuid, uuid, text, text, jsonb, text)
from public;

grant execute on function public.attach_lpg_cylinder_media(uuid, uuid, text, text, jsonb, text)
to authenticated, service_role;

commit;
