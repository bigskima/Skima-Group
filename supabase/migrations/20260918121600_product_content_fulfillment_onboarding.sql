begin;

-- Keep the seeded onboarding story compatible with both Partner Network and
-- SKIMA-managed fulfillment. Admin publications keep a higher priority and
-- remain authoritative when present.

update public.product_content_publications
set body='See progress from pickup through the selected fulfillment route and back to you.',
    metadata=metadata||jsonb_build_object('sequence',3,'replaceable_by_admin',true),
    updated_at=timezone('utc',now())
where publication_key='content.onboarding.customer.track.default'
  and coalesce((metadata->>'replaceable_by_admin')::boolean,false);

insert into public.product_content_publications(
  publication_key,placement_key,module_key,audience_keys,title,body,cta_label,cta_action,
  priority,status,published_at,metadata
) values (
  'content.onboarding.customer.refill.default',
  'mobile.onboarding.customer.refill',
  'lpg',
  array['public','customer'],
  'Refilled through SKIMA',
  'SKIMA coordinates the available fulfillment route for your area and keeps the refill protected.',
  null,
  '{}'::jsonb,
  100,
  'published',
  timezone('utc',now()),
  '{"sequence":4,"replaceable_by_admin":true}'::jsonb
)
on conflict(publication_key) do update
set title=excluded.title,
    body=excluded.body,
    audience_keys=excluded.audience_keys,
    module_key=excluded.module_key,
    priority=excluded.priority,
    metadata=public.product_content_publications.metadata||excluded.metadata,
    updated_at=timezone('utc',now())
where coalesce((public.product_content_publications.metadata->>'replaceable_by_admin')::boolean,true);

update public.product_content_publications
set metadata=metadata||jsonb_build_object('sequence',5,'replaceable_by_admin',true),
    updated_at=timezone('utc',now())
where publication_key='content.onboarding.customer.return.default'
  and coalesce((metadata->>'replaceable_by_admin')::boolean,false);

commit;
