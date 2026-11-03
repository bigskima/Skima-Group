begin;

select public.configure_platform_admin_role(
  'platform.super_admin',
  'Platform Super Admin',
  'Protected recovery owner with full platform authority, including SKIMA Store and all Fuel products and operations.',
  array(select permission_record.key from public.permissions permission_record order by permission_record.key),
  '{"protected":true,"admin_area":"owner","system_role":true,"template_managed":true}'::jsonb,
  'active'
);

select public.configure_platform_admin_role(
  'platform.store_admin',
  'Store Admin',
  'Manages SKIMA Store settings, products, catalogue visibility, stock availability and Store order operations.',
  array[
    'platform.catalog.read',
    'platform.modules.read',
    'platform.organizations.read',
    'platform.store.manage',
    'platform.store.read'
  ],
  '{"category":"store","admin_area":"store","module_keys":["store"],"scope":"platform_store"}'::jsonb,
  'active'
);

select public.configure_platform_admin_role(
  'platform.fuel_admin',
  'Fuel Admin',
  'Manages petrol, diesel and kerosene product controls, branch fuel offers, storage, containers and Fuel driver qualifications.',
  array[
    'platform.fuel.manage',
    'platform.fuel.read',
    'platform.organizations.read'
  ],
  '{"category":"fuel","admin_area":"fuel","module_keys":["fuel"],"scope":"platform_fuel"}'::jsonb,
  'active'
);

commit;