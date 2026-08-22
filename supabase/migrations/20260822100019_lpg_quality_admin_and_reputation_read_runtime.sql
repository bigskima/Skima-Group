create or replace function public.read_lpg_quality_admin_queue(
  target_status text default null,
  target_severity text default null,
  target_limit integer default 100
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if not (public.has_permission('lpg.quality.read',null) or public.has_permission('lpg.quality.manage',null)) then
    raise exception using errcode='42501', message='quality read permission required';
  end if;

  if target_status is not null and target_status not in ('open','triaged','under_review','resolved','dismissed') then
    raise exception using errcode='22023', message='unsupported complaint status';
  end if;
  if target_severity is not null and target_severity not in ('standard','high','critical') then
    raise exception using errcode='22023', message='unsupported complaint severity';
  end if;

  select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb)
  into result
  from (
    select
      complaint.created_at,
      jsonb_build_object(
        'complaintId', complaint.id,
        'orderId', complaint.order_id,
        'orderReference', order_record.public_reference,
        'customerUserId', complaint.customer_user_id,
        'subjectType', complaint.subject_type,
        'driverProfileId', complaint.driver_profile_id,
        'stationBranchId', complaint.station_branch_id,
        'category', complaint.category,
        'severity', complaint.severity,
        'description', complaint.description,
        'status', complaint.status,
        'resolutionCode', complaint.resolution_code,
        'resolvedAt', complaint.resolved_at,
        'createdAt', complaint.created_at,
        'updatedAt', complaint.updated_at,
        'publicHistory', coalesce((
          select jsonb_agg(jsonb_build_object(
            'eventType', event.event_type,
            'fromStatus', event.from_status,
            'toStatus', event.to_status,
            'publicMessage', event.public_message,
            'createdAt', event.created_at
          ) order by event.created_at asc)
          from public.lpg_complaint_events event
          where event.complaint_id=complaint.id
        ),'[]'::jsonb)
      ) row_data
    from public.lpg_service_complaints complaint
    join public.lpg_refill_orders order_record on order_record.id=complaint.order_id
    where (target_status is null or complaint.status=target_status)
      and (target_severity is null or complaint.severity=target_severity)
    order by complaint.created_at desc
    limit least(greatest(coalesce(target_limit,100),1),500)
  ) queue;

  return result;
end;
$$;

create or replace function public.read_lpg_quality_metrics()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not (public.has_permission('lpg.quality.read',null) or public.has_permission('lpg.quality.manage',null)) then
    raise exception using errcode='42501', message='quality read permission required';
  end if;

  return jsonb_build_object(
    'openComplaints',(select count(*) from public.lpg_service_complaints where status in ('open','triaged','under_review')),
    'criticalOpenComplaints',(select count(*) from public.lpg_service_complaints where status in ('open','triaged','under_review') and severity='critical'),
    'resolvedComplaints',(select count(*) from public.lpg_service_complaints where status='resolved'),
    'ratingEvents',(select count(*) from public.lpg_rating_events where status='active'),
    'driverRelationships',(select count(*) from public.lpg_rating_relationships where subject_type='driver'),
    'stationRelationships',(select count(*) from public.lpg_rating_relationships where subject_type='station'),
    'averageDriverRating',(select round(avg(current_rating)::numeric,2) from public.lpg_rating_relationships where subject_type='driver'),
    'averageStationRating',(select round(avg(current_rating)::numeric,2) from public.lpg_rating_relationships where subject_type='station')
  );
end;
$$;

create or replace function public.read_lpg_partner_reputation(
  target_subject_type text,
  target_subject_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare result jsonb;
begin
  if target_subject_type not in ('driver','station') then
    raise exception using errcode='22023', message='reputation subject must be driver or station';
  end if;
  if target_subject_id is null then
    raise exception using errcode='22023', message='reputation subject id is required';
  end if;

  if target_subject_type='driver' then
    select jsonb_build_object(
      'subjectType','driver',
      'subjectId',target_subject_id,
      'averageRating',round(avg(current_rating)::numeric,2),
      'relationshipCount',count(*),
      'ratingEventCount',coalesce((select count(*) from public.lpg_rating_events event where event.subject_type='driver' and event.driver_profile_id=target_subject_id and event.status='active'),0),
      'recentAverageRating',coalesce((select round(avg(event.rating)::numeric,2) from public.lpg_rating_events event where event.subject_type='driver' and event.driver_profile_id=target_subject_id and event.status='active' and event.created_at>=timezone('utc',now())-interval '90 days'),null),
      'recentRatingCount',coalesce((select count(*) from public.lpg_rating_events event where event.subject_type='driver' and event.driver_profile_id=target_subject_id and event.status='active' and event.created_at>=timezone('utc',now())-interval '90 days'),0)
    ) into result
    from public.lpg_rating_relationships relationship
    where relationship.subject_type='driver' and relationship.driver_profile_id=target_subject_id;
  else
    select jsonb_build_object(
      'subjectType','station',
      'subjectId',target_subject_id,
      'averageRating',round(avg(current_rating)::numeric,2),
      'relationshipCount',count(*),
      'ratingEventCount',coalesce((select count(*) from public.lpg_rating_events event where event.subject_type='station' and event.station_branch_id=target_subject_id and event.status='active'),0),
      'recentAverageRating',coalesce((select round(avg(event.rating)::numeric,2) from public.lpg_rating_events event where event.subject_type='station' and event.station_branch_id=target_subject_id and event.status='active' and event.created_at>=timezone('utc',now())-interval '90 days'),null),
      'recentRatingCount',coalesce((select count(*) from public.lpg_rating_events event where event.subject_type='station' and event.station_branch_id=target_subject_id and event.status='active' and event.created_at>=timezone('utc',now())-interval '90 days'),0)
    ) into result
    from public.lpg_rating_relationships relationship
    where relationship.subject_type='station' and relationship.station_branch_id=target_subject_id;
  end if;

  return coalesce(result,jsonb_build_object(
    'subjectType',target_subject_type,
    'subjectId',target_subject_id,
    'averageRating',null,
    'relationshipCount',0,
    'ratingEventCount',0,
    'recentAverageRating',null,
    'recentRatingCount',0
  ));
end;
$$;

revoke all on function public.read_lpg_quality_admin_queue(text,text,integer) from public,anon;
revoke all on function public.read_lpg_quality_metrics() from public,anon;
revoke all on function public.read_lpg_partner_reputation(text,uuid) from public;
grant execute on function public.read_lpg_quality_admin_queue(text,text,integer) to authenticated,service_role;
grant execute on function public.read_lpg_quality_metrics() to authenticated,service_role;
grant execute on function public.read_lpg_partner_reputation(text,uuid) to anon,authenticated,service_role;

comment on function public.read_lpg_partner_reputation(text,uuid) is
  'Returns aggregate LPG service reputation only. It exposes no customer identity, comment, tag, complaint detail or internal moderation data.';
