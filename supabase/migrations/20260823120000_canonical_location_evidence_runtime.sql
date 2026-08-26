begin;

revoke insert,update on public.lpg_customer_locations from authenticated;
revoke all on function public.create_lpg_customer_location(text,text,numeric,numeric,text,numeric,text,text,text,text,text,text,jsonb,text) from authenticated;

create table public.location_quality_policies(
  id uuid primary key default gen_random_uuid(),
  purpose text not null check(purpose ~ '^[A-Z][A-Z0-9_]{1,79}$'),
  service_key text check(service_key is null or service_key ~ '^[a-z][a-z0-9_.:-]{2,120}$'),
  capture_source text,
  high_confidence_max_meters numeric not null check(high_confidence_max_meters>0),
  acceptable_max_meters numeric not null check(acceptable_max_meters>=high_confidence_max_meters),
  recapture_above_meters numeric not null check(recapture_above_meters>=acceptable_max_meters),
  status text not null check(status in('active','paused','retired')),
  starts_at timestamptz,ends_at timestamptz,
  configuration jsonb not null default '{}'::jsonb check(jsonb_typeof(configuration)='object'),
  created_by uuid references public.profiles(id) on delete set null default auth.uid(),
  created_at timestamptz not null default timezone('utc',now()),updated_at timestamptz not null default timezone('utc',now()),
  check(ends_at is null or starts_at is null or ends_at>starts_at)
);
create index location_quality_resolution_idx on public.location_quality_policies(purpose,service_key,status,starts_at,ends_at);
insert into public.location_quality_policies(purpose,high_confidence_max_meters,acceptable_max_meters,recapture_above_meters,status,configuration)
values('CUSTOMER_ADDRESS',25,100,500,'active',jsonb_build_object('missingAccuracyResult','MANUAL_REVIEW')),
      ('APPLICATION_OPERATING_BASE',20,75,300,'active',jsonb_build_object('missingAccuracyResult','RECAPTURE_REQUIRED')),
      ('STATION_PHYSICAL',15,50,200,'active',jsonb_build_object('missingAccuracyResult','RECAPTURE_REQUIRED')),
      ('DRIVER_CURRENT',30,100,300,'active',jsonb_build_object('missingAccuracyResult','LOW_ACCURACY'));

create table public.canonical_location_legacy_mappings(
  id uuid primary key default gen_random_uuid(),legacy_source text not null,legacy_id uuid not null,
  location_id uuid not null references public.locations(id) on delete restrict,
  created_at timestamptz not null default timezone('utc',now()),metadata jsonb not null default '{}'::jsonb check(jsonb_typeof(metadata)='object'),
  unique(legacy_source,legacy_id),unique(location_id)
);

create table public.order_location_snapshots(
  id uuid primary key default gen_random_uuid(),order_type text not null,order_id uuid not null,
  purpose text not null check(purpose in('PICKUP','DELIVERY')),
  location_id uuid references public.locations(id) on delete restrict,
  point extensions.geography(Point,4326) not null,accuracy_meters numeric,formatted_address text,
  address_snapshot jsonb not null check(jsonb_typeof(address_snapshot)='object'),capture_source text not null,
  captured_at timestamptz,quality_status text not null check(quality_status in('HIGH_CONFIDENCE','ACCEPTABLE','LOW_ACCURACY','RECAPTURE_REQUIRED','MANUAL_REVIEW')),
  policy_snapshot jsonb not null default '{}'::jsonb check(jsonb_typeof(policy_snapshot)='object'),
  created_at timestamptz not null default timezone('utc',now()),unique(order_type,order_id,purpose)
);
create index order_location_snapshots_order_idx on public.order_location_snapshots(order_type,order_id);
create index order_location_snapshots_point_gist_idx on public.order_location_snapshots using gist(point);

alter table public.location_quality_policies enable row level security;
alter table public.canonical_location_legacy_mappings enable row level security;
alter table public.order_location_snapshots enable row level security;
revoke all on public.location_quality_policies,public.canonical_location_legacy_mappings,public.order_location_snapshots from public,anon,authenticated;
grant select,insert,update,delete on public.location_quality_policies to authenticated;
grant select on public.order_location_snapshots to authenticated;
grant all on public.location_quality_policies,public.canonical_location_legacy_mappings,public.order_location_snapshots to service_role;
create policy location_quality_read on public.location_quality_policies for select to authenticated using(public.has_permission('platform.location_evidence.read',null));
create policy location_quality_manage on public.location_quality_policies for all to authenticated using(public.has_permission('platform.location_evidence.override',null)) with check(public.has_permission('platform.location_evidence.override',null));
create policy order_location_snapshot_related_read on public.order_location_snapshots for select to authenticated
using(order_type='LPG_REFILL' and public.can_access_lpg_order(order_id));
create trigger set_location_quality_policies_updated_at before update on public.location_quality_policies for each row execute function public.set_updated_at();
create trigger audit_location_quality_policies after insert or update or delete on public.location_quality_policies for each row execute function public.record_table_audit();
create trigger audit_canonical_location_legacy_mappings after insert or update or delete on public.canonical_location_legacy_mappings for each row execute function public.record_table_audit();
create trigger audit_order_location_snapshots after insert or update or delete on public.order_location_snapshots for each row execute function public.record_table_audit();

create or replace function public.prevent_immutable_location_evidence_mutation() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception using errcode='55000',message='location evidence snapshot is immutable'; end $$;
create trigger protect_order_location_snapshots before update or delete on public.order_location_snapshots for each row execute function public.prevent_immutable_location_evidence_mutation();

create or replace function public.evaluate_location_quality(p_purpose text,p_accuracy_meters numeric,p_service_key text default null,p_capture_source text default null,p_at timestamptz default timezone('utc',now()))
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare policy record; result text;
begin
  select * into policy from public.location_quality_policies p where p.purpose=p_purpose and p.status='active'
    and (p.service_key is null or p.service_key=p_service_key) and (p.capture_source is null or p.capture_source=p_capture_source)
    and (p.starts_at is null or p.starts_at<=p_at) and (p.ends_at is null or p.ends_at>p_at)
  order by (p.service_key is not null)::integer desc,(p.capture_source is not null)::integer desc,p.created_at desc limit 1;
  if not found then return jsonb_build_object('status','MANUAL_REVIEW','policyId',null,'reason','QUALITY_POLICY_NOT_CONFIGURED'); end if;
  result:=case when p_accuracy_meters is null then coalesce(policy.configuration->>'missingAccuracyResult','MANUAL_REVIEW')
    when p_accuracy_meters<=policy.high_confidence_max_meters then 'HIGH_CONFIDENCE'
    when p_accuracy_meters<=policy.acceptable_max_meters then 'ACCEPTABLE'
    when p_accuracy_meters<=policy.recapture_above_meters then 'LOW_ACCURACY' else 'RECAPTURE_REQUIRED' end;
  return jsonb_build_object('status',result,'policyId',policy.id,'accuracyMeters',p_accuracy_meters,
    'thresholds',jsonb_build_object('highConfidence',policy.high_confidence_max_meters,'acceptable',policy.acceptable_max_meters,'recaptureAbove',policy.recapture_above_meters));
end $$;

create or replace function public.create_canonical_customer_location(
  target_label text,target_formatted_address text,target_latitude numeric,target_longitude numeric,target_idempotency_key text,
  target_accuracy_meters numeric default null,target_landmark text default null,target_delivery_instructions text default null,
  target_contact_name text default null,target_contact_phone text default null,target_provider_source text default null,
  target_provider_place_id text default null,target_metadata jsonb default '{}'::jsonb,target_source text default 'skima.location_api',
  target_address jsonb default '{}'::jsonb,target_capture_source text default 'DEVICE_GPS',target_captured_at timestamptz default timezone('utc',now())
) returns uuid language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare legacy_id uuid; canonical_id uuid; quality jsonb;
begin
  legacy_id:=public.create_lpg_customer_location(target_label,target_formatted_address,target_latitude,target_longitude,target_idempotency_key,
    target_accuracy_meters,target_landmark,target_delivery_instructions,target_contact_name,target_contact_phone,target_provider_source,target_provider_place_id,target_metadata,target_source);
  select location_id into canonical_id from public.canonical_location_legacy_mappings where legacy_source='lpg_customer_locations' and legacy_id=legacy_id;
  if canonical_id is null then
    quality:=public.evaluate_location_quality('CUSTOMER_ADDRESS',target_accuracy_meters,'lpg',target_capture_source);
    insert into public.locations(point,accuracy_meters,formatted_address,country,country_code,admin_area_1,admin_area_2,locality,sublocality,street,house_number,postal_code,landmark,capture_source,geocoder_provider,geocoder_reference,captured_at,created_by,metadata)
    values(extensions.st_setsrid(extensions.st_makepoint(target_longitude,target_latitude),4326)::extensions.geography,target_accuracy_meters,btrim(target_formatted_address),
      target_address->>'country',upper(target_address->>'countryCode'),target_address->>'region',target_address->>'district',target_address->>'city',target_address->>'sublocality',
      target_address->>'street',target_address->>'houseNumber',target_address->>'postalCode',target_landmark,target_capture_source,target_provider_source,target_provider_place_id,target_captured_at,auth.uid(),
      coalesce(target_metadata,'{}'::jsonb)||jsonb_build_object('quality',quality,'deliveryInstructions',target_delivery_instructions)) returning id into canonical_id;
    insert into public.canonical_location_legacy_mappings(legacy_source,legacy_id,location_id,metadata)
    values('lpg_customer_locations',legacy_id,canonical_id,jsonb_build_object('ownerUserId',auth.uid()));
    insert into public.entity_locations(entity_type,entity_id,location_id,purpose,is_current,metadata)
    values('LPG_CUSTOMER_LOCATION',legacy_id,canonical_id,'CUSTOMER_ADDRESS',true,jsonb_build_object('ownerUserId',auth.uid()));
    update public.lpg_customer_locations set metadata=metadata||jsonb_build_object('canonicalLocationId',canonical_id,'locationQuality',quality),updated_at=timezone('utc',now())
    where id=legacy_id;
  end if;
  return legacy_id;
end $$;

create or replace function public.snapshot_lpg_order_locations() returns trigger language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare source record; canonical_id uuid; quality jsonb; role text;
begin
  foreach role in array array['PICKUP','DELIVERY'] loop
    select * into source from public.lpg_customer_locations where id=case role when 'PICKUP' then new.pickup_location_id else new.delivery_location_id end;
    select location_id into canonical_id from public.canonical_location_legacy_mappings where legacy_source='lpg_customer_locations' and legacy_id=source.id;
    quality:=public.evaluate_location_quality('CUSTOMER_ADDRESS',source.accuracy_meters,'lpg',coalesce(source.provider_source,'DEVICE_GPS'));
    insert into public.order_location_snapshots(order_type,order_id,purpose,location_id,point,accuracy_meters,formatted_address,address_snapshot,capture_source,captured_at,quality_status,policy_snapshot)
    values('LPG_REFILL',new.id,role,canonical_id,extensions.st_setsrid(extensions.st_makepoint(source.longitude,source.latitude),4326)::extensions.geography,
      source.accuracy_meters,source.formatted_address,jsonb_build_object('landmark',source.landmark,'deliveryInstructions',source.delivery_instructions,'metadata',source.metadata),
      coalesce(source.provider_source,'IMPORTED'),source.created_at,quality->>'status',quality);
  end loop;
  return new;
end $$;
create trigger snapshot_lpg_order_locations_after_insert after insert on public.lpg_refill_orders for each row execute function public.snapshot_lpg_order_locations();

create or replace function public.sync_application_location_verification_to_canonical() returns trigger
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare canonical_id uuid; relationship_purpose text; source_class text;
begin
  relationship_purpose:=case
    when new.location_purpose like '%submission%' then 'APPLICATION_SUBMISSION'
    when new.location_purpose like '%declared%' then 'APPLICATION_DECLARED'
    when new.location_purpose like '%station%' then 'STATION_PHYSICAL'
    else 'APPLICATION_OPERATING_BASE' end;
  source_class:=case lower(coalesce(new.provider_source,'')) when 'manual_pin' then 'MAP_PIN' when 'maps_adapter' then 'GEOCODED'
    when 'admin_verified' then 'ADMIN_VERIFIED' else 'DEVICE_GPS' end;
  insert into public.locations(point,accuracy_meters,formatted_address,capture_source,geocoder_provider,geocoder_reference,captured_at,confirmed_at,created_by,metadata)
  values(extensions.st_setsrid(extensions.st_makepoint(new.longitude,new.latitude),4326)::extensions.geography,new.accuracy_meters,new.formatted_address,
    source_class,new.provider_source,new.provider_place_id,new.recorded_at,case when new.status='verified' then new.reviewed_at else null end,
    (select applicant_user_id from public.application_records where id=new.application_id),
    jsonb_build_object('verificationId',new.id,'applicationId',new.application_id,'applicationVersionId',new.application_version_id,
      'evidenceSnapshot',new.evidence_snapshot,'quality',public.evaluate_location_quality(relationship_purpose,new.accuracy_meters,null,source_class))) returning id into canonical_id;
  update public.entity_locations set is_current=false,valid_to=timezone('utc',now()),updated_at=timezone('utc',now())
    where entity_type='APPLICATION' and entity_id=new.application_id and purpose=relationship_purpose and is_current;
  insert into public.entity_locations(entity_type,entity_id,location_id,purpose,is_current,metadata)
  values('APPLICATION',new.application_id,canonical_id,relationship_purpose,true,jsonb_build_object('verificationId',new.id,'applicationVersionId',new.application_version_id));
  insert into public.canonical_location_legacy_mappings(legacy_source,legacy_id,location_id,metadata)
  values('application_location_verifications',new.id,canonical_id,jsonb_build_object('purpose',relationship_purpose))
  on conflict(legacy_source,legacy_id) do update set location_id=excluded.location_id,metadata=excluded.metadata;
  return new;
end $$;
create trigger sync_application_location_verification_canonical after insert or update of latitude,longitude,accuracy_meters,formatted_address,status
on public.application_location_verifications for each row execute function public.sync_application_location_verification_to_canonical();

revoke all on function public.prevent_immutable_location_evidence_mutation() from public,anon,authenticated;
revoke all on function public.evaluate_location_quality(text,numeric,text,text,timestamptz) from public,anon;
revoke all on function public.create_canonical_customer_location(text,text,numeric,numeric,text,numeric,text,text,text,text,text,text,jsonb,text,jsonb,text,timestamptz) from public,anon;
revoke all on function public.snapshot_lpg_order_locations() from public,anon,authenticated;
revoke all on function public.sync_application_location_verification_to_canonical() from public,anon,authenticated;
grant execute on function public.evaluate_location_quality(text,numeric,text,text,timestamptz) to authenticated,service_role;
grant execute on function public.create_canonical_customer_location(text,text,numeric,numeric,text,numeric,text,text,text,text,text,text,jsonb,text,jsonb,text,timestamptz) to authenticated,service_role;

commit;
