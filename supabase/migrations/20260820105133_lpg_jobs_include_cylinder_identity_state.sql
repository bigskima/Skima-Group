begin;

create or replace function public.read_lpg_jobs(
  target_queue text default null,
  target_limit integer default 50
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  resolved_limit integer;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_queue is not null
    and target_queue not in ('customer', 'driver', 'station', 'admin') then
    raise exception 'target_queue is not supported';
  end if;

  resolved_limit := least(greatest(coalesce(target_limit, 50), 1), 200);

  return coalesce((
    select jsonb_agg(job_payload order by (job_payload ->> 'updatedAt') desc)
    from (
      select jsonb_build_object(
        'queue', resolved.queue_name,
        'lpgOrderId', resolved.id,
        'publicReference', resolved.public_reference,
        'status', resolved.status,
        'assignmentStatus', resolved.assignment_status,
        'stationBranchId', resolved.station_branch_id,
        'driverProfileId', resolved.driver_profile_id,
        'cylinderId', resolved.cylinder_id,
        'cylinderReference', cylinder.public_reference,
        'cylinderIdentifier', cylinder.cylinder_identifier,
        'cylinderTagStatus', cylinder.tag_status,
        'activeTagReference', active_tag.public_tag_reference,
        'requestedKg', resolved.requested_kg,
        'actualKg', resolved.actual_kg,
        'updatedAt', resolved.updated_at,
        'metadata', resolved.metadata
      ) as job_payload
      from (
        select 'customer' as queue_name, target_order.*
        from public.lpg_refill_orders target_order
        where (target_queue is null or target_queue = 'customer')
          and target_order.customer_user_id = auth.uid()
          and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed')

        union all

        select 'driver' as queue_name, target_order.*
        from public.lpg_refill_orders target_order
        join public.driver_profiles driver on driver.id = target_order.driver_profile_id
        where (target_queue is null or target_queue = 'driver')
          and driver.user_id = auth.uid()
          and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed')

        union all

        select 'station' as queue_name, target_order.*
        from public.lpg_refill_orders target_order
        join public.lpg_station_branches station on station.id = target_order.station_branch_id
        where (target_queue is null or target_queue = 'station')
          and public.user_can_operate_lpg_station_branch(auth.uid(), station.id, 'lpg.orders.read')
          and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed')

        union all

        select 'admin' as queue_name, target_order.*
        from public.lpg_refill_orders target_order
        where (target_queue is null or target_queue = 'admin')
          and (auth.role() = 'service_role' or public.can_manage_lpg_operations())
          and target_order.status not in ('completed', 'cancelled', 'refunded', 'failed')
      ) resolved
      join public.lpg_cylinders cylinder on cylinder.id = resolved.cylinder_id
      left join lateral (
        select tag.public_tag_reference
        from public.lpg_cylinder_tags tag
        where tag.cylinder_id = resolved.cylinder_id
          and tag.status = 'active'
        order by tag.bound_at desc nulls last, tag.created_at desc
        limit 1
      ) active_tag on true
      order by resolved.updated_at desc
      limit resolved_limit
    ) jobs
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.read_lpg_jobs(text, integer) from public, anon;
grant execute on function public.read_lpg_jobs(text, integer) to authenticated, service_role;

commit;
