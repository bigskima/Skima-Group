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

interface OrderabilityResult {
  readonly allowed: boolean;
  readonly check_id: string;
  readonly calculated_amount?: number | string | null;
  readonly rejection_reason?: string | null;
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
const source = "platform.catalog_availability_gate";
const branchKey = `branch.catalog.${runKey}`;
const secondBranchKey = `branch.catalog.secondary.${runKey}`;
const staffRoleKey = `business.catalog.operator.${runKey}`;
const unitKey = `unit.catalog.${runKey}`;
const categoryKey = `category.catalog.${runKey}`;
const itemKey = `item.catalog.${runKey}`;
const variantKey = `variant.catalog.${runKey}`;

console.log(`Running catalog and availability lifecycle gate ${runId}...`);

const adminSession = await resolveAdminSession();
const owner = await createGateUser("catalog-owner");
const staff = await createGateUser("catalog-staff");
const customer = await createGateUser("catalog-customer");
const outsider = await createGateUser("catalog-outsider");
const approvedBusiness = await createApprovedBusiness(owner, adminSession);

const branchId = await createBranch(owner, approvedBusiness.organizationId, branchKey, "Primary");
const secondBranchId = await createBranch(
  owner,
  approvedBusiness.organizationId,
  secondBranchKey,
  "Secondary",
);
const roleId = await createCatalogStaffRole(owner, approvedBusiness.organizationId, branchId);
const invitationId = await inviteAndAcceptCatalogStaff(
  owner,
  staff,
  approvedBusiness.organizationId,
);
await requireCatalogStaffAssignment(approvedBusiness.organizationId, staff.id, roleId, branchId);

const unitId = await postGatewayId(owner.accessToken, "/runtime/catalog/units", {
  decimalPrecision: 2,
  displayName: "Configured Unit",
  idempotencyKey: idempotency("configure-unit"),
  metadata: { gate: "catalog_availability_lifecycle", runId },
  organizationId: approvedBusiness.organizationId,
  source,
  status: "active",
  symbol: "cu",
  unitKey,
  unitKind: "quantity",
});

const categoryId = await postGatewayId(owner.accessToken, "/runtime/catalog/categories", {
  categoryKey,
  categoryType: "product",
  description: "Generic configured category for catalog gate.",
  displayName: "Configured Category",
  idempotencyKey: idempotency("configure-category"),
  metadata: { gate: "catalog_availability_lifecycle", runId },
  organizationId: approvedBusiness.organizationId,
  source,
  status: "active",
});

await requireGatewayError(staff.accessToken, "/runtime/catalog/categories", {
  categoryKey: `category.staff.denied.${runKey}`,
  categoryType: "product",
  displayName: "Denied Staff Category",
  idempotencyKey: idempotency("staff-category-denied"),
  metadata: { gate: "catalog_availability_lifecycle", runId },
  organizationId: approvedBusiness.organizationId,
  source,
  status: "active",
}, "business catalog management permission is required");

const itemId = await postGatewayId(staff.accessToken, "/runtime/catalog/items", {
  branchId,
  categoryKey,
  description: "Generic configured item for catalog and availability gate.",
  displayName: "Configured Catalog Item",
  fulfillmentMethods: ["delivery", "pickup"],
  idempotencyKey: idempotency("configure-item"),
  itemKey,
  itemType: "product",
  maxQuantity: 5,
  metadata: { gate: "catalog_availability_lifecycle", runId },
  minQuantity: 1,
  organizationId: approvedBusiness.organizationId,
  preparationTimeMinutes: 20,
  source,
  status: "active",
});

const replayedItemId = await postGatewayId(staff.accessToken, "/runtime/catalog/items", {
  branchId,
  categoryKey,
  description: "Generic configured item for catalog and availability gate.",
  displayName: "Configured Catalog Item",
  fulfillmentMethods: ["delivery", "pickup"],
  idempotencyKey: idempotency("configure-item"),
  itemKey,
  itemType: "product",
  maxQuantity: 5,
  metadata: { gate: "catalog_availability_lifecycle", replay: true, runId },
  minQuantity: 1,
  organizationId: approvedBusiness.organizationId,
  preparationTimeMinutes: 20,
  source,
  status: "active",
});
requireCondition(replayedItemId === itemId, "catalog item idempotency did not replay.");

await requireGatewayError(staff.accessToken, "/runtime/catalog/items", {
  branchId: secondBranchId,
  categoryKey,
  displayName: "Denied Branch Item",
  fulfillmentMethods: ["delivery"],
  idempotencyKey: idempotency("staff-second-branch-denied"),
  itemKey: `item.denied.${runKey}`,
  itemType: "product",
  maxQuantity: 5,
  metadata: { gate: "catalog_availability_lifecycle", runId },
  minQuantity: 1,
  organizationId: approvedBusiness.organizationId,
  source,
  status: "active",
}, "business catalog management permission is required");

await requireGatewayError(outsider.accessToken, "/runtime/catalog/items", {
  branchId,
  categoryKey,
  displayName: "Denied Outsider Item",
  fulfillmentMethods: ["delivery"],
  idempotencyKey: idempotency("outsider-item-denied"),
  itemKey: `item.outsider.denied.${runKey}`,
  itemType: "product",
  maxQuantity: 5,
  metadata: { gate: "catalog_availability_lifecycle", runId },
  minQuantity: 1,
  organizationId: approvedBusiness.organizationId,
  source,
  status: "active",
}, "business catalog management permission is required");

await requireDirectCatalogMutationsRejected(staff, approvedBusiness.organizationId, branchId);

const variantId = await postGatewayId(staff.accessToken, "/runtime/catalog/variants", {
  displayName: "Configured Variant",
  idempotencyKey: idempotency("configure-variant"),
  itemId,
  metadata: { gate: "catalog_availability_lifecycle", runId },
  quantityValue: 1,
  sku: `SKU-${runKey.toUpperCase()}`,
  source,
  status: "active",
  unitKey,
  variantKey,
});

const priceId = await postGatewayId(staff.accessToken, "/runtime/catalog/prices", {
  amount: 1500,
  currencyCode: "NGN",
  idempotencyKey: idempotency("configure-price"),
  itemId,
  metadata: { gate: "catalog_availability_lifecycle", runId },
  source,
  status: "active",
  taxBehavior: "exclusive",
  variantId,
});

const mediaAssetId = await createMediaAsset(approvedBusiness.organizationId, owner.id);
const mediaLinkId = await postGatewayId(staff.accessToken, "/runtime/catalog/media", {
  displayOrder: 1,
  idempotencyKey: idempotency("attach-media"),
  itemId,
  mediaAssetId,
  metadata: { gate: "catalog_availability_lifecycle", runId },
  source,
  status: "active",
  variantId,
});

const availabilityId = await postGatewayId(staff.accessToken, "/runtime/catalog/availability", {
  availabilityStatus: "available",
  branchId,
  capacityLimit: 20,
  capacityUsed: 2,
  idempotencyKey: idempotency("configure-availability"),
  itemId,
  metadata: { gate: "catalog_availability_lifecycle", runId },
  reservedQuantity: 1,
  schedule: {
    timezone: "Africa/Lagos",
    windows: [{ day: "monday", from: "08:00", to: "18:00" }],
  },
  source,
  status: "active",
  stockQuantity: 10,
  variantId,
});

const stockAdjustmentId = await postGatewayId(
  staff.accessToken,
  "/runtime/catalog/stock-adjustments",
  {
    availabilityRuleId: availabilityId,
    deltaQuantity: 5,
    idempotencyKey: idempotency("adjust-stock"),
    metadata: { gate: "catalog_availability_lifecycle", runId },
    reason: "Gate stock replenishment.",
    source,
  },
);

const allowedOrderability = await postGatewayData<OrderabilityResult>(
  customer.accessToken,
  "/runtime/catalog/orderability",
  {
    branchId,
    currencyCode: "NGN",
    idempotencyKey: idempotency("orderability-allowed"),
    itemId,
    metadata: { gate: "catalog_availability_lifecycle", runId },
    quantity: 2,
    source,
    variantId,
  },
);
requireCondition(allowedOrderability.allowed === true, "available catalog item was rejected.");
requireCondition(
  Number(allowedOrderability.calculated_amount) === 3000,
  "catalog orderability calculated the wrong amount.",
);

const replayedOrderability = await postGatewayData<OrderabilityResult>(
  customer.accessToken,
  "/runtime/catalog/orderability",
  {
    branchId,
    currencyCode: "NGN",
    idempotencyKey: idempotency("orderability-allowed"),
    itemId,
    metadata: { gate: "catalog_availability_lifecycle", replay: true, runId },
    quantity: 2,
    source,
    variantId,
  },
);
requireCondition(
  replayedOrderability.check_id === allowedOrderability.check_id,
  "catalog orderability idempotency did not replay.",
);

await postGatewayId(staff.accessToken, "/runtime/catalog/availability", {
  availabilityStatus: "out_of_stock",
  branchId,
  capacityLimit: 20,
  capacityUsed: 2,
  idempotencyKey: idempotency("configure-out-of-stock"),
  itemId,
  metadata: { gate: "catalog_availability_lifecycle", runId },
  reservedQuantity: 0,
  schedule: {},
  source,
  status: "active",
  stockQuantity: 0,
  variantId,
});

const rejectedOrderability = await postGatewayData<OrderabilityResult>(
  customer.accessToken,
  "/runtime/catalog/orderability",
  {
    branchId,
    currencyCode: "NGN",
    idempotencyKey: idempotency("orderability-rejected"),
    itemId,
    metadata: { gate: "catalog_availability_lifecycle", runId },
    quantity: 1,
    source,
    variantId,
  },
);
requireCondition(rejectedOrderability.allowed === false, "out-of-stock catalog item was allowed.");
requireCondition(
  String(rejectedOrderability.rejection_reason ?? "").includes("availability"),
  "out-of-stock rejection did not explain availability.",
);

await requireRuntimeReadRoutes(owner.accessToken, customer.accessToken, {
  availabilityId,
  categoryId,
  itemId,
  mediaLinkId,
  priceId,
  unitId,
  variantId,
});
await requireCatalogEvents(approvedBusiness.organizationId, {
  availabilityId,
  itemId,
  variantId,
});
await requireCatalogAuditEvidence({
  availabilityId,
  categoryId,
  itemId,
  mediaLinkId,
  orderabilityCheckId: allowedOrderability.check_id,
  priceId,
  stockAdjustmentId,
  unitId,
  variantId,
});
await requireCatalogEventAppendOnlyProtection(approvedBusiness.organizationId);

console.log("Catalog and availability lifecycle gate completed.");
console.log(`organization_id=${approvedBusiness.organizationId}`);
console.log(`branch_id=${branchId}`);
console.log(`item_id=${itemId}`);
console.log(`variant_id=${variantId}`);
console.log(`availability_rule_id=${availabilityId}`);
console.log(`orderability_check_id=${allowedOrderability.check_id}`);
console.log(`staff_invitation_id=${invitationId}`);

async function createBranch(
  actor: GateUser,
  organizationId: string,
  key: string,
  label: string,
): Promise<string> {
  return await postGatewayId(actor.accessToken, "/runtime/organization-branches", {
    address: {
      city: "Awka",
      country: "NG",
      line1: `${label} catalog gate branch address`,
    },
    branchKey: key,
    displayName: `${label} Catalog Gate Branch ${runKey}`,
    geoLocation: {
      latitude: 6.2104,
      longitude: 7.0741,
    },
    idempotencyKey: idempotency(`create-${label.toLowerCase()}-branch`),
    metadata: { gate: "catalog_availability_lifecycle", runId },
    organizationId,
    source,
    status: "active",
  });
}

async function createCatalogStaffRole(
  businessOwner: GateUser,
  organizationId: string,
  assignedBranchId: string,
): Promise<string> {
  return await postGatewayId(businessOwner.accessToken, "/runtime/organization-roles", {
    branchId: assignedBranchId,
    description: "Branch-scoped catalog operator role for the catalog lifecycle gate.",
    displayName: `Catalog Operator ${runKey}`,
    idempotencyKey: idempotency("configure-catalog-staff-role"),
    metadata: { gate: "catalog_availability_lifecycle", runId },
    organizationId,
    permissionKeys: ["business.catalog.manage"],
    roleKey: staffRoleKey,
    source,
  });
}

async function inviteAndAcceptCatalogStaff(
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
      idempotencyKey: idempotency("invite-catalog-staff"),
      invitedEmail: staffMember.email,
      membershipType: "member",
      metadata: { gate: "catalog_availability_lifecycle", runId },
      organizationId,
      roleKey: staffRoleKey,
      source,
    },
  );

  await postGatewayId(staffMember.accessToken, "/runtime/organization-invitations/accept", {
    idempotencyKey: idempotency("accept-catalog-staff-invitation"),
    invitationId,
    metadata: { gate: "catalog_availability_lifecycle", runId },
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
      phone: "+2348000000003",
    },
    organization: {
      displayName: `Catalog Gate Business ${runKey}`,
      legalName: `Catalog Gate Business ${runKey} Ltd`,
      partnerTypeKey: "partner.fulfillment.configured",
      slug: `catalog-gate-${runKey}`,
    },
    ownership: {
      ownerUserId: businessOwner.id,
    },
  };

  const applicationId = await postGatewayId(businessOwner.accessToken, "/runtime/applications", {
    applicationTypeKey: "application.business.default",
    idempotencyKey: idempotency("create-business-application"),
    metadata: { gate: "catalog_availability_lifecycle", runId },
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
        metadata: { gate: "catalog_availability_lifecycle", requirementKey, runId },
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
    metadata: { gate: "catalog_availability_lifecycle", runId },
  });

  await postGatewayId(platformAdmin.accessToken, "/runtime/applications/reviewer", {
    applicationId,
    idempotencyKey: idempotency("assign-business-reviewer"),
    metadata: { gate: "catalog_availability_lifecycle", runId },
    reviewerUserId: platformAdmin.userId,
  });

  for (const documentSubmissionId of documentSubmissionIds) {
    await postGatewayId(platformAdmin.accessToken, "/runtime/documents/review", {
      applicantMessage: "Document accepted.",
      decision: "approved",
      documentSubmissionId,
      idempotencyKey: idempotency(`approve-business-document-${documentSubmissionId}`),
      internalNotes: "Catalog availability gate document approval.",
      metadata: { gate: "catalog_availability_lifecycle", runId },
    });
  }

  await postGatewayId(platformAdmin.accessToken, "/runtime/applications/decisions", {
    applicationId,
    decision: "approved",
    idempotencyKey: idempotency("approve-business-application"),
    metadata: { gate: "catalog_availability_lifecycle", runId },
    reason: "Configured business requirements were satisfied.",
  });

  const applicationRecord = await requireSingle(
    serviceClient
      .from("application_records")
      .select("status,organization_id,activated_subject_type,activated_subject_id")
      .eq("id", applicationId)
      .single(),
    "read approved catalog-gate application",
  );

  requireCondition(
    applicationRecord.status === "approved",
    `catalog-gate application expected approved, found ${String(applicationRecord.status)}.`,
  );
  requireCondition(
    applicationRecord.activated_subject_type === "partner",
    "catalog-gate application did not activate a partner profile.",
  );

  return {
    applicationId,
    organizationId: requireStringValue(
      applicationRecord.organization_id,
      "catalog-gate organization id",
    ),
    partnerId: requireStringValue(
      applicationRecord.activated_subject_id,
      "catalog-gate partner id",
    ),
  };
}

async function createMediaAsset(organizationId: string, ownerUserId: string): Promise<string> {
  const mediaAsset = await requireSingle(
    serviceClient
      .from("media_assets")
      .insert({
        byte_size: 4096,
        checksum: `${runId}:catalog-media`,
        content_type: "image/webp",
        metadata: { gate: "catalog_availability_lifecycle", runId },
        organization_id: organizationId,
        owner_user_id: ownerUserId,
        status: "active",
        storage_bucket: "skima-platform-media",
        storage_path: `${ownerUserId}/${runId}/catalog-item.webp`,
      })
      .select("id")
      .single(),
    "create catalog media asset",
  );

  return requireStringValue(mediaAsset.id, "catalog media asset id");
}

async function requireDirectCatalogMutationsRejected(
  actor: GateUser,
  organizationId: string,
  assignedBranchId: string,
): Promise<void> {
  const itemAttempt = await actor.client.from("catalog_items").insert({
    branch_id: assignedBranchId,
    display_name: "Direct Catalog Item Should Fail",
    fulfillment_methods: ["delivery"],
    idempotency_key: idempotency("direct-catalog-item"),
    item_type: "product",
    key: `item.direct.${runKey}`,
    metadata: { gate: "catalog_availability_lifecycle", runId },
    min_quantity: 1,
    organization_id: organizationId,
    source,
    status: "active",
  });

  requireCondition(Boolean(itemAttempt.error), "direct catalog item insert was allowed.");

  const orderabilityAttempt = await actor.client.from("catalog_orderability_checks").insert({
    currency_code: "NGN",
    idempotency_key: idempotency("direct-orderability"),
    item_id: crypto.randomUUID(),
    organization_id: organizationId,
    quantity: 1,
    source,
    status: "allowed",
  });

  requireCondition(
    Boolean(orderabilityAttempt.error),
    "direct catalog orderability insert was allowed.",
  );
}

async function requireCatalogStaffAssignment(
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
    "read catalog staff membership",
  );

  requireCondition(
    membership.membership_type === "member" && membership.status === "active",
    "catalog staff membership was not activated.",
  );

  const assignedRole = await requireSingle(
    serviceClient
      .from("user_roles")
      .select("branch_id,status")
      .eq("organization_id", organizationId)
      .eq("user_id", staffUserId)
      .eq("role_id", assignedRoleId)
      .single(),
    "read catalog staff role assignment",
  );

  requireCondition(
    assignedRole.branch_id === assignedBranchId && assignedRole.status === "active",
    "catalog staff role was not active and branch-scoped.",
  );
}

async function requireRuntimeReadRoutes(
  ownerAccessToken: string,
  customerAccessToken: string,
  ids: {
    readonly availabilityId: string;
    readonly categoryId: string;
    readonly itemId: string;
    readonly mediaLinkId: string;
    readonly priceId: string;
    readonly unitId: string;
    readonly variantId: string;
  },
): Promise<void> {
  const units = await getGatewayRecords(ownerAccessToken, "/runtime/catalog/units");
  requireCondition(
    units.some((record) => record.id === ids.unitId),
    "catalog unit route missed unit.",
  );

  const categories = await getGatewayRecords(ownerAccessToken, "/runtime/catalog/categories");
  requireCondition(
    categories.some((record) => record.id === ids.categoryId),
    "catalog category route missed category.",
  );

  const items = await getGatewayRecords(customerAccessToken, "/runtime/catalog/items");
  requireCondition(
    items.some((record) => record.id === ids.itemId),
    "catalog item route missed active item.",
  );

  const variants = await getGatewayRecords(customerAccessToken, "/runtime/catalog/variants");
  requireCondition(
    variants.some((record) => record.id === ids.variantId),
    "catalog variant route missed active variant.",
  );

  const prices = await getGatewayRecords(customerAccessToken, "/runtime/catalog/prices");
  requireCondition(
    prices.some((record) => record.id === ids.priceId),
    "catalog price route missed active price.",
  );

  const media = await getGatewayRecords(customerAccessToken, "/runtime/catalog/media");
  requireCondition(
    media.some((record) => record.id === ids.mediaLinkId),
    "catalog media route missed active media link.",
  );

  const availability = await getGatewayRecords(
    customerAccessToken,
    "/runtime/catalog/availability",
  );
  requireCondition(
    availability.some((record) => record.id === ids.availabilityId),
    "catalog availability route missed active availability.",
  );
}

async function requireCatalogEvents(
  organizationId: string,
  ids: {
    readonly availabilityId: string;
    readonly itemId: string;
    readonly variantId: string;
  },
): Promise<void> {
  const { data, error } = await serviceClient
    .from("catalog_runtime_events")
    .select("event_type_key,item_id,variant_id,metadata")
    .eq("organization_id", organizationId);

  if (error) {
    throw error;
  }

  const eventKeys = new Set((data ?? []).map((event) => event.event_type_key));
  for (
    const eventKey of [
      "event.catalog.unit.configured",
      "event.catalog.category.configured",
      "event.catalog.item.configured",
      "event.catalog.variant.configured",
      "event.catalog.price.configured",
      "event.catalog.media.attached",
      "event.catalog.availability.configured",
      "event.catalog.stock.adjusted",
      "event.catalog.orderability.checked",
    ]
  ) {
    requireCondition(eventKeys.has(eventKey), `catalog runtime event is missing: ${eventKey}.`);
  }

  requireCondition(
    (data ?? []).some((event) => event.item_id === ids.itemId),
    "catalog item event evidence is missing.",
  );
  requireCondition(
    (data ?? []).some((event) => event.variant_id === ids.variantId),
    "catalog variant event evidence is missing.",
  );
  requireCondition(
    (data ?? []).some((event) =>
      typeof event.metadata === "object" &&
      event.metadata !== null &&
      (event.metadata as Record<string, unknown>).rejection_reason === null
    ),
    "catalog orderability allowed event evidence is missing.",
  );

  const availabilityRecord = await requireSingle(
    serviceClient
      .from("catalog_availability_rules")
      .select("id,item_id,variant_id")
      .eq("id", ids.availabilityId)
      .single(),
    "read catalog availability evidence",
  );
  requireCondition(
    availabilityRecord.item_id === ids.itemId && availabilityRecord.variant_id === ids.variantId,
    "catalog availability was not tied to the configured item and variant.",
  );
}

async function requireCatalogAuditEvidence(ids: {
  readonly availabilityId: string;
  readonly categoryId: string;
  readonly itemId: string;
  readonly mediaLinkId: string;
  readonly orderabilityCheckId: string;
  readonly priceId: string;
  readonly stockAdjustmentId: string;
  readonly unitId: string;
  readonly variantId: string;
}): Promise<void> {
  await requireAuditRecord("catalog_units", ids.unitId);
  await requireAuditRecord("catalog_categories", ids.categoryId);
  await requireAuditRecord("catalog_items", ids.itemId);
  await requireAuditRecord("catalog_item_variants", ids.variantId);
  await requireAuditRecord("catalog_prices", ids.priceId);
  await requireAuditRecord("catalog_item_media", ids.mediaLinkId);
  await requireAuditRecord("catalog_availability_rules", ids.availabilityId);
  await requireAuditRecord("catalog_stock_adjustments", ids.stockAdjustmentId);
  await requireAuditRecord("catalog_orderability_checks", ids.orderabilityCheckId);
}

async function requireCatalogEventAppendOnlyProtection(organizationId: string): Promise<void> {
  const eventRecord = await requireSingle(
    serviceClient
      .from("catalog_runtime_events")
      .select("id,metadata")
      .eq("organization_id", organizationId)
      .limit(1)
      .single(),
    "read catalog runtime event for append-only check",
  );

  const updateResult = await serviceClient
    .from("catalog_runtime_events")
    .update({ metadata: { should_not_update: true } })
    .eq("id", eventRecord.id);
  requireCondition(Boolean(updateResult.error), "catalog runtime event direct update was allowed.");

  const deleteResult = await serviceClient
    .from("catalog_runtime_events")
    .delete()
    .eq("id", eventRecord.id);
  requireCondition(Boolean(deleteResult.error), "catalog runtime event direct delete was allowed.");
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

async function postGatewayData<T>(
  accessToken: string,
  path: string,
  payload: Record<string, unknown>,
): Promise<T> {
  const body = await postGateway(accessToken, path, payload);

  if (!body.data || typeof body.data !== "object" || Array.isArray(body.data)) {
    throw new Error(`${path} did not return a data object.`);
  }

  return body.data as T;
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
  const email = `skima-catalog-support-admin-${runId}@example.invalid`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: {
      gate: "catalog_availability_lifecycle",
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
      display_name: "Catalog Availability Gate Support Admin",
      id: data.user.id,
      metadata: { gate: "catalog_availability_lifecycle", runId },
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
      metadata: { gate: "catalog_availability_lifecycle", runId },
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
      gate: "catalog_availability_lifecycle",
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
      display_name: `Catalog Availability Gate ${kind}`,
      id: data.user.id,
      metadata: { gate: "catalog_availability_lifecycle", runId },
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
