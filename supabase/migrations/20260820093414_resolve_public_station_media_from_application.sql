create or replace function public.admin_approve_public_station_media(
  target_media_asset_id uuid,
  target_station_branch_id uuid,
  target_is_primary boolean default false,
  target_display_order integer default 0
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  media_record record;
  station_record record;
  submission_record record;
  source_application_id uuid;
  resolved_station_branch_id uuid;
  link_id uuid;
begin
  if auth.role() <> 'service_role'
     and not public.can_review_applications()
     and not public.can_manage_lpg_operations() then
    raise exception 'admin permission required to approve public station media';
  end if;

  if target_display_order < 0 then
    raise exception 'target_display_order must be zero or greater';
  end if;

  -- Preferred path: caller supplied the actual LPG station branch id.
  select station.* into station_record
  from public.lpg_station_branches station
  where station.id = target_station_branch_id;

  -- Backward-compatible path: older admin clients pass the source application id.
  if not found then
    select station.* into station_record
    from public.lpg_station_branches station
    where station.metadata ->> 'source_application_id' = target_station_branch_id::text
       or station.metadata ->> 'activated_from_application_id' = target_station_branch_id::text
    order by station.created_at asc
    limit 1;
  end if;

  if not found then
    raise exception 'Activate the station before publishing its public photos.';
  end if;

  resolved_station_branch_id := station_record.id;

  source_application_id := case
    when coalesce(station_record.metadata ->> 'source_application_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (station_record.metadata ->> 'source_application_id')::uuid
    when coalesce(station_record.metadata ->> 'activated_from_application_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (station_record.metadata ->> 'activated_from_application_id')::uuid
    else null
  end;

  if source_application_id is null then
    raise exception 'station has no source application for public media review';
  end if;

  select media.* into media_record
  from public.media_assets media
  where media.id = target_media_asset_id
    and media.status = 'active';

  if not found then
    raise exception 'media asset not found';
  end if;

  select submission.*, requirement.key as requirement_key,
         requirement.metadata as requirement_metadata
  into submission_record
  from public.document_submissions submission
  join public.document_requirements requirement on requirement.id = submission.requirement_id
  where submission.application_id = source_application_id
    and submission.media_asset_id = target_media_asset_id
    and submission.status = 'approved'
  order by submission.reviewed_at desc nulls last, submission.created_at desc
  limit 1;

  if not found then
    raise exception 'media must be an approved document submission from this station application';
  end if;

  if coalesce(submission_record.requirement_metadata ->> 'privacy_classification','PRIVATE_VERIFICATION') <> 'PUBLIC_PROFILE_CANDIDATE' then
    raise exception 'only public-profile candidate media can be approved for public display';
  end if;

  if media_record.privacy_classification in ('PRIVATE_KYC','PRIVATE_VERIFICATION','INTERNAL_ONLY') then
    raise exception 'private or internal media cannot be approved for public display';
  end if;

  if target_is_primary then
    update public.entity_media_links
    set is_primary = false,
        updated_at = timezone('utc', now())
    where entity_type = 'station'
      and entity_id = resolved_station_branch_id
      and media_role = 'station.photo.public'
      and status = 'active'
      and is_primary;
  end if;

  update public.media_assets
  set privacy_classification = 'PUBLIC_APPROVED',
      organization_id = coalesce(organization_id, station_record.organization_id),
      metadata = metadata || jsonb_build_object(
        'public_approved_at', timezone('utc', now()),
        'public_approved_by', auth.uid(),
        'public_station_branch_id', resolved_station_branch_id,
        'source_application_id', source_application_id
      ),
      updated_at = timezone('utc', now())
  where id = target_media_asset_id;

  insert into public.entity_media_links (
    organization_id,entity_type,entity_id,media_asset_id,media_role,is_primary,display_order,
    status,metadata,source,idempotency_key,created_by
  )
  values (
    station_record.organization_id,'station',resolved_station_branch_id,target_media_asset_id,
    'station.photo.public',target_is_primary,target_display_order,'active',
    jsonb_build_object(
      'application_id',source_application_id,
      'requirement_key',submission_record.requirement_key,
      'public_approved',true
    ),
    'platform.admin_curation',
    'public-station-media:' || resolved_station_branch_id::text || ':' || target_media_asset_id::text,
    auth.uid()
  )
  on conflict (entity_type,entity_id,media_asset_id,media_role) do update
  set is_primary = excluded.is_primary,
      display_order = excluded.display_order,
      status = 'active',
      metadata = public.entity_media_links.metadata || excluded.metadata,
      updated_at = timezone('utc', now())
  returning id into link_id;

  return link_id;
end;
$function$;
