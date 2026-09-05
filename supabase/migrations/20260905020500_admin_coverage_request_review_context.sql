begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

create or replace function public.read_application_coverage_requests_admin(
  p_status text default 'REQUESTED'
)
returns table (
  id uuid,
  application_id uuid,
  application_version_id uuid,
  applicant_user_id uuid,
  entity_type text,
  service_key text,
  coverage_type text,
  status text,
  radius_meters numeric,
  center_longitude double precision,
  center_latitude double precision,
  geography_name text,
  location_verification_status text,
  formatted_address text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  requested_status text := upper(btrim(coalesce(p_status, 'REQUESTED')));
  can_read_location_evidence boolean;
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and not public.is_platform_super_admin()
     and not public.has_permission('platform.coverage.read', null)
     and not public.has_permission('platform.coverage.manage', null) then
    raise exception using errcode = '42501', message = 'coverage read permission required';
  end if;

  if requested_status not in ('REQUESTED', 'APPROVED', 'REJECTED', 'WITHDRAWN') then
    raise exception using errcode = '22023', message = 'invalid coverage request status';
  end if;

  can_read_location_evidence := coalesce(auth.role(), '') = 'service_role'
    or public.is_platform_super_admin()
    or public.has_permission('platform.location_evidence.read', null);

  return query
  select
    request.id,
    request.application_id,
    request.application_version_id,
    request.applicant_user_id,
    request.entity_type,
    request.service_key,
    request.coverage_type,
    request.status,
    request.radius_meters,
    case
      when request.center_point is null then null
      else extensions.st_x(request.center_point::extensions.geometry)
    end,
    case
      when request.center_point is null then null
      else extensions.st_y(request.center_point::extensions.geometry)
    end,
    geography.canonical_name,
    verification.status,
    case when can_read_location_evidence then verification.formatted_address else null end,
    request.created_at
  from public.application_operational_coverage_requests request
  left join public.geographies geography
    on geography.id = request.geography_id
  left join lateral (
    select
      evidence.status,
      evidence.formatted_address
    from public.application_location_verifications evidence
    where evidence.application_id = request.application_id
      and evidence.application_version_id = request.application_version_id
      and evidence.location_purpose = case request.entity_type
        when 'DRIVER' then 'driver.base_location'
        when 'STATION' then 'station.facility_location'
        else evidence.location_purpose
      end
    order by evidence.updated_at desc, evidence.id
    limit 1
  ) verification on true
  where request.status = requested_status
  order by request.created_at, request.id;
end;
$$;

revoke all on function public.read_application_coverage_requests_admin(text)
  from public, anon, authenticated;
grant execute on function public.read_application_coverage_requests_admin(text)
  to authenticated, service_role;

comment on function public.read_application_coverage_requests_admin(text) is
  'Returns Admin review context for universal partner coverage requests, including radius centers and verified application-location evidence. Formatted address is returned only to location-evidence readers.';

commit;
