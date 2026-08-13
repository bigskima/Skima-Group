insert into public.product_content_placements (
  key,
  display_name,
  surface_key,
  content_kind,
  allowed_audiences,
  constraints,
  metadata
)
values (
  'mobile.onboarding.customer.refill',
  'Customer onboarding — refill',
  'mobile.auth.onboarding',
  'onboarding',
  array['public','customer'],
  '{"recommended_aspect_ratio":"4:3"}'::jsonb,
  '{"phase_owner":3,"admin_upload_slot":"onboarding_refill"}'::jsonb
)
on conflict (key) do update
set display_name = excluded.display_name,
    surface_key = excluded.surface_key,
    content_kind = excluded.content_kind,
    allowed_audiences = excluded.allowed_audiences,
    constraints = public.product_content_placements.constraints || excluded.constraints,
    metadata = public.product_content_placements.metadata || excluded.metadata,
    updated_at = timezone('utc', now());

create or replace function public.read_published_product_content(
  target_placement_keys text[] default null,
  target_module_key text default null,
  target_audience_key text default 'public',
  target_country_code text default null,
  target_region text default null,
  target_city text default null,
  target_at timestamptz default timezone('utc', now())
)
returns table (
  publication_id uuid,
  publication_key text,
  placement_key text,
  content_kind text,
  title text,
  body text,
  accessibility_label text,
  cta_label text,
  cta_action jsonb,
  media_asset_id uuid,
  media_storage_bucket text,
  media_storage_path text,
  media_content_type text,
  priority integer,
  revision integer,
  metadata jsonb
)
language sql
stable
security definer
set search_path = public
as $$
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
    and ('public' = any(publication.audience_keys) or coalesce(target_audience_key, 'public') = any(publication.audience_keys))
    and (cardinality(publication.country_codes) = 0 or lower(coalesce(target_country_code, '')) = any(select lower(value) from unnest(publication.country_codes) value))
    and (cardinality(publication.regions) = 0 or lower(coalesce(target_region, '')) = any(select lower(value) from unnest(publication.regions) value))
    and (cardinality(publication.cities) = 0 or lower(coalesce(target_city, '')) = any(select lower(value) from unnest(publication.cities) value))
    and (publication.starts_at is null or publication.starts_at <= target_at)
    and (publication.ends_at is null or publication.ends_at > target_at)
  order by publication.placement_key, publication.priority desc, publication.revision desc, publication.published_at desc nulls last, publication.created_at desc;
$$;

grant execute on function public.read_published_product_content(text[], text, text, text, text, text, timestamptz) to anon, authenticated, service_role;
