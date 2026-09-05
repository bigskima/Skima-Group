-- Converts a customer currency amount through the station's current, database-governed per-kg price.
-- The quote engine still performs the authoritative capacity, availability, route, fee and policy checks.
create or replace function public.resolve_lpg_refill_quantity_from_amount(target_station_branch_id uuid,target_amount numeric,target_at timestamptz default timezone('utc',now()))
returns numeric language plpgsql stable security definer set search_path=public,pg_temp as $$
declare station_record public.lpg_station_branches%rowtype; current_price numeric; resolved_kg numeric;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
 if target_amount is null or target_amount<=0 then raise exception using errcode='22023',message='amount must be greater than zero'; end if;
 select * into station_record from public.lpg_station_branches where id=target_station_branch_id and approval_status='approved' and compliance_status='approved';
 if not found then raise exception using errcode='22023',message='approved station is required'; end if;
 select cp.amount into current_price from public.catalog_prices cp join public.catalog_items ci on ci.id=cp.item_id
 where cp.organization_id=station_record.organization_id and cp.branch_id is not distinct from station_record.branch_id
 and ci.module_id=(select id from public.business_modules where key='lpg') and ci.status='active' and cp.status='active'
 and cp.currency_code='NGN' and cp.metadata->>'price_basis'='per_kg' and cp.effective_from<=target_at
 and (cp.effective_until is null or cp.effective_until>target_at) order by cp.effective_from desc limit 1;
 if current_price is null or current_price<=0 then raise exception using errcode='55000',message='current station price is unavailable'; end if;
 resolved_kg:=floor((target_amount/current_price)*1000)/1000;
 if resolved_kg<=0 then raise exception using errcode='22023',message='amount is below the minimum refill quantity'; end if;
 return resolved_kg;
end $$;
revoke all on function public.resolve_lpg_refill_quantity_from_amount(uuid,numeric,timestamptz) from public;
grant execute on function public.resolve_lpg_refill_quantity_from_amount(uuid,numeric,timestamptz) to authenticated,service_role;
