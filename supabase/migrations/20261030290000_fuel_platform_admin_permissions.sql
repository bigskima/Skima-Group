begin;

insert into public.permissions(key,description,risk_level)
values
  ('platform.fuel.read','Read SKIMA Fuel product configuration, offers, inventory, containers and qualifications.','standard'),
  ('platform.fuel.manage','Manage global Fuel product activation, container types and Fuel driver/vehicle qualifications.','high')
on conflict(key) do update
set description=excluded.description,
    risk_level=excluded.risk_level,
    updated_at=timezone('utc',now());

insert into public.role_permissions(role_id,permission_id)
select role_record.id,permission_record.id
from public.roles role_record
join public.permissions permission_record
  on permission_record.key='platform.fuel.read'
where role_record.organization_id is null
  and role_record.key in ('platform.super_admin','platform.module_admin','platform.operations_admin')
on conflict(role_id,permission_id) do nothing;

insert into public.role_permissions(role_id,permission_id)
select role_record.id,permission_record.id
from public.roles role_record
join public.permissions permission_record
  on permission_record.key='platform.fuel.manage'
where role_record.organization_id is null
  and role_record.key in ('platform.super_admin','platform.module_admin')
on conflict(role_id,permission_id) do nothing;

commit;
