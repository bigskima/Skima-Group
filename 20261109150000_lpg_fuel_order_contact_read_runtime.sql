-- Adds order-scoped customer and assigned-driver contact details to LPG and Fuel reads.
-- Contact fields are only returned to the customer, an assigned driver, or an authorized operator.

create or replace function public.read_fuel_order_contact_details(target_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, auth
as $function$
declare
  order_record public.order_records%rowtype;
  delivery_snapshot jsonb := '{}'::jsonb;
  delivery_location_id uuid;
  delivery_location_record public.lpg_customer_locations%rowtype;
  customer_record public.profiles%rowtype;
  customer_phone text;
  driver_details jsonb;
  result jsonb;
  assigned_to_user boolean := false;
begin
  if auth.uid() is null then
    raise exception using errcode='42501', message='Authentication is required to read Fuel order contacts';
  end if;

  select * into order_record
  from public.order_records
  where id = target_order_id
  for share;

  if not found or not exists (
    select 1
    from public.business_modules module
    where module.id = order_record.module_id
      and module.key = 'fuel'
  ) then
    raise exception using errcode='P0002', message='Fuel order was not found';
  end if;

  select exists (
    select 1
    from public.order_assignments assignment
    left join public.driver_profiles driver
      on assignment.entity_type = 'driver'
     and driver.id = assignment.entity_id
    left join public.lpg_station_managed_drivers station_driver
      on assignment.entity_type = 'driver'
     and station_driver.id = assignment.entity_id
    where assignment.order_id = target_order_id
      and assignment.participant_role = 'driver'
      and assignment.status = 'active'
      and (
        (assignment.entity_type = 'user' and assignment.entity_id = auth.uid())
        or driver.user_id = auth.uid()
        or station_driver.user_id = auth.uid()
      )
  ) into assigned_to_user;

  if order_record.requester_user_id is distinct from auth.uid()
     and not assigned_to_user
     and not public.can_read_fuel_order(target_order_id) then
    raise exception using errcode='42501', message='You do not have permission to read contacts for this Fuel order';
  end if;

  delivery_snapshot := case
    when jsonb_typeof(order_record.order_payload->'delivery_location') = 'object'
      then order_record.order_payload->'delivery_location'
    else '{}'::jsonb
  end;

  begin
    delivery_location_id := coalesce(
      nullif(order_record.order_payload->>'delivery_location_id', '')::uuid,
      nullif(delivery_snapshot->>'id', '')::uuid
    );
  exception when invalid_text_representation then
    delivery_location_id := null;
  end;

  if delivery_location_id is not null then
    select * into delivery_location_record
    from public.lpg_customer_locations location
    where location.id = delivery_location_id
      and location.owner_user_id = order_record.requester_user_id;
  end if;

  select * into customer_record
  from public.profiles
  where id = order_record.requester_user_id;

  select nullif(account.phone, '')
  into customer_phone
  from auth.users account
  where account.id = order_record.requester_user_id;

  select jsonb_build_object(
    'id', assignment.entity_id,
    'displayName', coalesce(
      driver.driver_display_name,
      station_driver.display_name,
      driver_profile.display_name,
      'Assigned driver'
    ),
    'phone', coalesce(
      nullif(station_driver.phone, ''),
      nullif(driver_account.phone, '')
    ),
    'assignedAt', assignment.assigned_at
  )
  into driver_details
  from public.order_assignments assignment
  left join public.driver_profiles driver
    on assignment.entity_type = 'driver'
   and driver.id = assignment.entity_id
  left join public.lpg_station_managed_drivers station_driver
    on assignment.entity_type = 'driver'
   and station_driver.id = assignment.entity_id
  left join auth.users driver_account
    on driver_account.id = coalesce(driver.user_id, station_driver.user_id, case
      when assignment.entity_type = 'user' then assignment.entity_id
      else null
    end)
  left join public.profiles driver_profile
    on driver_profile.id = driver_account.id
  where assignment.order_id = target_order_id
    and assignment.participant_role = 'driver'
    and assignment.status = 'active'
    and (
      (assignment.entity_type = 'user' and assignment.entity_id = driver_account.id)
      or driver.user_id is not null
      or station_driver.user_id is not null
    )
  order by assignment.assigned_at desc nulls last
  limit 1;

  result := jsonb_build_object(
    'customer', jsonb_build_object(
      'id', customer_record.id,
      'displayName', customer_record.display_name,
      'phone', customer_phone
    ),
    'deliveryLocation', case
      when delivery_location_record.id is not null
        or delivery_snapshot <> '{}'::jsonb
      then jsonb_build_object(
        'id', coalesce(delivery_location_record.id, delivery_location_id),
        'label', coalesce(delivery_snapshot->>'label', delivery_location_record.label),
        'formattedAddress', coalesce(
          delivery_snapshot->>'formattedAddress',
          delivery_snapshot->>'formatted_address',
          delivery_location_record.formatted_address
        ),
        'landmark', coalesce(delivery_snapshot->>'landmark', delivery_location_record.landmark),
        'instructions', coalesce(
          delivery_snapshot->>'deliveryInstructions',
          delivery_snapshot->>'delivery_instructions',
          delivery_location_record.delivery_instructions
        ),
        'contactName', coalesce(
          delivery_snapshot->>'contactName',
          delivery_snapshot->>'contact_name',
          delivery_location_record.contact_name,
          customer_record.display_name
        ),
        'contactPhone', coalesce(
          nullif(delivery_snapshot->>'contactPhone', ''),
          nullif(delivery_snapshot->>'contact_phone', ''),
          nullif(delivery_location_record.contact_phone, ''),
          customer_phone
        )
      )
      else null
    end,
    'driver', driver_details
  );

  return result;
end;
$function$;

revoke all on function public.read_fuel_order_contact_details(uuid) from public;
grant execute on function public.read_fuel_order_contact_details(uuid) to authenticated;

do $function$
declare
  function_definition text;
begin
  function_definition := pg_get_functiondef('public.read_lpg_job_details(uuid)'::regprocedure);

  if position('''phone'', (select nullif(account.phone, '''') from auth.users account where account.id = customer.id)' in function_definition) = 0 then
    function_definition := replace(
      function_definition,
      '''avatarUrl'', customer.avatar_url, ''email'', (select account.email from auth.users account where account.id = customer.id)',
      '''avatarUrl'', customer.avatar_url, ''email'', (select account.email from auth.users account where account.id = customer.id), ''phone'', (select nullif(account.phone, '''') from auth.users account where account.id = customer.id)'
    );
  end if;

  if position('''phone'', (select nullif(account.phone, '''') from auth.users account where account.id = driver_user.id)' in function_definition) = 0 then
    function_definition := replace(
      function_definition,
      '''avatarUrl'', driver_user.avatar_url,',
      '''avatarUrl'', driver_user.avatar_url, ''phone'', (select nullif(account.phone, '''') from auth.users account where account.id = driver_user.id),'
    );
  end if;

  if position('''phone'', station_driver.phone' in function_definition) = 0 then
    function_definition := replace(
      function_definition,
      '''displayName'', station_driver.display_name,',
      '''displayName'', station_driver.display_name, ''phone'', nullif(station_driver.phone, ''''),'
    );
  end if;

  if position('''phone'', (select nullif(account.phone' in function_definition) = 0
     or position('''phone'', station_driver.phone' in function_definition) = 0 then
    raise exception 'Could not extend LPG order contacts: one or more read-model insertion points were not found';
  end if;

  execute function_definition;
end;
$function$;
