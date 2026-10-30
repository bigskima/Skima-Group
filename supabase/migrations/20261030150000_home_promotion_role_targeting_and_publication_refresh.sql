begin;

-- Enable the home promotion slot for every signed-in LPG workspace while
-- preserving explicit per-publication audience targeting.
update public.product_content_placements
set allowed_audiences = array['public','customer','driver','station']::text[],
    updated_at = timezone('utc', now())
where key = 'mobile.home.promotion'
  and status = 'active';

-- A publication may only target audiences enabled for its placement.
CREATE OR REPLACE FUNCTION public.configure_product_content_publication(target_publication_id uuid DEFAULT NULL::uuid, target_publication_key text DEFAULT NULL::text, target_placement_key text DEFAULT NULL::text, target_organization_id uuid DEFAULT NULL::uuid, target_module_key text DEFAULT NULL::text, target_audience_keys text[] DEFAULT ARRAY['public'::text], target_country_codes text[] DEFAULT '{}'::text[], target_regions text[] DEFAULT '{}'::text[], target_cities text[] DEFAULT '{}'::text[], target_title text DEFAULT NULL::text, target_body text DEFAULT NULL::text, target_accessibility_label text DEFAULT NULL::text, target_cta_label text DEFAULT NULL::text, target_cta_action jsonb DEFAULT '{}'::jsonb, target_media_asset_id uuid DEFAULT NULL::uuid, target_priority integer DEFAULT 0, target_status text DEFAULT 'draft'::text, target_starts_at timestamp with time zone DEFAULT NULL::timestamp with time zone, target_ends_at timestamp with time zone DEFAULT NULL::timestamp with time zone, target_metadata jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  publication_record_id uuid;
  normalized_audiences text[];
begin
  if auth.role() <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.content.manage', target_organization_id)
    and not public.has_permission('platform.content.manage', null) then
    raise exception 'not authorized to manage product content publications';
  end if;

  if target_publication_id is null then
    if target_publication_key is null or target_publication_key !~ '^[a-z][a-z0-9_.:-]{2,160}$' then
      raise exception 'target_publication_key must be a valid platform key';
    end if;
  end if;

  if target_placement_key is null or target_placement_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_placement_key must be a valid platform key';
  end if;

  if target_module_key is not null and target_module_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception 'target_module_key must be a valid platform key';
  end if;

  if target_status not in ('draft', 'published', 'paused', 'retired') then
    raise exception 'target_status must be draft, published, paused, or retired';
  end if;

  if target_cta_action is null or jsonb_typeof(target_cta_action) <> 'object' then
    raise exception 'target_cta_action must be a JSON object';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  if target_ends_at is not null and target_starts_at is not null and target_ends_at <= target_starts_at then
    raise exception 'target_ends_at must be after target_starts_at';
  end if;

  if not exists (
    select 1
    from public.product_content_placements placement
    where placement.key = target_placement_key
      and placement.status <> 'retired'
  ) then
    raise exception 'target_placement_key must reference an active content placement';
  end if;

  select coalesce(array_agg(distinct audience order by audience), array['public']::text[])
  into normalized_audiences
  from unnest(coalesce(target_audience_keys, array['public']::text[])) as audience_input(audience)
  where audience is not null and btrim(audience) <> '';

  if cardinality(normalized_audiences) = 0 then
    normalized_audiences := array['public']::text[];
  end if;

  if not exists (
    select 1
    from public.product_content_placements placement
    where placement.key = target_placement_key
      and placement.status = 'active'
      and normalized_audiences <@ coalesce(placement.allowed_audiences, array['public']::text[])
  ) then
    raise exception 'selected publication audiences must be enabled on the active content placement';
  end if;

  if target_publication_id is null then
    select publication.id into publication_record_id
    from public.product_content_publications publication
    where publication.publication_key = target_publication_key;
  else
    publication_record_id := target_publication_id;
  end if;

  if publication_record_id is null then
    insert into public.product_content_publications (
      publication_key,
      placement_key,
      organization_id,
      module_key,
      audience_keys,
      country_codes,
      regions,
      cities,
      title,
      body,
      accessibility_label,
      cta_label,
      cta_action,
      media_asset_id,
      priority,
      status,
      starts_at,
      ends_at,
      published_at,
      metadata,
      created_by,
      updated_by
    )
    values (
      target_publication_key,
      target_placement_key,
      target_organization_id,
      target_module_key,
      normalized_audiences,
      coalesce(target_country_codes, '{}'::text[]),
      coalesce(target_regions, '{}'::text[]),
      coalesce(target_cities, '{}'::text[]),
      target_title,
      target_body,
      target_accessibility_label,
      target_cta_label,
      target_cta_action,
      target_media_asset_id,
      coalesce(target_priority, 0),
      target_status,
      target_starts_at,
      target_ends_at,
      case when target_status = 'published' then timezone('utc', now()) else null end,
      target_metadata,
      auth.uid(),
      auth.uid()
    )
    returning id into publication_record_id;
  else
    update public.product_content_publications
    set publication_key = coalesce(target_publication_key, publication_key),
        placement_key = target_placement_key,
        organization_id = target_organization_id,
        module_key = target_module_key,
        audience_keys = normalized_audiences,
        country_codes = coalesce(target_country_codes, '{}'::text[]),
        regions = coalesce(target_regions, '{}'::text[]),
        cities = coalesce(target_cities, '{}'::text[]),
        title = target_title,
        body = target_body,
        accessibility_label = target_accessibility_label,
        cta_label = target_cta_label,
        cta_action = target_cta_action,
        media_asset_id = target_media_asset_id,
        priority = coalesce(target_priority, 0),
        status = target_status,
        starts_at = target_starts_at,
        ends_at = target_ends_at,
        published_at = case
          when target_status = 'published' and published_at is null then timezone('utc', now())
          else published_at
        end,
        metadata = target_metadata,
        revision = revision + 1,
        updated_by = auth.uid(),
        updated_at = timezone('utc', now())
    where id = publication_record_id
    returning id into publication_record_id;

    if publication_record_id is null then
      raise exception 'target publication was not found';
    end if;
  end if;

  return publication_record_id;
end;
$function$;

-- Enforce placement reach and publication targeting together at delivery time.
CREATE OR REPLACE FUNCTION public.read_published_product_content(target_placement_keys text[] DEFAULT NULL::text[], target_module_key text DEFAULT NULL::text, target_audience_key text DEFAULT 'public'::text, target_country_code text DEFAULT NULL::text, target_region text DEFAULT NULL::text, target_city text DEFAULT NULL::text, target_at timestamp with time zone DEFAULT timezone('utc'::text, now()))
 RETURNS TABLE(publication_id uuid, publication_key text, placement_key text, content_kind text, title text, body text, accessibility_label text, cta_label text, cta_action jsonb, media_asset_id uuid, media_storage_bucket text, media_storage_path text, media_content_type text, priority integer, revision integer, metadata jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select
    publication.id as publication_id,
    publication.publication_key,
    publication.placement_key,
    placement.content_kind,
    publication.title,
    publication.body,
    publication.accessibility_label,
    publication.cta_label,
    publication.cta_action,
    publication.media_asset_id,
    media.storage_bucket as media_storage_bucket,
    media.storage_path as media_storage_path,
    media.content_type as media_content_type,
    publication.priority,
    publication.revision,
    publication.metadata
  from public.product_content_publications publication
  join public.product_content_placements placement
    on placement.key = publication.placement_key
   and placement.status = 'active'
  left join public.media_assets media
    on media.id = publication.media_asset_id
   and media.status = 'active'
  where publication.status = 'published'
    and (target_placement_keys is null or publication.placement_key = any(target_placement_keys))
    and (publication.module_key is null or target_module_key is null or publication.module_key = target_module_key)
    and (
      'public' = any(placement.allowed_audiences)
      or coalesce(target_audience_key, 'public') = any(placement.allowed_audiences)
    )
    and ('public' = any(publication.audience_keys) or coalesce(target_audience_key, 'public') = any(publication.audience_keys))
    and (cardinality(publication.country_codes) = 0 or lower(coalesce(target_country_code, '')) = any(select lower(value) from unnest(publication.country_codes) value))
    and (cardinality(publication.regions) = 0 or lower(coalesce(target_region, '')) = any(select lower(value) from unnest(publication.regions) value))
    and (cardinality(publication.cities) = 0 or lower(coalesce(target_city, '')) = any(select lower(value) from unnest(publication.cities) value))
    and (publication.starts_at is null or publication.starts_at <= target_at)
    and (publication.ends_at is null or publication.ends_at > target_at)
  order by publication.placement_key, publication.priority desc, publication.revision desc, publication.published_at desc nulls last, publication.created_at desc;
$function$;

-- Status transitions are content revisions: re-publication must refresh the
-- ordering and freshness metadata used by Admin and the mobile cache.
CREATE OR REPLACE FUNCTION public.set_product_content_publication_status(target_publication_id uuid, target_status text, target_reason text DEFAULT NULL::text, target_idempotency_key text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  organization_record_id uuid;
  publication_record_id uuid;
begin
  if target_publication_id is null then
    raise exception 'target_publication_id is required';
  end if;

  if target_status not in ('draft', 'published', 'paused', 'retired') then
    raise exception 'target_status must be draft, published, paused, or retired';
  end if;

  select publication.organization_id
  into organization_record_id
  from public.product_content_publications publication
  where publication.id = target_publication_id;

  if not found then
    raise exception 'target publication was not found';
  end if;

  if auth.role() <> 'service_role'
    and not public.is_platform_super_admin()
    and not public.has_permission('platform.content.manage', organization_record_id)
    and not public.has_permission('platform.content.manage', null) then
    raise exception 'not authorized to change product content publication state';
  end if;

  if target_idempotency_key is not null and btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key cannot be blank';
  end if;

  update public.product_content_publications
  set status = target_status,
      published_at = case
        when target_status = 'published' and published_at is null then timezone('utc', now())
        else published_at
      end,
      metadata = case
        when target_reason is null or btrim(target_reason) = '' then metadata
        else jsonb_set(metadata, '{last_status_reason}', to_jsonb(target_reason), true)
      end,
      revision = revision + 1,
      updated_by = auth.uid(),
      updated_at = timezone('utc', now())
  where id = target_publication_id
  returning id into publication_record_id;

  return publication_record_id;
end;
$function$;

-- Re-version the currently published home promotion after the audience rollout.
update public.product_content_publications
set revision = revision + 1,
    updated_at = timezone('utc', now())
where placement_key = 'mobile.home.promotion'
  and status = 'published';

commit;
