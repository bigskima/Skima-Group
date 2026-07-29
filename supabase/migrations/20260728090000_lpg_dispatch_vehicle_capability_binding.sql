begin;

update public.dispatch_policies
set rules = rules || jsonb_build_object(
      'driver_required_capabilities',
      jsonb_build_array('capability.driver.cylinder-handling'),
      'vehicle_required_capabilities',
      jsonb_build_array('capability.cargo.pressurized-cylinder'),
      'vehicle_authorization_required',
      true
    ),
    updated_at = timezone('utc', now())
where key = 'dispatch.lpg.nearest-qualified-driver.v1';

commit;
