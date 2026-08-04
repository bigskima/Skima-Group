begin;

drop policy if exists tracking_sessions_select_lpg_order_participant
on public.tracking_sessions;

create policy tracking_sessions_select_lpg_order_participant
on public.tracking_sessions
for select
to authenticated
using (
  subject_type = 'lpg_order'
  and public.can_access_lpg_order(subject_id)
);

drop policy if exists tracking_points_select_lpg_order_participant
on public.tracking_points;

create policy tracking_points_select_lpg_order_participant
on public.tracking_points
for select
to authenticated
using (
  exists (
    select 1
    from public.tracking_sessions tracking_session
    where tracking_session.id = tracking_points.tracking_session_id
      and tracking_session.subject_type = 'lpg_order'
      and public.can_access_lpg_order(tracking_session.subject_id)
  )
);

commit;
