begin;

revoke all on function public.can_manage_public_entity_media(text,uuid) from public, anon;
grant execute on function public.can_manage_public_entity_media(text,uuid) to authenticated, service_role;

commit;
