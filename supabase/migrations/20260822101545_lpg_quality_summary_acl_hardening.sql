create or replace function public.read_lpg_quality_summary(
  target_subject_type text,
  target_subject_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  relationship_count integer;
  event_count integer;
  average_rating numeric;
  weighted_score numeric;
  complaint_count integer;
begin
  if not (public.has_permission('lpg.quality.read',null) or public.has_permission('lpg.quality.manage',null)) then
    raise exception using errcode='42501', message='quality read permission required';
  end if;

  if target_subject_type not in ('driver','station') or target_subject_id is null then
    return null;
  end if;

  if target_subject_type='driver' then
    select count(*),avg(current_rating)::numeric(4,2)
    into relationship_count,average_rating
    from public.lpg_rating_relationships
    where driver_profile_id=target_subject_id and subject_type='driver';

    select count(*) into event_count
    from public.lpg_rating_events
    where driver_profile_id=target_subject_id and subject_type='driver' and status='active';

    select count(*) into complaint_count
    from public.lpg_service_complaints
    where driver_profile_id=target_subject_id and status not in ('dismissed','resolved');
  else
    select count(*),avg(current_rating)::numeric(4,2)
    into relationship_count,average_rating
    from public.lpg_rating_relationships
    where station_branch_id=target_subject_id and subject_type='station';

    select count(*) into event_count
    from public.lpg_rating_events
    where station_branch_id=target_subject_id and subject_type='station' and status='active';

    select count(*) into complaint_count
    from public.lpg_service_complaints
    where station_branch_id=target_subject_id and status not in ('dismissed','resolved');
  end if;

  weighted_score:=case when coalesce(relationship_count,0)=0 then null else (((coalesce(average_rating,0)*relationship_count)+(4.0*5))/(relationship_count+5))::numeric(4,2) end;

  return jsonb_build_object(
    'subjectType',target_subject_type,
    'subjectId',target_subject_id,
    'averageRating',average_rating,
    'relationshipCount',coalesce(relationship_count,0),
    'ratingEventCount',coalesce(event_count,0),
    'qualityScore',weighted_score,
    'openComplaintCount',coalesce(complaint_count,0)
  );
end;
$$;

revoke all on function public.read_lpg_quality_summary(text,uuid) from public,anon;
grant execute on function public.read_lpg_quality_summary(text,uuid) to authenticated,service_role;

comment on function public.read_lpg_quality_summary(text,uuid) is
  'Internal LPG quality summary. Complaint counts and weighted quality data require SKIMA quality permissions. Public clients should use read_lpg_partner_reputation instead.';
