begin;

-- Trigger/helper functions are internal implementation details. PostgreSQL triggers
-- execute them as their owner; application roles do not need direct EXECUTE.
revoke all on function public.sync_lpg_cylinder_tag_status_metadata() from public, anon, authenticated;
revoke all on function public.verify_lpg_scan_cylinder_identity() from public, anon, authenticated;
revoke all on function public.hash_lpg_cylinder_tag_credential(text) from public, anon, authenticated;

grant execute on function public.sync_lpg_cylinder_tag_status_metadata() to service_role;
grant execute on function public.verify_lpg_scan_cylinder_identity() to service_role;
grant execute on function public.hash_lpg_cylinder_tag_credential(text) to service_role;

-- Management RPCs remain callable by authenticated clients because the functions
-- themselves enforce lpg.cylinders.manage. Anonymous callers must never reach them.
revoke all on function public.issue_lpg_cylinder_tag(text, uuid, jsonb) from public, anon;
revoke all on function public.assign_lpg_cylinder_tag_to_driver(text, uuid, text, jsonb) from public, anon;
revoke all on function public.revoke_lpg_cylinder_tag(text, text, text, jsonb) from public, anon;

grant execute on function public.issue_lpg_cylinder_tag(text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.assign_lpg_cylinder_tag_to_driver(text, uuid, text, jsonb) to authenticated, service_role;
grant execute on function public.revoke_lpg_cylinder_tag(text, text, text, jsonb) to authenticated, service_role;

-- Operational RPCs are used by authenticated cylinder owners / assigned drivers /
-- administrators and perform their own relationship/permission checks internally.
revoke all on function public.bind_lpg_cylinder_tag(text, uuid, text, uuid, jsonb) from public, anon;
revoke all on function public.report_lpg_cylinder_tag_condition(text, text, text, text, uuid, jsonb) from public, anon;
revoke all on function public.replace_lpg_cylinder_tag(text, text, uuid, text, uuid, text, jsonb) from public, anon;

grant execute on function public.bind_lpg_cylinder_tag(text, uuid, text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.report_lpg_cylinder_tag_condition(text, text, text, text, uuid, jsonb) to authenticated, service_role;
grant execute on function public.replace_lpg_cylinder_tag(text, text, uuid, text, uuid, text, jsonb) to authenticated, service_role;

commit;
