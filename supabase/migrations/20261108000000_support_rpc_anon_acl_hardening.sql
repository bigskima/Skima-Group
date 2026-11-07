-- Remove direct anonymous RPC execution from authenticated support operations.
-- Public social profile reads remain available through read_active_social_accounts.

revoke all on function public.can_access_support_app(text,text) from anon;
revoke all on function public.create_support_app_thread(text,text,text,text,text,text,text,text,jsonb) from anon;
revoke all on function public.reply_to_my_support_app_thread(uuid,text,text,text,text,jsonb) from anon;
revoke all on function public.read_support_app_queue(text,text,integer) from anon;
revoke all on function public.respond_to_support_app_thread(uuid,text,text,boolean,text,jsonb) from anon;
revoke all on function public.upsert_support_app(text,text,boolean) from anon;
revoke all on function public.upsert_social_platform(text,text,text,text) from anon;
revoke all on function public.upsert_social_profile(uuid,text,text,text,text,text[],integer,boolean) from anon;

-- These are trigger-only SECURITY DEFINER functions and must not be callable as RPCs.
revoke all on function public.populate_support_thread_sla() from public,anon,authenticated;
revoke all on function public.track_support_first_response() from public,anon,authenticated;
revoke all on function public.queue_support_thread_reply_notification() from public,anon,authenticated;
