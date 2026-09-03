begin;

set local lock_timeout = '10s';
set local statement_timeout = '0';

-- Preserve the established implementation as a private core, then put the
-- provider-authority and evidence rules in a stable public wrapper. This keeps
-- existing API contracts intact while preventing manual edits from silently
-- overriding a POS or telemetry source.
alter function public.report_lpg_station_inventory(
  uuid, numeric, text, text, numeric, uuid, text, uuid[], jsonb, text, bigint
)
rename to report_lpg_station_inventory_core;

revoke all on function public.report_lpg_station_inventory_core(
  uuid, numeric, text, text, numeric, uuid, text, uuid[], jsonb, text, bigint
) from public, anon, authenticated;

create or replace function public.report_lpg_station_inventory(
  target_station_branch_id uuid,
  target_physical_stock_kg numeric,
  target_measurement_method_key text,
  target_idempotency_key text,
  target_skima_allocation_kg numeric default null,
  target_tank_id uuid default null,
  target_note text default null,
  target_evidence_asset_ids uuid[] default array[]::uuid[],
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'skima.lpg.inventory.manual',
  target_expected_version bigint default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  configuration_record public.station_inventory_configurations%rowtype;
  evidence_required boolean;
begin
  if not public.can_manage_lpg_station_inventory(
    target_station_branch_id,
    'station.inventory.update'
  ) then
    raise exception using
      errcode = '42501',
      message = 'branch-scoped inventory update permission is required';
  end if;

  select method.requires_evidence
  into evidence_required
  from public.inventory_measurement_methods method
  where method.key = target_measurement_method_key
    and method.status = 'active';

  if not found then
    raise exception 'select a supported inventory measurement method';
  end if;

  if evidence_required
     and cardinality(coalesce(target_evidence_asset_ids, array[]::uuid[])) = 0 then
    raise exception 'add the required measurement evidence before saving inventory';
  end if;

  select configuration.*
  into configuration_record
  from public.station_inventory_configurations configuration
  where configuration.station_branch_id = target_station_branch_id
  for share;

  if not found then
    raise exception 'station inventory configuration is required';
  end if;

  if configuration_record.primary_source_key <> 'manual'
     and (
       configuration_record.manual_fallback_until is null
       or configuration_record.manual_fallback_until <= timezone('utc', now())
     ) then
    raise exception 'activate a time-limited manual fallback before changing provider-managed inventory';
  end if;

  return public.report_lpg_station_inventory_core(
    target_station_branch_id => target_station_branch_id,
    target_physical_stock_kg => target_physical_stock_kg,
    target_measurement_method_key => target_measurement_method_key,
    target_idempotency_key => target_idempotency_key,
    target_skima_allocation_kg => target_skima_allocation_kg,
    target_tank_id => target_tank_id,
    target_note => target_note,
    target_evidence_asset_ids => coalesce(target_evidence_asset_ids, array[]::uuid[]),
    target_metadata => coalesce(target_metadata, '{}'::jsonb),
    target_source => target_source,
    target_expected_version => target_expected_version
  );
end;
$$;

revoke all on function public.report_lpg_station_inventory(
  uuid, numeric, text, text, numeric, uuid, text, uuid[], jsonb, text, bigint
) from public, anon;
grant execute on function public.report_lpg_station_inventory(
  uuid, numeric, text, text, numeric, uuid, text, uuid[], jsonb, text, bigint
) to authenticated, service_role;

comment on function public.report_lpg_station_inventory(
  uuid, numeric, text, text, numeric, uuid, text, uuid[], jsonb, text, bigint
) is 'Governed manual stock report. Provider-managed branches require an active, time-limited manual fallback; configured evidence requirements are enforced.';

-- Webhook receipts remain backend-only. The service policy is explicit so the
-- table's RLS posture is auditable even though Supabase service roles normally
-- bypass RLS.
drop policy if exists station_inventory_provider_webhook_receipts_service_only
on public.station_inventory_provider_webhook_receipts;
create policy station_inventory_provider_webhook_receipts_service_only
on public.station_inventory_provider_webhook_receipts
for all
to service_role
using (true)
with check (true);

notify pgrst, 'reload schema';

commit;
