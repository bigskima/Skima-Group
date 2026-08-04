import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.9";

import { resolveSupabaseRuntime } from "./supabase-runtime.ts";

interface GateUser {
  readonly accessToken: string;
  readonly client: SupabaseClient;
  readonly email: string;
  readonly id: string;
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
const source = "skima.lpg_payment_reservation_gate";

console.log(`Running LPG payment reservation gate ${runId}...`);

const customer = await createGateUser("lpg-payment-customer");
const outsider = await createGateUser("lpg-payment-outsider");

const cylinderId = await postGatewayId(customer.accessToken, "/lpg/cylinders", {
  conditionStatus: "good",
  cylinderIdentifier: `lpg-payment-gate-${runKey}`,
  idempotencyKey: idempotency("cylinder"),
  maxCapacityKg: 12.5,
  metadata: { gate: "lpg_payment_reservation", runId },
  sizeKg: 12.5,
  source,
});

const pickupLocationId = await postGatewayId(customer.accessToken, "/lpg/locations", {
  contactName: "LPG Payment Gate",
  contactPhone: `+234800${runKey.slice(0, 7).replaceAll(/[a-f]/g, "1")}`,
  formattedAddress: "LPG payment gate pickup address",
  idempotencyKey: idempotency("pickup-location"),
  label: "Pickup",
  latitude: 6.5244,
  longitude: 3.3792,
  metadata: { gate: "lpg_payment_reservation", runId },
  source,
});

const deliveryLocationId = await postGatewayId(customer.accessToken, "/lpg/locations", {
  contactName: "LPG Payment Gate",
  contactPhone: `+234801${runKey.slice(0, 7).replaceAll(/[a-f]/g, "1")}`,
  formattedAddress: "LPG payment gate delivery address",
  idempotencyKey: idempotency("delivery-location"),
  label: "Delivery",
  latitude: 6.525,
  longitude: 3.38,
  metadata: { gate: "lpg_payment_reservation", runId },
  source,
});

const quoteBody = await postGateway(customer.accessToken, "/lpg/quotes", {
  cylinderId,
  deliveryLocationId,
  idempotencyKey: idempotency("quote"),
  metadata: { gate: "lpg_payment_reservation", runId },
  pickupLocationId,
  requestedKg: 2,
  source,
});
const lpgRefillQuoteId = requireStringValue(quoteBody.id, "LPG quote id");
const quotePublicReference = requireStringValue(
  quoteBody.publicReference,
  "LPG quote public reference",
);

const orderBody = await postGateway(customer.accessToken, "/lpg/orders", {
  idempotencyKey: idempotency("order"),
  lpgRefillQuoteId,
  metadata: { gate: "lpg_payment_reservation", runId },
  source,
});
const lpgOrderId = requireStringValue(orderBody.id, "LPG order id");
const orderPublicReference = requireStringValue(
  orderBody.publicReference,
  "LPG order public reference",
);

const orderBeforePayment = await requireSingle(
  serviceClient
    .from("lpg_refill_orders")
    .select("service_request_id,total_amount,currency_code,status,payment_status,escrow_hold_id")
    .eq("id", lpgOrderId)
    .single(),
  "read LPG order before payment reservation",
);
requireCondition(
  orderBeforePayment.status === "awaiting_payment",
  "LPG order was not awaiting payment before reservation.",
);
requireCondition(
  orderBeforePayment.payment_status === "pending",
  "LPG order payment status was not pending before reservation.",
);
requireCondition(
  !orderBeforePayment.escrow_hold_id,
  "LPG order already had an escrow hold before reservation.",
);

const serviceRequestId = requireStringValue(
  orderBeforePayment.service_request_id,
  "service request id",
);
const currencyCode = requireStringValue(orderBeforePayment.currency_code, "currency code");
const orderTotalAmount = requireNumberValue(orderBeforePayment.total_amount, "order total amount");

await requireAuthenticatedDirectReservationRejected(customer, lpgOrderId);

const depositBody = await postGateway(customer.accessToken, "/runtime/payments/deposits", {
  amount: orderTotalAmount,
  currencyCode,
  idempotencyKey: idempotency("deposit"),
  metadata: { gate: "lpg_payment_reservation", lpgOrderId, runId },
  source,
});
const depositRequestId = requireStringValue(depositBody.id, "deposit request id");
const depositRecord = await requireSingle(
  serviceClient
    .from("payment_deposit_requests")
    .select("wallet_id,provider_reference,status")
    .eq("id", depositRequestId)
    .single(),
  "read initialized deposit",
);
const customerWalletId = requireStringValue(depositRecord.wallet_id, "customer wallet id");
requireCondition(depositRecord.status === "pending", "deposit was not pending before webhook.");

await postPaymentWebhook({
  depositRequestId,
  idempotencyKey: idempotency("deposit-webhook"),
  providerReference: requireStringValue(depositRecord.provider_reference, "provider reference"),
  providerStatus: "succeeded",
  status: "succeeded",
});
await requireWalletBalance(customerWalletId, orderTotalAmount, "customer wallet after deposit");

await requireGatewayError(outsider.accessToken, "/lpg/orders/reserve-payment", {
  customerWalletId,
  idempotencyKey: idempotency("outsider-reserve"),
  lpgOrderId,
  metadata: { gate: "lpg_payment_reservation", runId },
  source,
}, "target_actor_user_id must match LPG order customer");

const reservationBody = await postGateway(customer.accessToken, "/lpg/orders/reserve-payment", {
  customerWalletId,
  idempotencyKey: idempotency("reserve-payment"),
  lpgOrderId,
  metadata: { gate: "lpg_payment_reservation", runId },
  source,
});
requireCondition(
  reservationBody.id === lpgOrderId,
  "payment reservation returned a different order id.",
);
requireCondition(
  reservationBody.publicReference === orderPublicReference,
  "payment reservation returned a different LPG public reference.",
);
const reservationData = requireRecordValue(reservationBody.data, "reservation data");
const escrowHoldId = requireStringValue(reservationData.escrowHoldId, "escrow hold id");
const escrowWalletId = requireStringValue(reservationData.escrowWalletId, "escrow wallet id");
requireCondition(
  reservationData.status === "payment_reserved",
  "reservation response did not move the LPG order to payment_reserved.",
);
requireCondition(
  reservationData.paymentStatus === "reserved",
  "reservation response did not mark payment as reserved.",
);

const reservationRetryBody = await postGateway(
  customer.accessToken,
  "/lpg/orders/reserve-payment",
  {
    customerWalletId,
    idempotencyKey: idempotency("reserve-payment"),
    lpgOrderId,
    metadata: { gate: "lpg_payment_reservation", retry: true, runId },
    source,
  },
);
const reservationRetryData = requireRecordValue(
  reservationRetryBody.data,
  "retry reservation data",
);
requireCondition(
  reservationRetryBody.id === lpgOrderId,
  "idempotent reservation retry returned a different order id.",
);
requireCondition(
  reservationRetryData.escrowHoldId === escrowHoldId,
  "idempotent reservation retry returned a different escrow hold.",
);

await requireWalletBalance(customerWalletId, 0, "customer wallet after escrow hold");
await requireWalletBalance(escrowWalletId, orderTotalAmount, "escrow wallet after reservation");
await requireOrderReservation(lpgOrderId, escrowHoldId, serviceRequestId, orderTotalAmount);
await requireEscrowHold(
  escrowHoldId,
  escrowWalletId,
  serviceRequestId,
  orderTotalAmount,
  currencyCode,
);
await requireLpgPaymentEvent(lpgOrderId, escrowHoldId);

console.log("LPG payment reservation gate completed.");
console.log(`lpg_refill_quote_id=${lpgRefillQuoteId}`);
console.log(`lpg_quote_public_reference=${quotePublicReference}`);
console.log(`lpg_order_id=${lpgOrderId}`);
console.log(`lpg_order_public_reference=${orderPublicReference}`);
console.log(`deposit_request_id=${depositRequestId}`);
console.log(`customer_wallet_id=${customerWalletId}`);
console.log(`escrow_hold_id=${escrowHoldId}`);
console.log(`escrow_wallet_id=${escrowWalletId}`);

async function createGateUser(kind: string): Promise<GateUser> {
  const email = `skima-${kind}-${runId}@example.invalid`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { gate: "lpg_payment_reservation", kind, runId },
  });

  if (error) {
    throw error;
  }

  if (!data.user?.id) {
    throw new Error(`Supabase Auth did not create ${kind} user.`);
  }

  await requireMutation(
    serviceClient.from("profiles").upsert({
      display_name: `LPG Payment Gate ${kind}`,
      id: data.user.id,
      metadata: { gate: "lpg_payment_reservation", runId },
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

async function requireAuthenticatedDirectReservationRejected(
  user: GateUser,
  lpgOrderId: string,
): Promise<void> {
  const result = await user.client.rpc("reserve_lpg_refill_order_payment", {
    target_actor_user_id: user.id,
    target_idempotency_key: idempotency("direct-reserve-rejected"),
    target_lpg_order_id: lpgOrderId,
    target_metadata: { gate: "lpg_payment_reservation", directRpc: true, runId },
    target_source: source,
  });

  requireCondition(
    Boolean(result.error),
    "authenticated direct LPG payment reservation was allowed.",
  );
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

async function requireWalletBalance(
  walletId: string,
  expectedBalance: number,
  label: string,
): Promise<void> {
  const record = await requireSingle(
    serviceClient.from("wallet_balances").select("balance").eq("wallet_id", walletId).single(),
    `read ${label}`,
  );
  const balance = requireNumberValue(record.balance, label);
  requireCondition(
    amountsEqual(balance, expectedBalance),
    `${label} expected ${expectedBalance}, found ${balance}.`,
  );
}

async function requireOrderReservation(
  lpgOrderId: string,
  escrowHoldId: string,
  serviceRequestId: string,
  totalAmount: number,
): Promise<void> {
  const orderRecord = await requireSingle(
    serviceClient
      .from("lpg_refill_orders")
      .select("escrow_hold_id,status,payment_status,total_amount")
      .eq("id", lpgOrderId)
      .single(),
    "read reserved LPG order",
  );
  requireCondition(
    orderRecord.escrow_hold_id === escrowHoldId,
    "LPG order escrow hold was not set.",
  );
  requireCondition(
    orderRecord.status === "payment_reserved",
    "LPG order status was not payment_reserved.",
  );
  requireCondition(
    orderRecord.payment_status === "reserved",
    "LPG order payment status was not reserved.",
  );
  requireCondition(
    amountsEqual(requireNumberValue(orderRecord.total_amount, "reserved order total"), totalAmount),
    "LPG order total changed during payment reservation.",
  );

  const requestRecord = await requireSingle(
    serviceClient
      .from("service_requests")
      .select("escrow_hold_id,status")
      .eq("id", serviceRequestId)
      .single(),
    "read reserved service request",
  );
  requireCondition(
    requestRecord.escrow_hold_id === escrowHoldId,
    "service request escrow hold was not set.",
  );
  requireCondition(
    requestRecord.status === "payment_reserved",
    "service request status was not payment_reserved.",
  );
}

async function requireEscrowHold(
  escrowHoldId: string,
  escrowWalletId: string,
  serviceRequestId: string,
  expectedAmount: number,
  expectedCurrencyCode: string,
): Promise<void> {
  const holdRecord = await requireSingle(
    serviceClient
      .from("escrow_holds")
      .select("wallet_id,subject_type,subject_id,status,currency_code,hold_amount")
      .eq("id", escrowHoldId)
      .single(),
    "read LPG escrow hold",
  );
  requireCondition(holdRecord.wallet_id === escrowWalletId, "escrow hold wallet was incorrect.");
  requireCondition(
    holdRecord.subject_type === "service_request",
    "escrow hold subject type was incorrect.",
  );
  requireCondition(
    holdRecord.subject_id === serviceRequestId,
    "escrow hold service request was incorrect.",
  );
  requireCondition(holdRecord.status === "held", "escrow hold was not held.");
  requireCondition(
    holdRecord.currency_code === expectedCurrencyCode,
    "escrow hold currency was incorrect.",
  );
  requireCondition(
    amountsEqual(requireNumberValue(holdRecord.hold_amount, "escrow hold amount"), expectedAmount),
    "escrow hold amount was incorrect.",
  );
}

async function requireLpgPaymentEvent(lpgOrderId: string, escrowHoldId: string): Promise<void> {
  const eventRecord = await requireSingle(
    serviceClient
      .from("lpg_order_events")
      .select("id,metadata")
      .eq("lpg_order_id", lpgOrderId)
      .eq("event_type", "lpg.payment.reserved")
      .single(),
    "read LPG payment reserved event",
  );
  const metadata = requireRecordValue(eventRecord.metadata, "LPG payment event metadata");
  requireCondition(
    metadata.escrow_hold_id === escrowHoldId,
    "LPG payment event escrow hold was incorrect.",
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

function amountsEqual(left: number, right: number): boolean {
  return Math.abs(left - right) < 0.000001;
}

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
