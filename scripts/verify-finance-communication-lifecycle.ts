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
const source = "platform.finance_communication_gate";

console.log(`Running finance and communication lifecycle gate ${runId}...`);

const customer = await createGateUser("finance-customer");
const driver = await createGateUser("finance-driver");
const organizationId = await createGateOrganization();
const moduleRecord = await requireActiveModule("lpg");
const moduleVersionId = await requireActiveModuleVersion(moduleRecord.id);

const depositId = await postGatewayId(customer.accessToken, "/runtime/payments/deposits", {
  amount: 6000,
  currencyCode: "NGN",
  idempotencyKey: idempotency("deposit-initialize"),
  metadata: { gate: "finance_communication_lifecycle", runId },
  source,
});
const deposit = await requireSingle(
  serviceClient
    .from("payment_deposit_requests")
    .select("wallet_id,provider_reference,status")
    .eq("id", depositId)
    .single(),
  "read initialized deposit",
);
const customerWalletId = requireStringValue(deposit.wallet_id, "customer wallet id");
requireCondition(deposit.status === "pending", "deposit was not initialized as pending.");

await postPaymentWebhook({
  depositRequestId: depositId,
  idempotencyKey: idempotency("deposit-webhook"),
  providerReference: requireStringValue(deposit.provider_reference, "provider reference"),
  providerStatus: "succeeded",
  status: "succeeded",
});
await postPaymentWebhook({
  depositRequestId: depositId,
  idempotencyKey: idempotency("deposit-webhook"),
  providerReference: requireStringValue(deposit.provider_reference, "provider reference"),
  providerStatus: "succeeded",
  status: "succeeded",
});
await requireWalletBalance(customerWalletId, 6000, "customer wallet after deposit");
await requireDepositStatus(depositId, "succeeded");

const beneficiaryId = await postGatewayId(
  customer.accessToken,
  "/runtime/withdrawal-beneficiaries",
  {
    accountName: "Skima Finance Gate",
    accountNumber: `10${runKey.slice(0, 8).replaceAll(/[a-f]/g, "1")}`,
    bankCode: "999",
    idempotencyKey: idempotency("beneficiary"),
    metadata: { gate: "finance_communication_lifecycle", runId },
    source,
    walletId: customerWalletId,
  },
);

const failedWithdrawalId = await postGatewayId(customer.accessToken, "/runtime/withdrawals", {
  amount: 1200,
  beneficiaryId,
  feeAmount: 50,
  idempotencyKey: idempotency("withdrawal-failed"),
  metadata: { gate: "finance_communication_lifecycle", runId },
  source,
  walletId: customerWalletId,
});
await requireRpcId(
  serviceClient.rpc("approve_wallet_withdrawal", {
    target_idempotency_key: idempotency("withdrawal-failed-approve"),
    target_metadata: { gate: "finance_communication_lifecycle", runId },
    target_source: source,
    target_withdrawal_request_id: failedWithdrawalId,
  }),
  "approve failed-path withdrawal",
);
await requireRpcId(
  serviceClient.rpc("process_wallet_withdrawal_transfer", {
    target_idempotency_key: idempotency("withdrawal-failed-transfer"),
    target_metadata: { gate: "finance_communication_lifecycle", runId },
    target_provider_reference: `sandbox-transfer-failed-${runKey}`,
    target_provider_status: "failed",
    target_response_payload: { reason: "sandbox failure path" },
    target_source: source,
    target_withdrawal_request_id: failedWithdrawalId,
  }),
  "process failed-path withdrawal",
);
await requireWalletBalance(
  customerWalletId,
  6000,
  "customer wallet after failed withdrawal reversal",
);
await requireWithdrawalStatus(failedWithdrawalId, "failed");

const successfulWithdrawalId = await postGatewayId(customer.accessToken, "/runtime/withdrawals", {
  amount: 1000,
  beneficiaryId,
  feeAmount: 25,
  idempotencyKey: idempotency("withdrawal-success"),
  metadata: { gate: "finance_communication_lifecycle", runId },
  source,
  walletId: customerWalletId,
});
await requireRpcId(
  serviceClient.rpc("approve_wallet_withdrawal", {
    target_idempotency_key: idempotency("withdrawal-success-approve"),
    target_metadata: { gate: "finance_communication_lifecycle", runId },
    target_source: source,
    target_withdrawal_request_id: successfulWithdrawalId,
  }),
  "approve success-path withdrawal",
);
await requireRpcId(
  serviceClient.rpc("process_wallet_withdrawal_transfer", {
    target_idempotency_key: idempotency("withdrawal-success-transfer"),
    target_metadata: { gate: "finance_communication_lifecycle", runId },
    target_provider_reference: `sandbox-transfer-success-${runKey}`,
    target_provider_status: "succeeded",
    target_response_payload: { transferred: true },
    target_source: source,
    target_withdrawal_request_id: successfulWithdrawalId,
  }),
  "process success-path withdrawal",
);
await requireWalletBalance(customerWalletId, 4975, "customer wallet after successful withdrawal");
await requireWithdrawalStatus(successfulWithdrawalId, "succeeded");

const communicationId = await postGatewayId(
  customer.accessToken,
  "/runtime/communications/messages",
  {
    channel: "in_app",
    idempotencyKey: idempotency("communication"),
    metadata: { gate: "finance_communication_lifecycle", runId },
    payload: { title: "Finance gate", body: "Runtime communication delivery check." },
    purpose: "platform.gate.communication",
    recipientEntityId: customer.id,
    recipientEntityType: "user",
    source,
  },
);

const challengeId = await postGatewayId(customer.accessToken, "/runtime/otp/challenges", {
  channel: "in_app",
  idempotencyKey: idempotency("otp"),
  maxAttempts: 5,
  metadata: { gate: "finance_communication_lifecycle", runId },
  purpose: "platform.gate.login",
  recipientAddress: customer.email,
  source,
  ttlSeconds: 600,
});
await requireGatewayError(customer.accessToken, "/runtime/otp/verify", {
  challengeId,
  code: "000000",
  idempotencyKey: idempotency("otp-wrong"),
  metadata: { gate: "finance_communication_lifecycle", runId },
}, "OTP verification failed");
await requireOtpStorageIsProtected(customer, challengeId);
const otpCode = await fetchInAppOtpCode(customer.accessToken, challengeId);
await postGatewayId(customer.accessToken, "/runtime/otp/verify", {
  challengeId,
  code: otpCode,
  idempotencyKey: idempotency("otp-correct"),
  metadata: { gate: "finance_communication_lifecycle", runId },
});
await invokeRuntimeWorker();
await requireRpcNumber(
  serviceClient.rpc("sync_communication_message_statuses", { target_limit: 100 }),
  "sync communication statuses",
);
await requireCommunicationStatus(communicationId, "delivered");
await requireOtpStatus(challengeId, "verified");

const serviceRequestId = await requireRpcId(
  serviceClient.rpc("create_module_service_request", {
    target_idempotency_key: idempotency("service-request"),
    target_metadata: { gate: "finance_communication_lifecycle", runId },
    target_module_key: "lpg",
    target_organization_id: organizationId,
    target_request_payload: { gate: "finance_communication_lifecycle", runId },
    target_source: source,
  }),
  "create module-backed service request",
);

const orderId = await createSyntheticOrder({
  customerUserId: customer.id,
  moduleId: moduleRecord.id,
  moduleVersionId,
  organizationId,
  serviceRequestId,
});

const driverWalletId = await ensureWallet("driver", "user", driver.id, "driver");
const partnerWalletId = await ensureWallet("partner", "organization", organizationId, "partner");
const platformWalletId = await requirePlatformWallet("platform");

const escrowHoldId = await requireRpcId(
  serviceClient.rpc("fund_order_from_wallet", {
    target_customer_wallet_id: customerWalletId,
    target_escrow_wallet_id: null,
    target_idempotency_key: idempotency("order-funding"),
    target_metadata: { gate: "finance_communication_lifecycle", runId },
    target_order_id: orderId,
    target_source: source,
  }),
  "fund order from customer wallet",
);

const commissionId = await requireRpcId(
  serviceClient.rpc("execute_driver_commission", {
    target_base_amount: null,
    target_commission_policy_key: "commission.driver.percentage.default",
    target_driver_wallet_id: driverWalletId,
    target_escrow_hold_id: escrowHoldId,
    target_idempotency_key: idempotency("driver-commission"),
    target_metadata: { gate: "finance_communication_lifecycle", runId },
    target_order_id: orderId,
    target_source: source,
  }),
  "execute driver commission",
);

const settlementStatementId = await requireRpcId(
  serviceClient.rpc("execute_order_business_settlement", {
    target_business_wallet_id: partnerWalletId,
    target_escrow_hold_id: escrowHoldId,
    target_idempotency_key: idempotency("business-settlement"),
    target_metadata: { gate: "finance_communication_lifecycle", runId },
    target_order_id: orderId,
    target_platform_fee_amount: 125,
    target_platform_fee_wallet_id: platformWalletId,
    target_source: source,
  }),
  "execute business settlement",
);

await requireWalletBalance(customerWalletId, 2475, "customer wallet after order funding");
await requireWalletBalance(driverWalletId, 250, "driver wallet after commission");
await requireWalletBalance(partnerWalletId, 2125, "partner wallet after settlement");
await requireCommission(commissionId, 250);
await requireSettlementStatement(settlementStatementId, 2250, 2125, 125);
await requireServiceRequestReconciled(serviceRequestId);
await requireAppendOnlyProtection();

console.log("Finance and communication lifecycle gate completed.");
console.log(`deposit_request_id=${depositId}`);
console.log(`withdrawal_request_id=${successfulWithdrawalId}`);
console.log(`communication_message_id=${communicationId}`);
console.log(`otp_challenge_id=${challengeId}`);
console.log(`order_id=${orderId}`);
console.log(`escrow_hold_id=${escrowHoldId}`);
console.log(`commission_execution_id=${commissionId}`);
console.log(`settlement_statement_id=${settlementStatementId}`);

async function createGateUser(kind: string): Promise<GateUser> {
  const email = `skima-${kind}-${runId}@example.invalid`;
  const password = `${crypto.randomUUID()}Aa1!`;
  const { data, error } = await serviceClient.auth.admin.createUser({
    email,
    email_confirm: true,
    password,
    user_metadata: { gate: "finance_communication_lifecycle", kind, runId },
  });

  if (error) {
    throw error;
  }

  if (!data.user?.id) {
    throw new Error(`Supabase Auth did not create ${kind} user.`);
  }

  await requireMutation(
    serviceClient.from("profiles").upsert({
      display_name: `Finance Gate ${kind}`,
      id: data.user.id,
      metadata: { gate: "finance_communication_lifecycle", runId },
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

async function createGateOrganization(): Promise<string> {
  const { data, error } = await serviceClient
    .from("organizations")
    .insert({
      display_name: `Finance Gate Organization ${runKey}`,
      legal_name: `Finance Gate Organization ${runKey} Ltd`,
      metadata: { gate: "finance_communication_lifecycle", runId },
      slug: `finance-gate-${runKey}`,
      status: "active",
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return requireStringValue(data.id, "organization id");
}

async function requireActiveModule(moduleKey: string): Promise<{ readonly id: string }> {
  const record = await requireSingle(
    serviceClient
      .from("business_modules")
      .select("id")
      .eq("key", moduleKey)
      .eq("status", "active")
      .single(),
    `read active module ${moduleKey}`,
  );

  return { id: requireStringValue(record.id, "module id") };
}

async function requireActiveModuleVersion(moduleId: string): Promise<string> {
  const record = await requireSingle(
    serviceClient
      .from("business_module_versions")
      .select("id")
      .eq("module_id", moduleId)
      .eq("status", "active")
      .order("version", { ascending: false })
      .limit(1)
      .single(),
    "read active module version",
  );

  return requireStringValue(record.id, "module version id");
}

async function createSyntheticOrder(input: {
  readonly customerUserId: string;
  readonly moduleId: string;
  readonly moduleVersionId: string;
  readonly organizationId: string;
  readonly serviceRequestId: string;
}): Promise<string> {
  const { data, error } = await serviceClient
    .from("order_records")
    .insert({
      currency_code: "NGN",
      idempotency_key: idempotency("synthetic-order"),
      metadata: { gate: "finance_communication_lifecycle", runId },
      module_id: input.moduleId,
      module_version_id: input.moduleVersionId,
      order_payload: { gate: "finance_communication_lifecycle", runId },
      organization_id: input.organizationId,
      requester_user_id: input.customerUserId,
      service_request_id: input.serviceRequestId,
      source,
      status: "accepted",
      subtotal_amount: 2500,
      total_amount: 2500,
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return requireStringValue(data.id, "order id");
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
      target_metadata: { gate: "finance_communication_lifecycle", runId },
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

  return requireStringValue(data.id, `${walletType} platform wallet id`);
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
    body: JSON.stringify({ limit: 50 }),
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
    idempotencyKey: idempotency("otp-delivery"),
    metadata: { gate: "finance_communication_lifecycle", runId },
  });
  const data = body.data;

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("OTP delivery did not return a data object.");
  }

  return requireStringValue((data as Record<string, unknown>).code, "OTP delivery code");
}

async function requireOtpStorageIsProtected(user: GateUser, challengeId: string): Promise<void> {
  const challenge = await requireSingle(
    serviceClient
      .from("otp_challenges")
      .select("communication_message_id")
      .eq("id", challengeId)
      .single(),
    "read OTP challenge",
  );
  const communication = await requireSingle(
    serviceClient
      .from("communication_messages")
      .select("notification_message_id")
      .eq("id", challenge.communication_message_id)
      .single(),
    "read OTP communication",
  );
  const notification = await requireSingle(
    serviceClient
      .from("notification_messages")
      .select("payload")
      .eq("id", communication.notification_message_id)
      .single(),
    "read OTP notification",
  );
  const payload = notification.payload;

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("OTP notification payload was not an object.");
  }

  const otp = (payload as Record<string, unknown>).otp;
  if (!otp || typeof otp !== "object" || Array.isArray(otp)) {
    throw new Error("OTP notification payload did not contain otp object.");
  }

  requireCondition(
    !("code" in otp),
    "OTP notification payload exposed the raw OTP code.",
  );
  requireCondition(
    (otp as Record<string, unknown>).redacted === true,
    "OTP notification payload was not redacted.",
  );

  const directRead = await user.client
    .from("otp_delivery_codes")
    .select("code")
    .eq("otp_challenge_id", challengeId);
  requireCondition(Boolean(directRead.error), "OTP delivery code direct select was allowed.");
}

async function requireDepositStatus(depositId: string, expectedStatus: string): Promise<void> {
  const record = await requireSingle(
    serviceClient.from("payment_deposit_requests").select("status").eq("id", depositId).single(),
    "read deposit status",
  );
  requireCondition(
    record.status === expectedStatus,
    `expected deposit ${expectedStatus}, found ${String(record.status)}.`,
  );
}

async function requireWithdrawalStatus(
  withdrawalId: string,
  expectedStatus: string,
): Promise<void> {
  const record = await requireSingle(
    serviceClient.from("withdrawal_requests").select("status").eq("id", withdrawalId).single(),
    "read withdrawal status",
  );
  requireCondition(
    record.status === expectedStatus,
    `expected withdrawal ${expectedStatus}, found ${String(record.status)}.`,
  );
}

async function requireCommunicationStatus(
  communicationId: string,
  expectedStatus: string,
): Promise<void> {
  const record = await requireSingle(
    serviceClient
      .from("communication_messages")
      .select("status")
      .eq("id", communicationId)
      .single(),
    "read communication status",
  );
  requireCondition(
    record.status === expectedStatus,
    `expected communication ${expectedStatus}, found ${String(record.status)}.`,
  );
}

async function requireOtpStatus(challengeId: string, expectedStatus: string): Promise<void> {
  const record = await requireSingle(
    serviceClient.from("otp_challenges").select("status").eq("id", challengeId).single(),
    "read OTP status",
  );
  requireCondition(
    record.status === expectedStatus,
    `expected OTP ${expectedStatus}, found ${String(record.status)}.`,
  );
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
  const balance = Number(record.balance);
  requireCondition(
    balance === expectedBalance,
    `${label} expected ${expectedBalance}, found ${balance}.`,
  );
}

async function requireCommission(commissionId: string, expectedAmount: number): Promise<void> {
  const record = await requireSingle(
    serviceClient
      .from("commission_executions")
      .select("amount,status,transaction_id")
      .eq("id", commissionId)
      .single(),
    "read commission execution",
  );
  requireCondition(record.status === "posted", "commission execution was not posted.");
  requireCondition(Number(record.amount) === expectedAmount, "commission amount was incorrect.");
  requireCondition(Boolean(record.transaction_id), "commission execution has no transaction.");
}

async function requireSettlementStatement(
  statementId: string,
  expectedGross: number,
  expectedNet: number,
  expectedFee: number,
): Promise<void> {
  const record = await requireSingle(
    serviceClient
      .from("settlement_statements")
      .select("gross_amount,net_amount,platform_fee_amount,status,settlement_execution_id")
      .eq("id", statementId)
      .single(),
    "read settlement statement",
  );
  requireCondition(record.status === "posted", "settlement statement was not posted.");
  requireCondition(
    Number(record.gross_amount) === expectedGross,
    "settlement gross was incorrect.",
  );
  requireCondition(Number(record.net_amount) === expectedNet, "settlement net was incorrect.");
  requireCondition(
    Number(record.platform_fee_amount) === expectedFee,
    "settlement fee was incorrect.",
  );
  requireCondition(
    Boolean(record.settlement_execution_id),
    "settlement statement has no execution.",
  );
}

async function requireServiceRequestReconciled(serviceRequestId: string): Promise<void> {
  const { data, error } = await serviceClient.rpc("reconcile_service_request_financials", {
    target_service_request_id: serviceRequestId,
  });

  if (error) {
    throw error;
  }

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("financial reconciliation did not return an object.");
  }

  requireCondition(
    (data as Record<string, unknown>).balanced === true,
    `financial reconciliation was not balanced: ${JSON.stringify(data)}`,
  );
}

async function requireAppendOnlyProtection(): Promise<void> {
  const eventRecord = await requireSingle(
    serviceClient.from("payment_webhook_events").select("id").limit(1).single(),
    "read payment webhook event for append-only check",
  );

  const updateResult = await serviceClient
    .from("payment_webhook_events")
    .update({ metadata: { should_not_update: true } })
    .eq("id", eventRecord.id);
  requireCondition(Boolean(updateResult.error), "payment webhook event direct update was allowed.");

  const attemptRecord = await requireSingle(
    serviceClient.from("otp_attempts").select("id").limit(1).single(),
    "read OTP attempt for append-only check",
  );
  const deleteResult = await serviceClient.from("otp_attempts").delete().eq("id", attemptRecord.id);
  requireCondition(Boolean(deleteResult.error), "OTP attempt direct delete was allowed.");
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

async function requireRpcNumber(
  resultPromise: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  operationName: string,
): Promise<number> {
  const { data, error } = await resultPromise;

  if (error) {
    throw new Error(`${operationName} failed: ${error.message}`);
  }

  if (typeof data !== "number") {
    throw new Error(`${operationName} did not return a number.`);
  }

  return data;
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

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
