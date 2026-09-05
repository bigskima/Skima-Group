begin;

-- Customer-facing complaint status projection for Ask SKIMA.
-- Exposes only the signed-in customer's own complaint records and public complaint history.
-- Internal moderation notes and unrelated customer complaints are never returned.

create or replace function public.read_my_lpg_service_complaints(
  target_limit integer default 10
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  result jsonb;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication required';
  end if;

  select coalesce(
    jsonb_agg(row_data order by created_at desc),
    '[]'::jsonb
  )
  into result
  from (
    select
      complaint.created_at,
      jsonb_build_object(
        'complaintId', complaint.id,
        'orderId', complaint.order_id,
        'orderReference', order_record.public_reference,
        'subjectType', complaint.subject_type,
        'category', complaint.category,
        'severity', complaint.severity,
        'description', complaint.description,
        'status', complaint.status,
        'resolutionCode', complaint.resolution_code,
        'resolvedAt', complaint.resolved_at,
        'createdAt', complaint.created_at,
        'updatedAt', complaint.updated_at,
        'publicHistory', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'eventType', event.event_type,
              'fromStatus', event.from_status,
              'toStatus', event.to_status,
              'publicMessage', event.public_message,
              'createdAt', event.created_at
            )
            order by event.created_at asc
          )
          from public.lpg_complaint_events event
          where event.complaint_id = complaint.id
        ), '[]'::jsonb)
      ) as row_data
    from public.lpg_service_complaints complaint
    join public.lpg_refill_orders order_record
      on order_record.id = complaint.order_id
    where complaint.customer_user_id = auth.uid()
    order by complaint.created_at desc
    limit least(greatest(coalesce(target_limit, 10), 1), 50)
  ) customer_complaints;

  return result;
end;
$$;

revoke all on function public.read_my_lpg_service_complaints(integer)
from public, anon;
grant execute on function public.read_my_lpg_service_complaints(integer)
to authenticated, service_role;

comment on function public.read_my_lpg_service_complaints(integer) is
  'Returns only the signed-in customer own LPG support complaints and public status history. Internal moderation notes are excluded.';

commit;
