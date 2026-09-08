begin;

-- Live admin/runtime reconciliation for production LPG operations.
-- 1) Retire the legacy two-argument quality queue overload that makes PostgREST
--    calls with target_status + target_limit ambiguous.
drop function if exists public.read_lpg_quality_admin_queue(text, integer);

revoke all on function public.read_lpg_quality_admin_queue(text, text, integer)
  from public, anon;
grant execute on function public.read_lpg_quality_admin_queue(text, text, integer)
  to authenticated, service_role;

-- 2) application_records has never owned a public_reference column. Keep the
--    admin verification exception queue human-readable without depending on a
--    non-existent field.
create or replace function public.read_verification_exception_queue()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.role() <> 'service_role'
     and not public.can_review_applications()
     and not public.has_permission('platform.verification.read', null)
     and not public.has_permission('platform.verification.manage', null) then
    raise exception using errcode = '42501',
      message = 'verification review permission is required';
  end if;

  select coalesce(jsonb_agg(item order by item ->> 'updatedAt' desc), '[]'::jsonb)
  into result
  from (
    select jsonb_build_object(
      'applicationId', application.id,
      'publicReference', coalesce(
        nullif(application.metadata ->> 'publicReference', ''),
        nullif(application.metadata ->> 'public_reference', ''),
        'APP-' || upper(substr(replace(application.id::text, '-', ''), 1, 12))
      ),
      'applicationStatus', application.status,
      'operationalStatus', application.operational_status,
      'applicationTypeKey', application_type.key,
      'applicationCategory', application_type.application_category,
      'applicantUserId', application.applicant_user_id,
      'applicantName', profile.display_name,
      'unresolvedVerificationCount',
        coalesce((application.metadata ->> 'verification_unresolved_count')::integer, 0),
      'manualReviewCount',
        coalesce((application.metadata ->> 'verification_manual_review_count')::integer, 0),
      'latestVerificationStatus', latest_verification.status,
      'latestVerificationKey', latest_verification.verification_key,
      'latestFailureMessage', latest_verification.failure_message,
      'updatedAt', application.updated_at
    ) as item
    from public.application_records application
    join public.application_type_definitions application_type
      on application_type.id = application.application_type_id
    left join public.profiles profile
      on profile.id = application.applicant_user_id
    left join lateral (
      select
        session.status,
        definition.key as verification_key,
        session.failure_message
      from public.application_verification_sessions session
      join public.application_verification_requirements mapping
        on mapping.id = session.application_verification_requirement_id
      join public.verification_definitions definition
        on definition.id = mapping.verification_definition_id
      where session.application_id = application.id
        and session.status in ('failed', 'manual_review', 'expired')
      order by session.updated_at desc
      limit 1
    ) latest_verification on true
    where application_type.key in (
      'application.lpg.driver.phase-one',
      'application.lpg.station.phase-one',
      'application.lpg.vehicle.phase-one'
    )
      and application.status in (
        'submitted', 'resubmitted', 'under_review', 'additional_info_required'
      )
      and (
        coalesce((application.metadata ->> 'verification_unresolved_count')::integer, 0) > 0
        or coalesce((application.metadata ->> 'verification_manual_review_count')::integer, 0) > 0
        or latest_verification.status is not null
      )
  ) queue;

  return result;
end;
$$;

revoke all on function public.read_verification_exception_queue()
  from public, anon;
grant execute on function public.read_verification_exception_queue()
  to authenticated, service_role;

-- 3) The canonical helper was introduced with numeric arguments, while the
--    PostGIS-backed live driver position resolves to double precision. Supply
--    exact overloads so dispatch/retry and nearby station reads cannot fail on
--    PostgreSQL function-resolution type mismatches.
create or replace function public.lpg_distance_meters(
  origin_latitude numeric,
  origin_longitude numeric,
  target_latitude double precision,
  target_longitude double precision
)
returns numeric
language sql
immutable
strict
parallel safe
set search_path = public, pg_temp
as $$
  select public.lpg_distance_meters(
    origin_latitude,
    origin_longitude,
    target_latitude::numeric,
    target_longitude::numeric
  );
$$;

create or replace function public.lpg_distance_meters(
  origin_latitude double precision,
  origin_longitude double precision,
  target_latitude numeric,
  target_longitude numeric
)
returns numeric
language sql
immutable
strict
parallel safe
set search_path = public, pg_temp
as $$
  select public.lpg_distance_meters(
    origin_latitude::numeric,
    origin_longitude::numeric,
    target_latitude,
    target_longitude
  );
$$;

create or replace function public.lpg_distance_meters(
  origin_latitude double precision,
  origin_longitude double precision,
  target_latitude double precision,
  target_longitude double precision
)
returns numeric
language sql
immutable
strict
parallel safe
set search_path = public, pg_temp
as $$
  select public.lpg_distance_meters(
    origin_latitude::numeric,
    origin_longitude::numeric,
    target_latitude::numeric,
    target_longitude::numeric
  );
$$;

notify pgrst, 'reload schema';

commit;
