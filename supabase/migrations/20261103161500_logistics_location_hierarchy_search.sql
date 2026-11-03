begin;

create or replace function public.search_logistics_geographies(
  target_search text,
  target_country_code text default 'NG',
  target_parent_id uuid default null,
  target_limit integer default 40
)
returns table (
  id uuid,
  parent_id uuid,
  canonical_name text,
  country_code text,
  geography_level_id uuid,
  aliases jsonb,
  parent_name text,
  hierarchy_path text
)
language sql
stable
security invoker
set search_path = public
as $$
  with recursive search_input as (
    select
      public.normalize_geography_token(coalesce(target_search, '')) as full_token,
      nullif(btrim(target_search), '') as raw_search
  ),
  search_tokens as (
    select distinct public.normalize_geography_token(split.token) as token
    from search_input
    cross join lateral regexp_split_to_table(
      coalesce(search_input.raw_search, ''),
      '[[:space:],]+'
    ) as split(token)
    where char_length(public.normalize_geography_token(split.token)) >= 3
  ),
  matches as (
    select
      geography.id,
      geography.parent_id,
      geography.canonical_name,
      geography.country_code,
      geography.geography_level_id,
      geography.aliases,
      case
        when geography.normalized_name = search_input.full_token then 0
        when geography.normalized_name like search_input.full_token || '%' then 1
        when exists (
          select 1
          from search_tokens token
          where geography.normalized_name = token.token
        ) then 2
        when exists (
          select 1
          from search_tokens token
          where exists (
            select 1
            from jsonb_array_elements_text(coalesce(geography.aliases, '[]'::jsonb)) alias_value
            where public.normalize_geography_token(alias_value) = token.token
          )
        ) then 3
        when exists (
          select 1
          from search_tokens token
          where geography.normalized_name like '%' || token.token || '%'
        ) then 4
        else 5
      end as match_rank
    from public.geographies geography
    cross join search_input
    where geography.status = 'active'
      and geography.country_code = upper(coalesce(nullif(btrim(target_country_code), ''), 'NG'))
      and (target_parent_id is null or geography.parent_id = target_parent_id)
      and char_length(search_input.full_token) >= 2
      and (
        geography.normalized_name like '%' || search_input.full_token || '%'
        or exists (
          select 1
          from search_tokens token
          where geography.normalized_name = token.token
             or geography.normalized_name like '%' || token.token || '%'
        )
        or exists (
          select 1
          from search_tokens token
          where exists (
            select 1
            from jsonb_array_elements_text(coalesce(geography.aliases, '[]'::jsonb)) alias_value
            where public.normalize_geography_token(alias_value) = token.token
               or public.normalize_geography_token(alias_value) like '%' || token.token || '%'
          )
        )
      )
    order by match_rank, geography.canonical_name
    limit least(greatest(coalesce(target_limit, 40), 1), 50)
  ),
  hierarchy as (
    select
      match.id as matched_id,
      match.parent_id as ancestor_id,
      match.canonical_name::text as path,
      0 as depth
    from matches match

    union all

    select
      hierarchy.matched_id,
      parent.parent_id as ancestor_id,
      parent.canonical_name || ' · ' || hierarchy.path as path,
      hierarchy.depth + 1 as depth
    from hierarchy
    join public.geographies parent
      on parent.id = hierarchy.ancestor_id
     and parent.status = 'active'
    where hierarchy.depth < 8
  ),
  best_path as (
    select distinct on (hierarchy.matched_id)
      hierarchy.matched_id,
      hierarchy.path
    from hierarchy
    order by hierarchy.matched_id, hierarchy.depth desc
  )
  select
    match.id,
    match.parent_id,
    match.canonical_name,
    match.country_code,
    match.geography_level_id,
    match.aliases,
    parent.canonical_name as parent_name,
    best_path.path as hierarchy_path
  from matches match
  left join public.geographies parent on parent.id = match.parent_id
  left join best_path on best_path.matched_id = match.id
  order by match.match_rank, match.canonical_name;
$$;

revoke all on function public.search_logistics_geographies(text, text, uuid, integer)
  from public, anon;
grant execute on function public.search_logistics_geographies(text, text, uuid, integer)
  to authenticated, service_role;

comment on function public.search_logistics_geographies(text, text, uuid, integer) is
  'Searches active canonical Nigeria geographies and aliases across hierarchy levels, including multi-word address context, and returns the complete parent path.';

commit;
