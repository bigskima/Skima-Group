begin;

-- Ensure the Anambra launch hierarchy contains the locations already used by
-- customers and providers. IDs are resolved by natural keys at migration time;
-- addresses, streets and landmarks continue to come from the configured maps
-- adapter rather than being hard-coded into this catalogue.
with state as (
  select id
  from public.geographies
  where country_code = 'NG'
    and normalized_name = 'anambra state'
    and status = 'active'
  order by created_at
  limit 1
), level as (
  select id
  from public.geography_levels
  where key = 'admin_level_2'
    and status = 'active'
  order by specificity_rank
  limit 1
)
insert into public.geographies (
  parent_id, geography_level_id, canonical_name, normalized_name,
  country_code, source, external_reference, aliases, metadata, status
)
select
  state.id,
  level.id,
  place.canonical_name,
  place.normalized_name,
  'NG',
  'skima.location.seed',
  place.external_reference,
  place.aliases,
  jsonb_build_object('catalogue_scope', 'logistics_launch', 'seed_version', 1),
  'active'
from state
cross join level
cross join (values
  ('Anambra East', 'anambra east', 'ng:anambra-east', '["Anambra East LGA","Otuocha"]'::jsonb),
  ('Onitsha North', 'onitsha north', 'ng:onitsha-north', '["Onitsha North LGA"]'::jsonb),
  ('Onitsha South', 'onitsha south', 'ng:onitsha-south', '["Onitsha South LGA"]'::jsonb)
) as place(canonical_name, normalized_name, external_reference, aliases)
where not exists (
  select 1
  from public.geographies existing
  where existing.country_code = 'NG'
    and existing.parent_id = state.id
    and existing.normalized_name = place.normalized_name
    and existing.status = 'active'
)
on conflict (source, external_reference) do update
set parent_id = excluded.parent_id,
    geography_level_id = excluded.geography_level_id,
    canonical_name = excluded.canonical_name,
    normalized_name = excluded.normalized_name,
    aliases = excluded.aliases,
    metadata = public.geographies.metadata || excluded.metadata,
    status = 'active',
    updated_at = timezone('utc', now());

with anambra_east as (
  select id
  from public.geographies
  where country_code = 'NG'
    and normalized_name = 'anambra east'
    and status = 'active'
  order by created_at
  limit 1
), level as (
  select id
  from public.geography_levels
  where key = 'locality'
    and status = 'active'
  order by specificity_rank
  limit 1
)
insert into public.geographies (
  parent_id, geography_level_id, canonical_name, normalized_name,
  country_code, source, external_reference, aliases, metadata, status
)
select
  anambra_east.id,
  level.id,
  'Nsugbe',
  'nsugbe',
  'NG',
  'skima.location.seed',
  'ng:nsugbe',
  '["Nsugbe town"]'::jsonb,
  jsonb_build_object('catalogue_scope', 'logistics_launch', 'seed_version', 1),
  'active'
from anambra_east
cross join level
where not exists (
  select 1
  from public.geographies existing
  where existing.country_code = 'NG'
    and existing.parent_id = anambra_east.id
    and existing.normalized_name = 'nsugbe'
    and existing.status = 'active'
)
on conflict (source, external_reference) do update
set parent_id = excluded.parent_id,
    geography_level_id = excluded.geography_level_id,
    canonical_name = excluded.canonical_name,
    normalized_name = excluded.normalized_name,
    aliases = excluded.aliases,
    metadata = public.geographies.metadata || excluded.metadata,
    status = 'active',
    updated_at = timezone('utc', now());

commit;
