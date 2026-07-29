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
const source = "platform.order_operations_gate";

const branchKey = `branch.orders.${runKey}`;
const staffRoleKey = `business.order.operator.${runKey}`;
const unitKey = `unit.orders.${runKey}`;
const categoryKey = `category.orders.${runKey}`;
const itemKey = `item.orders.${runKey}`;
const variantKey = `variant.orders.${runKey}`;

console.log(`Running order operations lifecycle gate ${runId}...`);

const adminSession = await resolveAdminSession();
const owner = await createGateUser("orders-owner");
const staff = await createGateUser("orders-staff");
const customer = await createGateUser("orders-customer");
const outsider = await createGateUser("orders-outsider");
const approvedBusiness = await createApprovedBusiness(owner, adminSession);

const branchId = await createBranch(owner, approvedBusiness.organizationId);
const staffRoleId = await createOrderStaffRole(owner, approvedBusiness.organizationId, branchId);
const invitationId = await inviteAndAcceptOrderStaff(owner, staff, approvedBusiness.organizationId);
await requireOrderStaffAssignment(
  approvedBusiness.organizationId,
  staff.id,
  staffRoleId,
  branchId,
);

const unitId = await postGatewayId(owner.accessToken, "/runtime/catalog/units", {
  decimalPrecision: 0,
  displayName: "Order Unit",
  idempotencyKey: idempotency("configure-unit"),
  metadata: { gate: "order_operations_lifecycle", runId },
  organizationId: approvedBusiness.organizationId,
  source,
  status: "active",
  symbol: "ou",
  unitKey,
  unitKind: "quantity",
});

const categoryId = await postGatewayId(owner.accessToken, "/runtime/catalog/categories", {
  categoryKey,
  categoryType: "product",
  description: "Generic orderable category for the order operations gate.",
  displayName: "Order Category",
  idempotencyKey: idempotency("configure-category"),
  metadata: { gate: "order_operations_lifecycle", runId },
  organizationId: approvedBusiness.organizationId,
  source,
  status: "active",
});

const itemId = await postGatewayId(staff.accessToken, "/runtime/catalog/items", {
  branchId,
  categoryKey,
  description: "Generic orderable item for the order operations gate.",
  displayName: "Order Item",
  fulfillmentMethods: ["delivery", "pickup"],
  idempotencyKey: idempotency("configure-item"),
  itemKey,
  itemType: "product",
  maxQuantity: 10,
  metadata: { gate: "order_operations_lifecycle", runId },
  minQuantity: 1,
  organizationId: approvedBusiness.organizationId,
  preparationTimeMinutes: 10,
  source,
  status: "active",
});

const variantId = await postGatewayId(staff.accessToken, "/runtime/catalog/variants", {
  displayName: "Order Variant",
  idempotencyKey: idempotency("configure-variant"),
  itemId,
  metadata: { gate: "order_operations_lifecycle", runId },
  quantityValue: 1,
  sku: `ORDER-${runKey.toUpperCase()}`,
  source,
  status: "active",
  unitKey,
  variantKey,
});

const priceId = await postGatewayId(staff.accessToken, "/runtime/catalog/prices", {
  amount: 1200,
  currencyCode: "NGN",
  idempotencyKey: idempotency("configure-price"),
  itemId,
  metadata: { gate: "order_operations_lifecycle", runId },
  source,
  status: "active",
  taxBehavior: "exclusive",
  variantId,
});

const availabilityId = await postGatewayId(staff.accessToken, "/runtime/catalog/availability", {
  availabilityStatus: "available",
  branchId,
  capacityLimit: 12,
  capacityUsed: 0,
  idempotencyKey: idempotency("configure-availability"),
  itemId,
  metadata: { gate: "order_operations_lifecycle", runId },
  reservedQuantity: 0,
  schedule: {
    timezone: "Africa/Lagos",
    windows: [{ day: "tuesday", from: "08:00", to: "20:00" }],
  },
  source,
  status: "active",
  stockQuantity: 12,
  variantId,
});

await requireDirectOrderMutationsRejected(customer, approvedBusiness.organizationId, branchId);

const orderId = await postGatewayId(customer.accessToken, "/runtime/orders", {
  branchId,
  currencyCode: "NGN",
  fulfillmentMethod: "delivery",
  idempotencyKey: idempotency("create-order"),
  lineItems: [{ itemId, metadata: { gateLine: true }, quantity: 2, variantId }],
  metadata: { gate: "order_operations_lifecycle", runId },
  moduleKey: "lpg",
  orderPayload: {
    customerReference: `order-gate-${runKey}`,
    requestedAt: new Date().toISOString(),
  },
  organizationId: approvedBusiness.organizationId,
  source,
});

const replayedOrderId = await postGatewayId(customer.accessToken, "/runtime/orders", {
  branchId,
  currencyCode: "NGN",
  fulfillmentMethod: "delivery",
  idempotencyKey: idempotency("create-order"),
  lineItems: [{ itemId, metadata: { gateLine: true }, quantity: 2, variantId }],
  metadata: { gate: "order_operations_lifecycle", replay: true, runId },
  moduleKey: "lpg",
  orderPayload: {
    customerReference: `order-gate-${runKey}`,
    requestedAt: await requireOrderPayloadRequestedAt(orderId),
  },
  organizationId: approvedBusiness.organizationId,
  source,
});
requireCondition(replayedOrderId === orderId, "order creation idempotency did not replay.");

await requireOrderState(orderId, "received", "workflow_started", "received");
await requireLineAndAvailabilityState(orderId, availabilityId, {
  capacityUsed: 2,
  lineFulfillmentStatus: "pending",
  reservationStatus: "reserved",
  reservedQuantity: 2,
  stockQuantity: 12,
});

await requireGatewayError(customer.accessToken, "/runtime/orders/actions", {
  actionKey: "order.accept",
  idempotencyKey: idempotency("customer-accept-denied"),
  metadata: { gate: "order_operations_lifecycle", runId },
  orderId,
  source,
}, "business order processing permission is required");

await requireOutsiderCannotReadOrder(outsider, orderId);

const acceptEventId = await postGatewayId(staff.accessToken, "/runtime/orders/actions", {
  actionKey: "order.accept",
  idempotencyKey: idempotency("accept-order"),
  metadata: { gate: "order_operations_lifecycle", runId },
  orderId,
  payload: { acceptedBy: staff.id },
  source,
});

const replayedAcceptEventId = await postGatewayId(staff.accessToken, "/runtime/orders/actions", {
  actionKey: "order.accept",
  idempotencyKey: idempotency("accept-order"),
  metadata: { gate: "order_operations_lifecycle", replay: true, runId },
  orderId,
  payload: { acceptedBy: staff.id },
  source,
});
requireCondition(
  replayedAcceptEventId === acceptEventId,
  "order action idempotency did not replay.",
);

await requireOrderState(orderId, "accepted", "in_progress", "accepted");

const assignmentId = await postGatewayId(staff.accessToken, "/runtime/orders/assignments", {
  entityId: approvedBusiness.organizationId,
  entityType: "organization",
  idempotencyKey: idempotency("assign-business-operator"),
  metadata: { gate: "order_operations_lifecycle", runId },
  orderId,
  participantRole: "fulfillment_partner",
  source,
});

await postGatewayId(staff.accessToken, "/runtime/orders/actions", {
  actionKey: "order.start_preparation",
  idempotencyKey: idempotency("start-preparation"),
  metadata: { gate: "order_operations_lifecycle", runId },
  orderId,
  payload: { station: "generic-business-branch" },
  source,
});
await requireOrderState(orderId, "preparing", "in_progress", "preparing");

await postGatewayId(staff.accessToken, "/runtime/orders/actions", {
  actionKey: "order.ready_for_pickup",
  idempotencyKey: idempotency("ready-for-pickup"),
  metadata: { gate: "order_operations_lifecycle", runId },
  orderId,
  payload: { handoffWindow: "immediate" },
  source,
});
await requireOrderState(orderId, "ready_for_pickup", "in_progress", "ready_for_pickup");

await postGatewayId(staff.accessToken, "/runtime/orders/actions", {
  actionKey: "order.fulfill",
  idempotencyKey: idempotency("fulfill-order"),
  metadata: { gate: "order_operations_lifecycle", runId },
  orderId,
  payload: { fulfillmentEvidence: "confirmed-by-runtime-gate" },
  source,
});
await requireOrderState(orderId, "fulfilled", "fulfilled", "fulfilled");
await requireLineAndAvailabilityState(orderId, availabilityId, {
  capacityUsed: 2,
  lineFulfillmentStatus: "fulfilled",
  reservationStatus: "consumed",
  reservedQuantity: 0,
  stockQuantity: 10,
});

await postGatewayId(customer.accessToken, "/runtime/orders/actions", {
  actionKey: "order.complete",
  idempotencyKey: idempotency("complete-order"),
  metadata: { gate: "order_operations_lifecycle", runId },
  orderId,
  payload: { customerConfirmed: true },
  source,
});
await requireOrderState(orderId, "completed", "completed", "completed");

await requireRuntimeReadRoutes(customer.accessToken, staff.accessToken, {
  assignmentId,
  orderId,
  priceId,
  unitId,
  categoryId,
});
await requireOrderEvents(orderId, [
  "event.order.received",
  "event.order.accepted",
  "event.order.reassigned",
  "event.order.preparation.started",
  "event.order.ready_for_pickup",
  "event.order.fulfilled",
  "event.order.completed",
]);
await requireOrderNotifications(orderId);
await requireOrderAuditEvidence(orderId, assignmentId);
await requireOrderEventAppendOnlyProtection(orderId);

console.log("Order operations lifecycle gate completed.");
console.log(`order_id=${orderId}`);
console.log(`service_request_id=${await requireOrderServiceRequestId(orderId)}`);
console.log(`organization_id=${approvedBusiness.organizationId}`);
console.log(`branch_id=${branchId}`);
console.log(`item_id=${itemId}`);
console.log(`variant_id=${variantId}`);
console.log(`availability_rule_id=${availabilityId}`);
console.log(`staff_invitation_id=${invitationId}`);

async function createBranch(actor: GateUser, organizationId: string): Promise<string> {
  return await postGatewayId(actor.accessToken, "/runtime/organization-branches", {
    address: {
      city: "Awka",
      country: "NG",
      line1: `Order operations branch ${runKey}`,
    },
    branchKey,
    displayName: `Order Operations Branch ${runKey}`,
    geoLocation: {
      latitude: 6.2104,
      longitude: 7.0741,
    },
    idempotencyKey: idempotency("create-branch"),
    metadata: { gate: "order_operations_lifecycle", runId },
    organizationId,
    source,
    status: "active",
  });
}

async function createOrderStaffRole(
  businessOwner: GateUser,
  organizationId: string,
  assignedBranchId: string,
): Promise<string> {
  return await postGatewayId(businessOwner.accessToken, "/runtime/organization-roles", {
    branchId: assignedBranchId,
    description: "Branch-scoped order operator role for the order operations lifecycle gate.",
    displayName: `Order Operator ${runKey}`,
    idempotencyKey: idempotency("configure-order-staff-role"),
    metadata: { gate: "order_operations_lifecycle", runId },
    organizationId,
    permissionKeys: [
      "business.catalog.manage",
      "business.orders.read",
      "business.orders.process",
    ],
    roleKey: staffRoleKey,
    source,
  });
}

async function inviteAndAcceptOrderStaff(
  businessOwner: GateUser,
  staffMember: GateUser,
  organizationId: string,
): Promise<string> {
  const invitationId = await postGatewayId(
    businessOwner.accessToken,
    "/runtime/organization-invitations",
    {
      branchKey,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      idempotencyKey: idempotency("invite-order-staff"),
      invitedEmail: staffMember.email,
      membershipType: "member",
      metadata: { gate: "order_operations_lifecycle", runId },
      organizationId,
      roleKey: staffRoleKey,
      source,
    },
  );

  await postGatewayId(staffMember.accessToken, "/runtime/organization-invitations/accept", {
    idempotencyKey: idempotency("accept-order-staff-invitation"),
    invitationId,
    metadata: { gate: "order_operations_lifecycle", runId },
  });

  return invitationId;
}

async function createApprovedBusiness(
  businessOwner: GateUser,
  platformAdmin: AdminSession,
): Promise<ApprovedBusiness> {
  const applicationPayload = {
    contact: {
      email: businessOwner.email,
      phone: "+2348000000004",
    },
    organization: {
      displayName: `Order Gate Business ${runKey}`,
      legalName: `Order Gate Business ${runKey} Ltd`,
      partnerTypeKey: "partner.fulfillment.configured",
      slug: `order-gate-${runKey}`,
    },
    ownership: {
      ownerUserId: businessOwner.id,
    },
  };

  const applicationId = await postGatewayId(businessOwner.accessToken, "/runtime/applications", {
    applicationTypeKey: "application.business.default",
    idempotencyKey: idempotency("create-business-application"),
    metadata: { gate: "order_operations_lifecycle", runId },
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
        metadata: { gate: "order_operations_lifecycle", requirementKey, runId },
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
    metadata: { gate: "order_operations_lifecycle", runId },
  });

  await postGatewayId(platformAdmin.accessToken, "/runtime/applications/reviewer", {
    applicationId,
    idempotencyKey: idempotency("assign-business-reviewer"),
    metadata: { gate: "order_operations_lifecycle", runId },
    reviewerUserId: platformAdmin.userId,
  });

  for (const documentSubmissionId of documentSubmissionIds) {
    await postGatewayId(platformAdmin.accessToken, "/runtime/documents/review", {
      applicantMessage: "Document accepted.",
      decision: "approved",
      documentSubmissionId,
      idempotencyKey: idempotency(`approve-business-document-${documentSubmissionId}`),
      internalNotes: "Order operations gate document approval.",
      metadata: { gate: "order_operations_lifecycle", runId },
    });
  }

  await postGatewayId(platformAdmin.accessToken, "/runtime/applications/decisions", {
    applicationId,
    decision: "approved",
    idempotencyKey: idempotency("approve-business-application"),
    metadata: { gate: "order_operations_lifecycle", runId },
    reason: "Configured business requirements were satisfied.",
  });

  const applicationRecord = await requireSingle(
    serviceClient
      .from("application_records")
      .select("status,organization_id,activated_subject_type,activated_subject_id")
      .eq("id", applicationId)
      .single(),
    "read approved order-gate application",
  );

  requireCondition(
    applicationRecord.status === "approved",
    `order-gate application expected approved, found ${String(applicationRecord.status)}.`,
  );
  requireCondition(
    applicationRecord.activated_subject_type === "partner",
    "order-gate application did not activate a partner profile.",
  );

  return {
    applicationId,
    organizationId: requireStringValue(
      applicationRecord.organization_id,
      "order-gate organization id",
    ),
    partnerId: requireStringValue(
      applicationRecord.activated_subject_id,
      "order-gate partner id",
    ),
  };
}

async function requireOrderStaffAssignment(
  organizationId: string,
  staffUserId: string,
  assignedRoleId: string,
  assignedBranchId: string,
): Promise<void> {
  const membership = await requireSingle(
    serviceClient
      .from("organization_memberships")
      .select("membership_type,status")
      .eq("organization_id", organizationId)
      .eq("user_id", staffUserId)
      .single(),
    "read order staff membership",
  );

  requireCondition(
    membership.membership_type === "member" && membership.status === "active",
    "order staff membership was not activated.",
  );

  const assignedRole = await requireSingle(
    serviceClient
      .from("user_roles")
      .select("branch_id,status")
      .eq("organization_id", organizationId)
      .eq("user_id", staffUserId)
      .eq("role_id", assignedRoleId)
      .single(),
    "read order staff role assignment",
  );

  requireCondition(
    assignedRole.branch_id === assignedBranchId && assignedRole.status === "active",
    "order staff role was not active and branch-scoped.",
  );
}

async function requireOrderPayloadRequestedAt(orderId: string): Promise<string> {
  const orderRecord = await requireSingle(
    serviceClient
      .from("order_records")
      .select("order_payload")
      .eq("id", orderId)
      .single(),
    "read order payload for replay",
  );

  const payload = orderRecord.order_payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("order payload was not an object.");
  }

  const requestedAt = (payload as Record<string, unknown>).requestedAt;
  return requireStringValue(requestedAt, "order payload requestedAt");
}

async function requireOrderState(
  orderId: string,
  expectedOrderStatus: string,
  expectedServiceRequestStatus: string,
  expectedWorkflowState: string,
): Promise<void> {
  const orderRecord = await requireSingle(
    serviceClient
      .from("order_records")
      .select("status,service_request_id,workflow_instance_id,total_amount")
      .eq("id", orderId)
      .single(),
    "read order state",
  );

  requireCondition(
    orderRecord.status === expectedOrderStatus,
    `expected order status ${expectedOrderStatus}, found ${String(orderRecord.status)}.`,
  );

  if (expectedOrderStatus === "received") {
    requireCondition(Number(orderRecord.total_amount) === 2400, "order total was not calculated.");
  }

  const serviceRequest = await requireSingle(
    serviceClient
      .from("service_requests")
      .select("status")
      .eq("id", orderRecord.service_request_id)
      .single(),
    "read order service request state",
  );
  requireCondition(
    serviceRequest.status === expectedServiceRequestStatus,
    `expected service request status ${expectedServiceRequestStatus}, found ${
      String(serviceRequest.status)
    }.`,
  );

  const workflowInstance = await requireSingle(
    serviceClient
      .from("workflow_instances")
      .select("current_state_key,status")
      .eq("id", orderRecord.workflow_instance_id)
      .single(),
    "read order workflow state",
  );
  requireCondition(
    workflowInstance.current_state_key === expectedWorkflowState,
    `expected workflow state ${expectedWorkflowState}, found ${
      String(workflowInstance.current_state_key)
    }.`,
  );
}

async function requireLineAndAvailabilityState(
  orderId: string,
  availabilityId: string,
  expected: {
    readonly capacityUsed: number;
    readonly lineFulfillmentStatus: string;
    readonly reservationStatus: string;
    readonly reservedQuantity: number;
    readonly stockQuantity: number;
  },
): Promise<void> {
  const line = await requireSingle(
    serviceClient
      .from("order_line_items")
      .select("fulfillment_status,stock_reservation_status,quantity,line_amount")
      .eq("order_id", orderId)
      .single(),
    "read order line state",
  );

  requireCondition(Number(line.quantity) === 2, "order line quantity changed unexpectedly.");
  requireCondition(Number(line.line_amount) === 2400, "order line amount was not calculated.");
  requireCondition(
    line.fulfillment_status === expected.lineFulfillmentStatus,
    `expected line fulfillment ${expected.lineFulfillmentStatus}, found ${
      String(line.fulfillment_status)
    }.`,
  );
  requireCondition(
    line.stock_reservation_status === expected.reservationStatus,
    `expected reservation ${expected.reservationStatus}, found ${
      String(line.stock_reservation_status)
    }.`,
  );

  const availability = await requireSingle(
    serviceClient
      .from("catalog_availability_rules")
      .select("stock_quantity,reserved_quantity,capacity_used")
      .eq("id", availabilityId)
      .single(),
    "read order availability state",
  );

  requireCondition(
    Number(availability.stock_quantity) === expected.stockQuantity,
    `expected stock ${expected.stockQuantity}, found ${String(availability.stock_quantity)}.`,
  );
  requireCondition(
    Number(availability.reserved_quantity) === expected.reservedQuantity,
    `expected reserved quantity ${expected.reservedQuantity}, found ${
      String(availability.reserved_quantity)
    }.`,
  );
  requireCondition(
    Number(availability.capacity_used) === expected.capacityUsed,
    `expected capacity used ${expected.capacityUsed}, found ${String(availability.capacity_used)}.`,
  );
}

async function requireOutsiderCannotReadOrder(outsiderUser: GateUser, orderId: string) {
  const { data, error } = await outsiderUser.client
    .from("order_records")
    .select("id")
    .eq("id", orderId);

  if (error) {
    throw error;
  }

  requireCondition((data ?? []).length === 0, "outsider could read protected order records.");
}

async function requireRuntimeReadRoutes(
  customerAccessToken: string,
  staffAccessToken: string,
  ids: {
    readonly assignmentId: string;
    readonly categoryId: string;
    readonly orderId: string;
    readonly priceId: string;
    readonly unitId: string;
  },
): Promise<void> {
  const actions = await getGatewayRecords(staffAccessToken, "/runtime/order-actions");
  requireCondition(
    actions.some((record) => record.key === "order.accept"),
    "order actions route missed configured actions.",
  );

  const policies = await getGatewayRecords(staffAccessToken, "/runtime/order-acceptance-policies");
  requireCondition(
    policies.some((record) => record.key === "order.acceptance.manual.default"),
    "order acceptance policies route missed the manual policy.",
  );

  const customerOrders = await getGatewayRecords(customerAccessToken, "/runtime/orders");
  requireCondition(
    customerOrders.some((record) => record.id === ids.orderId),
    "customer order route missed created order.",
  );

  const staffOrders = await getGatewayRecords(staffAccessToken, "/runtime/orders");
  requireCondition(
    staffOrders.some((record) => record.id === ids.orderId),
    "business staff order route missed created order.",
  );

  const lineItems = await getGatewayRecords(customerAccessToken, "/runtime/orders/line-items");
  requireCondition(
    lineItems.some((record) => record.order_id === ids.orderId),
    "order line route missed created order line.",
  );

  const assignments = await getGatewayRecords(staffAccessToken, "/runtime/orders/assignments");
  requireCondition(
    assignments.some((record) => record.id === ids.assignmentId),
    "order assignment route missed assignment.",
  );

  const events = await getGatewayRecords(customerAccessToken, "/runtime/orders/events");
  requireCondition(
    events.some((record) => record.order_id === ids.orderId),
    "order event route missed order events.",
  );

  const catalogRecords = await Promise.all([
    getGatewayRecords(staffAccessToken, "/runtime/catalog/units"),
    getGatewayRecords(staffAccessToken, "/runtime/catalog/categories"),
    getGatewayRecords(staffAccessToken, "/runtime/catalog/prices"),
  ]);
  requireCondition(
    catalogRecords[0].some((record) => record.id === ids.unitId) &&
      catalogRecords[1].some((record) => record.id === ids.categoryId) &&
      catalogRecords[2].some((record) => record.id === ids.priceId),
    "catalog routes missed records needed by order operations.",
  );
}

async function requireOrderEvents(orderId: string, expectedEventTypes: string[]): Promise<void> {
  const { data, error } = await serviceClient
    .from("order_events")
    .select("event_type_key,from_status,to_status,event_id")
    .eq("order_id", orderId);

  if (error) {
    throw error;
  }

  const eventKeys = new Set((data ?? []).map((event) => event.event_type_key));
  for (const eventType of expectedEventTypes) {
    requireCondition(eventKeys.has(eventType), `order event is missing: ${eventType}.`);
  }

  const platformEventIds = (data ?? []).map((event) => event.event_id).filter(Boolean);
  requireCondition(
    platformEventIds.length >= expectedEventTypes.length,
    "platform event links missing.",
  );
}

async function requireOrderNotifications(orderId: string): Promise<void> {
  const { data, error } = await serviceClient
    .from("notification_messages")
    .select("id,payload,status,source")
    .eq("source", "platform.order_engine")
    .limit(1000);

  if (error) {
    throw error;
  }

  const orderNotifications = (data ?? []).filter((message) =>
    message.payload &&
    typeof message.payload === "object" &&
    !Array.isArray(message.payload) &&
    (message.payload as Record<string, unknown>).order_id === orderId
  );

  requireCondition(orderNotifications.length >= 2, "order notifications were not queued.");
  requireCondition(
    orderNotifications.every((message) => message.status === "queued"),
    "order notifications were not queued in a controlled state.",
  );
}

async function requireOrderAuditEvidence(orderId: string, assignmentId: string): Promise<void> {
  await requireAuditRecord("order_records", orderId);
  await requireAuditRecord("order_assignments", assignmentId);

  const line = await requireSingle(
    serviceClient.from("order_line_items").select("id").eq("order_id", orderId).single(),
    "read order line audit target",
  );
  await requireAuditRecord("order_line_items", requireStringValue(line.id, "order line id"));

  const event = await requireSingle(
    serviceClient.from("order_events").select("id").eq("order_id", orderId).limit(1).single(),
    "read order event audit target",
  );
  await requireAuditRecord("order_events", requireStringValue(event.id, "order event id"));
}

async function requireOrderEventAppendOnlyProtection(orderId: string): Promise<void> {
  const eventRecord = await requireSingle(
    serviceClient
      .from("order_events")
      .select("id,metadata")
      .eq("order_id", orderId)
      .limit(1)
      .single(),
    "read order event for append-only check",
  );

  const updateResult = await serviceClient
    .from("order_events")
    .update({ metadata: { should_not_update: true } })
    .eq("id", eventRecord.id);
  requireCondition(Boolean(updateResult.error), "order event direct update was allowed.");

  const deleteResult = await serviceClient.from("order_events").delete().eq("id", eventRecord.id);
  requireCondition(Boolean(deleteResult.error), "order event direct delete was allowed.");
}

async function requireDirectOrderMutationsRejected(
  actor: GateUser,
  organizationId: string,
  branchId: string,
): Promise<void> {
  const directOrderAttempt = await actor.client.from("order_records").insert({
    branch_id: branchId,
    currency_code: "NGN",
    idempotency_key: idempotency("direct-order"),
    metadata: { gate: "order_operations_lifecycle", runId },
    module_id: crypto.randomUUID(),
    module_version_id: crypto.randomUUID(),
    order_payload: {},
    organization_id: organizationId,
    service_request_id: crypto.randomUUID(),
    source,
    status: "received",
    total_amount: 0,
  });

  requireCondition(Boolean(directOrderAttempt.error), "direct order insert was allowed.");

  const directActionAttempt = await actor.client.from("order_action_definitions").insert({
    actor_scope: "business",
    display_name: "Direct Action Should Fail",
    event_type_key: "event.order.accepted",
    key: `order.direct.${runKey}`,
    metadata: { gate: "order_operations_lifecycle", runId },
    reservation_effect: "none",
    scope_type: "global",
    status: "active",
  });

  requireCondition(Boolean(directActionAttempt.error), "direct order action insert was allowed.");
}

async function requireOrderServiceRequestId(orderId: string): Promise<string> {
  const orderRecord = await requireSingle(
    serviceClient.from("order_records").select("service_request_id").eq("id", orderId).single(),
    "read order service request id",
  );

  return requireStringValue(orderRecord.service_request_id, "order service request id");
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
  const email = `skima-order-support-admin-${runId}@example.invalid`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: {
      gate: "order_operations_lifecycle",
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
      display_name: "Order Operations Gate Support Admin",
      id: data.user.id,
      metadata: { gate: "order_operations_lifecycle", runId },
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
      metadata: { gate: "order_operations_lifecycle", runId },
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
      gate: "order_operations_lifecycle",
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
      display_name: `Order Operations Gate ${kind}`,
      id: data.user.id,
      metadata: { gate: "order_operations_lifecycle", runId },
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
