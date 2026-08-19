begin;
revoke execute on function public.register_document_submission(uuid,text,text,text,text,bigint,text,text,text,jsonb) from anon;
revoke execute on function public.activate_approved_application(uuid) from anon;
revoke execute on function public.decide_application_review(uuid,text,text,text,jsonb) from anon;
revoke execute on function public.request_application_correction(uuid,text,text,text,jsonb) from anon;
commit;
