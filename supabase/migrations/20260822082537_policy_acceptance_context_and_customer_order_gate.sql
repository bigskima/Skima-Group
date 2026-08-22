create or replace function public.link_current_policy_acceptance_to_application(
  target_policy_key text,
  target_application_id uuid,
  target_role_key text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  app public.application_records%rowtype;
  doc public.policy_documents%rowtype;
  current_version public.policy_versions%rowtype;
  source_acceptance public.policy_acceptances%rowtype;
  linked_acceptance_id uuid;
begin
  if target_application_id is null then
    return false;
  end if;

  select * into app
  from public.application_records
  where id = target_application_id;

  if not found then
    return false;
  end if;

  if auth.role() <> 'service_role'
    and (auth.uid() is null or (app.applicant_user_id <> auth.uid() and not public.can_manage_applications())) then
    raise exception using errcode='42501', message='application access denied';
  end if;

  select * into doc
  from public.policy_documents
  where key = target_policy_key
    and status = 'active'
    and is_required;

  if not found then
    return true;
  end if;

  select * into current_version
  from public.policy_versions
  where policy_document_id = doc.id
    and status = 'published'
    and (effective_from is null or effective_from <= timezone('utc', now()))
    and (effective_until is null or effective_until > timezone('utc', now()))
  order by effective_from desc nulls last, published_at desc nulls last
  limit 1;

  if not found then
    return true;
  end if;

  if exists(
    select 1
    from public.policy_acceptances a
    where a.user_id = app.applicant_user_id
      and a.policy_version_id = current_version.id
      and a.application_id = target_application_id
  ) then
    return true;
  end if;

  select * into source_acceptance
  from public.policy_acceptances a
  where a.user_id = app.applicant_user_id
    and a.policy_version_id = current_version.id
    and a.application_id is null
  order by a.accepted_at desc
  limit 1;

  if not found then
    return false;
  end if;

  insert into public.policy_acceptances(
    policy_document_id,
    policy_version_id,
    user_id,
    application_id,
    audience,
    role_key,
    acceptance_statement,
    source,
    idempotency_key,
    metadata
  ) values (
    doc.id,
    current_version.id,
    app.applicant_user_id,
    target_application_id,
    doc.audience,
    coalesce(nullif(btrim(target_role_key), ''), source_acceptance.role_key),
    source_acceptance.acceptance_statement,
    'skima.application.submission',
    'policy-link:' || target_application_id::text || ':' || current_version.id::text,
    coalesce(source_acceptance.metadata, '{}'::jsonb) || jsonb_build_object(
      'linkedFromAcceptanceId', source_acceptance.id,
      'linkedAtSubmission', true
    )
  )
  on conflict (user_id, policy_version_id, coalesce(application_id, '00000000-0000-0000-0000-000000000000'::uuid))
  do nothing
  returning id into linked_acceptance_id;

  if linked_acceptance_id is not null then
    insert into public.policy_events(
      policy_document_id,
      policy_version_id,
      acceptance_id,
      event_type,
      actor_user_id,
      source,
      idempotency_key,
      metadata
    ) values (
      doc.id,
      current_version.id,
      linked_acceptance_id,
      'policy.acceptance_linked',
      app.applicant_user_id,
      'skima.policy.runtime',
      'policy-link-event:' || linked_acceptance_id::text,
      jsonb_build_object(
        'applicationId', target_application_id,
        'sourceAcceptanceId', source_acceptance.id,
        'roleKey', target_role_key
      )
    )
    on conflict (source, idempotency_key) do nothing;
  end if;

  return exists(
    select 1
    from public.policy_acceptances a
    where a.user_id = app.applicant_user_id
      and a.policy_version_id = current_version.id
      and a.application_id = target_application_id
  );
end;
$$;

revoke all on function public.link_current_policy_acceptance_to_application(text,uuid,text) from public, anon, authenticated;
grant execute on function public.link_current_policy_acceptance_to_application(text,uuid,text) to service_role;

create or replace function public.submit_application(
  target_application_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  application_record record;
  application_type_record record;
  application_payload jsonb;
  missing_required_count integer;
  missing_required_field_count integer;
  missing_required_field_labels text;
  submit_event_key text;
begin
  if auth.role() <> 'service_role' and auth.uid() is null then
    raise exception 'authenticated user context is required';
  end if;

  if target_application_id is null then
    raise exception 'target_application_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  if target_metadata is null or jsonb_typeof(target_metadata) <> 'object' then
    raise exception 'target_metadata must be a JSON object';
  end if;

  select application_record_table.* into application_record
  from public.application_records application_record_table
  where application_record_table.id = target_application_id
  for update;

  if not found then
    raise exception 'target_application_id must reference an existing application';
  end if;

  if auth.role() <> 'service_role'
    and application_record.applicant_user_id <> auth.uid()
    and not public.can_manage_applications() then
    raise exception 'only the applicant can submit this application';
  end if;

  if application_record.status not in ('draft', 'incomplete', 'additional_info_required') then
    raise exception 'application cannot be submitted in the current state';
  end if;

  select application_type.* into application_type_record
  from public.application_type_definitions application_type
  where application_type.id = application_record.application_type_id;

  if auth.role() <> 'service_role'
    and application_type_record.application_category in ('driver', 'business')
    and not public.has_accepted_current_policy('policy.partner.participation', target_application_id)
    and not public.link_current_policy_acceptance_to_application(
      'policy.partner.participation',
      target_application_id,
      application_type_record.key
    ) then
    raise exception using
      errcode = '55000',
      message = 'review and accept the current SKIMA Partner Participation Terms before submitting this application';
  end if;

  select coalesce(application_version.payload, '{}'::jsonb) into application_payload
  from public.application_versions application_version
  where application_version.application_id = target_application_id
    and application_version.version = application_record.active_version;

  application_payload := coalesce(application_payload, '{}'::jsonb);

  select count(*), string_agg(
    coalesce(field_definition ->> 'label', field_definition ->> 'path'),
    ', ' order by field_definition ->> 'path'
  )
  into missing_required_field_count, missing_required_field_labels
  from jsonb_array_elements(
    case
      when jsonb_typeof(application_type_record.metadata -> 'submission_required_fields') = 'array'
        then application_type_record.metadata -> 'submission_required_fields'
      else '[]'::jsonb
    end
  ) field_definition
  where nullif(
    btrim(coalesce(application_payload #>> string_to_array(field_definition ->> 'path', '.'), '')),
    ''
  ) is null;

  if missing_required_field_count > 0 then
    raise exception 'required application fields are missing: %', missing_required_field_labels;
  end if;

  select count(*) into missing_required_count
  from public.document_requirements requirement
  where requirement.requirement_set_id = application_type_record.document_requirement_set_id
    and requirement.status = 'active'
    and requirement.is_required
    and public.application_requirement_applies(requirement.metadata, application_payload)
    and (
      select count(*)
      from public.document_submissions document_submission
      where document_submission.application_id = target_application_id
        and document_submission.requirement_id = requirement.id
        and document_submission.status in ('uploaded', 'submitted', 'under_review', 'approved')
    ) < requirement.min_count;

  if missing_required_count > 0 then
    raise exception 'required documents are missing';
  end if;

  update public.application_versions
  set status = 'submitted',
      locked_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where application_id = target_application_id
    and version = application_record.active_version;

  update public.document_submissions
  set status = case when status = 'uploaded' then 'submitted' else status end,
      submitted_at = coalesce(submitted_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where application_id = target_application_id;

  submit_event_key := case
    when application_record.status = 'additional_info_required' then 'event.application.resubmitted'
    else 'event.application.submitted'
  end;

  perform public.advance_application_record_state(
    target_application_id,
    submit_event_key,
    target_metadata,
    target_idempotency_key
  );

  update public.application_records
  set locked_at = timezone('utc', now()),
      submitted_at = coalesce(submitted_at, timezone('utc', now())),
      updated_at = timezone('utc', now())
  where id = target_application_id;

  insert into public.application_review_tasks(application_id,status,idempotency_key,metadata)
  values(target_application_id,'open',target_idempotency_key || ':review-task',target_metadata)
  on conflict do nothing;

  return target_application_id;
end;
$$;

create or replace function public.create_lpg_refill_order(
  target_lpg_refill_quote_id uuid,
  target_idempotency_key text,
  target_metadata jsonb default '{}'::jsonb,
  target_source text default 'lpg.order_api'::text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  quote_record record;
  order_id uuid;
  existing_record record;
begin
  if auth.uid() is null then
    raise exception 'authenticated user is required';
  end if;

  if target_lpg_refill_quote_id is null then
    raise exception 'target_lpg_refill_quote_id is required';
  end if;

  if target_idempotency_key is null or btrim(target_idempotency_key) = '' then
    raise exception 'target_idempotency_key is required';
  end if;

  select quote.*
  into quote_record
  from public.lpg_refill_quotes quote
  join public.lpg_cylinders cylinder on cylinder.id = quote.cylinder_id
  where quote.id = target_lpg_refill_quote_id
    and cylinder.owner_user_id = auth.uid()
  for update;

  if not found then
    raise exception 'target_lpg_refill_quote_id must reference one of your quotes';
  end if;

  if not public.has_accepted_current_policy('policy.customer.terms', null) then
    raise exception using
      errcode = '55000',
      message = 'review and accept the current SKIMA Customer Terms of Service before confirming this order';
  end if;

  if quote_record.status <> 'quoted' then
    if quote_record.status = 'accepted' then
      select existing.*
      into existing_record
      from public.lpg_refill_orders existing
      where existing.lpg_refill_quote_id = quote_record.id;

      if found then
        return existing_record.id;
      end if;
    end if;

    raise exception 'LPG quote cannot be ordered from its current status';
  end if;

  if quote_record.expires_at <= timezone('utc', now()) then
    update public.lpg_refill_quotes
    set status = 'expired',
        updated_at = timezone('utc', now())
    where id = quote_record.id;

    update public.price_quotes
    set status = 'expired',
        updated_at = timezone('utc', now())
    where id = quote_record.price_quote_id;

    raise exception 'LPG quote has expired';
  end if;

  update public.lpg_refill_quotes
  set status = 'accepted',
      updated_at = timezone('utc', now())
  where id = quote_record.id;

  update public.price_quotes
  set status = 'accepted',
      accepted_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
  where id = quote_record.price_quote_id;

  insert into public.lpg_refill_orders (
    lpg_refill_quote_id,
    service_request_id,
    price_quote_id,
    customer_user_id,
    cylinder_id,
    pickup_location_id,
    delivery_location_id,
    station_branch_id,
    currency_code,
    requested_kg,
    total_amount,
    station_amount,
    delivery_fee_amount,
    platform_fee_amount,
    driver_commission_amount,
    metadata,
    source,
    idempotency_key
  )
  values (
    quote_record.id,
    quote_record.service_request_id,
    quote_record.price_quote_id,
    auth.uid(),
    quote_record.cylinder_id,
    quote_record.pickup_location_id,
    quote_record.delivery_location_id,
    quote_record.station_branch_id,
    quote_record.currency_code,
    quote_record.requested_kg,
    quote_record.total_amount,
    quote_record.lpg_amount,
    quote_record.delivery_fee_amount,
    quote_record.platform_fee_amount,
    quote_record.driver_commission_amount,
    target_metadata,
    target_source,
    target_idempotency_key
  )
  on conflict (source, idempotency_key) do nothing
  returning id into order_id;

  if order_id is null then
    select existing.*
    into existing_record
    from public.lpg_refill_orders existing
    where existing.source = target_source
      and existing.idempotency_key = target_idempotency_key;

    return existing_record.id;
  end if;

  update public.service_requests
  set status = 'priced',
      metadata = metadata || jsonb_build_object('lpg_order_id', order_id),
      updated_at = timezone('utc', now())
  where id = quote_record.service_request_id;

  perform public.record_lpg_order_event(
    order_id,
    'lpg.order.created',
    null,
    'awaiting_payment',
    target_idempotency_key || ':created',
    jsonb_build_object('price_quote_id', quote_record.price_quote_id)
  );

  return order_id;
end;
$$;
