import { createClient } from "npm:@supabase/supabase-js@2.110.9";

import { resolveSupabaseRuntime } from "./supabase-runtime.ts";

const runtime = await resolveSupabaseRuntime({ anonKey: true, serviceRoleKey: true });
const supabaseUrl = runtime.supabaseUrl;
const serviceRoleKey = runtime.serviceRoleKey!;
const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});
const workerSecret = requireEnv("SKIMA_WORKER_SECRET");

const runId = crypto.randomUUID();
const source = "platform.backend_lifecycle_gate";

console.log(`Running no-frontend backend lifecycle gate ${runId}...`);

const customerUserId = await createAuthUser("customer");
const driverUserId = await createAuthUser("driver");
const partnerOwnerUserId = await createAuthUser("partner-owner");

await upsertProfile(customerUserId, "Lifecycle Customer");
await upsertProfile(driverUserId, "Lifecycle Driver");
await upsertProfile(partnerOwnerUserId, "Lifecycle Partner Owner");

const organizationId = await createOrganization(partnerOwnerUserId);
const partnerId = await createPartner(organizationId, partnerOwnerUserId);
const driverId = await createDriver(driverUserId);
const vehicleId = await createVehicle(driverUserId);
const assetId = await createAsset(customerUserId);

await upsertCapability("driver", driverId, "capability.driver.cylinder-handling");
await upsertCapability("driver", driverId, "capability.cargo.pressurized-cylinder");
await upsertCapability("partner", partnerId, "capability.partner.refill-fulfillment");

const platformWalletId = await requirePlatformWallet("platform");
const escrowWalletId = await requirePlatformWallet("escrow");
const customerWalletId = await ensureWallet("customer", "user", customerUserId, "customer");
const partnerWalletId = await ensureWallet("partner", "partner", partnerId, "partner");
const driverWalletId = await ensureWallet("driver", "driver", driverId, "driver");

await fundCustomerWallet(platformWalletId, customerWalletId);

const serviceRequestId = await requireRpcId(
  serviceClient.rpc("create_module_service_request", {
    target_idempotency_key: idempotency("request"),
    target_metadata: { runId },
    target_module_key: "lpg",
    target_organization_id: organizationId,
    target_request_payload: {
      customerUserId,
      dropoff_location: { latitude: 6.2449, longitude: 7.1198 },
      pickup_location: { latitude: 6.2459, longitude: 7.1177 },
      priority: 50,
      requestedAssetId: assetId,
      vehicleId,
    },
    target_source: source,
  }),
  "create service request",
);

const priceQuoteId = await requireRpcId(
  serviceClient.rpc("calculate_price_quote", {
    target_currency_code: "NGN",
    target_idempotency_key: idempotency("price"),
    target_module_key: "lpg",
    target_pricing_context: {
      amount: 10000,
      fee_amount: 500,
      quantity: 1,
    },
    target_pricing_policy_key: "pricing.lpg.fixed.v1",
    target_service_request_id: serviceRequestId,
    target_source: source,
  }),
  "calculate price",
);

await requireRpcId(
  serviceClient.rpc("accept_price_quote", {
    target_idempotency_key: idempotency("price-accept"),
    target_metadata: { runId },
    target_price_quote_id: priceQuoteId,
  }),
  "accept price quote",
);

await requireRpcId(
  serviceClient.rpc("start_service_request_workflow", {
    target_context: { runId },
    target_idempotency_key: idempotency("workflow-start"),
    target_service_request_id: serviceRequestId,
  }),
  "start workflow",
);

await processEvent(serviceRequestId, "event.request.validated", "validated");
await assignParticipant(serviceRequestId, "partner", partnerId, "partner");
await processEvent(serviceRequestId, "event.partner.matched", "partner-matched");
await processEvent(serviceRequestId, "event.partner.accepted", "partner-accepted");

const dispatchRequestId = await requireRpcId(
  serviceClient.rpc("dispatch_service_request", {
    target_candidate_limit: 5,
    target_dispatch_policy_key: "dispatch.lpg.nearest-qualified-driver.v1",
    target_idempotency_key: idempotency("dispatch"),
    target_service_request_id: serviceRequestId,
  }),
  "dispatch service request",
);

await processEvent(serviceRequestId, "event.driver.matched", "driver-matched");

const assignedDriverId = await readTopDispatchCandidate(dispatchRequestId);

await requireRpcId(
  serviceClient.rpc("assign_dispatch_request", {
    target_assigned_entity_id: assignedDriverId,
    target_assigned_entity_type: "driver",
    target_dispatch_request_id: dispatchRequestId,
    target_idempotency_key: idempotency("dispatch-assign"),
    target_metadata: { runId },
  }),
  "assign dispatch request",
);

await assignParticipant(serviceRequestId, "driver", assignedDriverId, "driver");
await processEvent(serviceRequestId, "event.driver.assigned", "driver-assigned");

const escrowHoldId = await requireRpcId(
  serviceClient.rpc("create_escrow_hold", {
    target_customer_wallet_id: customerWalletId,
    target_escrow_wallet_id: escrowWalletId,
    target_idempotency_key: idempotency("escrow-hold"),
    target_metadata: { runId },
    target_service_request_id: serviceRequestId,
    target_source: source,
  }),
  "reserve payment in escrow",
);

await processEvent(serviceRequestId, "event.escrow.held", "escrow-held");

const trackingSessionId = await requireRpcId(
  serviceClient.rpc("start_tracking_session", {
    target_idempotency_key: idempotency("tracking-start"),
    target_metadata: { runId },
    target_provider_adapter_id: null,
    target_source: source,
    target_subject_id: serviceRequestId,
    target_subject_type: "service_request",
  }),
  "start tracking",
);

await requireRpcId(
  serviceClient.rpc("record_tracking_point", {
    target_accuracy_meters: 10,
    target_heading_degrees: 180,
    target_idempotency_key: idempotency("tracking-point"),
    target_latitude: 6.245,
    target_longitude: 7.118,
    target_metadata: { runId },
    target_recorded_at: new Date().toISOString(),
    target_speed_meters_per_second: 5,
    target_tracking_session_id: trackingSessionId,
  }),
  "record tracking point",
);

await recordVerification(
  serviceRequestId,
  "verification.lpg.pickup.asset_scan",
  "event.pickup.confirmed",
  assetId,
  "pickup.confirmation",
  "pickup",
);
await recordVerification(
  serviceRequestId,
  "verification.lpg.partner.fulfillment_scan",
  "event.partner.fulfillment.confirmed",
  assetId,
  "partner.fulfillment",
  "fulfillment",
);
await recordVerification(
  serviceRequestId,
  "verification.lpg.delivery.asset_scan",
  "event.delivery.completed",
  assetId,
  "delivery.confirmation",
  "delivery",
);

const notificationMessageId = await requireRpcId(
  serviceClient.rpc("queue_notification_message", {
    target_channel: "in_app",
    target_idempotency_key: idempotency("notification"),
    target_payload: { request_reference: serviceRequestId },
    target_provider_adapter_id: null,
    target_recipient_address: null,
    target_recipient_entity_id: customerUserId,
    target_recipient_entity_type: "user",
    target_source: source,
    target_template_key: "notification.lpg.delivery.completed",
  }),
  "queue notification",
);

const aiTaskRunId = await requireRpcId(
  serviceClient.rpc("queue_ai_task_run", {
    target_idempotency_key: idempotency("ai"),
    target_input: { dispatchRequestId, serviceRequestId },
    target_source: source,
    target_subject_id: serviceRequestId,
    target_subject_type: "service_request",
    target_task_key: "ai.lpg.dispatch.recommendation",
  }),
  "queue AI task",
);

await runWorker();
await requireRuntimeStatus("notification_messages", notificationMessageId, "delivered");
await requireRuntimeStatus("ai_task_runs", aiTaskRunId, "completed");

await requireRpcId(
  serviceClient.rpc("execute_service_request_settlement", {
    target_distribution: [
      {
        amount: 9000,
        entry_type: "principal",
        metadata: { role: "partner" },
        wallet_id: partnerWalletId,
      },
      {
        amount: 1000,
        entry_type: "commission",
        metadata: { role: "driver" },
        wallet_id: driverWalletId,
      },
      {
        amount: 500,
        entry_type: "fee",
        metadata: { role: "platform" },
        wallet_id: platformWalletId,
      },
    ],
    target_escrow_hold_id: escrowHoldId,
    target_idempotency_key: idempotency("settlement"),
    target_metadata: { runId },
    target_service_request_id: serviceRequestId,
    target_source: source,
  }),
  "execute settlement",
);

const reconciliation = await requireRpcObject(
  serviceClient.rpc("reconcile_service_request_financials", {
    target_service_request_id: serviceRequestId,
  }),
  "reconcile service request",
);

requireCondition(reconciliation.balanced === true, "service request reconciliation is unbalanced.");
await requireRuntimeStatus("service_requests", serviceRequestId, "settled");
await requireWorkflowCompleted(serviceRequestId);
await requireAuditEvidence(serviceRequestId);
await requireProviderEvidence();
await requireLedgerEvidence(serviceRequestId);

console.log("No-frontend backend lifecycle gate completed.");
console.log(`service_request_id=${serviceRequestId}`);

async function createAuthUser(kind: string): Promise<string> {
  const email = `skima-${kind}-${runId}@example.invalid`;
  const password = crypto.randomUUID() + "Aa1!";
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: {
      gate: "backend_lifecycle",
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

  return data.user.id;
}

async function upsertProfile(userId: string, displayName: string): Promise<void> {
  const { error } = await serviceClient.from("profiles").upsert({
    display_name: displayName,
    id: userId,
    metadata: { gate: "backend_lifecycle", runId },
    status: "active",
  });

  if (error) {
    throw error;
  }
}

async function createOrganization(ownerUserId: string): Promise<string> {
  const { data, error } = await serviceClient
    .from("organizations")
    .insert({
      created_by: ownerUserId,
      display_name: "Lifecycle Partner Organization",
      legal_name: "Lifecycle Partner Organization",
      metadata: { gate: "backend_lifecycle", runId },
      slug: `lifecycle-${runId.slice(0, 8)}`,
      status: "active",
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  await requireMutation(
    serviceClient.from("organization_memberships").insert({
      created_by: ownerUserId,
      membership_type: "owner",
      metadata: { gate: "backend_lifecycle", runId },
      organization_id: data.id,
      status: "active",
      user_id: ownerUserId,
    }),
  );

  return data.id;
}

async function createPartner(organizationId: string, ownerUserId: string): Promise<string> {
  const { data, error } = await serviceClient
    .from("partner_profiles")
    .insert({
      behavior_config: { gate: "backend_lifecycle" },
      created_by: ownerUserId,
      metadata: { gate: "backend_lifecycle", runId },
      organization_id: organizationId,
      partner_type_key: "partner.fulfillment.configured",
      status: "active",
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data.id;
}

async function createDriver(driverUserId: string): Promise<string> {
  const { data, error } = await serviceClient
    .from("driver_profiles")
    .insert({
      metadata: { gate: "backend_lifecycle", runId },
      operational_status: "available",
      user_id: driverUserId,
      verification_status: "approved",
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data.id;
}

async function createVehicle(ownerUserId: string): Promise<string> {
  const vehicleType = await requireSingle(
    serviceClient.from("vehicle_types").select("id").eq("key", "vehicle.motorcycle").single(),
    "read motorcycle vehicle type",
  );

  const { data, error } = await serviceClient
    .from("vehicles")
    .insert({
      capacity_profile: { max_units: 2 },
      metadata: { gate: "backend_lifecycle", runId },
      owner_user_id: ownerUserId,
      status: "active",
      vehicle_type_id: vehicleType.id,
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data.id;
}

async function createAsset(ownerUserId: string): Promise<string> {
  const { data, error } = await serviceClient
    .from("assets")
    .insert({
      asset_type_key: "asset.returnable-container",
      metadata: { gate: "backend_lifecycle", runId },
      owner_user_id: ownerUserId,
      status: "active",
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data.id;
}

async function upsertCapability(
  entityType: string,
  entityId: string,
  capabilityKey: string,
): Promise<void> {
  await requireMutation(
    serviceClient.from("entity_capabilities").upsert({
      capability_key: capabilityKey,
      constraints: { gate: "backend_lifecycle", runId },
      entity_id: entityId,
      entity_type: entityType,
      status: "active",
      verified_at: new Date().toISOString(),
    }),
  );
}

async function ensureWallet(
  walletType: string,
  ownerEntityType: string,
  ownerEntityId: string,
  purpose: string,
): Promise<string> {
  return await requireRpcId(
    serviceClient.rpc("ensure_wallet_account", {
      target_currency_code: "NGN",
      target_idempotency_key: idempotency(`wallet-${purpose}`),
      target_metadata: { gate: "backend_lifecycle", runId },
      target_owner_entity_id: ownerEntityId,
      target_owner_entity_type: ownerEntityType,
      target_source: source,
      target_wallet_type: walletType,
    }),
    `ensure ${purpose} wallet`,
  );
}

async function requirePlatformWallet(walletType: string): Promise<string> {
  const { data, error } = await serviceClient
    .from("wallet_accounts")
    .select("id")
    .eq("wallet_type", walletType)
    .eq("owner_entity_type", "platform")
    .eq("currency_code", "NGN")
    .eq("status", "active")
    .limit(1)
    .single();

  if (error) {
    throw error;
  }

  return data.id;
}

async function fundCustomerWallet(
  platformWalletId: string,
  customerWalletId: string,
): Promise<void> {
  await requireRpcId(
    serviceClient.rpc("post_financial_transaction", {
      target_currency_code: "NGN",
      target_entries: [
        {
          amount: 20000,
          direction: "debit",
          entry_type: "principal",
          metadata: { role: "platform_funding" },
          wallet_id: platformWalletId,
        },
        {
          amount: 20000,
          direction: "credit",
          entry_type: "principal",
          metadata: { role: "customer_wallet" },
          wallet_id: customerWalletId,
        },
      ],
      target_external_reference: null,
      target_idempotency_key: idempotency("customer-funding"),
      target_metadata: { gate: "backend_lifecycle", runId },
      target_policy_snapshot: {},
      target_provider_adapter_id: null,
      target_source: source,
      target_subject_id: null,
      target_subject_type: "service_request.lifecycle_gate",
      target_transaction_type: "transfer",
    }),
    "fund customer wallet",
  );
}

async function processEvent(
  serviceRequestId: string,
  eventTypeKey: string,
  step: string,
): Promise<void> {
  await requireRpcId(
    serviceClient.rpc("process_service_request_event", {
      target_event_type_key: eventTypeKey,
      target_idempotency_key: idempotency(`event-${step}`),
      target_payload: { runId, step },
      target_service_request_id: serviceRequestId,
    }),
    `process ${eventTypeKey}`,
  );
}

async function assignParticipant(
  serviceRequestId: string,
  participantRole: string,
  entityId: string,
  step: string,
): Promise<void> {
  await requireRpcId(
    serviceClient.rpc("assign_service_request_participant", {
      target_entity_id: entityId,
      target_idempotency_key: idempotency(`participant-${step}`),
      target_metadata: { runId },
      target_participant_role: participantRole,
      target_service_request_id: serviceRequestId,
    }),
    `assign ${participantRole}`,
  );
}

async function readTopDispatchCandidate(dispatchRequestId: string): Promise<string> {
  const { data, error } = await serviceClient
    .from("dispatch_candidates")
    .select("candidate_entity_id")
    .eq("dispatch_request_id", dispatchRequestId)
    .eq("candidate_entity_type", "driver")
    .order("rank", { ascending: true })
    .limit(1)
    .single();

  if (error) {
    throw error;
  }

  return data.candidate_entity_id;
}

async function recordVerification(
  serviceRequestId: string,
  definitionKey: string,
  eventTypeKey: string,
  scannedEntityId: string,
  purpose: string,
  step: string,
): Promise<void> {
  const verificationEventId = await requireRpcId(
    serviceClient.rpc("record_verification_event", {
      target_definition_key: definitionKey,
      target_idempotency_key: idempotency(`verification-${step}`),
      target_location: { latitude: 6.245, longitude: 7.118 },
      target_occurred_at: new Date().toISOString(),
      target_payload: { runId, serviceRequestId },
      target_purpose: purpose,
      target_result: "passed",
      target_scanned_entity_id: scannedEntityId,
      target_scanned_entity_type: "asset",
      target_source: source,
    }),
    `record ${step} verification`,
  );

  await processEvent(serviceRequestId, eventTypeKey, `${step}-${verificationEventId}`);
}

async function runWorker(): Promise<void> {
  const response = await fetch(`${supabaseUrl}/functions/v1/runtime-worker`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-skima-worker-secret": workerSecret,
    },
    body: JSON.stringify({ limit: 25 }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`runtime worker returned HTTP ${response.status}: ${body}`);
  }
}

async function requireRuntimeStatus(
  table: string,
  recordId: string,
  status: string,
): Promise<void> {
  const record = await requireSingle(
    serviceClient.from(table).select("status").eq("id", recordId).single(),
    `read ${table} status`,
  );

  requireCondition(
    record.status === status,
    `${table}.${recordId} expected status ${status}, found ${record.status}.`,
  );
}

async function requireWorkflowCompleted(serviceRequestId: string): Promise<void> {
  const request = await requireSingle(
    serviceClient
      .from("service_requests")
      .select("workflow_instance_id")
      .eq("id", serviceRequestId)
      .single(),
    "read service request workflow",
  );

  const workflow = await requireSingle(
    serviceClient
      .from("workflow_instances")
      .select("status,current_state_key")
      .eq("id", request.workflow_instance_id)
      .single(),
    "read workflow instance",
  );

  requireCondition(
    workflow.status === "completed" && workflow.current_state_key === "settled",
    `workflow expected completed/settled, found ${workflow.status}/${workflow.current_state_key}.`,
  );
}

async function requireAuditEvidence(serviceRequestId: string): Promise<void> {
  const { data, error } = await serviceClient
    .from("audit_logs")
    .select("id")
    .eq("entity_type", "service_requests")
    .eq("entity_id", serviceRequestId)
    .limit(1);

  if (error) {
    throw error;
  }

  requireCondition((data ?? []).length > 0, "service request audit evidence is missing.");
}

async function requireProviderEvidence(): Promise<void> {
  const { data, error } = await serviceClient
    .from("provider_execution_logs")
    .select("id")
    .in("provider_kind", ["notification", "ai"])
    .eq("status", "succeeded");

  if (error) {
    throw error;
  }

  requireCondition((data ?? []).length >= 2, "provider execution evidence is missing.");
}

async function requireLedgerEvidence(serviceRequestId: string): Promise<void> {
  const { data, error } = await serviceClient
    .from("financial_transactions")
    .select("id,transaction_type,total_amount")
    .eq("subject_type", "service_request")
    .eq("subject_id", serviceRequestId)
    .eq("status", "posted");

  if (error) {
    throw error;
  }

  const transactionTypes = new Set((data ?? []).map((transaction) => transaction.transaction_type));

  requireCondition(transactionTypes.has("hold"), "hold transaction is missing.");
  requireCondition(transactionTypes.has("release"), "release transaction is missing.");
}

async function requireRpcId(
  resultPromise: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  operationName: string,
): Promise<string> {
  const { data, error } = await resultPromise;

  if (error) {
    throw new Error(`${operationName} failed: ${error.message}`);
  }

  if (typeof data !== "string" || data.length === 0) {
    throw new Error(`${operationName} did not return an id.`);
  }

  return data;
}

async function requireRpcObject(
  resultPromise: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  operationName: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await resultPromise;

  if (error) {
    throw new Error(`${operationName} failed: ${error.message}`);
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${operationName} did not return a JSON object.`);
  }

  return data as Record<string, unknown>;
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
): Promise<void> {
  const { error } = await resultPromise;

  if (error) {
    throw error;
  }
}

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function idempotency(step: string): string {
  return `${source}:${runId}:${step}`;
}

function requireEnv(key: string): string {
  const value = Deno.env.get(key);

  if (!value) {
    throw new Error(`${key} is required in the deployment shell.`);
  }

  return value;
}
