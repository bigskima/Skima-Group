begin;

-- Logistics uses the shared product-content service for customer campaigns.
-- Admins can replace, schedule, target or pause this publication through
-- Experience -> Brand & app content without a Logistics-specific content table.
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
) values (
  'content.home.promotion.logistics.default',
  'mobile.home.promotion',
  'logistics',
  array['customer']::text[],
  'Move anything. Move with confidence.',
  'Find a qualified logistics company for your route, cargo and timing. Compare offers and follow every booking from one place.',
  'Create a request',
  '{"type":"route","value":"/(customer)/request"}'::jsonb,
  50,
  'published',
  timezone('utc', now()),
  '{"seed":"logistics_default","replaceable_by_admin":true}'::jsonb
)
on conflict (publication_key) do update
set placement_key = excluded.placement_key,
    module_key = excluded.module_key,
    audience_keys = excluded.audience_keys,
    title = excluded.title,
    body = excluded.body,
    cta_label = excluded.cta_label,
    cta_action = excluded.cta_action,
    priority = excluded.priority,
    status = 'published',
    published_at = coalesce(public.product_content_publications.published_at, excluded.published_at),
    metadata = public.product_content_publications.metadata || excluded.metadata,
    updated_at = timezone('utc', now())
where coalesce((public.product_content_publications.metadata->>'replaceable_by_admin')::boolean, true);

commit;
