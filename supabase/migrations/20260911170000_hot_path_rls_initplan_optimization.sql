-- Phase 14: reduce per-row auth.uid() evaluation on hot authenticated RLS paths.
-- Authorization semantics are unchanged; only auth.uid() is moved into an initplan.

DROP POLICY IF EXISTS application_records_select_actor_or_privileged ON public.application_records;
CREATE POLICY application_records_select_actor_or_privileged ON public.application_records
FOR SELECT TO authenticated
USING (
  applicant_user_id = (SELECT auth.uid())
  OR assigned_reviewer_user_id = (SELECT auth.uid())
  OR (organization_id IS NOT NULL AND is_organization_member(organization_id))
  OR has_permission('platform.applications.read'::text, NULL::uuid)
  OR can_review_applications()
);

DROP POLICY IF EXISTS application_review_tasks_select_reviewer_or_privileged ON public.application_review_tasks;
CREATE POLICY application_review_tasks_select_reviewer_or_privileged ON public.application_review_tasks
FOR SELECT TO authenticated
USING (
  assigned_reviewer_user_id = (SELECT auth.uid())
  OR can_read_application_record(application_id)
  OR can_review_applications()
);

DROP POLICY IF EXISTS platform_admins_select_self_or_privileged ON public.platform_admins;
CREATE POLICY platform_admins_select_self_or_privileged ON public.platform_admins
FOR SELECT TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR has_permission('platform.admins.read'::text, NULL::uuid)
  OR has_permission('platform.admins.manage'::text, NULL::uuid)
);

DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
CREATE POLICY profiles_insert_self ON public.profiles
FOR INSERT TO authenticated
WITH CHECK (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS profiles_select_self_or_privileged ON public.profiles;
CREATE POLICY profiles_select_self_or_privileged ON public.profiles
FOR SELECT TO authenticated
USING (
  id = (SELECT auth.uid())
  OR has_permission('platform.users.read'::text, NULL::uuid)
);

DROP POLICY IF EXISTS profiles_update_self_or_privileged ON public.profiles;
CREATE POLICY profiles_update_self_or_privileged ON public.profiles
FOR UPDATE TO authenticated
USING (
  id = (SELECT auth.uid())
  OR has_permission('platform.users.manage'::text, NULL::uuid)
)
WITH CHECK (
  id = (SELECT auth.uid())
  OR has_permission('platform.users.manage'::text, NULL::uuid)
);

DROP POLICY IF EXISTS support_threads_requester_read ON public.support_threads;
CREATE POLICY support_threads_requester_read ON public.support_threads
FOR SELECT TO authenticated
USING (requester_user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS support_thread_messages_requester_read ON public.support_thread_messages;
CREATE POLICY support_thread_messages_requester_read ON public.support_thread_messages
FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.support_threads thread
    WHERE thread.id = support_thread_messages.thread_id
      AND thread.requester_user_id = (SELECT auth.uid())
  )
);
