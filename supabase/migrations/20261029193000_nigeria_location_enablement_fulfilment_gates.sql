-- Nigeria-wide administrative location enablement with provider-specific, fail-closed fulfilment gates.
-- Country/state/LGA rules can match verified address metadata without manually drawing polygons.
-- Polygon/radius coverage and real provider eligibility remain required for dispatch.
begin;

CREATE OR REPLACE FUNCTION public.validate_geography_hierarchy_and_geometry()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  child_level record;
  parent record;
begin
  if new.parent_id = new.id then
    raise exception using errcode = '23514', message = 'geography cannot be its own parent';
  end if;

  if new.parent_id is not null and exists(
    with recursive descendants as (
      select id from public.geographies where parent_id = new.id
      union all
      select child.id
      from public.geographies child
      join descendants on child.parent_id = descendants.id
    )
    select 1 from descendants where id = new.parent_id
  ) then
    raise exception using errcode = '23514', message = 'geography hierarchy cycle is not allowed';
  end if;

  select *
  into child_level
  from public.geography_levels
  where id = new.geography_level_id;

  if not found or child_level.status <> 'active' then
    raise exception using errcode = '23514', message = 'geography requires an active configured level';
  end if;

  if new.parent_id is not null then
    select geography.*, level.specificity_rank parent_specificity
    into parent
    from public.geographies geography
    join public.geography_levels level on level.id = geography.geography_level_id
    where geography.id = new.parent_id;

    if not found then
      raise exception using errcode = '23514', message = 'parent geography was not found';
    end if;

    if parent.country_code <> new.country_code then
      raise exception using errcode = '23514', message = 'parent and child geographies must use the same country code';
    end if;

    if parent.parent_specificity >= child_level.specificity_rank then
      raise exception using errcode = '23514', message = 'child geography must use a more-specific configured level than its parent';
    end if;
  end if;

  if new.status = 'active' and new.boundary_geometry is null and child_level.key = 'custom_zone' then
    raise exception using errcode = '23514', message = 'active geography requires a boundary';
  end if;

  if new.boundary_geometry is not null then
    if extensions.st_isempty(new.boundary_geometry::extensions.geometry)
       or not extensions.st_isvalid(new.boundary_geometry::extensions.geometry)
       or extensions.st_area(new.boundary_geometry) <= 0 then
      raise exception using errcode = '23514',
        message = 'geography boundary must be a non-empty valid polygon with positive area';
    end if;

    if new.parent_id is not null then
      if parent.boundary_geometry is not null
         and child_level.key <> 'custom_zone'
         and not extensions.st_covers(parent.boundary_geometry, new.boundary_geometry) then
        raise exception using errcode = '23514',
          message = 'administrative child boundary must be covered by its parent boundary';
      end if;
    end if;
  end if;

  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.configure_universal_service_policy(p_policy_id uuid, p_service_key text, p_capability_key text, p_geography_id uuid, p_effect text, p_priority integer, p_status text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_reason text, p_configuration jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare resolved_id uuid;
begin
  if coalesce(auth.role(),'')<>'service_role' and not public.has_permission('platform.coverage.manage',null) then
    raise exception using errcode='42501',message='coverage management permission required';
  end if;
  if p_service_key is null or p_capability_key is null
     or p_service_key !~ '^[a-z][a-z0-9_.:-]{2,120}$' or p_capability_key !~ '^[a-z][a-z0-9_.:-]{2,120}$'
     or p_effect not in('ALLOW','DENY') or p_status not in('draft','active','paused','retired')
     or (p_ends_at is not null and p_starts_at is not null and p_ends_at<=p_starts_at)
     or jsonb_typeof(coalesce(p_configuration,'{}'::jsonb))<>'object' then
    raise exception using errcode='22023',message='valid coverage policy fields are required';
  end if;
  if p_status='active' and nullif(btrim(p_reason),'') is null then
    raise exception using errcode='22023',message='active coverage policy requires a reason';
  end if;
  if not exists(select 1 from public.geographies where id=p_geography_id and status='active') then
    raise exception using errcode='22023',message='active geography is required';
  end if;
  if p_policy_id is null then
    insert into public.service_coverage_policies(service_key,capability_key,target_geography_id,effect,priority,status,starts_at,ends_at,reason,configuration,created_by,updated_by)
    values(p_service_key,p_capability_key,p_geography_id,p_effect,coalesce(p_priority,0),p_status,p_starts_at,p_ends_at,nullif(btrim(p_reason),''),coalesce(p_configuration,'{}'::jsonb),auth.uid(),auth.uid())
    returning id into resolved_id;
  else
    update public.service_coverage_policies set service_key=p_service_key,capability_key=p_capability_key,target_geography_id=p_geography_id,
      effect=p_effect,priority=coalesce(p_priority,0),status=p_status,starts_at=p_starts_at,ends_at=p_ends_at,
      reason=nullif(btrim(p_reason),''),configuration=coalesce(p_configuration,'{}'::jsonb),updated_by=auth.uid()
    where id=p_policy_id returning id into resolved_id;
    if resolved_id is null then raise exception using errcode='P0002',message='coverage policy was not found'; end if;
  end if;
  return resolved_id;
end $function$


CREATE OR REPLACE FUNCTION public.preview_universal_service_policy(p_policy_id uuid, p_service_key text, p_capability_key text, p_geography_id uuid, p_priority integer, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  target record;
  conflicts jsonb;
  broader jsonb;
  narrower jsonb;
begin
  if pg_trigger_depth() = 0
     and coalesce(auth.role(), '') <> 'service_role'
     and not public.has_permission('platform.coverage.read', null)
     and not public.has_permission('platform.coverage.manage', null) then
    raise exception using errcode = '42501', message = 'coverage read permission required';
  end if;

  if p_service_key !~ '^[a-z][a-z0-9_.:-]{2,120}$'
     or p_capability_key !~ '^[a-z][a-z0-9_.:-]{2,120}$'
     or (p_starts_at is not null and p_ends_at is not null and p_ends_at <= p_starts_at) then
    raise exception using errcode = '22023', message = 'valid policy preview fields are required';
  end if;

  select geography.*, level.specificity_rank
  into target
  from public.geographies geography
  join public.geography_levels level on level.id = geography.geography_level_id
  where geography.id = p_geography_id
    and geography.status = 'active'
    and level.status = 'active'
    ;

  if not found then
    raise exception using errcode = 'P0002', message = 'active bounded target geography was not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'policyId', policy.id,
    'geographyId', geography.id,
    'geographyName', geography.canonical_name,
    'effect', policy.effect,
    'priority', policy.priority
  ) order by geography.canonical_name, policy.id), '[]'::jsonb)
  into conflicts
  from public.service_coverage_policies policy
  join public.geographies geography on geography.id = policy.target_geography_id
  join public.geography_levels level on level.id = geography.geography_level_id
  where policy.id is distinct from p_policy_id
    and policy.service_key = p_service_key
    and policy.capability_key = p_capability_key
    and policy.status = 'active'
    and geography.status = 'active'
    and level.specificity_rank = target.specificity_rank
    and policy.priority = coalesce(p_priority, 0)
    and (policy.ends_at is null or p_starts_at is null or policy.ends_at > p_starts_at)
    and (p_ends_at is null or policy.starts_at is null or p_ends_at > policy.starts_at)
    and (
      geography.id = target.id
      or (
        geography.boundary_geometry is not null
        and target.boundary_geometry is not null
        and extensions.st_intersects(geography.boundary_geometry, target.boundary_geometry)
      )
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'policyId', policy.id,
    'geographyId', geography.id,
    'geographyName', geography.canonical_name,
    'effect', policy.effect,
    'specificity', level.specificity_rank,
    'priority', policy.priority
  ) order by level.specificity_rank desc, policy.priority desc, policy.id), '[]'::jsonb)
  into broader
  from public.service_coverage_policies policy
  join public.geographies geography on geography.id = policy.target_geography_id
  join public.geography_levels level on level.id = geography.geography_level_id
  where policy.id is distinct from p_policy_id
    and policy.service_key = p_service_key
    and policy.capability_key = p_capability_key
    and policy.status = 'active'
    and level.specificity_rank < target.specificity_rank
    and (
      (geography.boundary_geometry is not null and target.boundary_geometry is not null
        and extensions.st_covers(geography.boundary_geometry, target.boundary_geometry))
      or geography.id in (
        with recursive ancestors(id,parent_id) as (
          select id,parent_id from public.geographies where id=target.id
          union all
          select parent.id,parent.parent_id
          from public.geographies parent join ancestors child on child.parent_id=parent.id
        )
        select id from ancestors where id <> target.id
      )
    );

  select coalesce(jsonb_agg(jsonb_build_object(
    'policyId', policy.id,
    'geographyId', geography.id,
    'geographyName', geography.canonical_name,
    'effect', policy.effect,
    'specificity', level.specificity_rank,
    'priority', policy.priority
  ) order by level.specificity_rank, policy.priority desc, policy.id), '[]'::jsonb)
  into narrower
  from public.service_coverage_policies policy
  join public.geographies geography on geography.id = policy.target_geography_id
  join public.geography_levels level on level.id = geography.geography_level_id
  where policy.id is distinct from p_policy_id
    and policy.service_key = p_service_key
    and policy.capability_key = p_capability_key
    and policy.status = 'active'
    and level.specificity_rank > target.specificity_rank
    and (
      (target.boundary_geometry is not null and geography.boundary_geometry is not null
        and extensions.st_covers(target.boundary_geometry, geography.boundary_geometry))
      or geography.id in (
        with recursive descendants(id,parent_id) as (
          select id,parent_id from public.geographies where parent_id=target.id
          union all
          select child.id,child.parent_id
          from public.geographies child join descendants parent on child.parent_id=parent.id
        )
        select id from descendants
      )
    );

  return jsonb_build_object(
    'canActivate', jsonb_array_length(conflicts) = 0,
    'target', jsonb_build_object(
      'geographyId', target.id,
      'geographyName', target.canonical_name,
      'specificity', target.specificity_rank
    ),
    'conflicts', conflicts,
    'broaderPolicies', broader,
    'narrowerPolicies', narrower
  );
end;
$function$;



create or replace function public.resolve_lpg_location_capability(
  p_service_key text,
  p_capability_key text,
  p_longitude double precision,
  p_latitude double precision,
  p_geography jsonb default '{}'::jsonb,
  p_at timestamptz default timezone('utc', now())
) returns jsonb
language plpgsql stable security definer
set search_path=public,extensions,pg_temp
as $function$
declare
  snapshot jsonb := coalesce(p_geography->'addressSnapshot',p_geography->'address_snapshot','{}'::jsonb);
  components jsonb := coalesce(p_geography->'addressComponents',p_geography->'address_components','{}'::jsonb);
  address_text text := coalesce(p_geography->>'formattedAddress',p_geography->>'formatted_address',p_geography->>'address','');
  country_name text;
  v_country_code text;
  state_name text;
  lga_name text;
  city_name text;
  sublocality_name text;
  winner record;
begin
  if auth.uid() is null and coalesce(auth.role(),'') <> 'service_role' then
    raise exception using errcode='42501',message='authentication required';
  end if;
  if p_service_key is null or p_capability_key is null
    or p_latitude is null or p_longitude is null
    or p_latitude not between -90 and 90 or p_longitude not between -180 and 180 then
    return jsonb_build_object('available',false,'reason','LOCATION_REQUIRED','matchedGeographyId',null,'matchedPolicyId',null);
  end if;

  country_name := nullif(btrim(coalesce(
    snapshot->>'country', components->>'country',
    p_geography->>'country', p_geography->>'countryName',
    case when address_text ilike '%Nigeria%' then 'Nigeria' end
  )), '');
  v_country_code := upper(nullif(btrim(coalesce(
    snapshot->>'countryCode', snapshot->>'country_code',
    components->>'countryCode', components->>'country_code',
    p_geography->>'countryCode', p_geography->>'country_code',
    case when public.normalize_geography_token(coalesce(country_name,''))='nigeria' then 'NG' end
  )), ''));
  state_name := nullif(btrim(coalesce(
    snapshot->>'state', snapshot->>'region', components->>'state', components->>'region',
    p_geography->>'state', p_geography->>'region', p_geography->>'admin_area_1'
  )), '');
  lga_name := nullif(btrim(coalesce(
    snapshot->>'lga', snapshot->>'district', components->>'lga', components->>'district',
    p_geography->>'lga', p_geography->>'district', p_geography->>'admin_area_2'
  )), '');
  city_name := nullif(btrim(coalesce(
    snapshot->>'city', snapshot->>'town', snapshot->>'locality',
    components->>'city', components->>'town', components->>'locality',
    p_geography->>'city', p_geography->>'town', p_geography->>'locality'
  )), '');
  sublocality_name := nullif(btrim(coalesce(
    snapshot->>'neighbourhood', snapshot->>'neighborhood', snapshot->>'subLocality',
    snapshot->>'sublocality', snapshot->>'village',
    components->>'neighbourhood', components->>'neighborhood', components->>'subLocality',
    components->>'sublocality', components->>'village',
    p_geography->>'neighbourhood', p_geography->>'neighborhood',
    p_geography->>'sublocality', p_geography->>'village'
  )), '');

  with candidates as (
    select policy.id as policy_id,policy.effect,policy.priority,geography.id as geography_id,
      level.specificity_rank
    from public.service_coverage_policies policy
    join public.geographies geography on geography.id=policy.target_geography_id and geography.status='active'
    join public.geography_levels level on level.id=geography.geography_level_id and level.status='active'
    where policy.service_key=p_service_key and policy.capability_key=p_capability_key
      and policy.status='active'
      and (policy.starts_at is null or policy.starts_at<=p_at)
      and (policy.ends_at is null or policy.ends_at>p_at)
      and (
        (
          geography.boundary_geometry is not null
          and extensions.st_covers(
            geography.boundary_geometry,
            extensions.st_setsrid(extensions.st_makepoint(p_longitude,p_latitude),4326)::extensions.geography
          )
        )
        or
        (
          geography.boundary_geometry is null
          and (v_country_code is null or upper(geography.country_code)=v_country_code)
          and case level.key
            when 'country' then
              (v_country_code is not null and upper(geography.country_code)=v_country_code)
              or (country_name is not null and public.normalize_geography_token(country_name)=geography.normalized_name)
            when 'admin_level_1' then
              state_name is not null and public.normalize_geography_token(state_name)=geography.normalized_name
            when 'admin_level_2' then
              lga_name is not null and public.normalize_geography_token(lga_name)=geography.normalized_name
            when 'locality' then
              city_name is not null and public.normalize_geography_token(city_name)=geography.normalized_name
            when 'sublocality' then
              sublocality_name is not null and public.normalize_geography_token(sublocality_name)=geography.normalized_name
            else false
          end
          and (
            level.key='country'
            or exists(
              select 1
              from public.geographies parent
              join public.geography_levels parent_level on parent_level.id=parent.geography_level_id
              where parent.id=geography.parent_id
                and parent.status='active'
                and case level.key
                  when 'admin_level_1' then parent_level.key='country'
                    and (v_country_code is null or upper(parent.country_code)=v_country_code)
                  when 'admin_level_2' then parent_level.key='admin_level_1'
                    and (state_name is null or public.normalize_geography_token(parent.canonical_name)=public.normalize_geography_token(state_name))
                  when 'locality' then parent_level.key in ('admin_level_2','admin_level_1')
                    and (lga_name is null or public.normalize_geography_token(parent.canonical_name)=public.normalize_geography_token(lga_name)
                      or public.normalize_geography_token(parent.canonical_name)=public.normalize_geography_token(state_name))
                  when 'sublocality' then parent_level.key in ('locality','admin_level_2')
                    and (city_name is null or public.normalize_geography_token(parent.canonical_name)=public.normalize_geography_token(city_name)
                      or public.normalize_geography_token(parent.canonical_name)=public.normalize_geography_token(lga_name))
                  else false
                end
            )
          )
        )
      )
  ), ranked as (
    select *,dense_rank() over(order by specificity_rank desc,priority desc) as choice_rank
    from candidates
  )
  select policy_id,effect,priority,geography_id,specificity_rank,count(*) over() as top_choice_count
    into winner
  from ranked where choice_rank=1 limit 1;

  if not found then
    return jsonb_build_object('available',false,'reason','SERVICE_NOT_LAUNCHED','matchedGeographyId',null,'matchedPolicyId',null);
  end if;
  if winner.top_choice_count>1 then
    return jsonb_build_object('available',false,'reason','POLICY_CONFIGURATION_CONFLICT','matchedGeographyId',null,'matchedPolicyId',null);
  end if;
  return jsonb_build_object(
    'available',winner.effect='ALLOW',
    'reason',case winner.effect when 'ALLOW' then 'AVAILABLE' else 'AREA_EXCLUDED' end,
    'matchedGeographyId',winner.geography_id,
    'matchedPolicyId',winner.policy_id
  );
end
$function$;
revoke all on function public.resolve_lpg_location_capability(text,text,double precision,double precision,jsonb,timestamptz) from public,anon;
grant execute on function public.resolve_lpg_location_capability(text,text,double precision,double precision,jsonb,timestamptz) to authenticated,service_role;

create or replace function public.resolve_lpg_serviceability(
  p_latitude double precision,
  p_longitude double precision,
  p_geography jsonb default '{}'::jsonb
) returns jsonb
language plpgsql stable security definer
set search_path=public,extensions,pg_temp
as $function$
declare
  customer_resolution jsonb;
  driver_resolution jsonb;
  station_resolution jsonb;
  managed_resolution jsonb;
begin
  customer_resolution:=public.resolve_lpg_location_capability('lpg','customer_ordering',p_longitude,p_latitude,coalesce(p_geography,'{}'::jsonb),timezone('utc',now()));
  driver_resolution:=public.resolve_lpg_location_capability('lpg','driver_onboarding',p_longitude,p_latitude,coalesce(p_geography,'{}'::jsonb),timezone('utc',now()));
  station_resolution:=public.resolve_lpg_location_capability('lpg','station_onboarding',p_longitude,p_latitude,coalesce(p_geography,'{}'::jsonb),timezone('utc',now()));
  managed_resolution:=public.resolve_lpg_location_capability('lpg','skima_managed_fulfillment',p_longitude,p_latitude,coalesce(p_geography,'{}'::jsonb),timezone('utc',now()));
  return jsonb_build_object(
    'serviceable',coalesce((customer_resolution->>'available')::boolean,false),
    'status',case when coalesce((customer_resolution->>'available')::boolean,false) then 'available' else 'unavailable' end,
    'reason',customer_resolution->>'reason',
    'matchedArea',case when customer_resolution->>'matchedGeographyId' is null then null else jsonb_build_object('id',customer_resolution->>'matchedGeographyId','policyId',customer_resolution->>'matchedPolicyId') end,
    'partnerOpportunity',coalesce((driver_resolution->>'available')::boolean,false) or coalesce((station_resolution->>'available')::boolean,false),
    'partnerOpportunities',jsonb_build_object(
      'driver',coalesce((driver_resolution->>'available')::boolean,false),
      'station',coalesce((station_resolution->>'available')::boolean,false)
    ),
    'skimaManagedEnabled',coalesce((managed_resolution->>'available')::boolean,false)
  );
end
$function$;
revoke all on function public.resolve_lpg_serviceability(double precision,double precision,jsonb) from public,anon;
grant execute on function public.resolve_lpg_serviceability(double precision,double precision,jsonb) to authenticated,service_role;



do $nigeria_location_seed$
declare
  country_level_id uuid;
  state_level_id uuid;
  lga_level_id uuid;
  nigeria_id uuid;
  anambra_id uuid;
  awka_id uuid;
  policy_id uuid;
  capability text;
  active_reason text;
begin
  select id into country_level_id from public.geography_levels where key='country' and status='active' limit 1;
  select id into state_level_id from public.geography_levels where key='admin_level_1' and status='active' limit 1;
  select id into lga_level_id from public.geography_levels where key='admin_level_2' and status='active' limit 1;
  if country_level_id is null or state_level_id is null or lga_level_id is null then
    raise exception 'Country, State and LGA geography levels must be active before enabling Nigeria-wide address eligibility';
  end if;

  select geography.id into nigeria_id
  from public.geographies geography
  join public.geography_levels level on level.id=geography.geography_level_id
  where level.key='country' and geography.country_code='NG'
    and public.normalize_geography_token(geography.canonical_name)=public.normalize_geography_token('Nigeria')
  order by geography.created_at limit 1;
  if nigeria_id is null then
    insert into public.geographies(
      parent_id,geography_level_id,canonical_name,normalized_name,country_code,
      boundary_geometry,centroid,source,external_reference,aliases,metadata,status
    ) values(
      null,country_level_id,'Nigeria',public.normalize_geography_token('Nigeria'),'NG',
      null,null,'skima.admin.named_geography',null,'[]'::jsonb,
      jsonb_build_object('sourceSurface','nigeria_location_enablement','addressOnlyPolicy',true,'nationalScope',true),
      'active'
    ) returning id into nigeria_id;
  else
    update public.geographies
    set parent_id=null,geography_level_id=country_level_id,canonical_name='Nigeria',
        normalized_name=public.normalize_geography_token('Nigeria'),country_code='NG',status='active',
        source=coalesce(source,'skima.admin.named_geography'),
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('sourceSurface','nigeria_location_enablement','addressOnlyPolicy',boundary_geometry is null,'nationalScope',true)
    where id=nigeria_id;
  end if;

  select geography.id into anambra_id
  from public.geographies geography
  join public.geography_levels level on level.id=geography.geography_level_id
  where level.key='admin_level_1' and geography.country_code='NG'
    and public.normalize_geography_token(geography.canonical_name) in (
      public.normalize_geography_token('Anambra State'),public.normalize_geography_token('Anambra')
    )
  order by geography.created_at limit 1;
  if anambra_id is null then
    insert into public.geographies(
      parent_id,geography_level_id,canonical_name,normalized_name,country_code,
      boundary_geometry,centroid,source,external_reference,aliases,metadata,status
    ) values(
      nigeria_id,state_level_id,'Anambra State',public.normalize_geography_token('Anambra State'),'NG',
      null,null,'skima.admin.named_geography',null,'["Anambra"]'::jsonb,
      jsonb_build_object('sourceSurface','nigeria_location_enablement','addressOnlyPolicy',true,'stateCode','AN'),
      'active'
    ) returning id into anambra_id;
  else
    update public.geographies
    set parent_id=nigeria_id,geography_level_id=state_level_id,canonical_name='Anambra State',
        normalized_name=public.normalize_geography_token('Anambra State'),country_code='NG',status='active',
        aliases=coalesce(aliases,'[]'::jsonb)||'["Anambra"]'::jsonb,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('sourceSurface','nigeria_location_enablement','addressOnlyPolicy',boundary_geometry is null,'stateCode','AN')
    where id=anambra_id;
  end if;

  select geography.id into awka_id
  from public.geographies geography
  where geography.country_code='NG'
    and public.normalize_geography_token(geography.canonical_name)=public.normalize_geography_token('Awka South')
    and geography.status <> 'retired'
  order by (geography.boundary_geometry is not null) desc, geography.created_at
  limit 1;
  if awka_id is not null then
    update public.geographies
    set parent_id=anambra_id,geography_level_id=lga_level_id,canonical_name='Awka South',
        normalized_name=public.normalize_geography_token('Awka South'),country_code='NG',status='active',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'country','Nigeria','state','Anambra State','lga','Awka South',
          'nationalScopeParentId',nigeria_id,'stateParentId',anambra_id,
          'testingScope',false,'sourceSurface','nigeria_location_enablement','addressOnlyPolicy',boundary_geometry is null
        )
    where id=awka_id;
  end if;

  foreach capability in array array['customer_ordering','driver_onboarding','station_onboarding'] loop
    policy_id:=null;
    select id into policy_id
    from public.service_coverage_policies
    where service_key='lpg' and capability_key=capability and target_geography_id=nigeria_id
    order by case status when 'active' then 0 when 'draft' then 1 else 2 end,updated_at desc
    limit 1;

    update public.service_coverage_policies
    set status='retired',updated_at=timezone('utc',now())
    where service_key='lpg' and capability_key=capability and target_geography_id=nigeria_id
      and id is distinct from policy_id and status in ('active','draft','paused');

    active_reason:=case capability
      when 'customer_ordering' then 'Enable Nigerian delivery-address checks nationally; an actual active station and qualified driver are still required before a quote or order can be created.'
      when 'driver_onboarding' then 'Allow driver applications throughout Nigeria; approval, active vehicle compliance and operating coverage remain mandatory for dispatch.'
      else 'Allow station applications throughout Nigeria; branch approval, live stock, station-managed driver and vehicle readiness remain mandatory for orders.'
    end;

    if policy_id is null then
      insert into public.service_coverage_policies(
        service_key,capability_key,target_geography_id,effect,priority,status,starts_at,ends_at,
        reason,configuration,created_by,updated_by
      ) values(
        'lpg',capability,nigeria_id,'ALLOW',0,'active',null,null,active_reason,
        jsonb_build_object('source','nigeria_location_enablement','addressHierarchyMatch',true,'notFulfilmentGuarantee',true),
        null,null
      );
    else
      update public.service_coverage_policies
      set effect='ALLOW',priority=0,status='active',starts_at=null,ends_at=null,reason=active_reason,
          configuration=coalesce(configuration,'{}'::jsonb)||jsonb_build_object(
            'source','nigeria_location_enablement','addressHierarchyMatch',true,'notFulfilmentGuarantee',true
          ),
          updated_by=null
      where id=policy_id;
    end if;
  end loop;
end
$nigeria_location_seed$;

insert into public.lpg_station_managed_coverage_policy(
  singleton,outside_customer_coverage_enabled,updated_by,updated_at,change_reason,version
) values(
  true,true,null,timezone('utc',now()),
  'Allow the Station Managed path to be evaluated throughout Nigeria; checkout still requires an approved in-radius station, stock, active station driver and eligible vehicle.',
  1
)
on conflict(singleton) do update
set outside_customer_coverage_enabled=true,
    updated_by=null,
    updated_at=timezone('utc',now()),
    change_reason='Allow the Station Managed path to be evaluated throughout Nigeria; checkout still requires an approved in-radius station, stock, active station driver and eligible vehicle.',
    version=public.lpg_station_managed_coverage_policy.version+1
where not public.lpg_station_managed_coverage_policy.outside_customer_coverage_enabled;



create or replace function public.lpg_independent_live_driver_available_at(
  target_latitude numeric,
  target_longitude numeric
) returns boolean
language plpgsql stable security definer
set search_path=public,extensions,pg_temp
as $function$
declare
  policy jsonb;
  freshness_seconds integer;
  max_distance_meters numeric;
  max_driver_orders integer;
  max_vehicle_orders integer;
  driver_required jsonb;
  vehicle_required jsonb;
begin
  if target_latitude is null or target_longitude is null
    or target_latitude not between -90 and 90 or target_longitude not between -180 and 180 then
    return false;
  end if;
  policy:=public.lpg_policy_config('lpg.dispatch.phase_one');
  freshness_seconds:=coalesce(nullif(policy->>'driver_location_freshness_seconds','')::integer,300);
  max_distance_meters:=coalesce(nullif(policy->>'max_driver_distance_meters','')::numeric,20000);
  max_driver_orders:=coalesce(nullif(policy->>'max_concurrent_orders_per_driver','')::integer,12);
  max_vehicle_orders:=coalesce(nullif(policy->>'max_concurrent_orders_per_vehicle','')::integer,12);
  driver_required:=coalesce(policy->'required_driver_capabilities','[]'::jsonb);
  vehicle_required:=coalesce(policy->'required_vehicle_capabilities','[]'::jsonb);
  if freshness_seconds<=0 or max_distance_meters<=0 or max_driver_orders<=0 or max_vehicle_orders<=0
    or jsonb_typeof(driver_required)<>'array' or jsonb_typeof(vehicle_required)<>'array' then
    return false;
  end if;

  return exists(
    select 1
    from public.driver_profiles driver
    join public.driver_vehicle_links vehicle_link
      on vehicle_link.driver_profile_id=driver.id
      and vehicle_link.status='active'
      and vehicle_link.starts_at<=timezone('utc',now())
      and (vehicle_link.ends_at is null or vehicle_link.ends_at>timezone('utc',now()))
    join public.vehicles vehicle on vehicle.id=vehicle_link.vehicle_id and vehicle.status='active'
    join lateral (
      select public.evaluate_driver_vehicle_eligibility(driver.id,vehicle.id,'lpg') as result
    ) eligibility on coalesce((eligibility.result->>'eligible')::boolean,false)
    join lateral (
      select state.point,state.captured_at
      from public.driver_location_state state
      where state.driver_id=driver.id and state.status='available'
        and state.captured_at>=timezone('utc',now())-make_interval(secs=>freshness_seconds)
      order by state.captured_at desc
      limit 1
    ) current_location on true
    where driver.verification_status='approved'
      and driver.operational_status in ('available','busy')
      and coalesce(driver.metadata->>'temporary_lpg_test_fixture','false')<>'true'
      and public.lpg_distance_meters(
        target_latitude,target_longitude,
        extensions.st_y(current_location.point::extensions.geometry),
        extensions.st_x(current_location.point::extensions.geometry)
      )<=max_distance_meters
      and (
        select count(*) from public.lpg_refill_orders active
        where active.driver_profile_id=driver.id
          and active.status not in ('completed','cancelled','refunded','failed')
      )<max_driver_orders
      and (
        select count(*) from public.lpg_refill_orders active
        where active.vehicle_id=vehicle.id
          and active.status not in ('completed','cancelled','refunded','failed')
      )<max_vehicle_orders
      and exists(
        select 1
        from public.operational_coverage_assignments coverage
        left join public.geographies geography on geography.id=coverage.geography_id
        where coverage.entity_type='DRIVER' and coverage.entity_id=driver.id and coverage.service_key='lpg'
          and coverage.status in ('approved','active') and coverage.approved_at is not null
          and (coverage.valid_from is null or coverage.valid_from<=timezone('utc',now()))
          and (coverage.valid_to is null or coverage.valid_to>timezone('utc',now()))
          and case coverage.coverage_type
            when 'ADMIN_GEOGRAPHY' then geography.status='active'
              and geography.boundary_geometry is not null
              and extensions.st_covers(geography.boundary_geometry,
                extensions.st_setsrid(extensions.st_makepoint(target_longitude,target_latitude),4326)::extensions.geography)
            when 'RADIUS' then extensions.st_dwithin(coverage.center_point,
                extensions.st_setsrid(extensions.st_makepoint(target_longitude,target_latitude),4326)::extensions.geography,
                coverage.radius_meters)
            when 'CUSTOM_ZONE' then extensions.st_covers(coverage.coverage_geometry,
                extensions.st_setsrid(extensions.st_makepoint(target_longitude,target_latitude),4326)::extensions.geography)
            else false
          end
      )
      and not exists(
        select 1 from jsonb_array_elements_text(driver_required) required(capability_key)
        where not exists(
          select 1 from public.entity_capabilities capability
          where capability.entity_type='driver' and capability.entity_id=driver.id
            and capability.capability_key=required.capability_key and capability.status='active'
        )
      )
      and not exists(
        select 1 from jsonb_array_elements_text(vehicle_required) required(capability_key)
        where not exists(
          select 1 from public.entity_capabilities capability
          where capability.entity_type='vehicle' and capability.entity_id=vehicle.id
            and capability.capability_key=required.capability_key and capability.status='active'
        )
      )
  );
end
$function$;
revoke all on function public.lpg_independent_live_driver_available_at(numeric,numeric) from public,anon;
grant execute on function public.lpg_independent_live_driver_available_at(numeric,numeric) to authenticated,service_role;


CREATE OR REPLACE FUNCTION public.read_lpg_marketplace_eligible_stations(target_pickup_location_id uuid, target_delivery_location_id uuid, target_cylinder_id uuid, target_requested_kg numeric, target_limit integer DEFAULT 10, target_at timestamp with time zone DEFAULT timezone('utc'::text, now()))
 RETURNS TABLE(station_branch_id uuid, display_name text, formatted_address text, latitude numeric, longitude numeric, service_radius_meters integer, pickup_distance_meters numeric, return_distance_meters numeric, route_proxy_distance_meters numeric, currency_code text, price_per_kg numeric, current_available_kg numeric, refill_capacity_kg numeric, supported_cylinder_sizes_kg numeric[], cylinder_size_kg numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  actor_user_id uuid := auth.uid();
  pickup_record public.lpg_customer_locations%rowtype;
  delivery_record public.lpg_customer_locations%rowtype;
  cylinder_record public.lpg_cylinders%rowtype;
  pickup_serviceability jsonb;
  delivery_serviceability jsonb;
begin
  if actor_user_id is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  if target_requested_kg is null or target_requested_kg <= 0 then
    raise exception using errcode = '22023', message = 'target_requested_kg must be greater than zero';
  end if;

  if target_limit is null or target_limit < 1 or target_limit > 50 then
    raise exception using errcode = '22023', message = 'target_limit must be between 1 and 50';
  end if;

  select * into pickup_record
  from public.lpg_customer_locations
  where id = target_pickup_location_id
    and owner_user_id = actor_user_id
    and status <> 'deleted';
  if not found then
    raise exception using errcode = '42501', message = 'pickup location is not available to this customer';
  end if;

  select * into delivery_record
  from public.lpg_customer_locations
  where id = target_delivery_location_id
    and owner_user_id = actor_user_id
    and status <> 'deleted';
  if not found then
    raise exception using errcode = '42501', message = 'return location is not available to this customer';
  end if;

  select * into cylinder_record
  from public.lpg_cylinders
  where id = target_cylinder_id
    and owner_user_id = actor_user_id
    and status <> 'deactivated';
  if not found then
    raise exception using errcode = '42501', message = 'cylinder is not available to this customer';
  end if;

  if target_requested_kg > cylinder_record.max_capacity_kg then
    raise exception using errcode = '22023', message = 'requested refill exceeds verified cylinder capacity';
  end if;

  pickup_serviceability := public.resolve_lpg_serviceability(
    pickup_record.latitude::double precision,
    pickup_record.longitude::double precision,
    coalesce(pickup_record.metadata, '{}'::jsonb)
      || jsonb_build_object('formattedAddress', pickup_record.formatted_address)
  );
  delivery_serviceability := public.resolve_lpg_serviceability(
    delivery_record.latitude::double precision,
    delivery_record.longitude::double precision,
    coalesce(delivery_record.metadata, '{}'::jsonb)
      || jsonb_build_object('formattedAddress', delivery_record.formatted_address)
  );

  if not coalesce((pickup_serviceability ->> 'serviceable')::boolean, false)
     or not coalesce((delivery_serviceability ->> 'serviceable')::boolean, false) then
    return;
  end if;

  -- Marketplace stations are only orderable when a verified independent driver
  -- has a fresh live location, active eligible vehicle, and approved coverage.
  if not public.lpg_independent_live_driver_available_at(
      pickup_record.latitude,pickup_record.longitude
    )
    or not public.lpg_independent_live_driver_available_at(
      delivery_record.latitude,delivery_record.longitude
    ) then
    return;
  end if;

  return query
  with candidate_stations as (
    select
      station.*,
      public.geo_distance_meters(
        station.latitude::double precision,
        station.longitude::double precision,
        pickup_record.latitude::double precision,
        pickup_record.longitude::double precision
      )::numeric as pickup_distance,
      public.geo_distance_meters(
        station.latitude::double precision,
        station.longitude::double precision,
        delivery_record.latitude::double precision,
        delivery_record.longitude::double precision
      )::numeric as return_distance
    from public.lpg_station_branches station
    where station.approval_status = 'approved'
      and station.compliance_status = 'approved'
      and station.availability_status = 'available'
      and station.latitude is not null
      and station.longitude is not null
      and coalesce(station.current_available_kg, 0) >= target_requested_kg
      and coalesce(station.refill_capacity_kg, 0) >= target_requested_kg
      and (
        coalesce(array_length(station.supported_cylinder_sizes_kg, 1), 0) = 0
        or cylinder_record.size_kg = any(station.supported_cylinder_sizes_kg)
      )
  ),
  effective_prices as (
    select distinct on (station.id)
      station.id as station_id,
      station.display_name,
      station.formatted_address,
      station.latitude,
      station.longitude,
      station.service_radius_meters,
      station.pickup_distance,
      station.return_distance,
      station.current_available_kg,
      station.refill_capacity_kg,
      station.supported_cylinder_sizes_kg,
      catalog_price.currency_code,
      catalog_price.amount as price_per_kg
    from candidate_stations station
    join public.catalog_prices catalog_price
      on catalog_price.organization_id = station.organization_id
     and catalog_price.branch_id is not distinct from station.branch_id
    join public.catalog_items catalog_item
      on catalog_item.id = catalog_price.item_id
    join public.business_modules module
      on module.id = catalog_item.module_id
     and module.key = 'lpg'
    where catalog_item.status = 'active'
      and catalog_item.item_type in ('product', 'service')
      and catalog_price.status = 'active'
      and catalog_price.currency_code = 'NGN'
      and catalog_price.effective_from <= target_at
      and (catalog_price.effective_until is null or catalog_price.effective_until > target_at)
      and catalog_price.metadata ->> 'price_basis' = 'per_kg'
      and catalog_price.amount >= 0
      and station.service_radius_meters is not null
      and station.service_radius_meters > 0
      and greatest(station.pickup_distance, station.return_distance) <= station.service_radius_meters
    order by station.id, catalog_price.effective_from desc, catalog_price.created_at desc
  )
  select
    priced.station_id,
    priced.display_name,
    priced.formatted_address,
    priced.latitude,
    priced.longitude,
    priced.service_radius_meters,
    round(priced.pickup_distance, 2),
    round(priced.return_distance, 2),
    round(priced.pickup_distance + priced.return_distance, 2),
    priced.currency_code,
    priced.price_per_kg,
    priced.current_available_kg,
    priced.refill_capacity_kg,
    priced.supported_cylinder_sizes_kg,
    cylinder_record.size_kg
  from effective_prices priced
  order by
    priced.pickup_distance + priced.return_distance asc,
    priced.price_per_kg asc,
    priced.station_id asc
  limit target_limit;
end;
$function$;


CREATE OR REPLACE FUNCTION public.create_lpg_marketplace_refill_quote_from_purchase_input(target_cylinder_id uuid, target_requested_kg numeric, target_requested_amount numeric, target_pickup_location_id uuid, target_delivery_location_id uuid, target_station_branch_id uuid, target_route_snapshot jsonb, target_idempotency_key text, target_preferred_time timestamp with time zone DEFAULT NULL::timestamp with time zone, target_delivery_instructions text DEFAULT NULL::text, target_metadata jsonb DEFAULT '{}'::jsonb, target_source text DEFAULT 'lpg.quote_api'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare resolved_kg numeric;
begin
 if (target_requested_kg is null) = (target_requested_amount is null) then raise exception using errcode='22023',message='choose exactly one purchase input'; end if;
 resolved_kg:=case when target_requested_amount is not null then public.resolve_lpg_refill_quantity_from_amount(target_station_branch_id,target_requested_amount) else target_requested_kg end;
 if target_station_branch_id is null then
   raise exception using errcode='55000',message='an active station and eligible fulfilment route are required before quoting';
 end if;
 if lower(coalesce(target_metadata->>'fulfillment_mode','independent_driver'))='station_managed' then
   if not exists(
     select 1 from public.read_lpg_station_managed_eligible_stations(
       target_pickup_location_id,target_delivery_location_id,target_cylinder_id,resolved_kg,50,timezone('utc',now())
     ) option where option.station_branch_id=target_station_branch_id
   ) then
     raise exception using errcode='55000',message='no active Station Managed station, driver and eligible vehicle can serve these locations and refill quantity';
   end if;
 else
   if not exists(
     select 1 from public.read_lpg_eligible_stations(
       target_pickup_location_id,target_delivery_location_id,target_cylinder_id,resolved_kg,50,timezone('utc',now())
     ) option where option.station_branch_id=target_station_branch_id
   ) then
     raise exception using errcode='55000',message='no active independent driver and eligible station can serve these locations and refill quantity';
   end if;
 end if;
 return public.create_lpg_refill_quote_from_commercial_snapshot(target_cylinder_id,resolved_kg,target_pickup_location_id,target_delivery_location_id,target_station_branch_id,target_route_snapshot,target_idempotency_key,target_preferred_time,target_delivery_instructions,coalesce(target_metadata,'{}')||jsonb_build_object('purchaseInput',case when target_requested_amount is null then 'weight' else 'amount' end,'requestedAmount',target_requested_amount),target_source);
end $function$


CREATE OR REPLACE FUNCTION public.read_lpg_internal_candidate_for_kg(target_pickup_location_id uuid, target_delivery_location_id uuid, target_cylinder_id uuid, target_requested_kg numeric, target_at timestamp with time zone DEFAULT timezone('utc'::text, now()))
 RETURNS TABLE(station_branch_id uuid, display_name text, formatted_address text, latitude numeric, longitude numeric, service_radius_meters integer, pickup_distance_meters numeric, return_distance_meters numeric, route_proxy_distance_meters numeric, currency_code text, price_per_kg numeric, current_available_kg numeric, refill_capacity_kg numeric, supported_cylinder_sizes_kg numeric[], cylinder_size_kg numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  config jsonb;
  reference_policy jsonb;
  payout_policy jsonb;
  pickup_record public.lpg_customer_locations%rowtype;
  delivery_record public.lpg_customer_locations%rowtype;
  cylinder_record public.lpg_cylinders%rowtype;
  reference_price numeric;
  route_km numeric;
  payout_percentage numeric;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;

  config:=public.lpg_policy_config('lpg.fulfillment.launch_assurance');
  if not coalesce((config->>'enabled')::boolean,false)
    or coalesce(config->>'mode','hybrid')='marketplace_only' then
    return;
  end if;

  select * into pickup_record from public.lpg_customer_locations
  where id=target_pickup_location_id and owner_user_id=auth.uid() and status<>'deleted';
  select * into delivery_record from public.lpg_customer_locations
  where id=target_delivery_location_id and owner_user_id=auth.uid() and status<>'deleted';
  select * into cylinder_record from public.lpg_cylinders
  where id=target_cylinder_id and owner_user_id=auth.uid() and status<>'deactivated';

  if pickup_record.id is null or delivery_record.id is null or cylinder_record.id is null then
    raise exception using errcode='42501',message='customer refill inputs are not available';
  end if;
  if target_requested_kg is null or target_requested_kg<=0
    or target_requested_kg>cylinder_record.max_capacity_kg then
    return;
  end if;

  if not coalesce((public.resolve_lpg_location_capability(
      'lpg','skima_managed_fulfillment',pickup_record.longitude,pickup_record.latitude,
      coalesce(pickup_record.metadata,'{}'::jsonb)||jsonb_build_object('formattedAddress',pickup_record.formatted_address),
      timezone('utc',now())
    )->>'available')::boolean,false)
    or not coalesce((public.resolve_lpg_location_capability(
      'lpg','skima_managed_fulfillment',delivery_record.longitude,delivery_record.latitude,
      coalesce(delivery_record.metadata,'{}'::jsonb)||jsonb_build_object('formattedAddress',delivery_record.formatted_address),
      timezone('utc',now())
    )->>'available')::boolean,false) then
    return;
  end if;
  if not public.lpg_internal_live_driver_available(pickup_record.latitude,pickup_record.longitude)
    or not public.lpg_internal_live_driver_available(delivery_record.latitude,delivery_record.longitude) then
    return;
  end if;

  begin
    reference_policy:=public.resolve_lpg_internal_reference_policy(target_pickup_location_id,target_at);
    payout_policy:=public.resolve_financial_policy(
      'payout.lpg.internal_driver','NGN',target_at,'lpg',null,'lpg.refill.internal','global',null
    );
  exception when others then
    return;
  end;

  reference_price:=nullif(reference_policy #>> '{configuration,amount_per_kg}','')::numeric;
  route_km:=nullif(reference_policy #>> '{configuration,estimated_route_km}','')::numeric;
  payout_percentage:=nullif(payout_policy #>> '{configuration,percentage}','')::numeric;
  if reference_price is null or reference_price<=0
    or route_km is null or route_km<0
    or payout_percentage is null or payout_percentage<=0 or payout_percentage>100 then
    return;
  end if;

  return query select
    coalesce(nullif(config->>'digital_station_id','')::uuid,'00000000-0000-0000-0000-000000000001'::uuid),
    coalesce(config->>'digital_station_label','SKIMA Fulfillment'),
    'SKIMA-managed refill. Your assigned SKIMA driver will use a suitable available LPG supplier.'::text,
    pickup_record.latitude,pickup_record.longitude,
    null::integer,
    0::numeric,0::numeric,round(route_km*1000,2),
    'NGN'::text,reference_price,
    999999999::numeric,999999999::numeric,array[]::numeric[],cylinder_record.size_kg;
end
$function$;


CREATE OR REPLACE FUNCTION public.create_lpg_internal_refill_quote(target_cylinder_id uuid, target_requested_kg numeric, target_pickup_location_id uuid, target_delivery_location_id uuid, target_route_snapshot jsonb, target_idempotency_key text, target_preferred_time timestamp with time zone DEFAULT NULL::timestamp with time zone, target_delivery_instructions text DEFAULT NULL::text, target_metadata jsonb DEFAULT '{}'::jsonb, target_source text DEFAULT 'lpg.quote_api'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  cylinder_record public.lpg_cylinders%rowtype;
  pickup_record public.lpg_customer_locations%rowtype;
  delivery_record public.lpg_customer_locations%rowtype;
  module_record record;
  pricing_policy_record record;
  settlement_policy_id uuid;
  dispatch_policy_id uuid;
  service_request_id uuid;
  price_quote_id uuid;
  quote_id uuid;
  quote_policy jsonb;
  quote_expiry_seconds integer;
  commercial_snapshot jsonb;
  financial_snapshot jsonb;
  quote_expires_at timestamptz;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authenticated user is required';
  end if;
  if target_requested_kg is null or target_requested_kg<=0 then
    raise exception using errcode='22023',message='requested kilograms must be greater than zero';
  end if;
  if coalesce(btrim(target_idempotency_key),'')='' then
    raise exception using errcode='22023',message='idempotency key is required';
  end if;
  if target_metadata is null or jsonb_typeof(target_metadata)<>'object' then
    raise exception using errcode='22023',message='metadata must be an object';
  end if;

  select * into cylinder_record
  from public.lpg_cylinders
  where id=target_cylinder_id and owner_user_id=auth.uid()
  for update;
  if not found then
    raise exception using errcode='42501',message='cylinder is not available to this customer';
  end if;
  if cylinder_record.status not in ('active','pending_verification','verified')
    or cylinder_record.condition_status in ('damaged','unsafe','expired') then
    raise exception using errcode='55000',message='cylinder is not eligible for refill';
  end if;
  if target_requested_kg>cylinder_record.max_capacity_kg then
    raise exception using errcode='22023',message='requested refill exceeds cylinder maximum capacity';
  end if;

  select * into pickup_record
  from public.lpg_customer_locations
  where id=target_pickup_location_id and owner_user_id=auth.uid() and status='active';
  if not found then
    raise exception using errcode='42501',message='pickup location is not available to this customer';
  end if;

  select * into delivery_record
  from public.lpg_customer_locations
  where id=target_delivery_location_id and owner_user_id=auth.uid() and status='active';
  if not found then
    raise exception using errcode='42501',message='return location is not available to this customer';
  end if;

  if not coalesce((public.resolve_lpg_location_capability(
      'lpg','skima_managed_fulfillment',pickup_record.longitude,pickup_record.latitude,
      coalesce(pickup_record.metadata,'{}'::jsonb)||jsonb_build_object('formattedAddress',pickup_record.formatted_address),
      timezone('utc',now())
    )->>'available')::boolean,false)
    or not coalesce((public.resolve_lpg_location_capability(
      'lpg','skima_managed_fulfillment',delivery_record.longitude,delivery_record.latitude,
      coalesce(delivery_record.metadata,'{}'::jsonb)||jsonb_build_object('formattedAddress',delivery_record.formatted_address),
      timezone('utc',now())
    )->>'available')::boolean,false) then
    raise exception using errcode='55000',message='SKIMA Managed fulfilment is not enabled for both selected locations';
  end if;
  if not public.lpg_internal_live_driver_available(pickup_record.latitude,pickup_record.longitude)
    or not public.lpg_internal_live_driver_available(delivery_record.latitude,delivery_record.longitude) then
    raise exception using errcode='55000',message='no active SKIMA Managed driver and eligible fleet vehicle can serve both selected locations';
  end if;

  commercial_snapshot:=public.calculate_lpg_internal_commercial_quote(
    target_pickup_location_id,target_requested_kg,target_route_snapshot,timezone('utc',now())
  );
  financial_snapshot:=commercial_snapshot->'policySnapshots';

  quote_policy:=public.lpg_policy_config('lpg.quote.phase_one');
  quote_expiry_seconds:=nullif(quote_policy->>'quote_expiry_seconds','')::integer;
  if quote_expiry_seconds is null or quote_expiry_seconds<=0 then
    raise exception using errcode='55000',message='LPG quote expiry policy is incomplete';
  end if;
  quote_expires_at:=timezone('utc',now())+make_interval(secs=>quote_expiry_seconds);

  select module.id,version.id as version_id into module_record
  from public.business_modules module
  join public.business_module_versions version on version.module_id=module.id
  where module.key='lpg' and module.status='active' and version.status='active'
  order by version.version desc limit 1;
  if not found then
    raise exception using errcode='55000',message='active LPG module version is required';
  end if;

  select * into pricing_policy_record
  from public.pricing_policies
  where key=quote_policy->>'pricing_policy_key' and status='active'
  order by version desc limit 1;
  if not found then
    raise exception using errcode='55000',message='active LPG pricing policy is required';
  end if;

  select id into settlement_policy_id
  from public.settlement_policies
  where key='settlement.lpg.escrow.skima-internal.v1' and status='active'
  order by version desc limit 1;
  if settlement_policy_id is null then
    raise exception using errcode='55000',message='active SKIMA internal LPG settlement policy is required';
  end if;

  select id into dispatch_policy_id
  from public.dispatch_policies
  where key=quote_policy->>'dispatch_policy_key' and status='active'
  limit 1;
  if dispatch_policy_id is null then
    raise exception using errcode='55000',message='active LPG dispatch policy is required';
  end if;

  insert into public.service_requests(
    module_id,module_version_id,requester_user_id,pricing_policy_id,settlement_policy_id,
    dispatch_policy_id,status,request_payload,participants,source,idempotency_key,metadata
  ) values(
    module_record.id,module_record.version_id,auth.uid(),pricing_policy_record.id,settlement_policy_id,
    dispatch_policy_id,'priced',
    jsonb_build_object(
      'bounded_context','lpg',
      'fulfillment_channel','skima_internal',
      'cylinder_id',target_cylinder_id,
      'requested_kg',target_requested_kg,
      'pickup_location',jsonb_build_object('id',pickup_record.id,'latitude',pickup_record.latitude,'longitude',pickup_record.longitude),
      'delivery_location',jsonb_build_object('id',delivery_record.id,'latitude',delivery_record.latitude,'longitude',delivery_record.longitude),
      'dropoff_location',jsonb_build_object('id',delivery_record.id,'latitude',delivery_record.latitude,'longitude',delivery_record.longitude),
      'station_branch_id',null,
      'preferred_time',target_preferred_time,
      'delivery_instructions',target_delivery_instructions
    ),
    jsonb_build_object('customer_user_id',auth.uid(),'fulfillment_channel','skima_internal'),
    target_source,target_idempotency_key||':service-request',
    target_metadata || jsonb_build_object('quote_policy_key','lpg.quote.phase_one','fulfillmentChannel','skima_internal')
  )
  on conflict(source,idempotency_key) do nothing
  returning id into service_request_id;

  if service_request_id is null then
    select id into quote_id
    from public.lpg_refill_quotes
    where source=target_source and idempotency_key=target_idempotency_key;
    if quote_id is not null then return quote_id; end if;
    raise exception 'LPG internal quote idempotency lookup failed';
  end if;

  insert into public.price_quotes(
    service_request_id,pricing_policy_id,module_id,currency_code,status,
    subtotal_amount,fee_amount,discount_amount,tax_amount,total_amount,
    pricing_context,calculation_breakdown,expires_at,source,idempotency_key,created_by
  ) values(
    service_request_id,pricing_policy_record.id,module_record.id,'NGN','calculated',
    (commercial_snapshot->>'stationLpgAmount')::numeric + (commercial_snapshot->>'customerDeliveryFee')::numeric,
    (commercial_snapshot->>'platformLpgMarkup')::numeric,
    0,0,
    (commercial_snapshot->>'stationLpgAmount')::numeric
      + (commercial_snapshot->>'customerDeliveryFee')::numeric
      + (commercial_snapshot->>'platformLpgMarkup')::numeric,
    jsonb_build_object(
      'requested_kg',target_requested_kg,
      'fulfillment_channel','skima_internal',
      'internal_reference_policy_version_id',commercial_snapshot #>> '{policySnapshots,internalReference,policyVersionId}'
    ),
    commercial_snapshot,
    quote_expires_at,target_source,target_idempotency_key||':price-quote',auth.uid()
  )
  returning id into price_quote_id;

  update public.service_requests
  set active_quote_id=price_quote_id,updated_at=timezone('utc',now())
  where id=service_request_id;

  insert into public.lpg_refill_quotes(
    service_request_id,price_quote_id,cylinder_id,pickup_location_id,delivery_location_id,
    station_branch_id,pricing_id,requested_kg,quoted_kg,currency_code,lpg_amount,
    delivery_fee_amount,platform_fee_amount,tax_amount,driver_commission_amount,total_amount,
    status,expires_at,breakdown,financial_policy_snapshot,fulfillment_channel,metadata,
    source,idempotency_key
  ) values(
    service_request_id,price_quote_id,target_cylinder_id,target_pickup_location_id,target_delivery_location_id,
    null,null,target_requested_kg,target_requested_kg,'NGN',
    (commercial_snapshot->>'stationLpgAmount')::numeric,
    (commercial_snapshot->>'customerDeliveryFee')::numeric,
    (commercial_snapshot->>'platformLpgMarkup')::numeric,
    0,
    (commercial_snapshot->>'driverPayout')::numeric,
    (commercial_snapshot->>'stationLpgAmount')::numeric
      + (commercial_snapshot->>'customerDeliveryFee')::numeric
      + (commercial_snapshot->>'platformLpgMarkup')::numeric,
    'quoted',quote_expires_at,commercial_snapshot,financial_snapshot,'skima_internal',
    target_metadata || jsonb_build_object(
      'commercial_policy_snapshot',commercial_snapshot,
      'commercial_policy_snapshot_locked',true,
      'fulfillmentChannel','skima_internal'
    ),
    target_source,target_idempotency_key
  )
  returning id into quote_id;

  insert into public.service_request_events(
    service_request_id,event_type_key,status,idempotency_key,metadata
  ) values(
    service_request_id,'event.request.created','priced',target_idempotency_key||':lpg:quoted',
    jsonb_build_object('lpg_quote_id',quote_id,'price_quote_id',price_quote_id,'fulfillment_channel','skima_internal')
  ) on conflict do nothing;

  return quote_id;
end
$function$;


comment on function public.resolve_lpg_location_capability is
  'Resolves bounded geographic policies by point-in-polygon and named administrative policies by normalized address hierarchy. A location policy never proves provider readiness.';
comment on function public.lpg_independent_live_driver_available_at is
  'Returns true only if an approved independent driver has fresh live location, active compliant vehicle, required capabilities, current workload capacity and approved operational coverage at the requested pickup point.';

commit;
