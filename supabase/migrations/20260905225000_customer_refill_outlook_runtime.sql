begin;

-- Customer refill outlook: deterministic personal history summary for Ask SKIMA.
-- This is a convenience estimate only. It does not measure gas remaining and cannot create an order.

create or replace function public.read_customer_refill_outlook()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with refill_history as (
    select
      orders.cylinder_id,
      orders.updated_at as refill_at,
      coalesce(orders.actual_kg, orders.quoted_kg, orders.requested_kg, 0)::numeric as refill_kg,
      lag(orders.updated_at) over (
        partition by orders.cylinder_id
        order by orders.updated_at
      ) as previous_refill_at
    from public.lpg_refill_orders orders
    where orders.customer_user_id = (select auth.uid())
      and orders.status in ('delivered', 'completed')
  ),
  cylinder_stats as (
    select
      history.cylinder_id,
      count(*)::integer as refill_count,
      max(history.refill_at) as last_refill_at,
      avg(history.refill_kg) as average_refill_kg,
      avg(
        extract(epoch from (history.refill_at - history.previous_refill_at)) / 86400.0
      ) filter (where history.previous_refill_at is not null) as average_interval_days
    from refill_history history
    group by history.cylinder_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'cylinderId', stats.cylinder_id,
        'cylinderName', cylinder.display_name,
        'cylinderReference', cylinder.public_reference,
        'refillCount', stats.refill_count,
        'lastRefillAt', stats.last_refill_at,
        'averageRefillKg', case
          when stats.average_refill_kg is null then null
          else round(stats.average_refill_kg, 2)
        end,
        'averageIntervalDays', case
          when stats.average_interval_days is null then null
          else round(stats.average_interval_days::numeric, 1)
        end,
        'estimatedNextRefillAt', case
          when stats.average_interval_days is null then null
          else stats.last_refill_at
            + make_interval(secs => (stats.average_interval_days * 86400.0)::double precision)
        end,
        'confidence', case
          when stats.refill_count >= 5 then 'high'
          when stats.refill_count >= 3 then 'medium'
          when stats.refill_count >= 2 then 'low'
          else 'insufficient_history'
        end,
        'estimateOnly', true,
        'measurement', 'historical_refill_interval',
        'doesNotMeasureRemainingGas', true
      )
      order by stats.last_refill_at desc
    ),
    '[]'::jsonb
  )
  from cylinder_stats stats
  join public.lpg_cylinders cylinder
    on cylinder.id = stats.cylinder_id
   and cylinder.owner_user_id = (select auth.uid())
   and cylinder.status <> 'deactivated';
$$;

revoke all on function public.read_customer_refill_outlook() from public, anon;
grant execute on function public.read_customer_refill_outlook() to authenticated, service_role;

commit;
