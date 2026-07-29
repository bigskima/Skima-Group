import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.9";

import { resolveSupabaseRuntime } from "./supabase-runtime.ts";

interface GateUser {
  readonly id: string;
  readonly email: string;
  readonly password: string;
  readonly accessToken: string;
  readonly client: SupabaseClient;
}

interface AdminSession {
  readonly accessToken: string;
  readonly client: SupabaseClient;
  readonly userId: string;
}

const runtime = await resolveSupabaseRuntime({ anonKey: true, serviceRoleKey: true });
const supabaseUrl = runtime.supabaseUrl;
const anonKey = runtime.anonKey!;
const serviceRoleKey = runtime.serviceRoleKey!;
const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

const adminAccessToken = Deno.env.get("SKIMA_ADMIN_ACCESS_TOKEN");
const adminEmail = Deno.env.get("SKIMA_SUPER_ADMIN_EMAIL") ?? Deno.env.get("SKIMA_ADMIN_EMAIL");
const adminPassword = Deno.env.get("SKIMA_SUPER_ADMIN_PASSWORD") ??
  Deno.env.get("SKIMA_ADMIN_PASSWORD");
const runId = crypto.randomUUID();
const source = "platform.application_document_gate";

console.log(`Running application and document lifecycle gate ${runId}...`);

const adminSession = await resolveAdminSession();
const applicant = await createGateUser("business-applicant");

const applicationPayload = {
  contact: {
    email: applicant.email,
    phone: "+2348000000000",
  },
  organization: {
    displayName: `Application Gate Business ${runId.slice(0, 8)}`,
    legalName: `Application Gate Business ${runId.slice(0, 8)} Ltd`,
    partnerTypeKey: "partner.fulfillment.configured",
    slug: `app-gate-${runId.slice(0, 8)}`,
  },
  ownership: {
    ownerUserId: applicant.id,
  },
};

const applicationId = await postGatewayId(applicant.accessToken, "/runtime/applications", {
  applicationTypeKey: "application.business.default",
  idempotencyKey: idempotency("create-application"),
  metadata: { gate: "application_document_lifecycle", runId },
  payload: applicationPayload,
  source,
});

await requireDirectApplicationInsertRejected(applicant.client);
await requireGatewayError(applicant.accessToken, "/runtime/applications/submit", {
  applicationId,
  idempotencyKey: idempotency("submit-missing-documents"),
  metadata: { gate: "application_document_lifecycle", runId },
}, "required documents are missing");

const documentSubmissionIds = [];

for (
  const requirementKey of [
    "business.registration",
    "business.owner-identity",
    "business.proof-of-address",
    "business.settlement-details",
  ]
) {
  documentSubmissionIds.push(
    await postGatewayId(applicant.accessToken, "/runtime/documents", {
      applicationId,
      byteSize: 2048,
      checksum: `${runId}:${requirementKey}`,
      contentType: "application/pdf",
      idempotencyKey: idempotency(`document-${requirementKey}`),
      metadata: { gate: "application_document_lifecycle", requirementKey, runId },
      requirementKey,
      source,
      storageBucket: "skima-platform-documents",
      storagePath: `${applicant.id}/${runId}/${requirementKey}.pdf`,
    }),
  );
}

await postGatewayId(applicant.accessToken, "/runtime/applications/submit", {
  applicationId,
  idempotencyKey: idempotency("submit-application"),
  metadata: { gate: "application_document_lifecycle", runId },
});
await requireApplicationStatus(applicationId, "submitted");

await postGatewayId(adminSession.accessToken, "/runtime/applications/reviewer", {
  applicationId,
  idempotencyKey: idempotency("assign-reviewer"),
  metadata: { gate: "application_document_lifecycle", runId },
  reviewerUserId: adminSession.userId,
});
await requireApplicationStatus(applicationId, "under_review");

await postGatewayId(adminSession.accessToken, "/runtime/applications/corrections", {
  applicantMessage: "Please confirm the settlement authorization details.",
  applicationId,
  idempotencyKey: idempotency("request-correction"),
  internalNotes: "Gate correction request validates resubmission path.",
  metadata: { gate: "application_document_lifecycle", runId },
});
await requireApplicationStatus(applicationId, "additional_info_required");

await postGatewayId(applicant.accessToken, "/runtime/applications/payload", {
  applicationId,
  idempotencyKey: idempotency("update-correction"),
  metadata: { gate: "application_document_lifecycle", runId },
  payload: {
    ...applicationPayload,
    correctionResponse: {
      confirmedSettlementAuthorization: true,
      respondedAt: new Date().toISOString(),
    },
  },
});

await postGatewayId(applicant.accessToken, "/runtime/applications/submit", {
  applicationId,
  idempotencyKey: idempotency("resubmit-application"),
  metadata: { gate: "application_document_lifecycle", runId },
});
await requireApplicationStatus(applicationId, "resubmitted");

await postGatewayId(adminSession.accessToken, "/runtime/applications/reviewer", {
  applicationId,
  idempotencyKey: idempotency("assign-reviewer-resubmitted"),
  metadata: { gate: "application_document_lifecycle", runId },
  reviewerUserId: adminSession.userId,
});
await requireApplicationStatus(applicationId, "under_review");

for (const documentSubmissionId of documentSubmissionIds) {
  await postGatewayId(adminSession.accessToken, "/runtime/documents/review", {
    applicantMessage: "Document accepted.",
    decision: "approved",
    documentSubmissionId,
    idempotencyKey: idempotency(`approve-document-${documentSubmissionId}`),
    internalNotes: "Gate document approval.",
    metadata: { gate: "application_document_lifecycle", runId },
  });
}

await postGatewayId(adminSession.accessToken, "/runtime/applications/decisions", {
  applicationId,
  decision: "approved",
  idempotencyKey: idempotency("approve-application"),
  metadata: { gate: "application_document_lifecycle", runId },
  reason: "All configured requirements were satisfied.",
});

const activated = await requireApplicationActivated(applicationId);
await requireBusinessOwnerAccess(applicant.client, activated.organizationId);
await requireApplicationEvents(applicationId);
await requireDocumentReviewEvidence(documentSubmissionIds);
await requireAuditEvidence(applicationId, activated.organizationId, activated.partnerId);
await requireAppendOnlyEventProtection(applicationId);

console.log("Application and document lifecycle gate completed.");
console.log(`application_id=${applicationId}`);
console.log(`organization_id=${activated.organizationId}`);
console.log(`partner_id=${activated.partnerId}`);

async function createGateUser(kind: string): Promise<GateUser> {
  const email = `skima-${kind}-${runId}@example.invalid`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: {
      gate: "application_document_lifecycle",
      kind,
      runId,
    },
  });

  if (error) {
    throw error;
  }

  if (!data.user?.id) {
    throw new Error(`Supabase Auth did not create ${kind} user.`);
  }

  await requireMutation(
    serviceClient.from("profiles").upsert({
      display_name: `Application Gate ${kind}`,
      id: data.user.id,
      metadata: { gate: "application_document_lifecycle", runId },
      status: "active",
    }),
    `upsert ${kind} profile`,
  );

  const client = createBrowserSafeClient();
  const { data: signInData, error: signInError } = await client.auth.signInWithPassword({
    email,
    password,
  });

  if (signInError) {
    throw signInError;
  }

  if (!signInData.session?.access_token) {
    throw new Error(`Supabase Auth did not return an access token for ${kind}.`);
  }

  return {
    accessToken: signInData.session.access_token,
    client: createAuthenticatedClient(signInData.session.access_token),
    email,
    id: data.user.id,
    password,
  };
}

async function requireDirectApplicationInsertRejected(client: SupabaseClient): Promise<void> {
  const applicationType = await requireSingle(
    serviceClient
      .from("application_type_definitions")
      .select("id")
      .eq("key", "application.business.default")
      .single(),
    "read application type",
  );

  const { error } = await client.from("application_records").insert({
    applicant_user_id: applicant.id,
    application_type_id: applicationType.id,
    idempotency_key: idempotency("direct-insert-should-fail"),
    metadata: { gate: "application_document_lifecycle", runId },
    source,
    status: "draft",
  });

  requireCondition(Boolean(error), "authenticated direct application insert was allowed.");
}

async function requireApplicationStatus(applicationId: string, status: string): Promise<void> {
  const applicationRecord = await requireSingle(
    serviceClient
      .from("application_records")
      .select("status")
      .eq("id", applicationId)
      .single(),
    "read application status",
  );

  requireCondition(
    applicationRecord.status === status,
    `application expected status ${status}, found ${applicationRecord.status}.`,
  );
}

async function requireApplicationActivated(
  applicationId: string,
): Promise<{ readonly organizationId: string; readonly partnerId: string }> {
  const applicationRecord = await requireSingle(
    serviceClient
      .from("application_records")
      .select("status,organization_id,activated_subject_type,activated_subject_id")
      .eq("id", applicationId)
      .single(),
    "read approved application",
  );

  requireCondition(
    applicationRecord.status === "approved",
    `application expected approved, found ${applicationRecord.status}.`,
  );
  requireCondition(
    applicationRecord.activated_subject_type === "partner",
    `application expected partner activation, found ${applicationRecord.activated_subject_type}.`,
  );
  requireCondition(
    typeof applicationRecord.organization_id === "string",
    "application approval did not activate an organization.",
  );
  requireCondition(
    typeof applicationRecord.activated_subject_id === "string",
    "application approval did not activate a partner profile.",
  );

  const organizationId = requireStringValue(
    applicationRecord.organization_id,
    "activated organization id",
  );
  const partnerId = requireStringValue(applicationRecord.activated_subject_id, "partner id");

  const organizationRecord = await requireSingle(
    serviceClient
      .from("organizations")
      .select("id,status")
      .eq("id", organizationId)
      .eq("status", "active")
      .single(),
    "read activated organization",
  );

  const partnerRecord = await requireSingle(
    serviceClient
      .from("partner_profiles")
      .select("id,status,organization_id")
      .eq("id", partnerId)
      .eq("status", "active")
      .single(),
    "read activated partner profile",
  );

  requireCondition(
    partnerRecord.organization_id === organizationRecord.id,
    "partner profile is not linked to the activated organization.",
  );

  return {
    organizationId,
    partnerId,
  };
}

async function requireBusinessOwnerAccess(
  client: SupabaseClient,
  organizationId: string,
): Promise<void> {
  const membership = await requireSingle(
    client
      .from("organization_memberships")
      .select("organization_id,user_id,membership_type,status")
      .eq("organization_id", organizationId)
      .eq("user_id", applicant.id)
      .single(),
    "read applicant organization membership",
  );

  requireCondition(
    membership.membership_type === "owner" && membership.status === "active",
    "applicant was not activated as active organization owner.",
  );

  const { data: roles, error } = await client
    .from("user_roles")
    .select("id,status")
    .eq("organization_id", organizationId)
    .eq("user_id", applicant.id)
    .eq("status", "active")
    .limit(1);

  if (error) {
    throw error;
  }

  requireCondition((roles ?? []).length === 1, "business owner role was not assigned.");
}

async function requireApplicationEvents(applicationId: string): Promise<void> {
  const { data, error } = await serviceClient
    .from("application_events")
    .select("event_type_key,to_status")
    .eq("application_id", applicationId);

  if (error) {
    throw error;
  }

  const eventKeys = new Set((data ?? []).map((event) => event.event_type_key));

  for (
    const eventKey of [
      "event.application.created",
      "event.application.document.registered",
      "event.application.submitted",
      "event.application.review.started",
      "event.application.correction.requested",
      "event.application.resubmitted",
      "event.application.approved",
    ]
  ) {
    requireCondition(eventKeys.has(eventKey), `application event is missing: ${eventKey}.`);
  }
}

async function requireDocumentReviewEvidence(
  documentSubmissionIds: readonly string[],
): Promise<void> {
  const { data, error } = await serviceClient
    .from("document_review_events")
    .select("document_submission_id,decision")
    .in("document_submission_id", documentSubmissionIds);

  if (error) {
    throw error;
  }

  const approvedDocumentIds = new Set(
    (data ?? [])
      .filter((event) => event.decision === "approved")
      .map((event) => event.document_submission_id),
  );

  for (const documentSubmissionId of documentSubmissionIds) {
    requireCondition(
      approvedDocumentIds.has(documentSubmissionId),
      `approved review evidence is missing for document ${documentSubmissionId}.`,
    );
  }
}

async function requireAuditEvidence(
  applicationId: string,
  organizationId: string,
  partnerId: string,
): Promise<void> {
  await requireAuditRecord("application_records", applicationId);
  await requireAuditRecord("organizations", organizationId);
  await requireAuditRecord("partner_profiles", partnerId);

  const { data, error } = await serviceClient
    .from("audit_logs")
    .select("id")
    .eq("entity_type", "document_submissions")
    .contains("after_state", { application_id: applicationId })
    .limit(1);

  if (error) {
    throw error;
  }

  requireCondition((data ?? []).length > 0, "document submission audit evidence is missing.");
}

async function requireAuditRecord(entityType: string, entityId: string): Promise<void> {
  const { data, error } = await serviceClient
    .from("audit_logs")
    .select("id")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .limit(1);

  if (error) {
    throw error;
  }

  requireCondition((data ?? []).length > 0, `${entityType} audit evidence is missing.`);
}

async function requireAppendOnlyEventProtection(applicationId: string): Promise<void> {
  const eventRecord = await requireSingle(
    serviceClient
      .from("application_events")
      .select("id,metadata")
      .eq("application_id", applicationId)
      .limit(1)
      .single(),
    "read application event for append-only check",
  );

  const updateResult = await serviceClient
    .from("application_events")
    .update({ metadata: { should_not_update: true } })
    .eq("id", eventRecord.id);

  requireCondition(Boolean(updateResult.error), "application event direct update was allowed.");

  const deleteResult = await serviceClient.from("application_events").delete().eq(
    "id",
    eventRecord.id,
  );

  requireCondition(Boolean(deleteResult.error), "application event direct delete was allowed.");
}

async function postGatewayId(
  accessToken: string,
  path: string,
  payload: Record<string, unknown>,
): Promise<string> {
  const body = await postGateway(accessToken, path, payload);
  const id = body.id;

  if (typeof id !== "string" || id.length === 0) {
    throw new Error(`${path} did not return an id.`);
  }

  return id;
}

async function requireGatewayError(
  accessToken: string,
  path: string,
  payload: Record<string, unknown>,
  expectedMessage: string,
): Promise<void> {
  const response = await fetch(`${supabaseUrl}/functions/v1/api-gateway${path}`, {
    body: JSON.stringify(payload),
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const body = await readGatewayJson(response);

  requireCondition(!response.ok, `${path} unexpectedly succeeded.`);
  requireCondition(
    String(body.message ?? "").includes(expectedMessage),
    `${path} returned unexpected error: ${String(body.message ?? body.error)}`,
  );
}

async function postGateway(
  accessToken: string,
  path: string,
  payload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(`${supabaseUrl}/functions/v1/api-gateway${path}`, {
    body: JSON.stringify(payload),
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const body = await readGatewayJson(response);

  if (!response.ok) {
    throw new Error(
      `${path} returned HTTP ${response.status}: ${String(body.message ?? body.error)}`,
    );
  }

  if (body.ok !== true) {
    throw new Error(`${path} did not return ok=true.`);
  }

  return body;
}

async function readGatewayJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json();

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Gateway response was not a JSON object.");
  }

  return value as Record<string, unknown>;
}

async function resolveAdminSession(): Promise<AdminSession> {
  if (adminAccessToken) {
    const client = createAuthenticatedClient(adminAccessToken);
    const userId = await requireCurrentUserId(client, "platform admin");

    return { accessToken: adminAccessToken, client, userId };
  }

  if (!adminEmail || !adminPassword) {
    throw new Error(
      "Set SKIMA_ADMIN_ACCESS_TOKEN or SKIMA_SUPER_ADMIN_EMAIL and SKIMA_SUPER_ADMIN_PASSWORD in the deployment shell.",
    );
  }

  const signInClient = createBrowserSafeClient();
  const { data, error } = await signInClient.auth.signInWithPassword({
    email: adminEmail,
    password: adminPassword,
  });

  if (error) {
    throw new Error(`Unable to sign in as the platform admin: ${error.message}`);
  }

  if (!data.session?.access_token) {
    throw new Error("Supabase Auth did not return an admin access token.");
  }

  const client = createAuthenticatedClient(data.session.access_token);
  const userId = await requireCurrentUserId(client, "platform admin");

  return { accessToken: data.session.access_token, client, userId };
}

async function requireCurrentUserId(client: SupabaseClient, label: string): Promise<string> {
  const { data, error } = await client.auth.getUser();

  if (error) {
    throw error;
  }

  if (!data.user?.id) {
    throw new Error(`${label} did not resolve to a Supabase Auth user.`);
  }

  return data.user.id;
}

function createBrowserSafeClient(): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

function createAuthenticatedClient(accessToken: string): SupabaseClient {
  return createClient(supabaseUrl, anonKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

async function requireSingle<T extends Record<string, unknown>>(
  resultPromise: PromiseLike<{ data: T | null; error: { message: string } | null }>,
  operationName: string,
): Promise<T> {
  const { data, error } = await resultPromise;

  if (error) {
    throw new Error(`${operationName} failed: ${error.message}`);
  }

  if (!data) {
    throw new Error(`${operationName} returned no record.`);
  }

  return data;
}

async function requireMutation(
  resultPromise: PromiseLike<{ error: { message: string } | null }>,
  operationName: string,
): Promise<void> {
  const { error } = await resultPromise;

  if (error) {
    throw new Error(`${operationName} failed: ${error.message}`);
  }
}

function idempotency(step: string): string {
  return `${source}:${runId}:${step}`;
}

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function requireStringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}
