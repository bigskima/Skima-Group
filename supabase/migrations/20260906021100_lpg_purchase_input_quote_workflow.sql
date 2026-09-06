-- Keeps amount/weight interpretation inside the LPG module workflow rather than the platform gateway.
create or replace function public.create_lpg_refill_quote_from_purchase_input(target_cylinder_id uuid,target_requested_kg numeric,target_requested_amount numeric,target_pickup_location_id uuid,target_delivery_location_id uuid,target_station_branch_id uuid,target_route_snapshot jsonb,target_idempotency_key text,target_preferred_time timestamptz default null,target_delivery_instructions text default null,target_metadata jsonb default '{}',target_source text default 'lpg.quote_api')
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare resolved_kg numeric;
begin
 if (target_requested_kg is null) = (target_requested_amount is null) then raise exception using errcode='22023',message='choose exactly one purchase input'; end if;
 resolved_kg:=case when target_requested_amount is not null then public.resolve_lpg_refill_quantity_from_amount(target_station_branch_id,target_requested_amount) else target_requested_kg end;
 return public.create_lpg_refill_quote_from_commercial_snapshot(target_cylinder_id,resolved_kg,target_pickup_location_id,target_delivery_location_id,target_station_branch_id,target_route_snapshot,target_idempotency_key,target_preferred_time,target_delivery_instructions,coalesce(target_metadata,'{}')||jsonb_build_object('purchaseInput',case when target_requested_amount is null then 'weight' else 'amount' end,'requestedAmount',target_requested_amount),target_source);
end $$;
revoke all on function public.create_lpg_refill_quote_from_purchase_input(uuid,numeric,numeric,uuid,uuid,uuid,jsonb,text,timestamptz,text,jsonb,text) from public;
grant execute on function public.create_lpg_refill_quote_from_purchase_input(uuid,numeric,numeric,uuid,uuid,uuid,jsonb,text,timestamptz,text,jsonb,text) to authenticated,service_role;
