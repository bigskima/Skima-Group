begin;

-- SKIMA Logistics post-pickup incident, custody and dispute protection.
-- All records live in the Logistics domain; customer/provider/driver permissions
-- are resolved server-side and all mutations go through SECURITY DEFINER RPCs.

alter table public.logistics_bookings
  add column if not exists cargo_custody_status text not null default 'not_collected',
  add column if not exists delivery_exception_reason text;

alter table public.logistics_bookings
  drop constraint if exists logistics_bookings_status_check;
alter table public.logistics_bookings
  add constraint logistics_bookings_status_check
  check (status in (
    'awaiting_payment','awaiting_offline_confirmation','payment_processing',
    'payment_reserved','offline_payment_confirmed','provider_accepted',
    'in_progress','delivered','delivery_exception','failed_delivery',
    'settled','completed_offline','cancelled','payment_failed','disputed','refunded'
  ));

-- Preserve the assigned driver record during incident review without treating an
-- incident-held driver as an active dispatch resource.
alter table public.logistics_booking_driver_assignments
  drop constraint if exists logistics_booking_driver_assignments_status_check;
alter table public.logistics_booking_driver_assignments
  add constraint logistics_booking_driver_assignments_status_check
  check (status in (
    'offered','accepted','replacement_pending','in_progress','picked_up','in_transit',
    'delivery_submitted','incident_hold','completed','rejected','reassigned','cancelled'
  ));

-- A driver whose assignment is on incident hold may still have physical custody
-- or unresolved cargo responsibility. Do not dispatch that driver to another job.
drop index if exists public.logistics_driver_one_active_booking_idx;
create unique index logistics_driver_one_active_booking_idx
  on public.logistics_booking_driver_assignments(driver_profile_id)
  where status in (
    'offered','accepted','replacement_pending','in_progress','picked_up','in_transit','incident_hold'
  );

alter table public.logistics_bookings
  drop constraint if exists logistics_bookings_cargo_custody_status_check;
alter table public.logistics_bookings
  add constraint logistics_bookings_cargo_custody_status_check
  check (cargo_custody_status in (
    'not_collected','driver_custody','recovery_pending','recovered','delivered','unknown'
  ));

create table if not exists public.logistics_booking_incidents (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.logistics_bookings(id) on delete restrict,
  job_id uuid not null references public.logistics_job_requests(id) on delete restrict,
  provider_organization_id uuid not null references public.organizations(id) on delete restrict,
  assignment_id uuid references public.logistics_booking_driver_assignments(id) on delete set null,
  reporter_user_id uuid not null references public.profiles(id) on delete restrict,
  reporter_role text not null check (reporter_role in ('customer','driver','company','platform')),
  incident_type text not null check (incident_type in (
    'vehicle_breakdown','accident','route_blocked','security_risk','cargo_damaged',
    'cargo_missing','customer_unavailable','incorrect_address','recipient_refused',
    'partial_delivery','wrong_cargo','other'
  )),
  severity text not null check (severity in ('low','medium','high','critical')),
  description text not null check (char_length(btrim(description)) between 5 and 3000),
  cargo_custody_status text not null check (cargo_custody_status in (
    'not_collected','driver_custody','recovery_pending','recovered','delivered','unknown'
  )),
  booking_status_before_incident text not null,
  assignment_status_before_incident text,
  location_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(location_snapshot) = 'object'),
  status text not null default 'reported'
    check (status in ('reported','investigating','recovery_required','resolved','closed')),
  resolution_code text,
  resolution_note text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (booking_id,idempotency_key)
);

create index if not exists logistics_booking_incidents_booking_idx
  on public.logistics_booking_incidents(booking_id,created_at desc);
create index if not exists logistics_booking_incidents_company_idx
  on public.logistics_booking_incidents(provider_organization_id,status,created_at desc);

create table if not exists public.logistics_booking_disputes (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.logistics_bookings(id) on delete restrict,
  job_id uuid not null references public.logistics_job_requests(id) on delete restrict,
  provider_organization_id uuid not null references public.organizations(id) on delete restrict,
  requester_user_id uuid not null references public.profiles(id) on delete restrict,
  incident_id uuid references public.logistics_booking_incidents(id) on delete set null,
  reason text not null check (reason in (
    'non_delivery','partial_delivery','damaged_cargo','wrong_delivery','recipient_not_authorized','other'
  )),
  details text not null check (char_length(btrim(details)) between 5 and 3000),
  booking_status_before_dispute text not null,
  status text not null default 'open'
    check (status in ('open','under_review','resolved','escalated','closed')),
  resolution_code text,
  resolution_note text,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  refund_transaction_id uuid references public.financial_transactions(id) on delete restrict,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  unique (booking_id,idempotency_key)
);

create unique index if not exists logistics_booking_one_active_dispute_idx
  on public.logistics_booking_disputes(booking_id)
  where status in ('open','under_review','escalated');
create index if not exists logistics_booking_disputes_company_idx
  on public.logistics_booking_disputes(provider_organization_id,status,created_at desc);

alter table public.logistics_booking_incidents enable row level security;
alter table public.logistics_booking_disputes enable row level security;

drop policy if exists logistics_booking_incidents_read_participants on public.logistics_booking_incidents;
create policy logistics_booking_incidents_read_participants
on public.logistics_booking_incidents for select to authenticated
using (
  exists (
    select 1 from public.logistics_bookings booking
    where booking.id = logistics_booking_incidents.booking_id
      and (
        booking.requester_user_id = auth.uid()
        or public.can_read_logistics_company(booking.provider_organization_id)
        or public.has_permission('logistics.marketplace.manage',null)
        or exists (
          select 1 from public.logistics_booking_driver_assignments assignment
          where assignment.id = logistics_booking_incidents.assignment_id
            and assignment.driver_user_id = auth.uid()
        )
        or exists (
          select 1 from public.logistics_booking_driver_assignments assignment
          where assignment.booking_id = logistics_booking_incidents.booking_id
            and assignment.driver_user_id = auth.uid()
            and assignment.metadata->>'assignment_kind' = 'recovery'
            and assignment.status not in ('rejected','reassigned','cancelled')
        )
      )
  )
);
create policy logistics_booking_incidents_no_direct_insert
on public.logistics_booking_incidents for insert to authenticated with check (false);
create policy logistics_booking_incidents_no_direct_update
on public.logistics_booking_incidents for update to authenticated using (false) with check (false);
create policy logistics_booking_incidents_no_direct_delete
on public.logistics_booking_incidents for delete to authenticated using (false);

drop policy if exists logistics_booking_disputes_read_participants on public.logistics_booking_disputes;
create policy logistics_booking_disputes_read_participants
on public.logistics_booking_disputes for select to authenticated
using (
  requester_user_id = auth.uid()
  or public.can_read_logistics_company(provider_organization_id)
  or public.has_permission('logistics.marketplace.manage',null)
);
create policy logistics_booking_disputes_no_direct_insert
on public.logistics_booking_disputes for insert to authenticated with check (false);
create policy logistics_booking_disputes_no_direct_update
on public.logistics_booking_disputes for update to authenticated using (false) with check (false);
create policy logistics_booking_disputes_no_direct_delete
on public.logistics_booking_disputes for delete to authenticated using (false);

revoke all on public.logistics_booking_incidents,public.logistics_booking_disputes from public,anon,authenticated;\ngrant select on public.logistics_booking_incidents,public.logistics_booking_disputes to authenticated,service_role;

create or replace function public.guard_logistics_settlement_on_open_exceptions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('settled','completed_offline') and old.status is distinct from new.status then
    if exists (
      select 1 from public.logistics_booking_disputes dispute
      where dispute.booking_id = new.id and dispute.status in ('open','under_review','escalated')
    ) then
      raise exception 'Logistics settlement is blocked while a customer dispute is open';
    end if;
    if exists (
      select 1 from public.logistics_booking_incidents incident
      where incident.booking_id = new.id and incident.status in ('reported','investigating','recovery_required')
    ) then
      raise exception 'Logistics settlement is blocked while a delivery incident requires action';
    end if;
    if new.status = 'settled' and new.payment_mode = 'online_wallet'
      and new.escrow_hold_id is null then
      raise exception 'online Logistics settlement requires the original escrow hold';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists logistics_settlement_exception_guard on public.logistics_bookings;
create trigger logistics_settlement_exception_guard
before update of status on public.logistics_bookings
for each row execute function public.guard_logistics_settlement_on_open_exceptions();

create or replace function public.report_logistics_booking_incident(
  target_booking_id uuid,
  target_incident_type text,
  target_severity text,
  target_description text,
  target_cargo_custody_status text,
  target_location_snapshot jsonb,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  booking_record public.logistics_bookings%rowtype;
  assignment_record public.logistics_booking_driver_assignments%rowtype;
  incident_id uuid;
  actor_role text;
  existing_incident public.logistics_booking_incidents%rowtype;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_booking_id is null
    or target_incident_type is null
    or target_severity is null
    or target_cargo_custody_status is null
    or target_incident_type not in (
      'vehicle_breakdown','accident','route_blocked','security_risk','cargo_damaged',
      'cargo_missing','customer_unavailable','incorrect_address','recipient_refused',
      'partial_delivery','wrong_cargo','other'
    )
    or target_severity not in ('low','medium','high','critical')
    or target_description is null or char_length(btrim(target_description)) not between 5 and 3000
    or target_cargo_custody_status not in ('not_collected','driver_custody','recovery_pending','recovered','delivered','unknown')
    or target_location_snapshot is null or jsonb_typeof(target_location_snapshot) <> 'object'
    or target_idempotency_key is null or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'valid booking, incident details, custody state, location snapshot and idempotency key are required';
  end if;

  select * into booking_record
  from public.logistics_bookings where id = target_booking_id for update;
  if not found then raise exception 'logistics booking was not found'; end if;

  if booking_record.requester_user_id = actor then
    actor_role := 'customer';
    if booking_record.status not in ('delivered','delivery_exception','failed_delivery','disputed') then
      raise exception 'customer incident reports are available after a delivery attempt';
    end if;
  elsif public.can_manage_logistics_company(booking_record.provider_organization_id)
    or public.has_permission('business.logistics.jobs.manage',booking_record.provider_organization_id) then
    actor_role := 'company';
  elsif exists (
    select 1 from public.logistics_booking_driver_assignments assignment
    where assignment.booking_id = booking_record.id
      and assignment.driver_user_id = actor
      and assignment.status in ('in_progress','picked_up','in_transit','delivery_submitted','incident_hold')
  ) then
    actor_role := 'driver';
  else
    raise exception 'only the customer, assigned driver or provider company may report this incident';
  end if;

  if actor_role = 'driver' and booking_record.service_started_at is null then
    raise exception 'drivers may report delivery incidents only after the service has started';
  end if;
  if booking_record.status in ('settled','completed_offline','cancelled','payment_failed','refunded') then
    raise exception 'a closed Logistics booking cannot accept a new operational incident';
  end if;

  select * into existing_incident
  from public.logistics_booking_incidents
  where booking_id = booking_record.id and idempotency_key = target_idempotency_key;
  if found then
    if existing_incident.incident_type <> target_incident_type
      or existing_incident.reporter_user_id <> actor
      or existing_incident.description <> btrim(target_description) then
      raise exception 'incident idempotency key was reused with different details';
    end if;
    return existing_incident.id;
  end if;

  select * into assignment_record
  from public.logistics_booking_driver_assignments
  where booking_id = booking_record.id
    and status in ('in_progress','picked_up','in_transit','delivery_submitted','incident_hold')
  order by created_at desc limit 1;

  insert into public.logistics_booking_incidents (
    booking_id,job_id,provider_organization_id,assignment_id,reporter_user_id,reporter_role,
    incident_type,severity,description,cargo_custody_status,booking_status_before_incident,
    assignment_status_before_incident,location_snapshot,idempotency_key,metadata
  )
  values (
    booking_record.id,booking_record.job_id,booking_record.provider_organization_id,
    assignment_record.id,actor,actor_role,target_incident_type,target_severity,btrim(target_description),
    target_cargo_custody_status,booking_record.status,assignment_record.status,
    target_location_snapshot,target_idempotency_key,
    jsonb_build_object('payment_mode',booking_record.payment_mode,'reported_at',timezone('utc',now()))
  )
  returning id into incident_id;

  if assignment_record.id is not null
    and assignment_record.status in ('in_progress','picked_up','in_transit','delivery_submitted') then
    update public.logistics_booking_driver_assignments
    set status = 'incident_hold',
        updated_at = timezone('utc',now()),
        metadata = metadata || jsonb_build_object(
          'delivery_exception_id',incident_id,
          'incident_reported_at',timezone('utc',now())
        )
    where id = assignment_record.id;
  end if;

  if booking_record.status <> 'disputed' then
    update public.logistics_bookings
    set status = 'delivery_exception',
        cargo_custody_status = target_cargo_custody_status,
        delivery_exception_reason = target_incident_type,
        updated_at = timezone('utc',now())
    where id = booking_record.id;
  else
    update public.logistics_bookings
    set cargo_custody_status = target_cargo_custody_status,
        delivery_exception_reason = target_incident_type,
        updated_at = timezone('utc',now())
    where id = booking_record.id;
  end if;

  if booking_record.payment_mode = 'online_wallet' and booking_record.escrow_hold_id is not null then
    update public.escrow_holds
    set status = 'disputed',updated_at = timezone('utc',now())
    where id = booking_record.escrow_hold_id and status in ('held','partially_released');
  end if;

  perform public.record_logistics_booking_event(
    booking_record.id,'logistics.booking.incident_reported',target_idempotency_key,
    booking_record.status,case when booking_record.status = 'disputed' then 'disputed' else 'delivery_exception' end,
    jsonb_build_object(
      'incident_id',incident_id,'incident_type',target_incident_type,'severity',target_severity,
      'reporter_role',actor_role,'cargo_custody_status',target_cargo_custody_status
    )
  );
  return incident_id;
end;
$$;

create or replace function public.respond_logistics_booking_incident(
  target_incident_id uuid,
  target_decision text,
  target_resolution_note text,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  incident_record public.logistics_booking_incidents%rowtype;
  booking_record public.logistics_bookings%rowtype;
  assignment_record public.logistics_booking_driver_assignments%rowtype;
  existing_event public.logistics_booking_events%rowtype;
  next_booking_status text;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_incident_id is null
    or target_decision is null
    or target_decision not in ('resume_delivery','recovery_required','mark_failed_delivery')
    or target_resolution_note is null or char_length(btrim(target_resolution_note)) not between 5 and 2000
    or target_idempotency_key is null or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'incident, supported resolution, explanation and idempotency key are required';
  end if;

  select * into incident_record
  from public.logistics_booking_incidents where id = target_incident_id;
  if not found then raise exception 'Logistics incident was not found'; end if;

  select * into booking_record
  from public.logistics_bookings where id = incident_record.booking_id for update;
  if not found then raise exception 'Logistics booking was not found'; end if;
  if not public.can_manage_logistics_company(booking_record.provider_organization_id)
    and not public.has_permission('business.logistics.jobs.manage',booking_record.provider_organization_id) then
    raise exception 'provider company incident-management permission is required';
  end if;
  if incident_record.status not in ('reported','investigating','recovery_required') then
    raise exception 'this incident is already resolved or closed';
  end if;

  select * into existing_event
  from public.logistics_booking_events
  where booking_id = booking_record.id and idempotency_key = target_idempotency_key;
  if found then
    if existing_event.event_type <> 'logistics.booking.incident_resolved'
      or existing_event.metadata->>'incident_id' <> incident_record.id::text
      or existing_event.metadata->>'decision' <> target_decision then
      raise exception 'incident resolution idempotency key was reused for a different action';
    end if;
    return incident_record.id;
  end if;

  select * into assignment_record
  from public.logistics_booking_driver_assignments
  where id = incident_record.assignment_id and booking_id = booking_record.id
  for update;

  if target_decision = 'recovery_required'
    and incident_record.cargo_custody_status not in ('driver_custody','unknown','recovery_pending') then
    raise exception 'cargo recovery is required only when cargo custody is with the driver or is uncertain';
  end if;
  if target_decision = 'mark_failed_delivery'
    and incident_record.cargo_custody_status in ('driver_custody','unknown','recovery_pending') then
    raise exception 'cargo in driver custody or with uncertain custody must enter controlled recovery, not be closed as a failed attempt';
  end if;

  if target_decision = 'resume_delivery' then
    if booking_record.status <> 'delivery_exception'
      or incident_record.booking_status_before_incident <> 'in_progress'
      or incident_record.assignment_status_before_incident not in ('in_progress','picked_up','in_transit')
      or incident_record.cargo_custody_status in ('recovery_pending','unknown') then
      raise exception 'delivery may resume only when the same active delivery has known cargo custody and no recovery is pending';
    end if;
    if assignment_record.id is null or assignment_record.status <> 'incident_hold' then
      raise exception 'the original incident-held driver assignment must remain available to resume this delivery';
    end if;
    if assignment_record.status = 'incident_hold' then
      update public.logistics_booking_driver_assignments
      set status = coalesce(incident_record.assignment_status_before_incident,'in_transit'),
          updated_at = timezone('utc',now())
      where id = assignment_record.id;
    end if;
    update public.logistics_bookings
    set status = 'in_progress',
        assigned_driver_profile_id = assignment_record.driver_profile_id,
        assigned_driver_user_id = assignment_record.driver_user_id,
        assigned_vehicle_id = assignment_record.vehicle_id,
        cargo_custody_status = incident_record.cargo_custody_status,
        delivery_exception_reason = null,
        updated_at = timezone('utc',now())
    where id = booking_record.id;
    if booking_record.payment_mode = 'online_wallet' and booking_record.escrow_hold_id is not null then
      update public.escrow_holds set status = 'held',updated_at = timezone('utc',now())
      where id = booking_record.escrow_hold_id and status = 'disputed' and released_amount = 0;
    end if;
    next_booking_status := 'in_progress';
    update public.logistics_booking_incidents
    set status = 'resolved',resolution_code = target_decision,
        resolution_note = btrim(target_resolution_note),resolved_by = actor,
        resolved_at = timezone('utc',now()),updated_at = timezone('utc',now())
    where id = incident_record.id;
  else
    if target_decision = 'recovery_required' then
      update public.logistics_booking_incidents
      set status = 'recovery_required',resolution_code = target_decision,
          resolution_note = btrim(target_resolution_note),resolved_by = actor,
          resolved_at = timezone('utc',now()),updated_at = timezone('utc',now())
      where id = incident_record.id;
    else
      update public.logistics_booking_incidents
      set status = 'resolved',resolution_code = target_decision,
          resolution_note = btrim(target_resolution_note),resolved_by = actor,
          resolved_at = timezone('utc',now()),updated_at = timezone('utc',now())
      where id = incident_record.id;
    end if;

    update public.logistics_booking_driver_assignments
    set status = case
          when target_decision = 'mark_failed_delivery'
            and incident_record.cargo_custody_status = 'not_collected' then 'cancelled'
          when target_decision = 'mark_failed_delivery'
            and incident_record.cargo_custody_status = 'delivered' then 'completed'
          else 'incident_hold'
        end,
        updated_at = timezone('utc',now()),
        metadata = metadata || jsonb_build_object(
          'delivery_exception_id',incident_record.id,
          'incident_assignment_outcome',target_decision
        )
    where id = incident_record.assignment_id
      and status in ('in_progress','picked_up','in_transit','delivery_submitted','incident_hold');

    update public.logistics_bookings
    set status = 'failed_delivery',
        cargo_custody_status = case
          when target_decision = 'recovery_required' then 'recovery_pending'
          else incident_record.cargo_custody_status
        end,
        assigned_driver_profile_id = null,
        assigned_driver_user_id = null,
        assigned_vehicle_id = null,
        driver_assigned_at = null,
        delivery_exception_reason = target_decision,
        updated_at = timezone('utc',now())
    where id = booking_record.id;
    next_booking_status := 'failed_delivery';
  end if;

  perform public.record_logistics_booking_event(
    booking_record.id,'logistics.booking.incident_resolved',target_idempotency_key,
    booking_record.status,next_booking_status,
    jsonb_build_object(
      'incident_id',incident_record.id,'decision',target_decision,
      'cargo_custody_status',case when target_decision = 'recovery_required' then 'recovery_pending' else incident_record.cargo_custody_status end,
      'resolution_note',btrim(target_resolution_note)
    )
  );
  return incident_record.id;
end;
$$;

create or replace function public.open_logistics_booking_dispute(
  target_booking_id uuid,
  target_reason text,
  target_details text,
  target_incident_id uuid,
  target_idempotency_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  booking_record public.logistics_bookings%rowtype;
  incident_record public.logistics_booking_incidents%rowtype;
  dispute_id uuid;
  existing_dispute public.logistics_booking_disputes%rowtype;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if target_booking_id is null
    or target_reason is null
    or target_reason not in ('non_delivery','partial_delivery','damaged_cargo','wrong_delivery','recipient_not_authorized','other')
    or target_details is null or char_length(btrim(target_details)) not between 5 and 3000
    or target_idempotency_key is null or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'valid booking, dispute reason, details and idempotency key are required';
  end if;

  select * into booking_record
  from public.logistics_bookings where id = target_booking_id for update;
  if not found or booking_record.requester_user_id <> actor then
    raise exception 'Logistics booking was not found for the authenticated customer';
  end if;
  if booking_record.status not in ('delivered','delivery_exception','failed_delivery') then
    raise exception 'a dispute can be opened only after a delivery attempt or failure';
  end if;
  if booking_record.status in ('settled','completed_offline','refunded') then
    raise exception 'this booking is already financially completed; contact SKIMA support for a post-settlement review';
  end if;

  if target_incident_id is not null then
    select * into incident_record
    from public.logistics_booking_incidents
    where id = target_incident_id and booking_id = booking_record.id;
    if not found then raise exception 'the selected incident does not belong to this booking'; end if;
  end if;

  select * into existing_dispute
  from public.logistics_booking_disputes
  where booking_id = booking_record.id and idempotency_key = target_idempotency_key;
  if found then
    if existing_dispute.reason <> target_reason
      or existing_dispute.requester_user_id <> actor
      or existing_dispute.details <> btrim(target_details) then
      raise exception 'dispute idempotency key was reused with different details';
    end if;
    return existing_dispute.id;
  end if;

  insert into public.logistics_booking_disputes (
    booking_id,job_id,provider_organization_id,requester_user_id,incident_id,
    reason,details,booking_status_before_dispute,idempotency_key,metadata
  )
  values (
    booking_record.id,booking_record.job_id,booking_record.provider_organization_id,actor,
    target_incident_id,target_reason,btrim(target_details),booking_record.status,
    target_idempotency_key,jsonb_build_object('payment_mode',booking_record.payment_mode)
  )
  returning id into dispute_id;

  update public.logistics_bookings
  set status = 'disputed',updated_at = timezone('utc',now())
  where id = booking_record.id;

  if booking_record.payment_mode = 'online_wallet' and booking_record.escrow_hold_id is not null then
    update public.escrow_holds
    set status = 'disputed',updated_at = timezone('utc',now())
    where id = booking_record.escrow_hold_id and status in ('held','partially_released');
  end if;

  perform public.record_logistics_booking_event(
    booking_record.id,'logistics.booking.dispute_opened',target_idempotency_key,
    booking_record.status,'disputed',
    jsonb_build_object('dispute_id',dispute_id,'reason',target_reason,'incident_id',target_incident_id)
  );
  return dispute_id;
end;
$$;

create or replace function public.resolve_logistics_booking_dispute(
  target_dispute_id uuid,
  target_decision text,
  target_resolution_note text,
  target_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  dispute_record public.logistics_booking_disputes%rowtype;
  booking_record public.logistics_bookings%rowtype;
  incident_record public.logistics_booking_incidents%rowtype;
  assignment_record public.logistics_booking_driver_assignments%rowtype;
  hold_record public.escrow_holds%rowtype;
  refund_wallet public.wallet_accounts%rowtype;
  v_refund_transaction_id uuid;
  next_booking_status text;
begin
  if actor is null then raise exception 'authentication is required'; end if;
  if not public.has_permission('platform.escrow.execute',null) then
    raise exception 'platform escrow execution permission is required';
  end if;
  if target_dispute_id is null
    or target_decision is null
    or target_decision not in (
      'refund_customer','allow_delivery_confirmation','resume_delivery',
      'offline_finance_review','close_offline_finance_review'
    )
    or target_resolution_note is null or char_length(btrim(target_resolution_note)) not between 5 and 2000
    or target_idempotency_key is null or char_length(btrim(target_idempotency_key)) not between 8 and 180 then
    raise exception 'dispute, supported decision, resolution note and idempotency key are required';
  end if;

  select * into dispute_record
  from public.logistics_booking_disputes where id = target_dispute_id for update;
  if not found then raise exception 'Logistics dispute was not found'; end if;

  select * into booking_record
  from public.logistics_bookings where id = dispute_record.booking_id for update;
  if not found then raise exception 'Logistics booking was not found'; end if;

  if dispute_record.status = 'resolved' then
    if dispute_record.resolution_code = target_decision then
      return jsonb_build_object(
        'dispute_id',dispute_record.id,
        'booking_id',booking_record.id,
        'status',dispute_record.status,
        'refund_transaction_id',dispute_record.refund_transaction_id
      );
    end if;
    raise exception 'this dispute has already been resolved';
  end if;
  if dispute_record.status not in ('open','under_review','escalated') then
    raise exception 'this dispute cannot be resolved from its current status';
  end if;

  if target_decision = 'refund_customer' then
    if booking_record.payment_mode <> 'online_wallet' then
      raise exception 'offline Logistics payments require manual finance review; no wallet refund can be issued by this workflow';
    end if;
    if booking_record.escrow_hold_id is null or booking_record.payment_attempt_wallet_id is null then
      raise exception 'the original Logistics escrow hold and customer funding wallet are required';
    end if;

    select * into hold_record
    from public.escrow_holds where id = booking_record.escrow_hold_id for update;
    if not found or hold_record.status <> 'disputed' or hold_record.released_amount <> 0
      or hold_record.hold_amount <> booking_record.total_customer_charge then
      raise exception 'the Logistics escrow hold is not fully available for a safe full refund';
    end if;

    select * into refund_wallet
    from public.wallet_accounts
    where id = booking_record.payment_attempt_wallet_id
      and wallet_type = 'customer'
      and owner_entity_type = 'user'
      and owner_entity_id = booking_record.requester_user_id
      and currency_code = booking_record.currency_code
      and status = 'active'
    for update;
    if not found then raise exception 'the original customer wallet is not active or does not match the booking'; end if;

    v_refund_transaction_id := public.refund_escrow_hold(
      booking_record.escrow_hold_id,
      refund_wallet.id,
      target_idempotency_key || ':refund',
      jsonb_build_object(
        'module_key','logistics_network',
        'booking_id',booking_record.id,
        'dispute_id',dispute_record.id,
        'resolution','refund_customer',
        'resolved_by',actor
      )
    );

    next_booking_status := 'refunded';
    update public.logistics_bookings
    set status = 'refunded',updated_at = timezone('utc',now())
    where id = booking_record.id;

  elsif target_decision = 'allow_delivery_confirmation' then
    if dispute_record.booking_status_before_dispute = 'delivery_exception'
      and dispute_record.incident_id is not null then
      select * into incident_record
      from public.logistics_booking_incidents
      where id = dispute_record.incident_id and booking_id = booking_record.id
      for update;
      if not found or incident_record.booking_status_before_incident <> 'delivered' then
        raise exception 'customer confirmation can be reopened only for a delivery that was already submitted';
      end if;
      if incident_record.assignment_id is not null then
        select * into assignment_record
        from public.logistics_booking_driver_assignments
        where id = incident_record.assignment_id and booking_id = booking_record.id
        for update;
        if assignment_record.id is not null and assignment_record.status = 'incident_hold' then
          update public.logistics_booking_driver_assignments
          set status = 'delivery_submitted',
              updated_at = timezone('utc',now()),
              metadata = metadata || jsonb_build_object('incident_review_outcome','delivery_confirmation_reopened')
          where id = assignment_record.id;
        end if;
      end if;
    elsif dispute_record.booking_status_before_dispute <> 'delivered' then
      raise exception 'delivery confirmation can be reopened only for a delivered booking';
    end if;
    if booking_record.payment_mode = 'online_wallet' then
      update public.escrow_holds set status = 'held',updated_at = timezone('utc',now())
      where id = booking_record.escrow_hold_id and status = 'disputed' and released_amount = 0;
    end if;
    next_booking_status := 'delivered';
    update public.logistics_bookings
    set status = 'delivered',
        cargo_custody_status = 'delivered',
        delivery_exception_reason = null,
        updated_at = timezone('utc',now())
    where id = booking_record.id;

  elsif target_decision = 'resume_delivery' then
    if dispute_record.booking_status_before_dispute <> 'delivery_exception'
      or dispute_record.incident_id is null then
      raise exception 'delivery can resume only when the dispute was opened during an active delivery exception';
    end if;
    select * into incident_record
    from public.logistics_booking_incidents
    where id = dispute_record.incident_id and booking_id = booking_record.id
    for update;
    if not found
      or incident_record.booking_status_before_incident <> 'in_progress'
      or incident_record.assignment_status_before_incident not in ('in_progress','picked_up','in_transit')
      or incident_record.cargo_custody_status in ('recovery_pending','unknown') then
      raise exception 'only the same active delivery with known cargo custody can resume';
    end if;
    select * into assignment_record
    from public.logistics_booking_driver_assignments
    where id = incident_record.assignment_id and booking_id = booking_record.id
    for update;
    if not found or assignment_record.status <> 'incident_hold' then
      raise exception 'the original incident-held driver assignment must be available for safe resumption';
    end if;
    update public.logistics_booking_driver_assignments
    set status = incident_record.assignment_status_before_incident,
        updated_at = timezone('utc',now()),
        metadata = metadata || jsonb_build_object('incident_review_outcome','delivery_resumed')
    where id = assignment_record.id;
    if booking_record.payment_mode = 'online_wallet' then
      update public.escrow_holds set status = 'held',updated_at = timezone('utc',now())
      where id = booking_record.escrow_hold_id and status = 'disputed' and released_amount = 0;
    end if;
    next_booking_status := 'in_progress';
    update public.logistics_bookings
    set status = 'in_progress',
        assigned_driver_profile_id = assignment_record.driver_profile_id,
        assigned_driver_user_id = assignment_record.driver_user_id,
        assigned_vehicle_id = assignment_record.vehicle_id,
        driver_assigned_at = coalesce(driver_assigned_at,assignment_record.offered_at),
        cargo_custody_status = incident_record.cargo_custody_status,
        delivery_exception_reason = null,
        updated_at = timezone('utc',now())
    where id = booking_record.id;

  elsif target_decision = 'offline_finance_review' then
    if booking_record.payment_mode <> 'offline' then
      raise exception 'manual offline finance review is only for offline Logistics bookings';
    end if;
    update public.logistics_booking_disputes
    set status = 'escalated',resolution_code = target_decision,
        resolution_note = btrim(target_resolution_note),resolved_by = actor,
        resolved_at = timezone('utc',now()),updated_at = timezone('utc',now())
    where id = dispute_record.id;
    perform public.record_logistics_booking_event(
      booking_record.id,'logistics.booking.dispute_escalated',target_idempotency_key,
      booking_record.status,booking_record.status,
      jsonb_build_object('dispute_id',dispute_record.id,'decision',target_decision,'note',btrim(target_resolution_note))
    );
    return jsonb_build_object(
      'dispute_id',dispute_record.id,'booking_id',booking_record.id,
      'status','escalated','refund_transaction_id',null
    );

  elsif target_decision = 'close_offline_finance_review' then
    if booking_record.payment_mode <> 'offline' or dispute_record.status <> 'escalated' then
      raise exception 'only an escalated offline dispute can be closed after finance review';
    end if;
    next_booking_status := dispute_record.booking_status_before_dispute;
    update public.logistics_bookings
    set status = next_booking_status,updated_at = timezone('utc',now())
    where id = booking_record.id;
  end if;

  if target_decision = 'refund_customer' then
    update public.logistics_booking_incidents
    set status = 'resolved',
        resolution_code = 'closed_by_customer_refund',
        resolution_note = 'Incident closed as part of the authorized full escrow refund after dispute review.',
        resolved_by = actor,
        resolved_at = timezone('utc',now()),
        updated_at = timezone('utc',now())
    where booking_id = booking_record.id
      and status in ('reported','investigating','recovery_required');
  elsif target_decision in ('allow_delivery_confirmation','resume_delivery')
    and dispute_record.incident_id is not null then
    update public.logistics_booking_incidents
    set status = 'resolved',
        resolution_code = 'resolved_by_dispute_' || target_decision,
        resolution_note = btrim(target_resolution_note),
        resolved_by = actor,
        resolved_at = timezone('utc',now()),
        updated_at = timezone('utc',now())
    where id = dispute_record.incident_id
      and status in ('reported','investigating','recovery_required');
  end if;

  update public.logistics_booking_disputes
  set status = 'resolved',
      resolution_code = target_decision,
      resolution_note = btrim(target_resolution_note),
      resolved_by = actor,
      resolved_at = timezone('utc',now()),
      refund_transaction_id = v_refund_transaction_id,
      updated_at = timezone('utc',now())
  where id = dispute_record.id;

  perform public.record_logistics_booking_event(
    booking_record.id,'logistics.booking.dispute_resolved',target_idempotency_key,
    'disputed',next_booking_status,
    jsonb_build_object(
      'dispute_id',dispute_record.id,
      'decision',target_decision,
      'refund_transaction_id',v_refund_transaction_id,
      'resolution_note',btrim(target_resolution_note)
    )
  );
  return jsonb_build_object(
    'dispute_id',dispute_record.id,
    'booking_id',booking_record.id,
    'status','resolved',
    'booking_status',next_booking_status,
    'refund_transaction_id',v_refund_transaction_id
  );
end;
$$;

revoke all on function public.guard_logistics_settlement_on_open_exceptions() from public,anon,authenticated;
revoke all on function public.report_logistics_booking_incident(uuid,text,text,text,text,jsonb,text) from public,anon;
revoke all on function public.respond_logistics_booking_incident(uuid,text,text,text) from public,anon;
revoke all on function public.open_logistics_booking_dispute(uuid,text,text,uuid,text) from public,anon;
revoke all on function public.resolve_logistics_booking_dispute(uuid,text,text,text) from public,anon;

grant execute on function public.report_logistics_booking_incident(uuid,text,text,text,text,jsonb,text) to authenticated,service_role;
grant execute on function public.respond_logistics_booking_incident(uuid,text,text,text) to authenticated,service_role;
grant execute on function public.open_logistics_booking_dispute(uuid,text,text,uuid,text) to authenticated,service_role;
grant execute on function public.resolve_logistics_booking_dispute(uuid,text,text,text) to authenticated,service_role;

notify pgrst,'reload schema';
commit;
