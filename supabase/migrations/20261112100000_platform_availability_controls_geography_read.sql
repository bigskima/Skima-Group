begin;

create or replace function public.read_platform_availability_controls()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $function$
declare
  access_rules jsonb;
  maintenance_notices jsonb;
  geographies jsonb;
begin
  if auth.uid() is null
     or (
       not public.has_permission('platform.configuration.read', null)
       and not public.has_permission('platform.configuration.manage', null)
     ) then
    raise exception using errcode = '42501', message = 'Platform configuration permission is required';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', rule.id,
      'applicationKey', rule.application_key,
      'scopeType', rule.scope_type,
      'geographyId', rule.geography_id,
      'geographyName', geography.canonical_name,
      'countryCode', geography.country_code,
      'accessEffect', rule.access_effect,
      'title', rule.title,
      'message', rule.message,
      'status', rule.status,
      'startsAt', rule.starts_at,
      'endsAt', rule.ends_at,
      'updatedAt', rule.updated_at
    ) order by rule.application_key, rule.scope_type, geography.canonical_name nulls first, rule.updated_at desc
  ), '[]'::jsonb)
  into access_rules
  from public.platform_application_access_rules rule
  left join public.geographies geography on geography.id = rule.geography_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', notice.id,
      'serviceKey', notice.service_key,
      'scopeType', notice.scope_type,
      'geographyId', notice.geography_id,
      'geographyName', geography.canonical_name,
      'countryCode', geography.country_code,
      'isEnabled', notice.is_enabled,
      'impact', notice.impact,
      'title', notice.title,
      'message', notice.message,
      'status', notice.status,
      'startsAt', notice.starts_at,
      'endsAt', notice.ends_at,
      'updatedAt', notice.updated_at
    ) order by notice.service_key, notice.scope_type, geography.canonical_name nulls first, notice.updated_at desc
  ), '[]'::jsonb)
  into maintenance_notices
  from public.platform_service_maintenance_notices notice
  left join public.geographies geography on geography.id = notice.geography_id;

  -- This endpoint is already protected by platform configuration read/manage.
  -- Return only the fields needed to select a scope; do not expose map geometry,
  -- aliases, or coverage policy metadata to this workspace.
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', geography.id,
      'canonical_name', geography.canonical_name,
      'country_code', geography.country_code,
      'geography_level_name', level.display_name,
      'parent_name', parent.canonical_name,
      'status', geography.status
    ) order by level.specificity_rank, geography.canonical_name
  ), '[]'::jsonb)
  into geographies
  from public.geographies geography
  join public.geography_levels level on level.id = geography.geography_level_id
  left join public.geographies parent on parent.id = geography.parent_id
  where geography.status = 'active'
    and level.status = 'active';

  return jsonb_build_object(
    'applicationAccessRules', access_rules,
    'maintenanceNotices', maintenance_notices,
    'geographies', geographies,
    'canManage', public.has_permission('platform.configuration.manage', null)
  );
end;
$function$;

revoke all on function public.read_platform_availability_controls() from public, anon;
grant execute on function public.read_platform_availability_controls() to authenticated;

comment on function public.read_platform_availability_controls() is
  'Returns availability rules and only the active geography labels needed by authorized platform configuration managers.';

commit;
