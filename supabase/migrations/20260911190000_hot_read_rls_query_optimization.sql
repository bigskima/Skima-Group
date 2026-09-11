-- Phase 17: optimize measured hot authenticated read paths without changing access semantics.
-- Evidence before this migration:
--   * audit_logs denied read: ~3.38s / ~32k shared hits for 6,103 rows
--   * document_submissions denied read: ~434ms for 23 rows
--   * communication_messages denied read: ~171ms for 160 rows
--   * application_records denied read: ~73ms for 9 rows
-- Row-independent auth/permission checks are moved into initplans. The document policy
-- is expanded in-place so it no longer re-queries document_submissions once per row.

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx
ON public.audit_logs (created_at DESC);

DROP POLICY IF EXISTS audit_logs_select_privileged ON public.audit_logs;
CREATE POLICY audit_logs_select_privileged ON public.audit_logs
FOR SELECT TO authenticated
USING (
  (SELECT public.has_permission('platform.audit.read'::text, NULL::uuid))
);

DROP POLICY IF EXISTS communication_messages_select_owner_or_privileged ON public.communication_messages;
CREATE POLICY communication_messages_select_owner_or_privileged ON public.communication_messages
FOR SELECT TO authenticated
USING (
  (
    recipient_entity_type = 'user'::text
    AND recipient_entity_id = (SELECT auth.uid())
  )
  OR (SELECT public.has_permission('platform.communications.read'::text, NULL::uuid))
  OR (SELECT public.has_permission('platform.communications.manage'::text, NULL::uuid))
);

DROP POLICY IF EXISTS application_records_select_actor_or_privileged ON public.application_records;
CREATE POLICY application_records_select_actor_or_privileged ON public.application_records
FOR SELECT TO authenticated
USING (
  applicant_user_id = (SELECT auth.uid())
  OR assigned_reviewer_user_id = (SELECT auth.uid())
  OR (
    organization_id IS NOT NULL
    AND public.is_organization_member(organization_id)
  )
  OR (SELECT public.has_permission('platform.applications.read'::text, NULL::uuid))
  OR (SELECT public.can_review_applications())
);

DROP POLICY IF EXISTS document_submissions_select_actor_or_privileged ON public.document_submissions;
CREATE POLICY document_submissions_select_actor_or_privileged ON public.document_submissions
FOR SELECT TO authenticated
USING (
  owner_user_id = (SELECT auth.uid())
  OR (
    organization_id IS NOT NULL
    AND public.is_organization_member(organization_id)
  )
  OR (
    application_id IS NOT NULL
    AND public.can_read_application_record(application_id)
  )
  OR (SELECT public.has_permission('platform.documents.read'::text, NULL::uuid))
  OR (SELECT public.can_review_applications())
);
