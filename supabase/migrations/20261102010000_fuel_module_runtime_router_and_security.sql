begin;

-- Trigger functions are invoked by PostgreSQL's trigger machinery, not by client RPC.
-- Remove their accidental PostgREST execute surface while retaining trigger execution.
revoke all on function public.initialize_fuel_order_operation() from public, anon, authenticated;
revoke all on function public.validate_fuel_container_allocation() from public, anon, authenticated;
revoke all on function public.validate_fuel_container_asset() from public, anon, authenticated;
revoke all on function public.validate_fuel_station_storage_scope() from public, anon, authenticated;
revoke all on function public.prevent_fuel_event_mutation() from public, anon, authenticated;

-- Fix the mutable search_path finding on the non-definer append-only trigger.
alter function public.prevent_fuel_event_mutation() set search_path = public;

-- This helper is used by authenticated RLS policies and permission checks, but it
-- must not expose its result to unauthenticated PostgREST callers.
revoke all on function public.can_manage_fuel_platform() from public, anon;
grant execute on function public.can_manage_fuel_platform() to authenticated, service_role;

-- Register module runtime routes as module metadata. The platform gateway only
-- resolves a configured handler; it does not know what Fuel does.
update public.business_modules
set metadata = jsonb_set(
      coalesce(metadata, '{}'::jsonb),
      '{runtime}',
      jsonb_build_object(
        'enabled', true,
        'route_prefix', '/runtime/fuel',
        'edge_function', 'fuel-runtime'
      ),
      true
    ),
    updated_at = timezone('utc', now())
where key = 'fuel'
  and status = 'active';

do $$
begin
  if not exists (
    select 1 from public.business_modules
    where key = 'fuel' and status = 'active'
      and metadata #>> '{runtime,enabled}' = 'true'
      and metadata #>> '{runtime,route_prefix}' = '/runtime/fuel'
      and metadata #>> '{runtime,edge_function}' = 'fuel-runtime'
  ) then
    raise exception 'Active Fuel module runtime route could not be registered';
  end if;
end;
$$;

create or replace function public.resolve_business_module_runtime_route(
  target_route_path text
)
returns table(module_key text, edge_function text)
language sql
stable
security definer
set search_path = public
as $$
  select
    module_record.key,
    module_record.metadata #>> '{runtime,edge_function}'
  from public.business_modules module_record
  where auth.uid() is not null
    and module_record.status = 'active'
    and module_record.metadata #>> '{runtime,enabled}' = 'true'
    and coalesce(module_record.metadata #>> '{runtime,route_prefix}', '') <> ''
    and target_route_path is not null
    and target_route_path ~ '^/[a-zA-Z0-9/_-]+$'
    and (
      target_route_path = module_record.metadata #>> '{runtime,route_prefix}'
      or left(
        target_route_path,
        length(module_record.metadata #>> '{runtime,route_prefix}') + 1
      ) = (module_record.metadata #>> '{runtime,route_prefix}') || '/'
    )
    and coalesce(module_record.metadata #>> '{runtime,edge_function}', '') ~ '^[a-z][a-z0-9-]{1,62}$'
  order by length(module_record.metadata #>> '{runtime,route_prefix}') desc
  limit 1;
$$;

create or replace function public.list_active_business_module_runtime_routes()
returns table(module_key text, route_prefix text)
language sql
stable
security definer
set search_path = public
as $$
  select
    module_record.key,
    module_record.metadata #>> '{runtime,route_prefix}'
  from public.business_modules module_record
  where auth.uid() is not null
    and module_record.status = 'active'
    and module_record.metadata #>> '{runtime,enabled}' = 'true'
    and coalesce(module_record.metadata #>> '{runtime,route_prefix}', '') <> ''
    and coalesce(module_record.metadata #>> '{runtime,edge_function}', '') ~ '^[a-z][a-z0-9-]{1,62}$'
  order by module_record.key;
$$;

revoke all on function public.resolve_business_module_runtime_route(text) from public, anon;
grant execute on function public.resolve_business_module_runtime_route(text) to authenticated, service_role;
revoke all on function public.list_active_business_module_runtime_routes() from public, anon;
grant execute on function public.list_active_business_module_runtime_routes() to authenticated, service_role;

notify pgrst, 'reload schema';
commit;
