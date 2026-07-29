import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.9";

import { resolveSupabaseRuntime } from "./supabase-runtime.ts";

interface GateUser {
  readonly id: string;
  readonly email: string;
  readonly accessToken: string;
  readonly client: SupabaseClient;
}

interface AdminSession {
  readonly accessToken: string;
  readonly client: SupabaseClient;
  readonly userId: string;
}

interface ApprovedBusiness {
  readonly applicationId: string;
  readonly organizationId: string;
  readonly partnerId: string;
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
const runKey = runId.replaceAll("-", "").slice(0, 12);
const source = "platform.organization_staff_gate";
const branchKey = `branch.staff.${runKey}`;
const secondBranchKey = `branch.staff.secondary.${runKey}`;
const roleKey = `business.catalog.manager.${runKey}`;

console.log(`Running organization staff lifecycle gate ${runId}...`);

const adminSession = await resolveAdminSession();
const owner = await createGateUser("staff-owner");
const staff = await createGateUser("staff-member");
const outsider = await createGateUser("staff-outsider");
const approvedBusiness = await createApprovedBusiness(owner, adminSession);

const branchId = await postGatewayId(owner.accessToken, "/runtime/organization-branches", {
  address: {
    city: "Awka",
    country: "NG",
    line1: "Configured branch address",
  },
  branchKey,
  displayName: `Staff Gate Branch ${runKey}`,
  geoLocation: {
    latitude: 6.2104,
    longitude: 7.0741,
  },
  idempotencyKey: idempotency("create-branch"),
  metadata: { gate: "organization_staff_lifecycle", runId },
  organizationId: approvedBusiness.organizationId,
  source,
  status: "active",
});

const secondBranchId = await postGatewayId(owner.accessToken, "/runtime/organization-branches", {
  address: {
    city: "Awka",
    country: "NG",
    line1: "Configured secondary branch address",
  },
  branchKey: secondBranchKey,
  displayName: `Staff Gate Secondary Branch ${runKey}`,
  geoLocation: {
    latitude: 6.213,
    longitude: 7.071,
  },
  idempotencyKey: idempotency("create-secondary-branch"),
  metadata: { gate: "organization_staff_lifecycle", runId },
  organizationId: approvedBusiness.organizationId,
  source,
  status: "active",
});

const roleId = await postGatewayId(owner.accessToken, "/runtime/organization-roles", {
  branchId,
  description: "Branch-scoped catalog operator role for the staff lifecycle gate.",
  displayName: `Catalog Manager ${runKey}`,
  idempotencyKey: idempotency("configure-catalog-role"),
  metadata: { gate: "organization_staff_lifecycle", runId },
  organizationId: approvedBusiness.organizationId,
  permissionKeys: ["business.catalog.manage"],
  roleKey,
  source,
});

await requireGatewayError(owner.accessToken, "/runtime/organization-roles", {
  displayName: "Invalid Platform Escalation Role",
  idempotencyKey: idempotency("reject-platform-permission-role"),
  metadata: { gate: "organization_staff_lifecycle", runId },
  organizationId: approvedBusiness.organizationId,
  permissionKeys: ["platform.roles.manage"],
  roleKey: `business.invalid.platform.${runKey}`,
  source,
}, "organization roles cannot grant platform permissions");

await requireDirectStaffMutationsRejected(
  owner,
  outsider.id,
  approvedBusiness.organizationId,
  roleId,
);

const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
const invitationId = await postGatewayId(owner.accessToken, "/runtime/organization-invitations", {
  branchKey,
  expiresAt,
  idempotencyKey: idempotency("invite-staff"),
  invitedEmail: staff.email,
  membershipType: "member",
  metadata: { gate: "organization_staff_lifecycle", runId },
  organizationId: approvedBusiness.organizationId,
  roleKey,
  source,
});

const replayedInvitationId = await postGatewayId(
  owner.accessToken,
  "/runtime/organization-invitations",
  {
    branchKey,
    expiresAt,
    idempotencyKey: idempotency("invite-staff"),
    invitedEmail: staff.email,
    membershipType: "member",
    metadata: { gate: "organization_staff_lifecycle", replay: true, runId },
    organizationId: approvedBusiness.organizationId,
    roleKey,
    source,
  },
);
requireCondition(
  replayedInvitationId === invitationId,
  "staff invitation idempotency did not return the existing invitation.",
);

await requireGatewayError(outsider.accessToken, "/runtime/organization-invitations", {
  branchKey,
  expiresAt,
  idempotencyKey: idempotency("outsider-invite"),
  invitedEmail: outsider.email,
  membershipType: "member",
  metadata: { gate: "organization_staff_lifecycle", runId },
  organizationId: approvedBusiness.organizationId,
  roleKey,
  source,
}, "organization staff management permission is required");

await postGatewayId(staff.accessToken, "/runtime/organization-invitations/accept", {
  idempotencyKey: idempotency("accept-invitation"),
  invitationId,
  metadata: { gate: "organization_staff_lifecycle", runId },
});

await requireStaffAssignment(approvedBusiness.organizationId, staff.id, roleId, branchId, "active");
await requireBranchPermission(
  staff.client,
  "business.catalog.manage",
  approvedBusiness.organizationId,
  branchId,
  true,
);
await requireBranchPermission(
  staff.client,
  "business.catalog.manage",
  approvedBusiness.organizationId,
  secondBranchId,
  false,
);

await requireGatewayError(staff.accessToken, "/runtime/organization-invitations", {
  branchKey,
  expiresAt,
  idempotencyKey: idempotency("staff-cannot-invite"),
  invitedEmail: outsider.email,
  membershipType: "member",
  metadata: { gate: "organization_staff_lifecycle", runId },
  organizationId: approvedBusiness.organizationId,
  roleKey,
  source,
}, "organization staff management permission is required");

await postGatewayId(owner.accessToken, "/runtime/organization-staff/status", {
  idempotencyKey: idempotency("suspend-staff"),
  metadata: { gate: "organization_staff_lifecycle", runId },
  organizationId: approvedBusiness.organizationId,
  reason: "Gate verifies suspended staff permissions are inactive.",
  status: "suspended",
  userId: staff.id,
});
await requireStaffAssignment(
  approvedBusiness.organizationId,
  staff.id,
  roleId,
  branchId,
  "suspended",
);
await requireBranchPermission(
  staff.client,
  "business.catalog.manage",
  approvedBusiness.organizationId,
  branchId,
  false,
);

await postGatewayId(owner.accessToken, "/runtime/organization-staff/status", {
  idempotencyKey: idempotency("reactivate-staff"),
  metadata: { gate: "organization_staff_lifecycle", runId },
  organizationId: approvedBusiness.organizationId,
  reason: "Gate verifies reactivated staff permissions are restored.",
  status: "active",
  userId: staff.id,
});
await requireStaffAssignment(approvedBusiness.organizationId, staff.id, roleId, branchId, "active");
await requireBranchPermission(
  staff.client,
  "business.catalog.manage",
  approvedBusiness.organizationId,
  branchId,
  true,
);

await postGatewayId(owner.accessToken, "/runtime/organization-staff/ownership-transfer", {
  fromUserId: owner.id,
  idempotencyKey: idempotency("transfer-ownership"),
  metadata: { gate: "organization_staff_lifecycle", runId },
  organizationId: approvedBusiness.organizationId,
  toUserId: staff.id,
});
await requireOwnershipTransferred(approvedBusiness.organizationId, owner.id, staff.id);
await requireBranchPermission(
  staff.client,
  "business.staff.manage",
  approvedBusiness.organizationId,
  branchId,
  true,
);

await requireRuntimeReadRoutes(owner.accessToken, staff.accessToken, {
  branchId,
  invitationId,
  organizationId: approvedBusiness.organizationId,
  roleId,
  secondBranchId,
  staffUserId: staff.id,
});
await requireStaffEvents(approvedBusiness.organizationId, {
  branchId,
  invitationId,
  roleId,
  staffUserId: staff.id,
});
await requireStaffAuditEvidence(approvedBusiness.organizationId, {
  branchId,
  invitationId,
  roleId,
  staffUserId: staff.id,
});
await requireStaffEventAppendOnlyProtection(approvedBusiness.organizationId);

console.log("Organization staff lifecycle gate completed.");
console.log(`organization_id=${approvedBusiness.organizationId}`);
console.log(`branch_id=${branchId}`);
console.log(`staff_user_id=${staff.id}`);
console.log(`invitation_id=${invitationId}`);

async function createApprovedBusiness(
  businessOwner: GateUser,
  platformAdmin: AdminSession,
): Promise<ApprovedBusiness> {
  const applicationPayload = {
    contact: {
      email: businessOwner.email,
      phone: "+2348000000002",
    },
    organization: {
      displayName: `Staff Gate Business ${runKey}`,
      legalName: `Staff Gate Business ${runKey} Ltd`,
      partnerTypeKey: "partner.fulfillment.configured",
      slug: `staff-gate-${runKey}`,
    },
    ownership: {
      ownerUserId: businessOwner.id,
    },
  };

  const applicationId = await postGatewayId(businessOwner.accessToken, "/runtime/applications", {
    applicationTypeKey: "application.business.default",
    idempotencyKey: idempotency("create-business-application"),
    metadata: { gate: "organization_staff_lifecycle", runId },
    payload: applicationPayload,
    source,
  });

  const documentSubmissionIds: string[] = [];
  for (
    const requirementKey of [
      "business.registration",
      "business.owner-identity",
      "business.proof-of-address",
      "business.settlement-details",
    ]
  ) {
    documentSubmissionIds.push(
      await postGatewayId(businessOwner.accessToken, "/runtime/documents", {
        applicationId,
        byteSize: 2048,
        checksum: `${runId}:${requirementKey}`,
        contentType: "application/pdf",
        idempotencyKey: idempotency(`document-${requirementKey}`),
        metadata: { gate: "organization_staff_lifecycle", requirementKey, runId },
        requirementKey,
        source,
        storageBucket: "skima-platform-documents",
        storagePath: `${businessOwner.id}/${runId}/${requirementKey}.pdf`,
      }),
    );
  }

  await postGatewayId(businessOwner.accessToken, "/runtime/applications/submit", {
    applicationId,
    idempotencyKey: idempotency("submit-business-application"),
    metadata: { gate: "organization_staff_lifecycle", runId },
  });

  await postGatewayId(platformAdmin.accessToken, "/runtime/applications/reviewer", {
    applicationId,
    idempotencyKey: idempotency("assign-business-reviewer"),
    metadata: { gate: "organization_staff_lifecycle", runId },
    reviewerUserId: platformAdmin.userId,
  });

  for (const documentSubmissionId of documentSubmissionIds) {
    await postGatewayId(platformAdmin.accessToken, "/runtime/documents/review", {
      applicantMessage: "Document accepted.",
      decision: "approved",
      documentSubmissionId,
      idempotencyKey: idempotency(`approve-business-document-${documentSubmissionId}`),
      internalNotes: "Organization staff gate document approval.",
      metadata: { gate: "organization_staff_lifecycle", runId },
    });
  }

  await postGatewayId(platformAdmin.accessToken, "/runtime/applications/decisions", {
    applicationId,
    decision: "approved",
    idempotencyKey: idempotency("approve-business-application"),
    metadata: { gate: "organization_staff_lifecycle", runId },
    reason: "Configured business requirements were satisfied.",
  });

  const applicationRecord = await requireSingle(
    serviceClient
      .from("application_records")
      .select("status,organization_id,activated_subject_type,activated_subject_id")
      .eq("id", applicationId)
      .single(),
    "read approved staff-gate application",
  );

  requireCondition(
    applicationRecord.status === "approved",
    `staff-gate application expected approved, found ${String(applicationRecord.status)}.`,
  );
  requireCondition(
    applicationRecord.activated_subject_type === "partner",
    "staff-gate application did not activate a partner profile.",
  );

  const organizationId = requireStringValue(
    applicationRecord.organization_id,
    "staff-gate organization id",
  );
  const partnerId = requireStringValue(
    applicationRecord.activated_subject_id,
    "staff-gate partner id",
  );

  const ownerMembership = await requireSingle(
    serviceClient
      .from("organization_memberships")
      .select("membership_type,status")
      .eq("organization_id", organizationId)
      .eq("user_id", businessOwner.id)
      .single(),
    "read activated owner membership",
  );
  requireCondition(
    ownerMembership.membership_type === "owner" && ownerMembership.status === "active",
    "approved applicant was not activated as the organization owner.",
  );

  return {
    applicationId,
    organizationId,
    partnerId,
  };
}

async function requireDirectStaffMutationsRejected(
  manager: GateUser,
  subjectUserId: string,
  organizationId: string,
  roleId: string,
): Promise<void> {
  const branchAttempt = await manager.client.from("organization_branches").insert({
    address: {},
    display_name: "Direct Branch Insert Should Fail",
    geo_location: {},
    idempotency_key: idempotency("direct-branch-insert"),
    key: `branch.direct.${runKey}`,
    organization_id: organizationId,
    source,
    status: "active",
  });
  requireCondition(Boolean(branchAttempt.error), "direct organization branch insert was allowed.");

  const membershipAttempt = await manager.client.from("organization_memberships").insert({
    membership_type: "member",
    organization_id: organizationId,
    status: "active",
    user_id: subjectUserId,
  });
  requireCondition(
    Boolean(membershipAttempt.error),
    "direct organization membership insert was allowed.",
  );

  const roleAttempt = await manager.client.from("user_roles").insert({
    organization_id: organizationId,
    role_id: roleId,
    status: "active",
    user_id: subjectUserId,
  });
  requireCondition(Boolean(roleAttempt.error), "direct organization user role insert was allowed.");
}

async function requireStaffAssignment(
  organizationId: string,
  staffUserId: string,
  roleId: string,
  expectedBranchId: string,
  expectedStatus: "active" | "suspended",
): Promise<void> {
  const membership = await requireSingle(
    serviceClient
      .from("organization_memberships")
      .select("membership_type,status")
      .eq("organization_id", organizationId)
      .eq("user_id", staffUserId)
      .single(),
    "read staff membership",
  );

  requireCondition(
    membership.membership_type === "member",
    `staff membership type expected member, found ${String(membership.membership_type)}.`,
  );
  requireCondition(
    membership.status === expectedStatus,
    `staff membership expected ${expectedStatus}, found ${String(membership.status)}.`,
  );

  const assignedRole = await requireSingle(
    serviceClient
      .from("user_roles")
      .select("branch_id,status")
      .eq("organization_id", organizationId)
      .eq("user_id", staffUserId)
      .eq("role_id", roleId)
      .single(),
    "read assigned staff role",
  );

  requireCondition(
    assignedRole.branch_id === expectedBranchId,
    "staff role was not scoped to the configured branch.",
  );
  requireCondition(
    assignedRole.status === expectedStatus,
    `staff role expected ${expectedStatus}, found ${String(assignedRole.status)}.`,
  );
}

async function requireOwnershipTransferred(
  organizationId: string,
  previousOwnerId: string,
  newOwnerId: string,
): Promise<void> {
  const previousOwnerMembership = await requireSingle(
    serviceClient
      .from("organization_memberships")
      .select("membership_type,status")
      .eq("organization_id", organizationId)
      .eq("user_id", previousOwnerId)
      .single(),
    "read previous owner membership",
  );
  requireCondition(
    previousOwnerMembership.membership_type === "admin" &&
      previousOwnerMembership.status === "active",
    "previous owner was not converted to an active organization admin.",
  );

  const newOwnerMembership = await requireSingle(
    serviceClient
      .from("organization_memberships")
      .select("membership_type,status")
      .eq("organization_id", organizationId)
      .eq("user_id", newOwnerId)
      .single(),
    "read new owner membership",
  );
  requireCondition(
    newOwnerMembership.membership_type === "owner" && newOwnerMembership.status === "active",
    "new owner was not activated as organization owner.",
  );

  const ownerRole = await requireSingle(
    serviceClient
      .from("roles")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("key", "business.owner")
      .single(),
    "read business owner role",
  );

  const previousOwnerRole = await requireSingle(
    serviceClient
      .from("user_roles")
      .select("status")
      .eq("organization_id", organizationId)
      .eq("user_id", previousOwnerId)
      .eq("role_id", ownerRole.id)
      .single(),
    "read previous owner role",
  );
  requireCondition(
    previousOwnerRole.status === "suspended",
    "previous owner role was not suspended after transfer.",
  );

  const newOwnerRole = await requireSingle(
    serviceClient
      .from("user_roles")
      .select("status")
      .eq("organization_id", organizationId)
      .eq("user_id", newOwnerId)
      .eq("role_id", ownerRole.id)
      .single(),
    "read new owner role",
  );
  requireCondition(newOwnerRole.status === "active", "new owner role is not active.");
}

async function requireBranchPermission(
  client: SupabaseClient,
  permission: string,
  organizationId: string,
  targetBranchId: string,
  expected: boolean,
): Promise<void> {
  const { data, error } = await client.rpc("has_permission_for_branch", {
    target_branch_id: targetBranchId,
    target_organization_id: organizationId,
    target_permission: permission,
  });

  if (error) {
    throw error;
  }

  requireCondition(
    data === expected,
    `${permission} branch permission expected ${expected}, found ${String(data)}.`,
  );
}

async function requireRuntimeReadRoutes(
  ownerAccessToken: string,
  staffAccessToken: string,
  ids: {
    readonly branchId: string;
    readonly invitationId: string;
    readonly organizationId: string;
    readonly roleId: string;
    readonly secondBranchId: string;
    readonly staffUserId: string;
  },
): Promise<void> {
  const ownerBranches = await getGatewayRecords(ownerAccessToken, "/runtime/organization-branches");
  requireCondition(
    ownerBranches.some((record) => record.id === ids.branchId) &&
      ownerBranches.some((record) => record.id === ids.secondBranchId),
    "owner branch runtime route did not expose configured branches.",
  );

  const ownerRoles = await getGatewayRecords(ownerAccessToken, "/runtime/organization-roles");
  requireCondition(
    ownerRoles.some((record) => record.id === ids.roleId),
    "owner role runtime route did not expose configured organization role.",
  );

  const ownerInvitations = await getGatewayRecords(
    staffAccessToken,
    "/runtime/organization-invitations",
  );
  requireCondition(
    ownerInvitations.some((record) => record.id === ids.invitationId),
    "owner invitation runtime route did not expose the staff invitation.",
  );

  const staffRoles = await getGatewayRecords(staffAccessToken, "/runtime/organization-user-roles");
  requireCondition(
    staffRoles.some((record) =>
      record.organization_id === ids.organizationId && record.user_id === ids.staffUserId
    ),
    "staff user role runtime route did not expose the staff member's assignment.",
  );

  const staffEvents = await getGatewayRecords(
    staffAccessToken,
    "/runtime/organization-staff/events",
  );
  requireCondition(staffEvents.length > 0, "staff event runtime route did not expose events.");
}

async function requireStaffEvents(
  organizationId: string,
  ids: {
    readonly branchId: string;
    readonly invitationId: string;
    readonly roleId: string;
    readonly staffUserId: string;
  },
): Promise<void> {
  const { data, error } = await serviceClient
    .from("organization_staff_events")
    .select("event_type_key,branch_id,invitation_id,role_id,subject_user_id")
    .eq("organization_id", organizationId);

  if (error) {
    throw error;
  }

  const eventKeys = new Set((data ?? []).map((event) => event.event_type_key));
  for (
    const eventKey of [
      "event.organization.branch.created",
      "event.organization.role.configured",
      "event.organization.staff.invited",
      "event.organization.staff.accepted",
      "event.organization.staff.status_changed",
      "event.organization.ownership.transferred",
    ]
  ) {
    requireCondition(eventKeys.has(eventKey), `organization staff event is missing: ${eventKey}.`);
  }

  requireCondition(
    (data ?? []).some((event) => event.branch_id === ids.branchId),
    "organization staff branch event evidence is missing.",
  );
  requireCondition(
    (data ?? []).some((event) => event.invitation_id === ids.invitationId),
    "organization staff invitation event evidence is missing.",
  );
  requireCondition(
    (data ?? []).some((event) => event.role_id === ids.roleId),
    "organization staff role event evidence is missing.",
  );
  requireCondition(
    (data ?? []).some((event) => event.subject_user_id === ids.staffUserId),
    "organization staff subject event evidence is missing.",
  );
}

async function requireStaffAuditEvidence(
  organizationId: string,
  ids: {
    readonly branchId: string;
    readonly invitationId: string;
    readonly roleId: string;
    readonly staffUserId: string;
  },
): Promise<void> {
  await requireAuditRecord("organization_branches", ids.branchId);
  await requireAuditRecord("organization_invitations", ids.invitationId);
  await requireAuditRecord("roles", ids.roleId);

  const membershipAudit = await serviceClient
    .from("audit_logs")
    .select("id")
    .eq("entity_type", "organization_memberships")
    .contains("after_state", {
      organization_id: organizationId,
      user_id: ids.staffUserId,
    })
    .limit(1);

  if (membershipAudit.error) {
    throw membershipAudit.error;
  }
  requireCondition(
    (membershipAudit.data ?? []).length > 0,
    "organization staff membership audit evidence is missing.",
  );

  const { data, error } = await serviceClient
    .from("audit_logs")
    .select("id")
    .eq("entity_type", "organization_staff_events")
    .contains("after_state", { organization_id: organizationId })
    .limit(1);

  if (error) {
    throw error;
  }

  requireCondition((data ?? []).length > 0, "organization staff event audit evidence is missing.");
}

async function requireStaffEventAppendOnlyProtection(organizationId: string): Promise<void> {
  const eventRecord = await requireSingle(
    serviceClient
      .from("organization_staff_events")
      .select("id,metadata")
      .eq("organization_id", organizationId)
      .limit(1)
      .single(),
    "read organization staff event for append-only check",
  );

  const updateResult = await serviceClient
    .from("organization_staff_events")
    .update({ metadata: { should_not_update: true } })
    .eq("id", eventRecord.id);
  requireCondition(
    Boolean(updateResult.error),
    "organization staff event direct update was allowed.",
  );

  const deleteResult = await serviceClient
    .from("organization_staff_events")
    .delete()
    .eq("id", eventRecord.id);
  requireCondition(
    Boolean(deleteResult.error),
    "organization staff event direct delete was allowed.",
  );
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

async function getGatewayRecords(
  accessToken: string,
  path: string,
): Promise<Record<string, unknown>[]> {
  const response = await fetch(`${supabaseUrl}/functions/v1/api-gateway${path}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    method: "GET",
  });
  const body = await readGatewayJson(response);

  if (!response.ok) {
    throw new Error(
      `${path} returned HTTP ${response.status}: ${String(body.message ?? body.error)}`,
    );
  }

  if (body.ok !== true || !Array.isArray(body.data)) {
    throw new Error(`${path} did not return an ok data array.`);
  }

  return body.data as Record<string, unknown>[];
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
    return await createGatePlatformAdminSession();
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

async function createGatePlatformAdminSession(): Promise<AdminSession> {
  const email = `skima-staff-support-admin-${runId}@example.invalid`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: {
      gate: "organization_staff_lifecycle",
      kind: "temporary-platform-support-admin",
      runId,
    },
  });

  if (error) {
    throw error;
  }

  if (!data.user?.id) {
    throw new Error("Supabase Auth did not create the temporary platform support admin.");
  }

  await requireMutation(
    serviceClient.from("profiles").upsert({
      display_name: "Organization Staff Gate Support Admin",
      id: data.user.id,
      metadata: { gate: "organization_staff_lifecycle", runId },
      status: "active",
    }),
    "upsert temporary platform support admin profile",
  );

  const roleRecord = await requireSingle(
    serviceClient
      .from("roles")
      .select("id")
      .eq("key", "platform.support_admin")
      .is("organization_id", null)
      .eq("status", "active")
      .single(),
    "read platform support admin role",
  );

  await requireMutation(
    serviceClient.from("platform_admins").upsert({
      admin_kind: "role_admin",
      metadata: { gate: "organization_staff_lifecycle", runId },
      primary_role_id: roleRecord.id,
      status: "active",
      title: "Application Reviewer",
      user_id: data.user.id,
    }, { onConflict: "user_id" }),
    "configure temporary platform support admin record",
  );

  await requireMutation(
    serviceClient.from("user_roles").insert({
      organization_id: null,
      role_id: roleRecord.id,
      status: "active",
      user_id: data.user.id,
    }),
    "assign temporary platform support admin role",
  );

  const client = createBrowserSafeClient();
  const signInResult = await client.auth.signInWithPassword({ email, password });

  if (signInResult.error) {
    throw signInResult.error;
  }

  if (!signInResult.data.session?.access_token) {
    throw new Error("Supabase Auth did not return a temporary admin access token.");
  }

  return {
    accessToken: signInResult.data.session.access_token,
    client: createAuthenticatedClient(signInResult.data.session.access_token),
    userId: data.user.id,
  };
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

async function createGateUser(kind: string): Promise<GateUser> {
  const email = `skima-${kind}-${runId}@example.invalid`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: {
      gate: "organization_staff_lifecycle",
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
      display_name: `Organization Staff Gate ${kind}`,
      id: data.user.id,
      metadata: { gate: "organization_staff_lifecycle", runId },
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
  };
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

function requireStringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
