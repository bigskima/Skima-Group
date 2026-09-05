begin;

-- Cylinder visual review is a read-only AI observation layer.
-- It is deliberately separate from cylinder presentation generation, identity, capacity verification,
-- inspection, safety state, dispatch eligibility and every authoritative LPG workflow.

create table if not exists public.ai_cylinder_visual_reviews (
  id uuid primary key default gen_random_uuid(),
  cylinder_id uuid not null references public.lpg_cylinders(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  source_media_asset_id uuid not null references public.media_assets(id) on delete restrict,
  provider_adapter_key text not null,
  model_key text not null,
  image_quality text not null default 'unknown'
    check (image_quality in ('good','usable','poor','unknown')),
  visible_colour text,
  probable_size_marking_kg numeric(8,2)
    check (
      probable_size_marking_kg is null
      or probable_size_marking_kg between 1 and 100
    ),
  visible_markings text[] not null default '{}'::text[],
  appearance_observations text[] not null default '{}'::text[],
  retake_suggestions text[] not null default '{}'::text[],
  manual_inspection_recommended boolean not null default true
    check (manual_inspection_recommended = true),
  safety_certification boolean not null default false
    check (safety_certification = false),
  mutates_cylinder boolean not null default false
    check (mutates_cylinder = false),
  provider_metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provider_metadata) = 'object'),
  metadata jsonb not null default '{}'::jsonb
    check (jsonb_typeof(metadata) = 'object'),
  idempotency_key text not null unique,
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists ai_cylinder_visual_reviews_owner_recent_idx
on public.ai_cylinder_visual_reviews (owner_user_id, created_at desc);

create index if not exists ai_cylinder_visual_reviews_cylinder_recent_idx
on public.ai_cylinder_visual_reviews (cylinder_id, created_at desc);

alter table public.ai_cylinder_visual_reviews enable row level security;

drop policy if exists ai_cylinder_visual_reviews_read_owner_or_privileged
on public.ai_cylinder_visual_reviews;

create policy ai_cylinder_visual_reviews_read_owner_or_privileged
on public.ai_cylinder_visual_reviews
for select to authenticated
using (
  owner_user_id = (select auth.uid())
  or public.is_platform_super_admin()
  or public.has_permission('platform.ai.read', null)
  or public.has_permission('platform.ai.manage', null)
);

revoke all on public.ai_cylinder_visual_reviews from public, anon, authenticated;
grant select on public.ai_cylinder_visual_reviews to authenticated;
grant all on public.ai_cylinder_visual_reviews to service_role;

create or replace function public.prevent_ai_cylinder_visual_review_mutation()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'cylinder visual review history is append-only';
end;
$$;

drop trigger if exists guard_ai_cylinder_visual_review_mutation
on public.ai_cylinder_visual_reviews;

create trigger guard_ai_cylinder_visual_review_mutation
before update or delete
on public.ai_cylinder_visual_reviews
for each row
execute function public.prevent_ai_cylinder_visual_review_mutation();

insert into public.ai_capabilities (
  key,
  display_name,
  description,
  category,
  response_mode,
  control_mode,
  status,
  config
)
values (
  'ai.lpg.cylinder.visual_review',
  'Cylinder Visual Review',
  'Reviews an owned source cylinder photo for visible details and photo quality without making safety, identity or capacity decisions.',
  'analysis',
  'json',
  'read_only',
  'active',
  '{
    "workspace": "customer",
    "grounded_only": true,
    "required_input_modes": ["image"],
    "purpose": "visible_details_and_photo_quality",
    "may_mutate_business_state": false,
    "may_mutate_cylinder": false,
    "safety_certification": false,
    "capacity_verification": false,
    "condition_verification": false
  }'::jsonb
)
on conflict (key) do update
set display_name = excluded.display_name,
    description = excluded.description,
    category = excluded.category,
    response_mode = excluded.response_mode,
    control_mode = 'read_only',
    status = excluded.status,
    config = public.ai_capabilities.config || excluded.config,
    updated_at = timezone('utc', now());

-- The initial Gemini adapter already serves SKIMA AI. Explicitly advertise image input support
-- for multimodal routes; other providers stay text-only until an administrator configures them.
update public.provider_adapters
set config = config || jsonb_build_object(
      'input_modes',
      case
        when jsonb_typeof(config -> 'input_modes') = 'array' then
          (config -> 'input_modes')
          || case
               when (config -> 'input_modes') ? 'text' then '[]'::jsonb
               else '["text"]'::jsonb
             end
          || case
               when (config -> 'input_modes') ? 'image' then '[]'::jsonb
               else '["image"]'::jsonb
             end
        else '["text","image"]'::jsonb
      end
    ),
    updated_at = timezone('utc', now())
where provider_kind = 'ai'
  and key = 'provider.ai.google-gemini';

create or replace function public.validate_ai_provider_route_input_modes()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  capability_record public.ai_capabilities%rowtype;
  provider_record public.provider_adapters%rowtype;
  required_mode text;
begin
  select * into capability_record
  from public.ai_capabilities
  where id = new.capability_id;

  if capability_record.id is null then
    raise exception 'AI capability was not found';
  end if;

  if jsonb_typeof(capability_record.config -> 'required_input_modes') <> 'array' then
    return new;
  end if;

  select * into provider_record
  from public.provider_adapters
  where id = new.provider_adapter_id;

  if provider_record.id is null
    or provider_record.provider_kind <> 'ai' then
    raise exception 'AI provider was not found';
  end if;

  for required_mode in
    select jsonb_array_elements_text(capability_record.config -> 'required_input_modes')
  loop
    if not (
      coalesce(provider_record.config -> 'input_modes', '[]'::jsonb)
        ? required_mode
    ) then
      raise exception
        'AI provider does not support required input mode % for capability %',
        required_mode,
        capability_record.key;
    end if;
  end loop;

  return new;
end;
$$;

drop trigger if exists validate_ai_provider_route_input_modes
on public.ai_provider_routes;

create trigger validate_ai_provider_route_input_modes
before insert or update of capability_id, provider_adapter_id, status, config
on public.ai_provider_routes
for each row
execute function public.validate_ai_provider_route_input_modes();

create or replace function public.validate_ai_provider_input_mode_routes()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  route_record record;
  required_mode text;
begin
  if new.provider_kind <> 'ai' then
    return new;
  end if;

  for route_record in
    select
      route.id as route_id,
      capability.key as capability_key,
      capability.config as capability_config
    from public.ai_provider_routes route
    join public.ai_capabilities capability
      on capability.id = route.capability_id
    where route.provider_adapter_id = new.id
      and route.status = 'active'
      and jsonb_typeof(capability.config -> 'required_input_modes') = 'array'
  loop
    for required_mode in
      select jsonb_array_elements_text(
        route_record.capability_config -> 'required_input_modes'
      )
    loop
      if not (
        coalesce(new.config -> 'input_modes', '[]'::jsonb)
          ? required_mode
      ) then
        raise exception
          'cannot remove input mode % while active AI route % requires it',
          required_mode,
          route_record.capability_key;
      end if;
    end loop;
  end loop;

  return new;
end;
$$;

drop trigger if exists validate_ai_provider_input_mode_routes
on public.provider_adapters;

create trigger validate_ai_provider_input_mode_routes
before update of provider_kind, config
on public.provider_adapters
for each row
execute function public.validate_ai_provider_input_mode_routes();

-- Seed the new capability from the already configured Gemini text model when available.
-- Provider/model choice remains a database route and can be changed later from SKIMA Intelligence.
insert into public.ai_provider_routes (
  capability_id,
  provider_adapter_id,
  model_key,
  priority,
  status,
  config
)
select
  capability.id,
  provider.id,
  provider.config ->> 'text_model',
  1,
  'active',
  jsonb_build_object(
    'fallback_only', false,
    'automatic_failover_eligible', false,
    'review_only', true
  )
from public.ai_capabilities capability
join public.provider_adapters provider
  on provider.provider_kind = 'ai'
 and provider.key = 'provider.ai.google-gemini'
where capability.key = 'ai.lpg.cylinder.visual_review'
  and provider.status in ('active','degraded')
  and nullif(btrim(provider.config ->> 'text_model'), '') is not null
on conflict (capability_id, provider_adapter_id, model_key)
do update set
  priority = 1,
  status = 'active',
  config = public.ai_provider_routes.config
    || jsonb_build_object(
      'fallback_only', false,
      'automatic_failover_eligible', false,
      'review_only', true
    ),
  updated_at = timezone('utc', now()),
  version = public.ai_provider_routes.version + 1;

create or replace function public.read_my_cylinder_visual_reviews(
  target_cylinder_id uuid,
  target_limit integer default 5
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if target_cylinder_id is null then
    raise exception using errcode = '22023', message = 'cylinder id is required';
  end if;

  if not exists (
    select 1
    from public.lpg_cylinders cylinder
    where cylinder.id = target_cylinder_id
      and cylinder.owner_user_id = auth.uid()
      and cylinder.status <> 'deactivated'
  ) then
    raise exception using errcode = '42501', message = 'owned active cylinder was not found';
  end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', review.id,
        'cylinderId', review.cylinder_id,
        'sourceMediaAssetId', review.source_media_asset_id,
        'imageQuality', review.image_quality,
        'visibleColour', review.visible_colour,
        'probableSizeMarkingKg', review.probable_size_marking_kg,
        'visibleMarkings', to_jsonb(review.visible_markings),
        'appearanceObservations', to_jsonb(review.appearance_observations),
        'retakeSuggestions', to_jsonb(review.retake_suggestions),
        'manualInspectionRecommended', true,
        'safetyCertification', false,
        'mutatesCylinder', false,
        'createdAt', review.created_at
      )
      order by review.created_at desc
    ),
    '[]'::jsonb
  )
  into result
  from (
    select *
    from public.ai_cylinder_visual_reviews visual_review
    where visual_review.cylinder_id = target_cylinder_id
      and visual_review.owner_user_id = auth.uid()
    order by visual_review.created_at desc
    limit least(greatest(coalesce(target_limit, 5), 1), 20)
  ) review;

  return result;
end;
$$;

revoke all on function public.read_my_cylinder_visual_reviews(uuid, integer)
from public, anon;
grant execute on function public.read_my_cylinder_visual_reviews(uuid, integer)
to authenticated, service_role;

comment on table public.ai_cylinder_visual_reviews is
  'Append-only AI observations from an owned cylinder source photo. These records never certify safety, verify capacity, set cylinder condition, or mutate cylinder business state.';

commit;
