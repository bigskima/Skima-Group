begin;
set local role service_role;

-- Arbitrary geography proof: no country, state, LGA, city, or business-specific branch is used.
do $$
declare
  country_level uuid:=gen_random_uuid(); region_level uuid:=gen_random_uuid(); district_level uuid:=gen_random_uuid(); town_level uuid:=gen_random_uuid();
  country_id uuid:=gen_random_uuid(); region_id uuid:=gen_random_uuid(); district_id uuid:=gen_random_uuid(); delta_id uuid:=gen_random_uuid(); epsilon_id uuid:=gen_random_uuid();
  driver_id uuid:=gen_random_uuid(); decision jsonb; edge_decision jsonb;
begin
  insert into public.geography_levels(id,key,display_name,plural_display_name,depth,specificity_rank,status)
  values(country_level,'test_country','Test country','Test countries',0,10,'active');
  insert into public.geography_levels(id,key,display_name,plural_display_name,depth,specificity_rank,parent_level_id,status)
  values(region_level,'test_region','Test region','Test regions',1,20,country_level,'active'),
        (district_level,'test_district','Test district','Test districts',2,30,region_level,'active'),
        (town_level,'test_town','Test town','Test towns',3,40,district_level,'active');

  insert into public.geographies(id,parent_id,geography_level_id,canonical_name,normalized_name,country_code,boundary_geometry,source,external_reference,status)
  values
    (country_id,null,country_level,'Country Alpha','country alpha','AA',extensions.st_geogfromtext('SRID=4326;MULTIPOLYGON(((0 0,10 0,10 10,0 10,0 0)))'),'test','country','active'),
    (region_id,country_id,region_level,'Region Beta','region beta','AA',extensions.st_geogfromtext('SRID=4326;MULTIPOLYGON(((1 1,9 1,9 9,1 9,1 1)))'),'test','region','active'),
    (district_id,region_id,district_level,'District Gamma','district gamma','AA',extensions.st_geogfromtext('SRID=4326;MULTIPOLYGON(((2 2,8 2,8 8,2 8,2 2)))'),'test','district','active'),
    (delta_id,district_id,town_level,'Town Delta','town delta','AA',extensions.st_geogfromtext('SRID=4326;MULTIPOLYGON(((3 3,5 3,5 5,3 5,3 3)))'),'test','delta','active'),
    (epsilon_id,district_id,town_level,'Town Epsilon','town epsilon','AA',extensions.st_geogfromtext('SRID=4326;MULTIPOLYGON(((5 3,7 3,7 5,5 5,5 3)))'),'test','epsilon','active');

  insert into public.service_coverage_policies(service_key,capability_key,target_geography_id,effect,priority,status,reason)
  values('test_service','customer_ordering',region_id,'ALLOW',0,'active','test region launch'),
        ('test_service','customer_ordering',district_id,'DENY',0,'active','test district exclusion'),
        ('test_service','customer_ordering',delta_id,'ALLOW',0,'active','test town re-enable');

  decision:=public.resolve_service_availability('test_service','customer_ordering',4,4,timezone('utc',now()));
  if decision->>'reason'<>'AVAILABLE' or decision->>'matchedGeographyId'<>delta_id::text then
    raise exception 'town override failed: %',decision;
  end if;
  decision:=public.resolve_service_availability('test_service','customer_ordering',6,4,timezone('utc',now()));
  if decision->>'reason'<>'AREA_EXCLUDED' or decision->>'matchedGeographyId'<>district_id::text then
    raise exception 'district exclusion failed: %',decision;
  end if;
  edge_decision:=public.resolve_service_availability('test_service','customer_ordering',3,4,timezone('utc',now()));
  if edge_decision->>'reason'<>'AVAILABLE' then raise exception 'boundary ST_Covers behavior failed: %',edge_decision; end if;
  decision:=public.resolve_service_availability('another_service','customer_ordering',4,4,timezone('utc',now()));
  if decision->>'reason'<>'SERVICE_NOT_LAUNCHED' then raise exception 'service isolation failed: %',decision; end if;

  insert into public.service_coverage_policies(service_key,capability_key,target_geography_id,effect,priority,status,reason)
  values('test_service','customer_ordering',delta_id,'DENY',0,'active','intentional tie test');
  decision:=public.resolve_service_availability('test_service','customer_ordering',4,4,timezone('utc',now()));
  if decision->>'reason'<>'POLICY_CONFIGURATION_CONFLICT' then raise exception 'tied policy conflict failed: %',decision; end if;
  delete from public.service_coverage_policies where reason='intentional tie test';

  insert into public.service_coverage_policies(service_key,capability_key,target_geography_id,effect,priority,status,starts_at,ends_at,reason)
  values('test_service','expired_capability',delta_id,'ALLOW',0,'active',timezone('utc',now())-interval '2 days',timezone('utc',now())-interval '1 day','expired test');
  decision:=public.resolve_service_availability('test_service','expired_capability',4,4,timezone('utc',now()));
  if decision->>'reason'<>'SERVICE_NOT_LAUNCHED' then raise exception 'expired policy was not ignored: %',decision; end if;

  insert into public.operational_coverage_assignments(entity_type,entity_id,service_key,coverage_type,geography_id,status,source,approved_at)
  values('DRIVER',driver_id,'test_service','ADMIN_GEOGRAPHY',delta_id,'active','ADMIN_ASSIGNED',timezone('utc',now())),
        ('DRIVER',driver_id,'test_service','ADMIN_GEOGRAPHY',epsilon_id,'active','ADMIN_ASSIGNED',timezone('utc',now()));
  decision:=public.resolve_operational_coverage_eligibility('DRIVER',driver_id,'test_service',6,4,timezone('utc',now()));
  if not coalesce((decision->>'eligible')::boolean,false) then raise exception 'multiple geography coverage failed: %',decision; end if;

  insert into public.operational_coverage_assignments(entity_type,entity_id,service_key,coverage_type,center_point,radius_meters,status,source,approved_at)
  values('DRIVER',driver_id,'test_service','RADIUS',extensions.st_geogfromtext('SRID=4326;POINT(4 4)'),150000,'active','ADMIN_ASSIGNED',timezone('utc',now()));
  decision:=public.resolve_operational_coverage_eligibility('DRIVER',driver_id,'test_service',4.5,4,timezone('utc',now()));
  if not coalesce((decision->>'eligible')::boolean,false) then raise exception 'radius coverage failed: %',decision; end if;

  insert into public.operational_coverage_assignments(entity_type,entity_id,service_key,coverage_type,coverage_geometry,status,source,approved_at)
  values('DRIVER',driver_id,'test_service','CUSTOM_ZONE',extensions.st_geogfromtext('SRID=4326;MULTIPOLYGON(((7 6,9 6,9 8,7 8,7 6)))'),'active','ADMIN_ASSIGNED',timezone('utc',now()));
  decision:=public.resolve_operational_coverage_eligibility('DRIVER',driver_id,'test_service',8,7,timezone('utc',now()));
  if not coalesce((decision->>'eligible')::boolean,false) then raise exception 'custom zone coverage failed: %',decision; end if;

  insert into public.operational_coverage_assignments(entity_type,entity_id,service_key,coverage_type,center_point,radius_meters,status,source)
  values('DRIVER',driver_id,'test_service','RADIUS',extensions.st_geogfromtext('SRID=4326;POINT(20 20)'),1000,'requested','REQUESTED');
  decision:=public.resolve_operational_coverage_eligibility('DRIVER',driver_id,'test_service',20,20,timezone('utc',now()));
  if coalesce((decision->>'eligible')::boolean,false) then raise exception 'requested coverage granted eligibility: %',decision; end if;
  decision:=public.resolve_operational_coverage_eligibility('DRIVER',driver_id,'another_service',4,4,timezone('utc',now()));
  if coalesce((decision->>'eligible')::boolean,false) then raise exception 'wrong-service coverage granted eligibility: %',decision; end if;

  insert into public.operational_coverage_assignments(entity_type,entity_id,service_key,coverage_type,center_point,radius_meters,status,source,valid_from,valid_to,approved_at)
  values('DRIVER',driver_id,'test_service','RADIUS',extensions.st_geogfromtext('SRID=4326;POINT(30 30)'),1000,'expired','ADMIN_ASSIGNED',
    timezone('utc',now())-interval '2 days',timezone('utc',now())-interval '1 day',timezone('utc',now())-interval '2 days');
  decision:=public.resolve_operational_coverage_eligibility('DRIVER',driver_id,'test_service',30,30,timezone('utc',now()));
  if coalesce((decision->>'eligible')::boolean,false) then raise exception 'expired coverage granted eligibility: %',decision; end if;
end $$;

rollback;
