begin;

insert into public.permissions (key, description, risk_level)
values
  ('platform.content.read', 'Read published platform product content.', 'standard'),
  ('platform.content.manage', 'Manage platform product content and publication state.', 'high')
on conflict (key) do update
set description = excluded.description,
    risk_level = excluded.risk_level,
    updated_at = timezone('utc', now());

insert into public.role_permissions (role_id, permission_id)
select role_record.id, permission_record.id
from public.roles role_record
cross join public.permissions permission_record
where role_record.key = 'platform.admin'
  and permission_record.key in ('platform.content.read', 'platform.content.manage')
on conflict do nothing;

create table if not exists public.product_content_placements (
  id uuid primary key default gen_random_uuid(),
  key text not null unique check (key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  display_name text not null,
  surface_key text not null check (surface_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  content_kind text not null
    check (content_kind in ('brand', 'onboarding', 'promotion', 'safety', 'empty_state', 'illustration', 'service')),
  allowed_audiences text[] not null default array['public']::text[],
  status text not null default 'active' check (status in ('active', 'inactive', 'retired')),
  constraints jsonb not null default '{}'::jsonb check (jsonb_typeof(constraints) = 'object'),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.product_content_publications (
  id uuid primary key default gen_random_uuid(),
  publication_key text not null unique check (publication_key ~ '^[a-z][a-z0-9_.:-]{2,160}$'),
  placement_key text not null references public.product_content_placements(key) on delete restrict,
  organization_id uuid references public.organizations(id) on delete set null,
  module_key text check (module_key is null or module_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  audience_keys text[] not null default array['public']::text[],
  country_codes text[] not null default '{}'::text[],
  regions text[] not null default '{}'::text[],
  cities text[] not null default '{}'::text[],
  title text,
  body text,
  accessibility_label text,
  cta_label text,
  cta_action jsonb not null default '{}'::jsonb check (jsonb_typeof(cta_action) = 'object'),
  media_asset_id uuid references public.media_assets(id) on delete set null,
  priority integer not null default 0,
  revision integer not null default 1 check (revision > 0),
  status text not null default 'draft' check (status in ('draft', 'published', 'paused', 'retired')),
  starts_at timestamptz,
  ends_at timestamptz,
  published_at timestamptz,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  check (ends_at is null or starts_at is null or ends_at > starts_at),
  check (cardinality(audience_keys) > 0)
);

create index if not exists product_content_publications_delivery_idx
on public.product_content_publications (placement_key, status, priority desc, revision desc, starts_at, ends_at);

create index if not exists product_content_publications_targeting_idx
on public.product_content_publications using gin (audience_keys);

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'skima-product-content',
  'skima-product-content',
  true,
  15728640,
  array['image/jpeg', 'image/png', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
set name = excluded.name,
    public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists storage_objects_product_content_insert on storage.objects;
create policy storage_objects_product_content_insert
on storage.objects
for insert to authenticated
with check (
  bucket_id = 'skima-product-content'
  and public.has_permission('platform.content.manage', null)
);

drop policy if exists storage_objects_product_content_update on storage.objects;
create policy storage_objects_product_content_update
on storage.objects
for update to authenticated
using (
  bucket_id = 'skima-product-content'
  and public.has_permission('platform.content.manage', null)
)
with check (
  bucket_id = 'skima-product-content'
  and public.has_permission('platform.content.manage', null)
);

drop policy if exists storage_objects_product_content_delete on storage.objects;
create policy storage_objects_product_content_delete
on storage.objects
for delete to authenticated
using (
  bucket_id = 'skima-product-content'
  and public.has_permission('platform.content.manage', null)
);

insert into public.product_content_placements (
  key,
  display_name,
  surface_key,
  content_kind,
  allowed_audiences,
  constraints,
  metadata
)
values
  ('mobile.brand.logo.primary', 'Primary mobile brand', 'mobile.global.header', 'brand', array['public','customer','driver','station'], '{"recommended_aspect_ratio":"3:1"}'::jsonb, '{"phase_owner":3}'::jsonb),
  ('mobile.brand.logo.compact', 'Compact mobile brand', 'mobile.global.compact-header', 'brand', array['public','customer','driver','station'], '{"recommended_aspect_ratio":"1:1"}'::jsonb, '{"phase_owner":3}'::jsonb),
  ('mobile.welcome.hero', 'Welcome introduction', 'mobile.auth.welcome', 'onboarding', array['public'], '{"recommended_aspect_ratio":"4:3"}'::jsonb, '{"phase_owner":3}'::jsonb),
  ('mobile.onboarding.customer.request', 'Customer onboarding — request', 'mobile.auth.onboarding', 'onboarding', array['public','customer'], '{}'::jsonb, '{"phase_owner":3}'::jsonb),
  ('mobile.onboarding.customer.pickup', 'Customer onboarding — pickup', 'mobile.auth.onboarding', 'onboarding', array['public','customer'], '{}'::jsonb, '{"phase_owner":3}'::jsonb),
  ('mobile.onboarding.customer.track', 'Customer onboarding — track', 'mobile.auth.onboarding', 'onboarding', array['public','customer'], '{}'::jsonb, '{"phase_owner":3}'::jsonb),
  ('mobile.onboarding.customer.return', 'Customer onboarding — return', 'mobile.auth.onboarding', 'onboarding', array['public','customer'], '{}'::jsonb, '{"phase_owner":3}'::jsonb),
  ('mobile.home.promotion', 'Mobile home promotion', 'mobile.customer.home', 'promotion', array['customer'], '{"recommended_aspect_ratio":"16:7"}'::jsonb, '{"phase_owner":3}'::jsonb),
  ('mobile.safety.banner', 'Mobile safety banner', 'mobile.customer.home', 'safety', array['customer','driver','station'], '{}'::jsonb, '{"phase_owner":3}'::jsonb),
  ('mobile.empty.cylinders', 'Cylinder empty state', 'mobile.customer.cylinders', 'empty_state', array['customer'], '{}'::jsonb, '{"phase_owner":3}'::jsonb),
  ('mobile.empty.orders', 'Order empty state', 'mobile.customer.orders', 'empty_state', array['customer'], '{}'::jsonb, '{"phase_owner":3}'::jsonb)
on conflict (key) do update
set display_name = excluded.display_name,
    surface_key = excluded.surface_key,
    content_kind = excluded.content_kind,
    allowed_audiences = excluded.allowed_audiences,
    constraints = excluded.constraints,
    metadata = public.product_content_placements.metadata || excluded.metadata,
    status = 'active',
    updated_at = timezone('utc', now());

insert into public.product_content_publications (
  publication_key,
  placement_key,
  module_key,
  audience_keys,
  title,
  body,
  cta_label,
  cta_action,
  priority,
  status,
  published_at,
  metadata
)
values
  ('content.brand.primary.default', 'mobile.brand.logo.primary', null, array['public','customer','driver','station'], 'SKIMA', 'Every journey, handled with care.', null, '{}'::jsonb, 100, 'published', timezone('utc', now()), '{"seed":"platform_default","replaceable_by_admin":true}'::jsonb),
  ('content.brand.compact.default', 'mobile.brand.logo.compact', null, array['public','customer','driver','station'], 'S', 'SKIMA', null, '{}'::jsonb, 100, 'published', timezone('utc', now()), '{"seed":"platform_default","replaceable_by_admin":true}'::jsonb),
  ('content.onboarding.customer.request.default', 'mobile.onboarding.customer.request', 'lpg', array['public','customer'], 'Request your refill', 'Choose a registered cylinder and tell us where to collect it.', null, '{}'::jsonb, 100, 'published', timezone('utc', now()), '{"sequence":1,"replaceable_by_admin":true}'::jsonb),
  ('content.onboarding.customer.pickup.default', 'mobile.onboarding.customer.pickup', 'lpg', array['public','customer'], 'We collect with care', 'A verified driver picks up your cylinder and confirms every hand-off.', null, '{}'::jsonb, 100, 'published', timezone('utc', now()), '{"sequence":2,"replaceable_by_admin":true}'::jsonb),
  ('content.onboarding.customer.track.default', 'mobile.onboarding.customer.track', 'lpg', array['public','customer'], 'Follow every step', 'See progress from pickup through the partner station and back to you.', null, '{}'::jsonb, 100, 'published', timezone('utc', now()), '{"sequence":3,"replaceable_by_admin":true}'::jsonb),
  ('content.onboarding.customer.return.default', 'mobile.onboarding.customer.return', 'lpg', array['public','customer'], 'Delivered back safely', 'Confirm your return and keep the same SKIMA cylinder identity for next time.', null, '{}'::jsonb, 100, 'published', timezone('utc', now()), '{"sequence":4,"replaceable_by_admin":true}'::jsonb),
  ('content.home.promotion.refill.default', 'mobile.home.promotion', 'lpg', array['customer'], 'Your refill, handled end to end', 'Register once, request in a few taps and follow your cylinder all the way home.', 'Request a refill', '{"type":"route","value":"/(customer)/orders/new"}'::jsonb, 50, 'published', timezone('utc', now()), '{"seed":"module_default","replaceable_by_admin":true}'::jsonb)
on conflict (publication_key) do update
set placement_key = excluded.placement_key,
    module_key = excluded.module_key,
    audience_keys = excluded.audience_keys,
    title = excluded.title,
    body = excluded.body,
    cta_label = excluded.cta_label,
    cta_action = excluded.cta_action,
    priority = excluded.priority,
    metadata = public.product_content_publications.metadata || excluded.metadata,
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
  with ranked as (
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
      publication.metadata,
      row_number() over (
        partition by publication.placement_key
        order by publication.priority desc, publication.revision desc, publication.published_at desc nulls last, publication.created_at desc
      ) as delivery_rank
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
  )
  select
    ranked.publication_id,
    ranked.publication_key,
    ranked.placement_key,
    ranked.content_kind,
    ranked.title,
    ranked.body,
    ranked.accessibility_label,
    ranked.cta_label,
    ranked.cta_action,
    ranked.media_asset_id,
    ranked.media_storage_bucket,
    ranked.media_storage_path,
    ranked.media_content_type,
    ranked.priority,
    ranked.revision,
    ranked.metadata
  from ranked
  where ranked.delivery_rank = 1
  order by ranked.placement_key;
$$;

alter table public.product_content_placements enable row level security;
alter table public.product_content_publications enable row level security;

drop policy if exists product_content_placements_manage on public.product_content_placements;
create policy product_content_placements_manage
on public.product_content_placements
for all to authenticated
using (public.has_permission('platform.content.manage', null))
with check (public.has_permission('platform.content.manage', null));

drop policy if exists product_content_publications_manage on public.product_content_publications;
create policy product_content_publications_manage
on public.product_content_publications
for all to authenticated
using (public.has_permission('platform.content.manage', organization_id))
with check (public.has_permission('platform.content.manage', organization_id));

drop trigger if exists audit_product_content_placements_mutations on public.product_content_placements;
create trigger audit_product_content_placements_mutations
after insert or update or delete on public.product_content_placements
for each row execute function public.record_table_audit();

drop trigger if exists audit_product_content_publications_mutations on public.product_content_publications;
create trigger audit_product_content_publications_mutations
after insert or update or delete on public.product_content_publications
for each row execute function public.record_table_audit();

revoke all on table public.product_content_placements from public, anon, authenticated;
revoke all on table public.product_content_publications from public, anon, authenticated;
grant all on table public.product_content_placements to service_role;
grant all on table public.product_content_publications to service_role;
grant execute on function public.read_published_product_content(text[], text, text, text, text, text, timestamptz) to anon, authenticated, service_role;

commit;
