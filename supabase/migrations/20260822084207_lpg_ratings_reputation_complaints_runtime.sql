create table if not exists public.lpg_rating_relationships (
  id uuid primary key default gen_random_uuid(),
  customer_user_id uuid not null references public.profiles(id) on delete restrict,
  subject_type text not null check (subject_type in ('driver','station')),
  driver_profile_id uuid null references public.driver_profiles(id) on delete restrict,
  station_branch_id uuid null references public.lpg_station_branches(id) on delete restrict,
  current_rating smallint not null check (current_rating between 1 and 5),
  latest_order_id uuid not null references public.lpg_refill_orders(id) on delete restrict,
  latest_event_id uuid null,
  rating_count integer not null default 1 check (rating_count > 0),
  first_rated_at timestamptz not null default timezone('utc',now()),
  last_rated_at timestamptz not null default timezone('utc',now()),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  constraint lpg_rating_relationship_subject_shape check (
    (subject_type='driver' and driver_profile_id is not null and station_branch_id is null)
    or (subject_type='station' and station_branch_id is not null and driver_profile_id is null)
  )
);

create unique index if not exists lpg_rating_relationship_driver_unique on public.lpg_rating_relationships(customer_user_id,driver_profile_id) where subject_type='driver';
create unique index if not exists lpg_rating_relationship_station_unique on public.lpg_rating_relationships(customer_user_id,station_branch_id) where subject_type='station';
create index if not exists lpg_rating_relationship_driver_summary_idx on public.lpg_rating_relationships(driver_profile_id,current_rating) where subject_type='driver';
create index if not exists lpg_rating_relationship_station_summary_idx on public.lpg_rating_relationships(station_branch_id,current_rating) where subject_type='station';

create table if not exists public.lpg_rating_events (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid not null references public.lpg_rating_relationships(id) on delete restrict,
  order_id uuid not null references public.lpg_refill_orders(id) on delete restrict,
  customer_user_id uuid not null references public.profiles(id) on delete restrict,
  subject_type text not null check (subject_type in ('driver','station')),
  driver_profile_id uuid null references public.driver_profiles(id) on delete restrict,
  station_branch_id uuid null references public.lpg_station_branches(id) on delete restrict,
  previous_rating smallint null check (previous_rating between 1 and 5),
  rating smallint not null check (rating between 1 and 5),
  feedback_tags text[] not null default '{}'::text[],
  comment text null,
  status text not null default 'active' check (status in ('active','excluded','under_review')),
  source text not null default 'skima.lpg.mobile',
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  constraint lpg_rating_event_subject_shape check (
    (subject_type='driver' and driver_profile_id is not null and station_branch_id is null)
    or (subject_type='station' and station_branch_id is not null and driver_profile_id is null)
  ),
  constraint lpg_rating_event_comment_length check (comment is null or char_length(comment)<=1000),
  constraint lpg_rating_events_source_idempotency_unique unique(source,idempotency_key)
);
create unique index if not exists lpg_rating_event_order_subject_unique on public.lpg_rating_events(order_id,customer_user_id,subject_type);
create index if not exists lpg_rating_events_driver_time_idx on public.lpg_rating_events(driver_profile_id,created_at desc) where subject_type='driver';
create index if not exists lpg_rating_events_station_time_idx on public.lpg_rating_events(station_branch_id,created_at desc) where subject_type='station';

alter table public.lpg_rating_relationships
  add constraint lpg_rating_relationship_latest_event_fkey
  foreign key (latest_event_id) references public.lpg_rating_events(id) on delete restrict;

create table if not exists public.lpg_service_complaints (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.lpg_refill_orders(id) on delete restrict,
  customer_user_id uuid not null references public.profiles(id) on delete restrict,
  subject_type text not null check (subject_type in ('driver','station','order','payment','cylinder')),
  driver_profile_id uuid null references public.driver_profiles(id) on delete restrict,
  station_branch_id uuid null references public.lpg_station_branches(id) on delete restrict,
  category text not null check (category in ('underfill','safety','lost_cylinder','switched_cylinder','damaged_cylinder','delivery','payment','conduct','fraud','pricing','other')),
  severity text not null default 'standard' check (severity in ('standard','high','critical')),
  description text not null check (char_length(btrim(description)) between 10 and 4000),
  status text not null default 'open' check (status in ('open','triaged','under_review','resolved','dismissed')),
  resolution_code text null,
  resolved_at timestamptz null,
  resolved_by uuid null references public.profiles(id) on delete set null,
  source text not null default 'skima.lpg.mobile',
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  updated_at timestamptz not null default timezone('utc',now()),
  constraint lpg_service_complaints_source_idempotency_unique unique(source,idempotency_key),
  constraint lpg_service_complaint_subject_shape check (
    (subject_type='driver' and driver_profile_id is not null and station_branch_id is null)
    or (subject_type='station' and station_branch_id is not null and driver_profile_id is null)
    or (subject_type in ('order','payment','cylinder') and driver_profile_id is null and station_branch_id is null)
  )
);
create index if not exists lpg_service_complaints_customer_idx on public.lpg_service_complaints(customer_user_id,created_at desc);
create index if not exists lpg_service_complaints_status_idx on public.lpg_service_complaints(status,severity,created_at desc);
create index if not exists lpg_service_complaints_driver_idx on public.lpg_service_complaints(driver_profile_id,status) where driver_profile_id is not null;
create index if not exists lpg_service_complaints_station_idx on public.lpg_service_complaints(station_branch_id,status) where station_branch_id is not null;

create table if not exists public.lpg_complaint_events (
  id uuid primary key default gen_random_uuid(),
  complaint_id uuid not null references public.lpg_service_complaints(id) on delete restrict,
  event_type text not null,
  from_status text null,
  to_status text null,
  actor_user_id uuid null references public.profiles(id) on delete set null default auth.uid(),
  public_message text null check (public_message is null or char_length(public_message)<=2000),
  internal_note text null check (internal_note is null or char_length(internal_note)<=4000),
  source text not null default 'skima.lpg.complaints',
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata)='object'),
  created_at timestamptz not null default timezone('utc',now()),
  constraint lpg_complaint_events_source_idempotency_unique unique(source,idempotency_key)
);
create index if not exists lpg_complaint_events_complaint_idx on public.lpg_complaint_events(complaint_id,created_at asc);

alter table public.lpg_rating_relationships enable row level security;
alter table public.lpg_rating_events enable row level security;
alter table public.lpg_service_complaints enable row level security;
alter table public.lpg_complaint_events enable row level security;

revoke all on table public.lpg_rating_relationships from public,anon,authenticated;
revoke all on table public.lpg_rating_events from public,anon,authenticated;
revoke all on table public.lpg_service_complaints from public,anon,authenticated;
revoke all on table public.lpg_complaint_events from public,anon,authenticated;
grant all on table public.lpg_rating_relationships to service_role;
grant all on table public.lpg_rating_events to service_role;
grant all on table public.lpg_service_complaints to service_role;
grant all on table public.lpg_complaint_events to service_role;

drop trigger if exists set_lpg_rating_relationships_updated_at on public.lpg_rating_relationships;
create trigger set_lpg_rating_relationships_updated_at before update on public.lpg_rating_relationships for each row execute function public.set_updated_at();
drop trigger if exists set_lpg_service_complaints_updated_at on public.lpg_service_complaints;
create trigger set_lpg_service_complaints_updated_at before update on public.lpg_service_complaints for each row execute function public.set_updated_at();

create or replace function public.prevent_lpg_rating_event_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$ begin raise exception using errcode='55000',message='rating history is append-only'; end $$;
drop trigger if exists guard_lpg_rating_event_mutation on public.lpg_rating_events;
create trigger guard_lpg_rating_event_mutation before update or delete on public.lpg_rating_events for each row execute function public.prevent_lpg_rating_event_mutation();

create or replace function public.prevent_lpg_complaint_event_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$ begin raise exception using errcode='55000',message='complaint history is append-only'; end $$;
drop trigger if exists guard_lpg_complaint_event_mutation on public.lpg_complaint_events;
create trigger guard_lpg_complaint_event_mutation before update or delete on public.lpg_complaint_events for each row execute function public.prevent_lpg_complaint_event_mutation();

insert into public.permissions(key,description,risk_level,metadata)
values
 ('lpg.quality.read','Read LPG ratings, quality summaries and complaints.','standard','{}'::jsonb),
 ('lpg.quality.manage','Review rating integrity and resolve LPG service complaints.','high','{}'::jsonb)
on conflict (key) do update set description=excluded.description,risk_level=excluded.risk_level,updated_at=timezone('utc',now());

update public.platform_admin_role_templates t
set permission_keys=(select array_agg(distinct x order by x) from unnest(t.permission_keys || case t.key
 when 'platform.super_admin' then array['lpg.quality.read','lpg.quality.manage']::text[]
 when 'platform.company_admin' then array['lpg.quality.read','lpg.quality.manage']::text[]
 when 'platform.operations_admin' then array['lpg.quality.read','lpg.quality.manage']::text[]
 when 'platform.support_admin' then array['lpg.quality.read','lpg.quality.manage']::text[]
 else array[]::text[] end) x), updated_at=timezone('utc',now())
where t.key in ('platform.super_admin','platform.company_admin','platform.operations_admin','platform.support_admin');

insert into public.role_permissions(role_id,permission_id,conditions)
select r.id,p.id,'{}'::jsonb
from public.roles r join public.permissions p on p.key=any(case r.key
 when 'platform.super_admin' then array['lpg.quality.read','lpg.quality.manage']::text[]
 when 'platform.company_admin' then array['lpg.quality.read','lpg.quality.manage']::text[]
 when 'platform.operations_admin' then array['lpg.quality.read','lpg.quality.manage']::text[]
 when 'platform.support_admin' then array['lpg.quality.read','lpg.quality.manage']::text[]
 else array[]::text[] end)
where r.key in ('platform.super_admin','platform.company_admin','platform.operations_admin','platform.support_admin')
on conflict(role_id,permission_id) do nothing;

create or replace function public.submit_lpg_rating(
  target_order_id uuid,
  target_subject_type text,
  target_rating integer,
  target_feedback_tags text[] default '{}'::text[],
  target_comment text default null,
  target_source text default 'skima.lpg.mobile',
  target_idempotency_key text default null,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  order_record public.lpg_refill_orders%rowtype;
  relationship public.lpg_rating_relationships%rowtype;
  previous_rating smallint;
  event_id uuid;
  existing_event_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  if target_subject_type not in ('driver','station') then raise exception using errcode='22023',message='rating subject must be driver or station'; end if;
  if target_rating is null or target_rating not between 1 and 5 then raise exception using errcode='22023',message='rating must be between 1 and 5'; end if;
  if coalesce(btrim(target_idempotency_key),'')='' then raise exception using errcode='22023',message='idempotency key is required'; end if;
  if target_metadata is null or jsonb_typeof(target_metadata)<>'object' then raise exception using errcode='22023',message='metadata must be an object'; end if;

  select * into order_record from public.lpg_refill_orders where id=target_order_id and customer_user_id=auth.uid();
  if not found then raise exception using errcode='42501',message='order does not belong to current customer'; end if;
  if order_record.status not in ('delivered','completed') then raise exception using errcode='55000',message='ratings are available after delivery is completed'; end if;
  if target_subject_type='driver' and order_record.driver_profile_id is null then raise exception using errcode='55000',message='this order has no completed driver relationship to rate'; end if;
  if target_subject_type='station' and order_record.station_branch_id is null then raise exception using errcode='55000',message='this order has no station relationship to rate'; end if;

  select id into existing_event_id from public.lpg_rating_events where source=coalesce(nullif(btrim(target_source),''),'skima.lpg.mobile') and idempotency_key=target_idempotency_key;
  if existing_event_id is not null then return existing_event_id; end if;
  if exists(select 1 from public.lpg_rating_events where order_id=target_order_id and customer_user_id=auth.uid() and subject_type=target_subject_type) then raise exception using errcode='23505',message='this service relationship has already been rated for this order'; end if;

  if target_subject_type='driver' then
    select * into relationship from public.lpg_rating_relationships where customer_user_id=auth.uid() and subject_type='driver' and driver_profile_id=order_record.driver_profile_id for update;
  else
    select * into relationship from public.lpg_rating_relationships where customer_user_id=auth.uid() and subject_type='station' and station_branch_id=order_record.station_branch_id for update;
  end if;

  if found then
    previous_rating:=relationship.current_rating;
    update public.lpg_rating_relationships
    set current_rating=target_rating,latest_order_id=target_order_id,rating_count=rating_count+1,last_rated_at=timezone('utc',now()),metadata=metadata || jsonb_build_object('lastSource',coalesce(nullif(btrim(target_source),''),'skima.lpg.mobile'))
    where id=relationship.id returning * into relationship;
  else
    insert into public.lpg_rating_relationships(customer_user_id,subject_type,driver_profile_id,station_branch_id,current_rating,latest_order_id,rating_count,metadata)
    values(auth.uid(),target_subject_type,case when target_subject_type='driver' then order_record.driver_profile_id else null end,case when target_subject_type='station' then order_record.station_branch_id else null end,target_rating,target_order_id,1,jsonb_build_object('lastSource',coalesce(nullif(btrim(target_source),''),'skima.lpg.mobile')))
    returning * into relationship;
  end if;

  insert into public.lpg_rating_events(relationship_id,order_id,customer_user_id,subject_type,driver_profile_id,station_branch_id,previous_rating,rating,feedback_tags,comment,status,source,idempotency_key,metadata)
  values(relationship.id,target_order_id,auth.uid(),target_subject_type,case when target_subject_type='driver' then order_record.driver_profile_id else null end,case when target_subject_type='station' then order_record.station_branch_id else null end,previous_rating,target_rating,coalesce(target_feedback_tags,'{}'::text[]),nullif(btrim(target_comment),''),'active',coalesce(nullif(btrim(target_source),''),'skima.lpg.mobile'),target_idempotency_key,target_metadata)
  returning id into event_id;
  update public.lpg_rating_relationships set latest_event_id=event_id where id=relationship.id;
  return event_id;
end;
$$;

create or replace function public.read_lpg_order_rating_state(target_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare order_record public.lpg_refill_orders%rowtype; result jsonb;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  select * into order_record from public.lpg_refill_orders where id=target_order_id and customer_user_id=auth.uid();
  if not found then raise exception using errcode='42501',message='order does not belong to current customer'; end if;
  select jsonb_build_object('eligible',order_record.status in ('delivered','completed'),'orderId',order_record.id,'driverProfileId',order_record.driver_profile_id,'stationBranchId',order_record.station_branch_id,'driverRating',(select rating from public.lpg_rating_events where order_id=order_record.id and customer_user_id=auth.uid() and subject_type='driver' limit 1),'stationRating',(select rating from public.lpg_rating_events where order_id=order_record.id and customer_user_id=auth.uid() and subject_type='station' limit 1)) into result;
  return result;
end;
$$;

create or replace function public.read_lpg_quality_summary(target_subject_type text,target_subject_id uuid)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare relationship_count integer; event_count integer; average_rating numeric; weighted_score numeric; complaint_count integer;
begin
  if target_subject_type not in ('driver','station') or target_subject_id is null then return null; end if;
  if target_subject_type='driver' then
    select count(*),avg(current_rating)::numeric(4,2) into relationship_count,average_rating from public.lpg_rating_relationships where driver_profile_id=target_subject_id and subject_type='driver';
    select count(*) into event_count from public.lpg_rating_events where driver_profile_id=target_subject_id and subject_type='driver' and status='active';
    select count(*) into complaint_count from public.lpg_service_complaints where driver_profile_id=target_subject_id and status not in ('dismissed','resolved');
  else
    select count(*),avg(current_rating)::numeric(4,2) into relationship_count,average_rating from public.lpg_rating_relationships where station_branch_id=target_subject_id and subject_type='station';
    select count(*) into event_count from public.lpg_rating_events where station_branch_id=target_subject_id and subject_type='station' and status='active';
    select count(*) into complaint_count from public.lpg_service_complaints where station_branch_id=target_subject_id and status not in ('dismissed','resolved');
  end if;
  weighted_score:=case when coalesce(relationship_count,0)=0 then null else (((coalesce(average_rating,0)*relationship_count)+(4.0*5))/(relationship_count+5))::numeric(4,2) end;
  return jsonb_build_object('subjectType',target_subject_type,'subjectId',target_subject_id,'averageRating',average_rating,'relationshipCount',coalesce(relationship_count,0),'ratingEventCount',coalesce(event_count,0),'qualityScore',weighted_score,'openComplaintCount',coalesce(complaint_count,0));
end;
$$;

create or replace function public.create_lpg_service_complaint(target_order_id uuid,target_subject_type text,target_category text,target_description text,target_severity text default 'standard',target_source text default 'skima.lpg.mobile',target_idempotency_key text default null,target_metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare order_record public.lpg_refill_orders%rowtype; complaint_id uuid; existing_id uuid;
begin
  if auth.uid() is null then raise exception using errcode='42501',message='authentication required'; end if;
  if target_subject_type not in ('driver','station','order','payment','cylinder') then raise exception using errcode='22023',message='unsupported complaint subject'; end if;
  if target_category not in ('underfill','safety','lost_cylinder','switched_cylinder','damaged_cylinder','delivery','payment','conduct','fraud','pricing','other') then raise exception using errcode='22023',message='unsupported complaint category'; end if;
  if target_severity not in ('standard','high','critical') then raise exception using errcode='22023',message='unsupported complaint severity'; end if;
  if char_length(btrim(coalesce(target_description,''))) not between 10 and 4000 then raise exception using errcode='22023',message='describe the issue in at least 10 characters'; end if;
  if coalesce(btrim(target_idempotency_key),'')='' then raise exception using errcode='22023',message='idempotency key is required'; end if;
  select * into order_record from public.lpg_refill_orders where id=target_order_id and customer_user_id=auth.uid();
  if not found then raise exception using errcode='42501',message='order does not belong to current customer'; end if;
  if target_subject_type='driver' and order_record.driver_profile_id is null then raise exception using errcode='55000',message='this order has no driver to report'; end if;
  if target_subject_type='station' and order_record.station_branch_id is null then raise exception using errcode='55000',message='this order has no station to report'; end if;
  select id into existing_id from public.lpg_service_complaints where source=coalesce(nullif(btrim(target_source),''),'skima.lpg.mobile') and idempotency_key=target_idempotency_key;
  if existing_id is not null then return existing_id; end if;
  insert into public.lpg_service_complaints(order_id,customer_user_id,subject_type,driver_profile_id,station_branch_id,category,severity,description,status,source,idempotency_key,metadata)
  values(order_record.id,auth.uid(),target_subject_type,case when target_subject_type='driver' then order_record.driver_profile_id else null end,case when target_subject_type='station' then order_record.station_branch_id else null end,target_category,target_severity,btrim(target_description),'open',coalesce(nullif(btrim(target_source),''),'skima.lpg.mobile'),target_idempotency_key,target_metadata)
  returning id into complaint_id;
  insert into public.lpg_complaint_events(complaint_id,event_type,to_status,actor_user_id,public_message,source,idempotency_key,metadata)
  values(complaint_id,'complaint.created','open',auth.uid(),'Your report has been received.','skima.lpg.complaints','complaint-created:'||complaint_id::text,jsonb_build_object('category',target_category,'severity',target_severity));
  return complaint_id;
end;
$$;

create or replace function public.review_lpg_service_complaint(target_complaint_id uuid,target_status text,target_resolution_code text,target_public_message text,target_internal_note text,target_idempotency_key text,target_metadata jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path=public,pg_temp as $$
declare complaint public.lpg_service_complaints%rowtype;
begin
  if not (public.has_permission('lpg.quality.manage',null) or public.has_permission('lpg.operations.manage',null)) then raise exception using errcode='42501',message='quality review permission required'; end if;
  if target_status not in ('triaged','under_review','resolved','dismissed') then raise exception using errcode='22023',message='unsupported complaint status'; end if;
  if coalesce(btrim(target_idempotency_key),'')='' then raise exception using errcode='22023',message='idempotency key is required'; end if;
  select * into complaint from public.lpg_service_complaints where id=target_complaint_id for update;
  if not found then raise exception using errcode='22023',message='complaint not found'; end if;
  if complaint.status in ('resolved','dismissed') then raise exception using errcode='55000',message='closed complaint cannot be changed'; end if;
  update public.lpg_service_complaints set status=target_status,resolution_code=case when target_status in ('resolved','dismissed') then nullif(btrim(target_resolution_code),'') else resolution_code end,resolved_at=case when target_status in ('resolved','dismissed') then timezone('utc',now()) else null end,resolved_by=case when target_status in ('resolved','dismissed') then auth.uid() else null end where id=complaint.id;
  insert into public.lpg_complaint_events(complaint_id,event_type,from_status,to_status,actor_user_id,public_message,internal_note,source,idempotency_key,metadata)
  values(complaint.id,'complaint.status_changed',complaint.status,target_status,auth.uid(),nullif(btrim(target_public_message),''),nullif(btrim(target_internal_note),''),'skima.lpg.complaints',target_idempotency_key,target_metadata)
  on conflict(source,idempotency_key) do nothing;
  return complaint.id;
end;
$$;

create or replace function public.read_lpg_quality_admin_queue(target_status text default null,target_limit integer default 100)
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
declare result jsonb;
begin
  if not (public.has_permission('lpg.quality.read',null) or public.has_permission('lpg.quality.manage',null) or public.has_permission('lpg.operations.manage',null)) then raise exception using errcode='42501',message='quality read permission required'; end if;
  select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb) into result
  from (select c.created_at,jsonb_build_object('complaintId',c.id,'orderId',c.order_id,'subjectType',c.subject_type,'driverProfileId',c.driver_profile_id,'stationBranchId',c.station_branch_id,'category',c.category,'severity',c.severity,'description',c.description,'status',c.status,'resolutionCode',c.resolution_code,'createdAt',c.created_at,'updatedAt',c.updated_at) row_data from public.lpg_service_complaints c where target_status is null or c.status=target_status order by c.created_at desc limit least(greatest(coalesce(target_limit,100),1),500)) rows;
  return result;
end;
$$;

revoke all on function public.submit_lpg_rating(uuid,text,integer,text[],text,text,text,jsonb) from public,anon;
revoke all on function public.read_lpg_order_rating_state(uuid) from public,anon;
revoke all on function public.read_lpg_quality_summary(text,uuid) from public;
revoke all on function public.create_lpg_service_complaint(uuid,text,text,text,text,text,text,jsonb) from public,anon;
revoke all on function public.review_lpg_service_complaint(uuid,text,text,text,text,text,jsonb) from public,anon;
revoke all on function public.read_lpg_quality_admin_queue(text,integer) from public,anon;
grant execute on function public.submit_lpg_rating(uuid,text,integer,text[],text,text,text,jsonb) to authenticated,service_role;
grant execute on function public.read_lpg_order_rating_state(uuid) to authenticated,service_role;
grant execute on function public.read_lpg_quality_summary(text,uuid) to anon,authenticated,service_role;
grant execute on function public.create_lpg_service_complaint(uuid,text,text,text,text,text,text,jsonb) to authenticated,service_role;
grant execute on function public.review_lpg_service_complaint(uuid,text,text,text,text,text,jsonb) to authenticated,service_role;
grant execute on function public.read_lpg_quality_admin_queue(text,integer) to authenticated,service_role;

create policy lpg_rating_relationships_owner_read on public.lpg_rating_relationships for select to authenticated using(customer_user_id=auth.uid() or public.has_permission('lpg.quality.read',null));
create policy lpg_rating_events_owner_read on public.lpg_rating_events for select to authenticated using(customer_user_id=auth.uid() or public.has_permission('lpg.quality.read',null));
create policy lpg_service_complaints_owner_read on public.lpg_service_complaints for select to authenticated using(customer_user_id=auth.uid() or public.has_permission('lpg.quality.read',null));
create policy lpg_complaint_events_owner_read on public.lpg_complaint_events for select to authenticated using(exists(select 1 from public.lpg_service_complaints c where c.id=complaint_id and (c.customer_user_id=auth.uid() or public.has_permission('lpg.quality.read',null))));
