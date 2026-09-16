begin;

alter function public.read_lpg_eligible_stations(uuid,uuid,uuid,numeric,integer,timestamptz)
  rename to read_lpg_marketplace_eligible_stations;
alter function public.read_lpg_eligible_stations_for_amount(uuid,uuid,uuid,numeric,integer,timestamptz)
  rename to read_lpg_marketplace_eligible_stations_for_amount;

create or replace function public.read_lpg_internal_candidate_for_kg(
  target_pickup_location_id uuid,
  target_delivery_location_id uuid,
  target_cylinder_id uuid,
  target_requested_kg numeric,
  target_at timestamptz default timezone('utc',now())
)
returns table(
  station_branch_id uuid,display_name text,formatted_address text,latitude numeric,longitude numeric,
  service_radius_meters integer,pickup_distance_meters numeric,return_distance_meters numeric,
  route_proxy_distance_meters numeric,currency_code text,price_per_kg numeric,current_available_kg numeric,
  refill_capacity_kg numeric,supported_cylinder_sizes_kg numeric[],cylinder_size_kg numeric
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  config jsonb;
  reference_policy jsonb;
  payout_policy jsonb;
  pickup_record public.lpg_customer_locations%rowtype;
  delivery_record public.lpg_customer_locations%rowtype;
  cylinder_record public.lpg_cylinders%rowtype;
  reference_price numeric;
  route_km numeric;
  payout_percentage numeric;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='authentication required';
  end if;

  config:=public.lpg_policy_config('lpg.fulfillment.launch_assurance');
  if not coalesce((config->>'enabled')::boolean,false)
    or coalesce(config->>'mode','hybrid')='marketplace_only' then
    return;
  end if;

  select * into pickup_record from public.lpg_customer_locations
  where id=target_pickup_location_id and owner_user_id=auth.uid() and status<>'deleted';
  select * into delivery_record from public.lpg_customer_locations
  where id=target_delivery_location_id and owner_user_id=auth.uid() and status<>'deleted';
  select * into cylinder_record from public.lpg_cylinders
  where id=target_cylinder_id and owner_user_id=auth.uid() and status<>'deactivated';

  if pickup_record.id is null or delivery_record.id is null or cylinder_record.id is null then
    raise exception using errcode='42501',message='customer refill inputs are not available';
  end if;
  if target_requested_kg is null or target_requested_kg<=0
    or target_requested_kg>cylinder_record.max_capacity_kg then
    return;
  end if;

  begin
    reference_policy:=public.resolve_lpg_internal_reference_policy(target_pickup_location_id,target_at);
    payout_policy:=public.resolve_financial_policy(
      'payout.lpg.internal_driver','NGN',target_at,'lpg',null,'lpg.refill.internal','global',null
    );
  exception when others then
    return;
  end;

  reference_price:=nullif(reference_policy #>> '{configuration,amount_per_kg}','')::numeric;
  route_km:=nullif(reference_policy #>> '{configuration,estimated_route_km}','')::numeric;
  payout_percentage:=nullif(payout_policy #>> '{configuration,percentage}','')::numeric;
  if reference_price is null or reference_price<=0
    or route_km is null or route_km<0
    or payout_percentage is null or payout_percentage<=0 or payout_percentage>100 then
    return;
  end if;

  return query select
    coalesce(nullif(config->>'digital_station_id','')::uuid,'00000000-0000-0000-0000-000000000001'::uuid),
    coalesce(config->>'digital_station_label','SKIMA Fulfillment'),
    'SKIMA-managed refill. Your assigned SKIMA driver will use a suitable available LPG supplier.'::text,
    pickup_record.latitude,pickup_record.longitude,
    null::integer,
    0::numeric,0::numeric,round(route_km*1000,2),
    'NGN'::text,reference_price,
    999999999::numeric,999999999::numeric,array[]::numeric[],cylinder_record.size_kg;
end
$$;

create or replace function public.read_lpg_eligible_stations(
  target_pickup_location_id uuid,
  target_delivery_location_id uuid,
  target_cylinder_id uuid,
  target_requested_kg numeric,
  target_limit integer default 10,
  target_at timestamptz default timezone('utc',now())
)
returns table(
  station_branch_id uuid,display_name text,formatted_address text,latitude numeric,longitude numeric,
  service_radius_meters integer,pickup_distance_meters numeric,return_distance_meters numeric,
  route_proxy_distance_meters numeric,currency_code text,price_per_kg numeric,current_available_kg numeric,
  refill_capacity_kg numeric,supported_cylinder_sizes_kg numeric[],cylinder_size_kg numeric
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  config jsonb;
  mode text;
  priority_mode text;
  fallback_only boolean;
  market_count integer:=0;
  remaining integer;
begin
  if target_limit is null or target_limit<1 or target_limit>50 then
    raise exception using errcode='22023',message='target_limit must be between 1 and 50';
  end if;
  config:=public.lpg_policy_config('lpg.fulfillment.launch_assurance');
  mode:=coalesce(config->>'mode','hybrid');
  priority_mode:=coalesce(config->>'priority','marketplace_first');
  fallback_only:=coalesce((config->>'marketplace_first_fallback_only')::boolean,true);

  if not coalesce((config->>'enabled')::boolean,false) or mode='marketplace_only' then
    return query select * from public.read_lpg_marketplace_eligible_stations(
      target_pickup_location_id,target_delivery_location_id,target_cylinder_id,target_requested_kg,target_limit,target_at
    );
    return;
  end if;

  if mode='internal_only' then
    return query select * from public.read_lpg_internal_candidate_for_kg(
      target_pickup_location_id,target_delivery_location_id,target_cylinder_id,target_requested_kg,target_at
    ) limit target_limit;
    return;
  end if;

  if priority_mode='internal_first' then
    return query select * from public.read_lpg_internal_candidate_for_kg(
      target_pickup_location_id,target_delivery_location_id,target_cylinder_id,target_requested_kg,target_at
    );
    get diagnostics market_count=row_count;
    remaining:=greatest(target_limit-market_count,0);
    if remaining>0 then
      return query select * from public.read_lpg_marketplace_eligible_stations(
        target_pickup_location_id,target_delivery_location_id,target_cylinder_id,target_requested_kg,remaining,target_at
      );
    end if;
    return;
  end if;

  return query select * from public.read_lpg_marketplace_eligible_stations(
    target_pickup_location_id,target_delivery_location_id,target_cylinder_id,target_requested_kg,target_limit,target_at
  );
  get diagnostics market_count=row_count;

  if market_count=0 or not fallback_only then
    remaining:=greatest(target_limit-market_count,0);
    if remaining>0 then
      return query select * from public.read_lpg_internal_candidate_for_kg(
        target_pickup_location_id,target_delivery_location_id,target_cylinder_id,target_requested_kg,target_at
      ) limit remaining;
    end if;
  end if;
end
$$;

create or replace function public.read_lpg_eligible_stations_for_amount(
  target_pickup_location_id uuid,
  target_delivery_location_id uuid,
  target_cylinder_id uuid,
  target_requested_amount numeric,
  target_limit integer default 10,
  target_at timestamptz default timezone('utc',now())
)
returns table(
  station_branch_id uuid,display_name text,formatted_address text,latitude numeric,longitude numeric,
  service_radius_meters integer,pickup_distance_meters numeric,return_distance_meters numeric,
  route_proxy_distance_meters numeric,currency_code text,price_per_kg numeric,current_available_kg numeric,
  refill_capacity_kg numeric,supported_cylinder_sizes_kg numeric[],cylinder_size_kg numeric
)
language plpgsql
stable
security definer
set search_path=public,pg_temp
as $$
declare
  config jsonb;
  mode text;
  priority_mode text;
  fallback_only boolean;
  market_count integer:=0;
  remaining integer;
  internal_kg numeric;
begin
  if target_limit is null or target_limit<1 or target_limit>50 then
    raise exception using errcode='22023',message='target_limit must be between 1 and 50';
  end if;
  if target_requested_amount is null or target_requested_amount<=0 then
    raise exception using errcode='22023',message='requested amount must be greater than zero';
  end if;

  config:=public.lpg_policy_config('lpg.fulfillment.launch_assurance');
  mode:=coalesce(config->>'mode','hybrid');
  priority_mode:=coalesce(config->>'priority','marketplace_first');
  fallback_only:=coalesce((config->>'marketplace_first_fallback_only')::boolean,true);

  if not coalesce((config->>'enabled')::boolean,false) or mode='marketplace_only' then
    return query select * from public.read_lpg_marketplace_eligible_stations_for_amount(
      target_pickup_location_id,target_delivery_location_id,target_cylinder_id,target_requested_amount,target_limit,target_at
    );
    return;
  end if;

  begin
    internal_kg:=public.resolve_lpg_internal_refill_quantity_from_amount(
      target_pickup_location_id,target_requested_amount,target_at
    );
  exception when others then
    internal_kg:=null;
  end;

  if mode='internal_only' then
    if internal_kg is not null then
      return query select * from public.read_lpg_internal_candidate_for_kg(
        target_pickup_location_id,target_delivery_location_id,target_cylinder_id,internal_kg,target_at
      ) limit target_limit;
    end if;
    return;
  end if;

  if priority_mode='internal_first' then
    if internal_kg is not null then
      return query select * from public.read_lpg_internal_candidate_for_kg(
        target_pickup_location_id,target_delivery_location_id,target_cylinder_id,internal_kg,target_at
      );
      get diagnostics market_count=row_count;
    end if;
    remaining:=greatest(target_limit-market_count,0);
    if remaining>0 then
      return query select * from public.read_lpg_marketplace_eligible_stations_for_amount(
        target_pickup_location_id,target_delivery_location_id,target_cylinder_id,target_requested_amount,remaining,target_at
      );
    end if;
    return;
  end if;

  return query select * from public.read_lpg_marketplace_eligible_stations_for_amount(
    target_pickup_location_id,target_delivery_location_id,target_cylinder_id,target_requested_amount,target_limit,target_at
  );
  get diagnostics market_count=row_count;

  if (market_count=0 or not fallback_only) and internal_kg is not null then
    remaining:=greatest(target_limit-market_count,0);
    if remaining>0 then
      return query select * from public.read_lpg_internal_candidate_for_kg(
        target_pickup_location_id,target_delivery_location_id,target_cylinder_id,internal_kg,target_at
      ) limit remaining;
    end if;
  end if;
end
$$;

revoke all on function public.read_lpg_internal_candidate_for_kg(uuid,uuid,uuid,numeric,timestamptz) from public,anon,authenticated;
revoke all on function public.read_lpg_eligible_stations(uuid,uuid,uuid,numeric,integer,timestamptz) from public,anon;
revoke all on function public.read_lpg_eligible_stations_for_amount(uuid,uuid,uuid,numeric,integer,timestamptz) from public,anon;

grant execute on function public.read_lpg_eligible_stations(uuid,uuid,uuid,numeric,integer,timestamptz) to authenticated,service_role;
grant execute on function public.read_lpg_eligible_stations_for_amount(uuid,uuid,uuid,numeric,integer,timestamptz) to authenticated,service_role;
grant execute on function public.read_lpg_marketplace_eligible_stations(uuid,uuid,uuid,numeric,integer,timestamptz) to authenticated,service_role;
grant execute on function public.read_lpg_marketplace_eligible_stations_for_amount(uuid,uuid,uuid,numeric,integer,timestamptz) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
