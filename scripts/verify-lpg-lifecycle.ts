import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.9";

import { resolveSupabaseRuntime } from "./supabase-runtime.ts";

interface GateUser {
  readonly accessToken: string;
  readonly client: SupabaseClient;
  readonly email: string;
  readonly id: string;
}

interface GateStation {
  readonly organizationId: string;
  readonly stationBranchId: string;
}

const runtime = await resolveSupabaseRuntime({ anonKey: true, serviceRoleKey: true });
const supabaseUrl = runtime.supabaseUrl;
const anonKey = runtime.anonKey!;
const serviceRoleKey = runtime.serviceRoleKey!;
const workerSecret = requireEnv("SKIMA_WORKER_SECRET");
const paymentWebhookSecret = Deno.env.get("SKIMA_PAYMENT_WEBHOOK_SECRET") ?? workerSecret;
const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

const runId = crypto.randomUUID();
const runKey = runId.replaceAll("-", "").slice(0, 12);
const source = "skima.lpg_lifecycle_gate";
const latitudeSeed = Number.parseInt(runKey.slice(0, 6), 16) / 0xffffff;
const longitudeSeed = Number.parseInt(runKey.slice(6, 12), 16) / 0xffffff;
const pickupLatitude = -60 + latitudeSeed * 120;
const pickupLongitude = -170 + longitudeSeed * 340;
const deliveryLatitude = pickupLatitude + 0.002;
const deliveryLongitude = pickupLongitude + 0.002;
const stationLatitude = pickupLatitude + 0.001;
const stationLongitude = pickupLongitude + 0.001;
const wrongStationLatitude = pickupLatitude + 0.01;
const wrongStationLongitude = pickupLongitude + 0.01;

console.log(`Running LPG lifecycle gate ${runId}...`);

const customer = await createGateUser("lpg-lifecycle-customer");
const stationOwner = await createGateUser("lpg-lifecycle-station-owner");
const stationStaff = await createGateUser("lpg-lifecycle-station-staff");
const wrongStationOwner = await createGateUser("lpg-lifecycle-wrong-station");
const driver = await createGateUser("lpg-lifecycle-driver");
const outsider = await createGateUser("lpg-lifecycle-outsider");
const admin = await createPlatformLpgAdmin();

const configBody = await getGateway(admin.accessToken, "/lpg/config");
const config = requireRecordValue(configBody.data, "LPG config");
const cylinderProfiles = requireArrayValue(config.cylinderTypeProfiles, "cylinder type profiles");
requireCondition(cylinderProfiles.length > 0, "LPG cylinder type profiles were not returned.");
mark("config and actors ready");

await postGateway(admin.accessToken, "/lpg/maps/autocomplete", {
  idempotencyKey: idempotency("maps-autocomplete"),
  input: "LPG station lifecycle gate",
});

const station = await setupStationForUser(stationOwner, "primary", stationLatitude, stationLongitude, 20);
const wrongStation = await setupStationForUser(
  wrongStationOwner,
  "wrong",
  wrongStationLatitude,
  wrongStationLongitude,
  1,
);
await requireRpcId(
  serviceClient.rpc("assign_lpg_station_role", {
    target_idempotency_key: idempotency("station-staff-pump-role"),
    target_metadata: { gate: "lpg_lifecycle", runId },
    target_preset_key: "lpg.station.pump",
    target_station_branch_id: station.stationBranchId,
    target_user_id: stationStaff.id,
  }),
  "assign station staff pump role",
);
mark("stations and staff ready");

const { driverProfileId, vehicleId } = await setupDriver(driver);
await postGatewayId(driver.accessToken, "/lpg/driver-locations", {
  driverProfileId,
  idempotencyKey: idempotency("driver-location-stale"),
  latitude: pickupLatitude,
  longitude: pickupLongitude,
  metadata: { gate: "lpg_lifecycle", stale: true, runId },
  onlineStatus: "online",
  recordedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
  source,
});
mark("driver seeded with stale location");

const mediaBody = await postGateway(customer.accessToken, "/runtime/media/assets", {
  assetTypeKey: "media.lpg.cylinder_image",
  byteSize: 128,
  contentType: "image/jpeg",
  idempotencyKey: idempotency("media-cylinder"),
  metadata: { gate: "lpg_lifecycle", runId },
  source,
  storageBucket: "skima-platform-media",
  storagePath: `${customer.id}/${runKey}/cylinder.jpg`,
});
const cylinderMediaAssetId = requireStringValue(mediaBody.id, "cylinder media asset id");
const mediaReplayBody = await postGateway(customer.accessToken, "/runtime/media/assets", {
  assetTypeKey: "media.lpg.cylinder_image",
  byteSize: 128,
  contentType: "image/jpeg",
  idempotencyKey: idempotency("media-cylinder"),
  metadata: { gate: "lpg_lifecycle", replay: true, runId },
  source,
  storageBucket: "skima-platform-media",
  storagePath: `${customer.id}/${runKey}/cylinder.jpg`,
});
requireCondition(mediaReplayBody.id === cylinderMediaAssetId, "media idempotency replay changed id.");

const cylinderPayload = {
  conditionStatus: "good",
  cylinderIdentifier: `lpg-lifecycle-${runKey}`,
  idempotencyKey: idempotency("cylinder"),
  imageAssetIds: [cylinderMediaAssetId],
  maxCapacityKg: 12.5,
  metadata: {
    gate: "lpg_lifecycle",
    ownershipProofMediaAssetId: cylinderMediaAssetId,
    runId,
  },
  sizeKg: 12.5,
  source,
};
const cylinderBody = await postGateway(customer.accessToken, "/lpg/cylinders", cylinderPayload);
const cylinderId = requireStringValue(cylinderBody.id, "cylinder id");
const cylinderPublicReference = requireStringValue(
  cylinderBody.publicReference,
  "cylinder public reference",
);
const cylinderReplayBody = await postGateway(customer.accessToken, "/lpg/cylinders", cylinderPayload);
requireCondition(cylinderReplayBody.id === cylinderId, "cylinder idempotency replay changed id.");

const unsafeCylinderBody = await postGateway(customer.accessToken, "/lpg/cylinders", {
  conditionStatus: "unsafe",
  cylinderIdentifier: `lpg-lifecycle-unsafe-${runKey}`,
  idempotencyKey: idempotency("unsafe-cylinder"),
  imageAssetIds: [cylinderMediaAssetId],
  maxCapacityKg: 12.5,
  metadata: {
    gate: "lpg_lifecycle",
    ownershipProofMediaAssetId: cylinderMediaAssetId,
    runId,
  },
  sizeKg: 12.5,
  source,
});
const unsafeCylinderId = requireStringValue(unsafeCylinderBody.id, "unsafe cylinder id");
mark("media and cylinders ready");

const pickupLocationId = await postGatewayId(customer.accessToken, "/lpg/locations", {
  contactName: "LPG Lifecycle Gate",
  contactPhone: `+234800${runKey.slice(0, 7).replaceAll(/[a-f]/g, "1")}`,
  formattedAddress: "LPG lifecycle gate pickup address",
  idempotencyKey: idempotency("pickup-location"),
  label: "Pickup",
  latitude: pickupLatitude,
  longitude: pickupLongitude,
  metadata: { gate: "lpg_lifecycle", runId },
  source,
});
const deliveryLocationId = await postGatewayId(customer.accessToken, "/lpg/locations", {
  contactName: "LPG Lifecycle Gate",
  contactPhone: `+234801${runKey.slice(0, 7).replaceAll(/[a-f]/g, "1")}`,
  formattedAddress: "LPG lifecycle gate delivery address",
  idempotencyKey: idempotency("delivery-location"),
  label: "Delivery",
  latitude: deliveryLatitude,
  longitude: deliveryLongitude,
  metadata: { gate: "lpg_lifecycle", runId },
  source,
});
mark("customer locations ready");

await requireGatewayError(customer.accessToken, "/lpg/quotes", {
  cylinderId,
  deliveryLocationId,
  idempotencyKey: idempotency("insufficient-capacity-quote"),
  metadata: { gate: "lpg_lifecycle", runId },
  pickupLocationId,
  requestedKg: 12,
  source,
  stationBranchId: wrongStation.stationBranchId,
}, "sufficient capacity");

await requireGatewayError(customer.accessToken, "/lpg/quotes", {
  cylinderId: unsafeCylinderId,
  deliveryLocationId,
  idempotencyKey: idempotency("unsafe-cylinder-quote"),
  metadata: { gate: "lpg_lifecycle", runId },
  pickupLocationId,
  requestedKg: 2,
  source,
  stationBranchId: station.stationBranchId,
}, "cylinder is not eligible");

const quotePayload = {
  cylinderId,
  deliveryLocationId,
  idempotencyKey: idempotency("quote"),
  metadata: { gate: "lpg_lifecycle", runId },
  pickupLocationId,
  requestedKg: 2,
  source,
  stationBranchId: station.stationBranchId,
};
const quoteBody = await postGateway(customer.accessToken, "/lpg/quotes", quotePayload);
const lpgRefillQuoteId = requireStringValue(quoteBody.id, "LPG quote id");
const quoteReplayBody = await postGateway(customer.accessToken, "/lpg/quotes", quotePayload);
requireCondition(quoteReplayBody.id === lpgRefillQuoteId, "quote idempotency replay changed id.");
mark("quote ready");

const orderPayload = {
  idempotencyKey: idempotency("order"),
  lpgRefillQuoteId,
  metadata: { gate: "lpg_lifecycle", runId },
  source,
};
const orderBody = await postGateway(customer.accessToken, "/lpg/orders", orderPayload);
const lpgOrderId = requireStringValue(orderBody.id, "LPG order id");
const orderPublicReference = requireStringValue(
  orderBody.publicReference,
  "LPG order public reference",
);
const orderReplayBody = await postGateway(customer.accessToken, "/lpg/orders", orderPayload);
requireCondition(orderReplayBody.id === lpgOrderId, "order idempotency replay changed id.");
mark("order ready");

await requireGatewayError(outsider.accessToken, "/lpg/orders/reserve-payment", {
  idempotencyKey: idempotency("outsider-reserve"),
  lpgOrderId,
  metadata: { gate: "lpg_lifecycle", runId },
  source,
}, "target_actor_user_id must match LPG order customer");

const orderBeforePayment = await requireSingle(
  serviceClient
    .from("lpg_refill_orders")
    .select("service_request_id,total_amount,currency_code")
    .eq("id", lpgOrderId)
    .single(),
  "read LPG order before payment",
);
const orderTotalAmount = requireNumberValue(orderBeforePayment.total_amount, "order total amount");
const currencyCode = requireStringValue(orderBeforePayment.currency_code, "currency code");

const depositBody = await postGateway(customer.accessToken, "/runtime/payments/deposits", {
  amount: orderTotalAmount,
  currencyCode,
  idempotencyKey: idempotency("deposit"),
  metadata: { gate: "lpg_lifecycle", lpgOrderId, runId },
  source,
});
const depositRequestId = requireStringValue(depositBody.id, "deposit request id");
const depositRecord = await requireSingle(
  serviceClient
    .from("payment_deposit_requests")
    .select("wallet_id,provider_reference")
    .eq("id", depositRequestId)
    .single(),
  "read initialized deposit",
);
const customerWalletId = requireStringValue(depositRecord.wallet_id, "customer wallet id");
await postPaymentWebhook({
  depositRequestId,
  idempotencyKey: idempotency("deposit-webhook"),
  providerReference: requireStringValue(depositRecord.provider_reference, "provider reference"),
  providerStatus: "succeeded",
  status: "succeeded",
});

const reservationPayload = {
  customerWalletId,
  idempotencyKey: idempotency("reserve-payment"),
  lpgOrderId,
  metadata: { gate: "lpg_lifecycle", runId },
  source,
};
const reservationBody = await postGateway(customer.accessToken, "/lpg/orders/reserve-payment", reservationPayload);
const reservationData = requireRecordValue(reservationBody.data, "reservation data");
const escrowHoldId = requireStringValue(reservationData.escrowHoldId, "escrow hold id");
const reservationReplayBody = await postGateway(
  customer.accessToken,
  "/lpg/orders/reserve-payment",
  reservationPayload,
);
requireCondition(reservationReplayBody.id === lpgOrderId, "reservation replay changed order id.");
mark("payment reserved");

await requireGatewayError(admin.accessToken, "/lpg/orders/dispatch", {
  candidateLimit: 5,
  idempotencyKey: idempotency("dispatch-stale"),
  lpgOrderId,
  source,
}, "no fresh eligible LPG driver location");
mark("stale dispatch rejected");

await postGatewayId(driver.accessToken, "/lpg/driver-locations", {
  driverProfileId,
  idempotencyKey: idempotency("driver-location-fresh"),
  latitude: pickupLatitude,
  longitude: pickupLongitude,
  metadata: { gate: "lpg_lifecycle", runId },
  onlineStatus: "online",
  source,
});

const dispatchPayload = {
  candidateLimit: 5,
  idempotencyKey: idempotency("dispatch"),
  lpgOrderId,
  source,
};
const dispatchRequestId = await postGatewayId(admin.accessToken, "/lpg/orders/dispatch", dispatchPayload);
const dispatchReplayId = await postGatewayId(admin.accessToken, "/lpg/orders/dispatch", dispatchPayload);
requireCondition(dispatchReplayId === dispatchRequestId, "dispatch idempotency replay changed id.");
await requireOrderState(lpgOrderId, "driver_offered");
await requireCapacityReservation(lpgOrderId, station.stationBranchId);
await requireDirectCapacityMutationRejected(customer, lpgOrderId, station.stationBranchId);
mark("driver offered and capacity reserved");

const acceptancePayload = {
  idempotencyKey: idempotency("driver-accept"),
  lpgOrderId,
  metadata: { gate: "lpg_lifecycle", runId },
  source,
};
await postGatewayId(driver.accessToken, "/lpg/orders/accept-assignment", acceptancePayload);
await postGatewayId(driver.accessToken, "/lpg/orders/accept-assignment", acceptancePayload);
await requireOrderState(lpgOrderId, "driver_accepted");
mark("driver accepted");

await postGatewayId(driver.accessToken, "/lpg/driver-locations", {
  driverProfileId,
  idempotencyKey: idempotency("driver-location-active-order"),
  latitude: pickupLatitude,
  longitude: pickupLongitude,
  lpgOrderId,
  metadata: { gate: "lpg_lifecycle", activeOrder: true, runId },
  onlineStatus: "online",
  source,
});
await requireTrackingPoint(lpgOrderId);
mark("tracking active");

await postGatewayId(driver.accessToken, "/lpg/orders/actions", {
  actionKey: "lpg.pickup.start",
  idempotencyKey: idempotency("action-pickup-start"),
  lpgOrderId,
  payload: { gate: "lpg_lifecycle", runId },
  source,
});
await requireGatewayError(outsider.accessToken, "/lpg/scans", {
  idempotencyKey: idempotency("wrong-pickup-scan"),
  lpgOrderId,
  payload: { gate: "lpg_lifecycle", runId },
  scanType: "customer_pickup",
  source,
}, "LPG order access permission");

const pickupScanBody = await postGateway(driver.accessToken, "/lpg/scans", {
  idempotencyKey: idempotency("scan-pickup"),
  latitude: pickupLatitude,
  longitude: pickupLongitude,
  lpgOrderId,
  payload: { gate: "lpg_lifecycle", runId },
  scanType: "customer_pickup",
  source,
});
const pickupScanPublicReference = requireStringValue(
  pickupScanBody.publicReference,
  "pickup scan public reference",
);
await postGateway(driver.accessToken, "/lpg/scans", {
  idempotencyKey: idempotency("scan-pickup"),
  latitude: pickupLatitude,
  longitude: pickupLongitude,
  lpgOrderId,
  payload: { gate: "lpg_lifecycle", runId },
  scanType: "customer_pickup",
  source,
});
mark("pickup verified");

await postGatewayId(driver.accessToken, "/lpg/orders/actions", {
  actionKey: "lpg.station.start",
  idempotencyKey: idempotency("action-station-start"),
  lpgOrderId,
  payload: { gate: "lpg_lifecycle", runId },
  source,
});
await requireGatewayError(wrongStationOwner.accessToken, "/lpg/scans", {
  idempotencyKey: idempotency("wrong-station-receipt"),
  lpgOrderId,
  payload: { gate: "lpg_lifecycle", runId },
  scanType: "station_receipt",
  source,
}, "LPG order access permission");
await requireGatewayError(driver.accessToken, "/lpg/scans", {
  idempotencyKey: idempotency("driver-station-receipt"),
  lpgOrderId,
  payload: { gate: "lpg_lifecycle", runId },
  scanType: "station_receipt",
  source,
}, "branch-scoped LPG scanner permission");

await postGateway(stationStaff.accessToken, "/lpg/scans", {
  idempotencyKey: idempotency("scan-station-receipt"),
  latitude: stationLatitude,
  longitude: stationLongitude,
  lpgOrderId,
  payload: { gate: "lpg_lifecycle", runId },
  scanType: "station_receipt",
  source,
});
mark("station receipt verified");
await postGatewayId(stationStaff.accessToken, "/lpg/inspections", {
  evidenceMediaAssetIds: [cylinderMediaAssetId],
  idempotencyKey: idempotency("inspection-safe"),
  lpgOrderId,
  observations: { gate: "lpg_lifecycle", result: "safe", runId },
  result: "safe",
  source,
});

await postGatewayId(stationStaff.accessToken, "/lpg/orders/actions", {
  actionKey: "lpg.refill.start",
  idempotencyKey: idempotency("action-refill-start"),
  lpgOrderId,
  payload: { gate: "lpg_lifecycle", runId },
  source,
});
await requireGatewayError(stationStaff.accessToken, "/lpg/refills/confirm", {
  actualKg: 2.5,
  idempotencyKey: idempotency("refill-overfill-negative"),
  lpgOrderId,
  safetyObservations: { gate: "lpg_lifecycle", runId },
  source,
}, "overfill");

const refillPayload = {
  actualKg: 1.5,
  idempotencyKey: idempotency("refill-confirm"),
  lpgOrderId,
  safetyObservations: { gate: "lpg_lifecycle", result: "safe", runId },
  source,
};
const refillId = await postGatewayId(stationStaff.accessToken, "/lpg/refills/confirm", refillPayload);
const refillReplayId = await postGatewayId(stationStaff.accessToken, "/lpg/refills/confirm", refillPayload);
requireCondition(refillReplayId === refillId, "refill idempotency replay changed id.");
mark("refill confirmed");

const settlementExecutionId = await postGatewayId(stationOwner.accessToken, "/lpg/orders/settle-station", {
  idempotencyKey: idempotency("station-settlement"),
  lpgOrderId,
  metadata: { gate: "lpg_lifecycle", runId },
  source,
});
await requireOrderState(lpgOrderId, "station_settled");
mark("station settled");

await postGateway(stationStaff.accessToken, "/lpg/scans", {
  idempotencyKey: idempotency("scan-station-release"),
  latitude: stationLatitude,
  longitude: stationLongitude,
  lpgOrderId,
  payload: { gate: "lpg_lifecycle", runId },
  scanType: "station_release",
  source,
});
await postGatewayId(driver.accessToken, "/lpg/orders/actions", {
  actionKey: "lpg.delivery.pending",
  idempotencyKey: idempotency("action-delivery-pending"),
  lpgOrderId,
  payload: { gate: "lpg_lifecycle", runId },
  source,
});

const challengeId = await postGatewayId(customer.accessToken, "/lpg/orders/delivery-challenge", {
  action: "request",
  channel: "in_app",
  idempotencyKey: idempotency("delivery-challenge"),
  lpgOrderId,
  metadata: { gate: "lpg_lifecycle", runId },
  recipientAddress: customer.email,
  source,
});
const otpCode = await fetchInAppOtpCode(customer.accessToken, challengeId);
await postGatewayId(customer.accessToken, "/lpg/orders/delivery-challenge", {
  action: "verify",
  challengeId,
  code: otpCode,
  idempotencyKey: idempotency("delivery-challenge-verify"),
  lpgOrderId,
  metadata: { gate: "lpg_lifecycle", runId },
});
mark("delivery challenge verified");

const deliveryScanBody = await postGateway(driver.accessToken, "/lpg/scans", {
  idempotencyKey: idempotency("scan-delivery"),
  latitude: deliveryLatitude,
  longitude: deliveryLongitude,
  lpgOrderId,
  payload: { deliveryChallengeId: challengeId, gate: "lpg_lifecycle", runId },
  scanType: "customer_delivery",
  source,
});
const deliveryScanPublicReference = requireStringValue(
  deliveryScanBody.publicReference,
  "delivery scan public reference",
);
await requireOrderState(lpgOrderId, "delivered");
mark("delivery verified");

const commissionExecutionId = await postGatewayId(driver.accessToken, "/lpg/orders/execute-driver-commission", {
  idempotencyKey: idempotency("driver-commission"),
  lpgOrderId,
  metadata: { gate: "lpg_lifecycle", runId },
  source,
});
await requireOrderState(lpgOrderId, "completed");

const financialSummaryBody = await getGateway(
  customer.accessToken,
  `/lpg/orders/financial-summary?lpgOrderId=${encodeURIComponent(lpgOrderId)}`,
);
const financialSummary = requireRecordValue(financialSummaryBody.data, "financial summary");
requireCondition(financialSummary.balanced === true, "LPG order financial summary is not balanced.");
requireCondition(
  Number(financialSummary.refund_total) > 0,
  "underfill refund was not reflected in reconciliation.",
);

await invokeRuntimeWorker();
await requireLpgNotifications(lpgOrderId);
mark("worker and notifications verified");

const finalOrder = await requireSingle(
  serviceClient
    .from("lpg_refill_orders")
    .select(
      "order_record_id,station_settlement_statement_id,driver_commission_execution_id,underfill_refund_transaction_id,status",
    )
    .eq("id", lpgOrderId)
    .single(),
  "read final LPG order",
);
requireCondition(finalOrder.status === "completed", "final LPG order was not completed.");
requireCondition(finalOrder.order_record_id !== null, "LPG order was not projected to order_records.");
requireCondition(
  finalOrder.driver_commission_execution_id === commissionExecutionId,
  "driver commission id was not stored on LPG order.",
);

const statementId = requireStringValue(
  finalOrder.station_settlement_statement_id,
  "settlement statement id",
);
const statementRecord = await requireSingle(
  serviceClient
    .from("settlement_statements")
    .select("public_reference")
    .eq("id", statementId)
    .single(),
  "read settlement statement reference",
);
const settlementPublicReference = requireStringValue(
  statementRecord.public_reference,
  "settlement public reference",
);

console.log("LPG lifecycle gate completed.");
console.log(`lpg_order_id=${lpgOrderId}`);
console.log(`lpg_order_public_reference=${orderPublicReference}`);
console.log(`cylinder_public_reference=${cylinderPublicReference}`);
console.log(`pickup_scan_public_reference=${pickupScanPublicReference}`);
console.log(`delivery_scan_public_reference=${deliveryScanPublicReference}`);
console.log(`escrow_hold_id=${escrowHoldId}`);
console.log(`station_settlement_execution_id=${settlementExecutionId}`);
console.log(`settlement_public_reference=${settlementPublicReference}`);
console.log(`driver_commission_execution_id=${commissionExecutionId}`);
console.log(`vehicle_id=${vehicleId}`);

async function createGateUser(kind: string): Promise<GateUser> {
  const email = `skima-${kind}-${runId}@example.invalid`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { gate: "lpg_lifecycle", kind, runId },
  });

  if (error) {
    throw error;
  }

  if (!data.user?.id) {
    throw new Error(`Supabase Auth did not create ${kind} user.`);
  }

  await requireMutation(
    serviceClient.from("profiles").upsert({
      display_name: `LPG Lifecycle Gate ${kind}`,
      id: data.user.id,
      metadata: { gate: "lpg_lifecycle", runId },
      status: "active",
    }),
    `upsert ${kind} profile`,
  );

  const browserClient = createBrowserSafeClient();
  const signIn = await browserClient.auth.signInWithPassword({ email, password });

  if (signIn.error) {
    throw signIn.error;
  }

  if (!signIn.data.session?.access_token) {
    throw new Error(`Supabase Auth did not return an access token for ${kind}.`);
  }

  return {
    accessToken: signIn.data.session.access_token,
    client: createAuthenticatedClient(signIn.data.session.access_token),
    email,
    id: data.user.id,
  };
}

async function createPlatformLpgAdmin(): Promise<GateUser> {
  const user = await createGateUser("lpg-lifecycle-admin");
  const roleRecord = await requireSingle(
    serviceClient
      .from("roles")
      .select("id")
      .eq("key", "platform.lpg_operations_admin")
      .is("organization_id", null)
      .eq("status", "active")
      .single(),
    "read LPG operations admin role",
  );

  await requireMutation(
    serviceClient.from("platform_admins").upsert({
      admin_kind: "role_admin",
      metadata: { gate: "lpg_lifecycle", runId },
      primary_role_id: roleRecord.id,
      status: "active",
      title: "LPG Lifecycle Gate Admin",
      user_id: user.id,
    }, { onConflict: "user_id" }),
    "configure LPG operations admin",
  );

  await requireMutation(
    serviceClient.from("user_roles").insert({
      organization_id: null,
      role_id: roleRecord.id,
      status: "active",
      user_id: user.id,
    }),
    "assign LPG operations admin role",
  );

  return user;
}

async function setupStationForUser(
  owner: GateUser,
  label: string,
  latitude: number,
  longitude: number,
  capacityKg: number,
): Promise<GateStation> {
  const organizationId = await createGateOrganization(owner.id, label);
  const roleId = await requireRpcId(
    serviceClient.rpc("configure_organization_role", {
      target_branch_id: null,
      target_description: "Bootstrap role for LPG lifecycle gate station activation.",
      target_display_name: `LPG Lifecycle Bootstrap ${label}`,
      target_idempotency_key: idempotency(`station-${label}-bootstrap-role`),
      target_metadata: { gate: "lpg_lifecycle", runId },
      target_organization_id: organizationId,
      target_permission_keys: [
        "business.staff.manage",
        "lpg.config.read",
        "lpg.orders.finance",
        "lpg.orders.manage",
        "lpg.orders.read",
        "lpg.stations.manage",
        "lpg.stations.pump",
        "lpg.stations.read",
        "lpg.stations.scan",
      ],
      target_role_key: `lpg.lifecycle.${label}.bootstrap`,
      target_source: source,
    }),
    `configure ${label} bootstrap station role`,
  );

  await requireMutation(
    serviceClient.from("organization_memberships").upsert({
      membership_type: "owner",
      metadata: { gate: "lpg_lifecycle", runId },
      organization_id: organizationId,
      status: "active",
      user_id: owner.id,
    }, { onConflict: "organization_id,user_id" }),
    `assign ${label} owner membership`,
  );

  await requireMutation(
    serviceClient.from("user_roles").insert({
      organization_id: organizationId,
      role_id: roleId,
      status: "active",
      user_id: owner.id,
    }),
    `assign ${label} owner bootstrap role`,
  );

  const stationBranchId = await postGatewayId(owner.accessToken, "/lpg/stations/activate", {
    currentAvailableKg: capacityKg,
    displayName: `LPG Lifecycle ${label} ${runKey}`,
    formattedAddress: `LPG lifecycle ${label} station address`,
    idempotencyKey: idempotency(`station-${label}-activate`),
    latitude,
    longitude,
    metadata: { gate: "lpg_lifecycle", label, runId },
    operatingHours: { mode: "gate" },
    organizationId,
    ownerUserId: owner.id,
    refillCapacityKg: capacityKg,
    serviceRadiusMeters: 10000,
    source,
    supportedCylinderSizesKg: [12.5, 25, 50],
  });

  return { organizationId, stationBranchId };
}

async function createGateOrganization(ownerUserId: string, label: string): Promise<string> {
  const { data, error } = await serviceClient
    .from("organizations")
    .insert({
      display_name: `LPG Lifecycle ${label} ${runKey}`,
      legal_name: `LPG Lifecycle ${label} ${runKey} Ltd`,
      metadata: { gate: "lpg_lifecycle", ownerUserId, runId },
      slug: `lpg-life-${label}-${runKey}`,
      status: "active",
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  const organizationId = requireStringValue(data.id, "organization id");

  await requireMutation(
    serviceClient.from("partner_profiles").upsert({
      behavior_config: { gate: "lpg_lifecycle" },
      metadata: { gate: "lpg_lifecycle", runId },
      organization_id: organizationId,
      partner_type_key: "partner.lpg.station",
      status: "active",
    }, { onConflict: "organization_id" }),
    "upsert station partner profile",
  );

  return organizationId;
}

async function setupDriver(user: GateUser): Promise<{
  readonly driverProfileId: string;
  readonly vehicleId: string;
}> {
  const driverRecord = await requireSingle(
    serviceClient
      .from("driver_profiles")
      .insert({
        metadata: { gate: "lpg_lifecycle", runId },
        operational_status: "available",
        user_id: user.id,
        verification_status: "approved",
      })
      .select("id")
      .single(),
    "create LPG lifecycle driver profile",
  );
  const driverProfileId = requireStringValue(driverRecord.id, "driver profile id");

  const vehicleType = await requireSingle(
    serviceClient.from("vehicle_types").select("id").eq("key", "vehicle.motorcycle").single(),
    "read motorcycle vehicle type",
  );
  const vehicleRecord = await requireSingle(
    serviceClient
      .from("vehicles")
      .insert({
        capacity_profile: { maxLoadKg: 50 },
        color: "white",
        manufacturer: "Configured",
        max_load_kg: 50,
        metadata: { gate: "lpg_lifecycle", runId },
        model: "Lifecycle LPG Motorcycle",
        model_year: 2026,
        owner_user_id: user.id,
        ownership_type: "driver_owned",
        registration_number: `LPG-${runKey.toUpperCase()}`,
        status: "active",
        vehicle_type_id: vehicleType.id,
      })
      .select("id")
      .single(),
    "create LPG lifecycle vehicle",
  );
  const vehicleId = requireStringValue(vehicleRecord.id, "vehicle id");

  await requireMutation(
    serviceClient.from("driver_vehicle_links").insert({
      driver_profile_id: driverProfileId,
      metadata: { gate: "lpg_lifecycle", runId },
      relationship_type: "driver_owned",
      status: "active",
      vehicle_id: vehicleId,
    }),
    "link lifecycle driver vehicle",
  );

  await requireMutation(
    serviceClient.from("entity_capabilities").upsert([
      {
        capability_key: "capability.driver.cylinder-handling",
        constraints: { gate: "lpg_lifecycle", runId },
        entity_id: driverProfileId,
        entity_type: "driver",
        status: "active",
        verified_at: new Date().toISOString(),
      },
      {
        capability_key: "capability.cargo.pressurized-cylinder",
        constraints: { gate: "lpg_lifecycle", runId },
        entity_id: vehicleId,
        entity_type: "vehicle",
        status: "active",
        verified_at: new Date().toISOString(),
      },
    ], { onConflict: "entity_type,entity_id,capability_key" }),
    "assign LPG driver and vehicle capabilities",
  );

  return { driverProfileId, vehicleId };
}

async function postPaymentWebhook(payload: Record<string, unknown>): Promise<void> {
  const response = await fetch(`${supabaseUrl}/functions/v1/payment-webhook`, {
    body: JSON.stringify({ ...payload, source }),
    headers: {
      "Content-Type": "application/json",
      "x-skima-webhook-secret": paymentWebhookSecret,
    },
    method: "POST",
  });
  const body = await readJson(response);

  if (!response.ok || body.ok !== true) {
    throw new Error(
      `payment-webhook returned HTTP ${response.status}: ${String(body.message ?? body.error)}`,
    );
  }
}

async function invokeRuntimeWorker(): Promise<void> {
  const response = await fetch(`${supabaseUrl}/functions/v1/runtime-worker`, {
    body: JSON.stringify({ limit: 100 }),
    headers: {
      "Content-Type": "application/json",
      "x-skima-worker-secret": workerSecret,
    },
    method: "POST",
  });
  const body = await readJson(response);

  if (!response.ok || body.ok !== true) {
    throw new Error(
      `runtime-worker returned HTTP ${response.status}: ${String(body.message ?? body.error)}`,
    );
  }
}

async function fetchInAppOtpCode(accessToken: string, challengeId: string): Promise<string> {
  const body = await postGateway(accessToken, "/runtime/otp/delivery", {
    challengeId,
    idempotencyKey: idempotency(`fetch-otp-${challengeId}`),
  });
  const data = requireRecordValue(body.data, "OTP delivery data");

  return requireStringValue(data.code, "OTP code");
}

async function requireOrderState(lpgOrderId: string, expectedStatus: string): Promise<void> {
  const order = await requireSingle(
    serviceClient
      .from("lpg_refill_orders")
      .select("status")
      .eq("id", lpgOrderId)
      .single(),
    `read LPG order status ${expectedStatus}`,
  );

  requireCondition(
    order.status === expectedStatus,
    `LPG order expected status ${expectedStatus}, found ${String(order.status)}.`,
  );
}

async function requireCapacityReservation(
  lpgOrderId: string,
  stationBranchId: string,
): Promise<void> {
  const reservation = await requireSingle(
    serviceClient
      .from("lpg_station_capacity_reservations")
      .select("station_branch_id,status,reserved_kg")
      .eq("lpg_order_id", lpgOrderId)
      .single(),
    "read LPG station capacity reservation",
  );
  requireCondition(
    reservation.station_branch_id === stationBranchId,
    "capacity reservation station branch was incorrect.",
  );
  requireCondition(reservation.status === "reserved", "capacity reservation was not reserved.");
  requireCondition(
    requireNumberValue(reservation.reserved_kg, "reserved kg") === 2,
    "capacity reservation kg was incorrect.",
  );
}

async function requireDirectCapacityMutationRejected(
  user: GateUser,
  lpgOrderId: string,
  stationBranchId: string,
): Promise<void> {
  const result = await user.client.from("lpg_station_capacity_reservations").insert({
    idempotency_key: idempotency("direct-capacity-mutation"),
    lpg_order_id: lpgOrderId,
    requested_kg: 1,
    reserved_kg: 1,
    source,
    station_branch_id: stationBranchId,
  });

  requireCondition(Boolean(result.error), "direct capacity reservation mutation was allowed.");
}

async function requireTrackingPoint(lpgOrderId: string): Promise<void> {
  const order = await requireSingle(
    serviceClient
      .from("lpg_refill_orders")
      .select("tracking_session_id")
      .eq("id", lpgOrderId)
      .single(),
    "read LPG tracking session",
  );
  const trackingSessionId = requireStringValue(order.tracking_session_id, "tracking session id");
  const point = await requireSingle(
    serviceClient
      .from("tracking_points")
      .select("id")
      .eq("tracking_session_id", trackingSessionId)
      .limit(1)
      .single(),
    "read generic tracking point",
  );
  requireStringValue(point.id, "tracking point id");
}

async function requireLpgNotifications(lpgOrderId: string): Promise<void> {
  const { data, error } = await serviceClient
    .from("communication_messages")
    .select("id,status,payload")
    .eq("source", "lpg.lifecycle_worker")
    .limit(100);

  if (error) {
    throw error;
  }

  const matching = (data ?? []).filter((record) => {
    const payload = requireRecordValue(record.payload, "communication payload");
    return payload.lpg_order_id === lpgOrderId;
  });

  requireCondition(matching.length > 0, "no LPG lifecycle communications were queued.");
  requireCondition(
    matching.some((record) => record.status === "delivered"),
    "no LPG lifecycle communication was delivered.",
  );
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

async function getGateway(accessToken: string, path: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${supabaseUrl}/functions/v1/api-gateway${path}`, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${accessToken}`,
    },
    method: "GET",
  });
  const body = await readJson(response);

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
  const body = await readJson(response);

  requireCondition(!response.ok, `${path} unexpectedly succeeded.`);
  requireCondition(
    String(body.message ?? body.error ?? "").includes(expectedMessage),
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
  const body = await readJson(response);

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

async function requireRpcId(
  resultPromise: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  operationName: string,
): Promise<string> {
  const { data, error } = await resultPromise;

  if (error) {
    throw new Error(`${operationName} failed: ${error.message}`);
  }

  return requireStringValue(data, `${operationName} id`);
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

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const value = await response.json();

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected a JSON object response.");
  }

  return value as Record<string, unknown>;
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

function idempotency(step: string): string {
  return `${source}:${runId}:${step}`;
}

function mark(message: string): void {
  console.log(`[lpg-lifecycle] ${message}`);
}

function requireEnv(key: string): string {
  const value = Deno.env.get(key);

  if (!value) {
    throw new Error(`${key} is required in the deployment shell, .env.local, or CI secret store.`);
  }

  return value;
}

function requireStringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }

  return value;
}

function requireNumberValue(value: unknown, label: string): number {
  const numericValue = typeof value === "number" ? value : Number(value);

  if (!Number.isFinite(numericValue)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return numericValue;
}

function requireRecordValue(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }

  return value as Record<string, unknown>;
}

function requireArrayValue(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value;
}

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
