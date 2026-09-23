begin;
revoke all on function public.read_admin_operational_guide() from public, anon;
grant execute on function public.read_admin_operational_guide() to authenticated, service_role;
commit;
