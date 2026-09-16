begin;

revoke all on function public.read_lpg_launch_assurance_configuration() from public, anon;
revoke all on function public.set_lpg_launch_assurance_configuration(boolean,text,text,boolean,text,text) from public, anon;
revoke all on function public.set_lpg_internal_driver_compensation(numeric,text,text) from public, anon;
revoke all on function public.set_lpg_internal_reference_price(text,text,numeric,numeric,numeric,text,text) from public, anon;

grant execute on function public.read_lpg_launch_assurance_configuration() to authenticated, service_role;
grant execute on function public.set_lpg_launch_assurance_configuration(boolean,text,text,boolean,text,text) to authenticated, service_role;
grant execute on function public.set_lpg_internal_driver_compensation(numeric,text,text) to authenticated, service_role;
grant execute on function public.set_lpg_internal_reference_price(text,text,numeric,numeric,numeric,text,text) to authenticated, service_role;

notify pgrst,'reload schema';
commit;
