begin;

create index if not exists expansion_interest_user_resolution_idx
  on public.expansion_interest(user_id, service_key, interest_type, location_id);

create or replace function public.record_expansion_interest(
  p_service_key text,
  p_interest_type text,
  p_location_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  interest_id uuid;
  owner_id uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_service_key is null or p_service_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' then
    raise exception using errcode = '22023', message = 'a valid service key is required';
  end if;
  if p_interest_type not in ('CUSTOMER', 'DRIVER', 'STATION') then
    raise exception using errcode = '22023', message = 'a valid interest type is required';
  end if;

  select location.created_by into owner_id
  from public.locations location
  where location.id = p_location_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'canonical location was not found';
  end if;
  if owner_id is distinct from auth.uid() then
    raise exception using errcode = '42501', message = 'location does not belong to the current user';
  end if;

  -- Serialize the same user/service/type/location tuple so repeated taps and
  -- concurrent clients remain idempotent without deleting historical demand.
  perform pg_advisory_xact_lock(hashtextextended(
    auth.uid()::text || ':' || p_service_key || ':' || p_interest_type || ':' || p_location_id::text,
    0
  ));

  select interest.id into interest_id
  from public.expansion_interest interest
  where interest.user_id = auth.uid()
    and interest.service_key = p_service_key
    and interest.interest_type = p_interest_type
    and interest.location_id = p_location_id
  order by interest.created_at
  limit 1;

  if interest_id is null then
    insert into public.expansion_interest(user_id, service_key, interest_type, location_id)
    values(auth.uid(), p_service_key, p_interest_type, p_location_id)
    returning id into interest_id;
  end if;

  return interest_id;
end;
$$;

-- Compatibility bridge for module-owned saved locations. The universal
-- demand table and writer remain business-agnostic; only this adapter knows
-- how the LPG module projects its saved-location identifiers.
create or replace function public.record_lpg_customer_expansion_interest(
  p_location_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  legacy_location_id uuid;
  canonical_location_id uuid;
  recorded_ids uuid[] := array[]::uuid[];
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;
  if p_location_ids is null or cardinality(p_location_ids) = 0 or cardinality(p_location_ids) > 10 then
    raise exception using errcode = '22023', message = 'between one and ten locations are required';
  end if;

  foreach legacy_location_id in array p_location_ids loop
    select mapping.location_id into canonical_location_id
    from public.lpg_customer_locations legacy
    join public.canonical_location_legacy_mappings mapping
      on mapping.legacy_source = 'lpg_customer_locations'
     and mapping.legacy_id = legacy.id
    where legacy.id = legacy_location_id
      and legacy.owner_user_id = auth.uid()
      and legacy.status = 'active';

    if canonical_location_id is null then
      raise exception using errcode = 'P0002', message = 'an active canonical customer location was not found';
    end if;

    recorded_ids := array_append(
      recorded_ids,
      public.record_expansion_interest('lpg', 'CUSTOMER', canonical_location_id)
    );
  end loop;

  return jsonb_build_object(
    'recorded', cardinality(recorded_ids),
    'interestIds', to_jsonb(recorded_ids)
  );
end;
$$;

create or replace function public.read_expansion_demand(
  p_service_key text default null,
  p_interest_type text default null
)
returns table(
  service_key text,
  interest_type text,
  geography_id uuid,
  geography_name text,
  request_count bigint,
  distinct_user_count bigint,
  last_requested_at timestamptz
)
language sql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
  select interest.service_key,
    interest.interest_type,
    matched.id,
    coalesce(matched.canonical_name, 'Unmapped coordinate'),
    count(*),
    count(distinct interest.user_id),
    max(interest.created_at)
  from public.expansion_interest interest
  join public.locations location on location.id = interest.location_id
  left join lateral (
    select geography.id, geography.canonical_name
    from public.geographies geography
    join public.geography_levels level on level.id = geography.geography_level_id
    where geography.status = 'active'
      and level.status = 'active'
      and geography.boundary_geometry is not null
      and extensions.st_covers(geography.boundary_geometry, location.point)
    order by level.specificity_rank desc, geography.id
    limit 1
  ) matched on true
  where (public.has_permission('platform.coverage.read', null) or coalesce(auth.role(), '') = 'service_role')
    and (p_service_key is null or interest.service_key = p_service_key)
    and (p_interest_type is null or interest.interest_type = p_interest_type)
  group by interest.service_key, interest.interest_type, matched.id, matched.canonical_name
  order by count(*) desc, max(interest.created_at) desc;
$$;

revoke all on function public.record_expansion_interest(text, text, uuid) from public, anon;
revoke all on function public.record_lpg_customer_expansion_interest(uuid[]) from public, anon;
revoke all on function public.read_expansion_demand(text, text) from public, anon;
grant execute on function public.record_expansion_interest(text, text, uuid) to authenticated, service_role;
grant execute on function public.record_lpg_customer_expansion_interest(uuid[]) to authenticated, service_role;
grant execute on function public.read_expansion_demand(text, text) to authenticated, service_role;

commit;
