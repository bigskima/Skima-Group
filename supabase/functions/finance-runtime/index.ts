import { createClient, type SupabaseClient, type User } from "npm:@supabase/supabase-js@2.110.9";
import {
  createPaystackTransferRecipient,
  initiatePaystackTransfer,
  listPaystackBanks,
  PaystackPayoutError,
  resolvePaystackBankAccount,
} from "../_shared/paystack-payouts.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Origin": "*",
  "Content-Type": "application/json",
};

Deno.serve(async (request: Request): Promise<Response> => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  const requestId = crypto.randomUUID();
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("authorization");

  if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
    return json({ ok: false, error: "unauthorized", requestId }, 401);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });

  const userResult = await userClient.auth.getUser();
  const user = userResult.data.user;
  if (userResult.error || !user) {
    return json({ ok: false, error: "unauthorized", requestId }, 401);
  }

  try {
    const path = financePath(request.url);

    if (path === "/banks" && request.method === "GET") {
      return payoutBanks(userClient, serviceClient, requestId);
    }

    if (path === "/beneficiaries/resolve" && request.method === "POST") {
      return resolveBeneficiaryAccount(
        userClient,
        serviceClient,
        await readBody(request),
        requestId,
      );
    }

    if (path === "/deposits" && request.method === "GET") {
      return deposits(userClient, requestId);
    }

    if (path === "/deposits/preview" && request.method === "POST") {
      return depositPreview(userClient, user, await readBody(request), requestId);
    }

    if (path === "/deposits" && request.method === "POST") {
      return initializeDeposit(
        userClient,
        serviceClient,
        user,
        await readBody(request),
        requestId,
      );
    }

    if (path === "/beneficiaries" && request.method === "GET") {
      return beneficiaries(userClient, requestId);
    }

    if (path === "/beneficiaries" && request.method === "POST") {
      return configureBeneficiary(
        userClient,
        serviceClient,
        await readBody(request),
        requestId,
      );
    }

    if (path === "/withdrawals" && request.method === "GET") {
      return withdrawals(userClient, requestId);
    }

    if (path === "/withdrawals/preview" && request.method === "POST") {
      return withdrawalPreview(userClient, await readBody(request), requestId);
    }

    if (path === "/withdrawals" && request.method === "POST") {
      return requestWithdrawal(
        userClient,
        serviceClient,
        await readBody(request),
        requestId,
      );
    }

    if (path === "/withdrawals/retry" && request.method === "POST") {
      return retryWithdrawal(
        userClient,
        serviceClient,
        await readBody(request),
        requestId,
      );
    }

    if (path === "/revenue/summary" && request.method === "GET") {
      return revenueSummary(userClient, request, requestId);
    }

    if (path === "/revenue/activity" && request.method === "GET") {
      return revenueActivity(userClient, request, requestId);
    }

    if (path === "/settings" && request.method === "GET") {
      return moneySettings(userClient, requestId);
    }

    return json({ ok: false, error: "not_found", requestId }, 404);
  } catch (error) {
    console.error(JSON.stringify({
      severity: "error",
      source: "finance-runtime",
      requestId,
      message: error instanceof Error ? error.message : "unknown finance runtime error",
    }));
    return json(
      {
        ok: false,
        error: error instanceof FinanceError ? error.code : "finance_runtime_error",
        message: error instanceof Error ? error.message : "Finance request failed.",
        requestId,
      },
      error instanceof FinanceError ? error.status : 500,
    );
  }
});

class FinanceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

type Body = Readonly<Record<string, unknown>>;

function financePath(urlValue: string): string {
  let path = new URL(urlValue).pathname.replace(/\/+$/, "");
  const marker = "/finance-runtime";
  const index = path.indexOf(marker);
  if (index >= 0) path = path.slice(index + marker.length);
  return path || "/";
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: CORS_HEADERS });
}

async function readBody(request: Request): Promise<Body> {
  const value = await request.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FinanceError("invalid_request", "Request body must be a JSON object.");
  }
  return value as Body;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new FinanceError("invalid_request", `${field} is required.`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireNumber(value: unknown, field: string): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new FinanceError("invalid_request", `${field} must be greater than zero.`);
  }
  return number;
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function requireRpc<T>(promise: PromiseLike<{ data: T; error: { message: string } | null }>): Promise<T> {
  const result = await promise;
  if (result.error) throw new FinanceError("database_error", result.error.message);
  return result.data;
}

async function requireRevenueAccess(client: SupabaseClient): Promise<void> {
  const [read, manage] = await Promise.all([
    client.rpc("has_permission", {
      target_permission: "platform.revenue.read",
      target_organization_id: null,
    }),
    client.rpc("has_permission", {
      target_permission: "platform.revenue.manage",
      target_organization_id: null,
    }),
  ]);
  if (read.error) throw new FinanceError("database_error", read.error.message);
  if (manage.error) throw new FinanceError("database_error", manage.error.message);
  if (read.data !== true && manage.data !== true) {
    throw new FinanceError("forbidden", "SKIMA Revenue is restricted to Finance Admin and Super Admin.", 403);
  }
}

async function payoutBanks(
  client: SupabaseClient,
  serviceClient: SupabaseClient,
  requestId: string,
): Promise<Response> {
  const { data, error } = await client
    .from("currency_definitions")
    .select("code,display_name,symbol,metadata")
    .eq("code", "NGN")
    .eq("status", "enabled")
    .maybeSingle();
  if (error) throw new FinanceError("database_error", error.message);

  const metadata = optionalRecord(data?.metadata);
  const publicPayout = optionalRecord(metadata.public_payout);
  const configuredBanks = Array.isArray(publicPayout.banks) ? publicPayout.banks : [];
  const providerKey = await activePaymentProvider(serviceClient);

  if (providerKey === "provider.payment.paystack") {
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (secret) {
      try {
        const banks = await listPaystackBanks(secret);
        if (banks.length > 0) {
          return json({
            ok: true,
            data: {
              currencyCode: "NGN",
              available: true,
              provider: providerKey,
              source: "paystack",
              banks,
            },
            requestId,
          });
        }
      } catch (error) {
        if (!(error instanceof PaystackPayoutError)) throw error;
      }
    }
  }

  return json({
    ok: true,
    data: {
      currencyCode: data?.code ?? "NGN",
      available: publicPayout.available === true,
      provider: providerKey,
      source: "configured-fallback",
      banks: configuredBanks,
    },
    requestId,
  });
}

async function resolveBeneficiaryAccount(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  body: Body,
  requestId: string,
): Promise<Response> {
  const walletId = requireString(body.walletId, "walletId");
  const bankCode = requireString(body.bankCode, "bankCode");
  const accountNumber = requireString(body.accountNumber, "accountNumber");

  const walletAccess = await userClient.rpc("can_access_wallet_account", {
    target_wallet_id: walletId,
  });
  if (walletAccess.error) {
    throw new FinanceError("database_error", walletAccess.error.message);
  }
  if (walletAccess.data !== true) {
    throw new FinanceError(
      "forbidden",
      "You can only verify a payout account for a wallet you are allowed to use.",
      403,
    );
  }

  const providerKey = await activePaymentProvider(serviceClient);

  if (providerKey !== "provider.payment.paystack") {
    await assertConfiguredBank(serviceClient, bankCode);
    return json({
      ok: true,
      data: {
        bankCode,
        accountNumber,
        accountName: `Sandbox payout account •••• ${accountNumber.slice(-4)}`,
        provider: providerKey,
        verified: true,
      },
      requestId,
    });
  }

  const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!secret) {
    throw new FinanceError("payment_provider_unavailable", "Paystack payouts are not configured.", 503);
  }

  try {
    const account = await resolvePaystackBankAccount(secret, accountNumber, bankCode);
    return json({
      ok: true,
      data: {
        ...account,
        provider: providerKey,
        verified: true,
      },
      requestId,
    });
  } catch (error) {
    throw financeErrorFromPaystack(error);
  }
}

async function deposits(client: SupabaseClient, requestId: string): Promise<Response> {
  const { data, error } = await client
    .from("payment_deposit_requests")
    .select("id,public_reference,wallet_id,currency_code,amount,fee_amount,total_charge_amount,status,provider_reference,checkout_url,initialized_at,verified_at,failed_at,reversed_at,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new FinanceError("database_error", error.message);
  return json({ ok: true, data: data ?? [], requestId });
}

async function ensureCustomerWallet(
  client: SupabaseClient,
  user: User,
  body: Body,
): Promise<string> {
  const supplied = optionalString(body.walletId);
  if (supplied) return supplied;
  const idempotencyKey = optionalString(body.idempotencyKey) ?? crypto.randomUUID();
  const walletId = await requireRpc<string>(client.rpc("ensure_wallet_account", {
    target_wallet_type: "customer",
    target_owner_entity_type: "user",
    target_owner_entity_id: user.id,
    target_currency_code: "NGN",
    target_source: "platform.finance_runtime",
    target_metadata: { wallet_purpose: "customer_deposit" },
    target_idempotency_key: `${idempotencyKey}:wallet`,
  }));
  return String(walletId);
}

async function depositPreview(
  client: SupabaseClient,
  user: User,
  body: Body,
  requestId: string,
): Promise<Response> {
  const amount = requireNumber(body.amount, "amount");
  const walletId = await ensureCustomerWallet(client, user, body);
  const preview = await requireRpc(client.rpc("calculate_deposit_fee_from_policy", {
    target_wallet_id: walletId,
    target_amount: amount,
  }));
  return json({ ok: true, data: preview, walletId, requestId });
}

async function initializeDeposit(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  user: User,
  body: Body,
  requestId: string,
): Promise<Response> {
  const amount = requireNumber(body.amount, "amount");
  const idempotencyKey = requireString(body.idempotencyKey, "idempotencyKey");
  const walletId = await ensureCustomerWallet(userClient, user, body);
  const providerKey = await activePaymentProvider(serviceClient);

  const depositId = String(await requireRpc(userClient.rpc("initialize_wallet_deposit", {
    target_wallet_id: walletId,
    target_amount: amount,
    target_currency_code: "NGN",
    target_provider_adapter_key: providerKey,
    target_source: "platform.finance_runtime",
    target_idempotency_key: idempotencyKey,
    target_metadata: {
      ...optionalRecord(body.metadata),
      initiatedBy: "finance-runtime",
    },
  })));

  const { data: deposit, error } = await serviceClient
    .from("payment_deposit_requests")
    .select("id,public_reference,wallet_id,provider_adapter_id,currency_code,amount,fee_amount,total_charge_amount,status,provider_reference,checkout_url")
    .eq("id", depositId)
    .single();
  if (error || !deposit) throw new FinanceError("database_error", error?.message ?? "Deposit was not found.");

  if (providerKey !== "provider.payment.paystack") {
    return json({ ok: true, data: deposit, requestId });
  }

  const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!paystackSecret) {
    throw new FinanceError("payment_provider_unavailable", "Paystack is not configured.", 503);
  }
  if (!user.email) {
    throw new FinanceError("customer_email_required", "A verified customer email is required for card or bank payment.");
  }

  const requestPayload: Record<string, unknown> = {
    amount: Math.round(Number(deposit.total_charge_amount) * 100),
    currency: deposit.currency_code,
    email: user.email,
    reference: deposit.provider_reference,
    metadata: {
      depositRequestId: deposit.id,
      publicReference: deposit.public_reference,
      walletId: deposit.wallet_id,
      walletCreditAmount: deposit.amount,
      skimaFeeAmount: deposit.fee_amount,
      totalChargeAmount: deposit.total_charge_amount,
    },
  };
  const callbackUrl = optionalString(body.callbackUrl) ?? Deno.env.get("SKIMA_PAYSTACK_CALLBACK_URL") ?? null;
  if (callbackUrl) requestPayload.callback_url = callbackUrl;

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${paystackSecret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(requestPayload),
    signal: AbortSignal.timeout(20_000),
  });
  const responseBody = await response.json() as Record<string, unknown>;
  const responseData = optionalRecord(responseBody.data);
  const authorizationUrl = optionalString(responseData.authorization_url);

  await serviceClient.rpc("record_provider_execution", {
    target_error_message: response.ok ? null : optionalString(responseBody.message) ?? "Paystack initialization failed",
    target_idempotency_key: `${idempotencyKey}:paystack`,
    target_operation_key: "provider.payment.initialize",
    target_provider_adapter_key: "provider.payment.paystack",
    target_provider_kind: "payment",
    target_request_payload: requestPayload,
    target_response_payload: responseBody,
    target_status: response.ok ? "succeeded" : "failed",
  });

  if (!response.ok || !authorizationUrl) {
    throw new FinanceError(
      "payment_initialization_failed",
      optionalString(responseBody.message) ?? "Payment initialization failed.",
      502,
    );
  }

  const update = await serviceClient
    .from("payment_deposit_requests")
    .update({ checkout_url: authorizationUrl, updated_at: new Date().toISOString() })
    .eq("id", depositId);
  if (update.error) throw new FinanceError("database_error", update.error.message);

  return json({
    ok: true,
    data: {
      ...deposit,
      checkout_url: authorizationUrl,
      authorizationUrl,
    },
    requestId,
  });
}

async function beneficiaries(client: SupabaseClient, requestId: string): Promise<Response> {
  const { data, error } = await client
    .from("withdrawal_beneficiaries")
    .select("id,wallet_id,beneficiary_type,bank_code,account_number_last4,account_name,status,verified_at,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new FinanceError("database_error", error.message);
  return json({ ok: true, data: data ?? [], requestId });
}

async function configureBeneficiary(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  body: Body,
  requestId: string,
): Promise<Response> {
  const walletId = requireString(body.walletId, "walletId");
  const bankCode = requireString(body.bankCode, "bankCode");
  const accountNumber = requireString(body.accountNumber, "accountNumber");
  const idempotencyKey = requireString(body.idempotencyKey, "idempotencyKey");
  const providerKey = await activePaymentProvider(serviceClient);
  const baseMetadata = optionalRecord(body.metadata);

  let accountName: string;
  let recipient: Awaited<ReturnType<typeof createPaystackTransferRecipient>> | null = null;

  if (providerKey === "provider.payment.paystack") {
    const secret = Deno.env.get("PAYSTACK_SECRET_KEY");
    if (!secret) {
      throw new FinanceError("payment_provider_unavailable", "Paystack payouts are not configured.", 503);
    }
    try {
      const resolved = await resolvePaystackBankAccount(secret, accountNumber, bankCode);
      accountName = resolved.accountName;
      recipient = await createPaystackTransferRecipient(secret, resolved);
    } catch (error) {
      throw financeErrorFromPaystack(error);
    }
  } else {
    await assertConfiguredBank(serviceClient, bankCode);
    accountName = optionalString(body.accountName) ??
      `Sandbox payout account •••• ${accountNumber.slice(-4)}`;
  }

  const beneficiaryId = String(await requireRpc(userClient.rpc("configure_withdrawal_beneficiary", {
    target_wallet_id: walletId,
    target_beneficiary_type: "bank_account",
    target_bank_code: bankCode,
    target_account_number: accountNumber,
    target_account_name: accountName,
    target_provider_adapter_key: providerKey,
    target_source: "platform.finance_runtime",
    target_idempotency_key: idempotencyKey,
    target_metadata: {
      ...baseMetadata,
      accountNameSource: providerKey === "provider.payment.paystack"
        ? "paystack.bank.resolve"
        : "sandbox",
      resolvedAt: new Date().toISOString(),
    },
  })));

  if (recipient) {
    const current = await serviceClient
      .from("withdrawal_beneficiaries")
      .select("metadata")
      .eq("id", beneficiaryId)
      .single();
    if (current.error) throw new FinanceError("database_error", current.error.message);

    const updated = await serviceClient
      .from("withdrawal_beneficiaries")
      .update({
        account_name: recipient.accountName,
        provider_recipient_code: recipient.recipientCode,
        status: "verified",
        verified_at: new Date().toISOString(),
        metadata: {
          ...optionalRecord(current.data?.metadata),
          paystackRecipientCode: recipient.recipientCode,
          paystackRecipientId: recipient.recipientId,
          accountNameSource: "paystack.bank.resolve",
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", beneficiaryId);
    if (updated.error) throw new FinanceError("database_error", updated.error.message);
  }

  const record = await userClient
    .from("withdrawal_beneficiaries")
    .select("id,wallet_id,beneficiary_type,bank_code,account_number_last4,account_name,status,verified_at,created_at,updated_at")
    .eq("id", beneficiaryId)
    .single();
  if (record.error) throw new FinanceError("database_error", record.error.message);
  return json({ ok: true, data: record.data, requestId });
}

async function withdrawals(client: SupabaseClient, requestId: string): Promise<Response> {
  const { data, error } = await client
    .from("withdrawal_requests")
    .select("id,public_reference,wallet_id,beneficiary_id,currency_code,amount,fee_amount,total_debit_amount,status,provider_reference,requested_at,approved_at,processed_at,failed_at,reversed_at,created_at,updated_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new FinanceError("database_error", error.message);
  return json({ ok: true, data: data ?? [], requestId });
}

async function withdrawalPreview(
  client: SupabaseClient,
  body: Body,
  requestId: string,
): Promise<Response> {
  const walletId = requireString(body.walletId, "walletId");
  const amount = requireNumber(body.amount, "amount");
  const preview = await requireRpc(client.rpc("calculate_withdrawal_fee_from_policy", {
    target_wallet_id: walletId,
    target_amount: amount,
  }));
  const record = optionalRecord(preview);
  const fee = Number(record.calculatedFeeAmount ?? 0);
  return json({
    ok: true,
    data: {
      ...record,
      totalDebitAmount: amount + fee,
      amountSentToBank: amount,
    },
    requestId,
  });
}

async function requestWithdrawal(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  body: Body,
  requestId: string,
): Promise<Response> {
  const walletId = requireString(body.walletId, "walletId");
  const beneficiaryId = requireString(body.beneficiaryId, "beneficiaryId");
  const amount = requireNumber(body.amount, "amount");
  const idempotencyKey = requireString(body.idempotencyKey, "idempotencyKey");

  const feeSnapshot = optionalRecord(await requireRpc(userClient.rpc("calculate_withdrawal_fee_from_policy", {
    target_wallet_id: walletId,
    target_amount: amount,
  })));
  const feeAmount = Number(feeSnapshot.calculatedFeeAmount ?? 0);

  const withdrawalId = String(await requireRpc(userClient.rpc("request_wallet_withdrawal", {
    target_wallet_id: walletId,
    target_beneficiary_id: beneficiaryId,
    target_amount: amount,
    target_fee_amount: feeAmount,
    target_source: "platform.finance_runtime",
    target_idempotency_key: idempotencyKey,
    target_metadata: {
      ...optionalRecord(body.metadata),
      financialPolicySnapshot: feeSnapshot,
      requestedThrough: "finance-runtime",
    },
  })));

  await requireRpc(serviceClient.rpc("approve_wallet_withdrawal", {
    target_withdrawal_request_id: withdrawalId,
    target_source: "platform.finance_runtime",
    target_idempotency_key: `finance-runtime:${withdrawalId}:approve`,
    target_metadata: { automaticRuntimeApproval: true },
  }));

  const transfer = await initiateWithdrawalTransfer(serviceClient, withdrawalId);
  const record = await userClient
    .from("withdrawal_requests")
    .select("id,public_reference,wallet_id,beneficiary_id,currency_code,amount,fee_amount,total_debit_amount,status,provider_reference,requested_at,approved_at,processed_at,failed_at,reversed_at,created_at,updated_at")
    .eq("id", withdrawalId)
    .single();
  if (record.error) throw new FinanceError("database_error", record.error.message);

  return json({ ok: true, data: record.data, transfer, requestId });
}

async function retryWithdrawal(
  userClient: SupabaseClient,
  serviceClient: SupabaseClient,
  body: Body,
  requestId: string,
): Promise<Response> {
  const withdrawalId = requireString(body.withdrawalRequestId, "withdrawalRequestId");
  const owned = await userClient
    .from("withdrawal_requests")
    .select("id,status")
    .eq("id", withdrawalId)
    .maybeSingle();
  if (owned.error) throw new FinanceError("database_error", owned.error.message);
  if (!owned.data) throw new FinanceError("not_found", "Withdrawal was not found.", 404);
  if (owned.data.status === "processing" || owned.data.status === "succeeded") {
    return json({ ok: true, data: owned.data, requestId });
  }
  if (owned.data.status !== "approved") {
    throw new FinanceError("invalid_withdrawal_state", "Only an approved withdrawal can be retried.");
  }
  const transfer = await initiateWithdrawalTransfer(serviceClient, withdrawalId);
  const record = await userClient
    .from("withdrawal_requests")
    .select("id,public_reference,wallet_id,beneficiary_id,currency_code,amount,fee_amount,total_debit_amount,status,provider_reference,requested_at,approved_at,processed_at,failed_at,reversed_at,created_at,updated_at")
    .eq("id", withdrawalId)
    .single();
  if (record.error) throw new FinanceError("database_error", record.error.message);
  return json({ ok: true, data: { ...record.data, transfer }, requestId });
}

async function initiateWithdrawalTransfer(
  serviceClient: SupabaseClient,
  withdrawalId: string,
): Promise<Record<string, unknown>> {
  const withdrawal = await serviceClient
    .from("withdrawal_requests")
    .select("id,public_reference,beneficiary_id,provider_adapter_id,currency_code,amount,fee_amount,total_debit_amount,status,provider_reference")
    .eq("id", withdrawalId)
    .single();
  if (withdrawal.error || !withdrawal.data) {
    throw new FinanceError("database_error", withdrawal.error?.message ?? "Withdrawal was not found.");
  }
  if (!['approved', 'processing'].includes(withdrawal.data.status)) {
    return { status: withdrawal.data.status };
  }

  const adapter = await serviceClient
    .from("provider_adapters")
    .select("key")
    .eq("id", withdrawal.data.provider_adapter_id)
    .single();
  if (adapter.error) throw new FinanceError("database_error", adapter.error.message);

  if (adapter.data.key !== "provider.payment.paystack") {
    await requireRpc(serviceClient.rpc("process_wallet_withdrawal_transfer", {
      target_withdrawal_request_id: withdrawalId,
      target_provider_status: "succeeded",
      target_provider_reference: withdrawal.data.public_reference,
      target_response_payload: { sandbox: true },
      target_source: "platform.finance_runtime",
      target_idempotency_key: `finance-runtime:${withdrawalId}:sandbox-success`,
      target_metadata: { automaticRuntimeTransfer: true },
    }));
    return { provider: adapter.data.key, status: "succeeded" };
  }

  const beneficiary = await serviceClient
    .from("withdrawal_beneficiaries")
    .select("provider_recipient_code,status")
    .eq("id", withdrawal.data.beneficiary_id)
    .single();
  if (beneficiary.error || !beneficiary.data) {
    throw new FinanceError("database_error", beneficiary.error?.message ?? "Beneficiary was not found.");
  }
  if (beneficiary.data.status !== "verified" || !beneficiary.data.provider_recipient_code) {
    throw new FinanceError("beneficiary_not_verified", "A verified bank beneficiary is required.");
  }

  const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");
  if (!paystackSecret) {
    throw new FinanceError("payment_provider_unavailable", "Paystack transfer is not configured.", 503);
  }

  const reference = `skima-wdl-${withdrawalId.replaceAll("-", "")}`;
  const referenceReservation = await serviceClient
    .from("withdrawal_requests")
    .update({
      provider_reference: reference,
      updated_at: new Date().toISOString(),
    })
    .eq("id", withdrawalId);
  if (referenceReservation.error) {
    throw new FinanceError("database_error", referenceReservation.error.message);
  }

  let transfer;
  try {
    transfer = await initiatePaystackTransfer(paystackSecret, {
      amountMajor: Number(withdrawal.data.amount),
      recipientCode: beneficiary.data.provider_recipient_code,
      reason: "SKIMA wallet withdrawal",
      reference,
    });
  } catch (error) {
    if (error instanceof PaystackPayoutError && error.code === "paystack_unreachable") {
      // Network ambiguity is deliberately not treated as a failed payout. The
      // reserved wallet funds remain approved and the same provider reference
      // can be safely retried or finalized by webhook.
      return {
        provider: "provider.payment.paystack",
        status: "approved",
        retryable: true,
        message: error.message,
      };
    }

    if (error instanceof PaystackPayoutError) {
      await requireRpc(serviceClient.rpc("process_wallet_withdrawal_transfer", {
        target_withdrawal_request_id: withdrawalId,
        target_provider_status: "failed",
        target_provider_reference: reference,
        target_response_payload: {
          status: false,
          error: error.code,
          message: error.message,
        },
        target_source: "platform.finance_runtime",
        target_idempotency_key: `finance-runtime:${withdrawalId}:transfer:${reference}:failed`,
        target_metadata: {
          automaticRuntimeTransfer: true,
          paystackErrorCode: error.code,
          paystackErrorMessage: error.message,
          principalAttempted: withdrawal.data.amount,
          skimaFeeRetained: withdrawal.data.fee_amount,
        },
      }));
      return {
        provider: "provider.payment.paystack",
        providerReference: reference,
        providerStatus: "failed",
        principalSentToProvider: 0,
        skimaFee: withdrawal.data.fee_amount,
        message: error.message,
      };
    }

    throw financeErrorFromPaystack(error);
  }

  await requireRpc(serviceClient.rpc("process_wallet_withdrawal_transfer", {
    target_withdrawal_request_id: withdrawalId,
    target_provider_status: transfer.providerStatus,
    target_provider_reference: transfer.providerReference,
    target_response_payload: transfer.response,
    target_source: "platform.finance_runtime",
    target_idempotency_key: `finance-runtime:${withdrawalId}:transfer:${transfer.providerReference}:${transfer.providerStatus}`,
    target_metadata: {
      automaticRuntimeTransfer: true,
      principalSentToProvider: withdrawal.data.amount,
      skimaFeeRetained: withdrawal.data.fee_amount,
    },
  }));

  return {
    provider: "provider.payment.paystack",
    providerReference: transfer.providerReference,
    providerStatus: transfer.providerStatus,
    principalSentToProvider: withdrawal.data.amount,
    skimaFee: withdrawal.data.fee_amount,
  };
}

async function revenueSummary(
  client: SupabaseClient,
  request: Request,
  requestId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const data = await requireRpc(client.rpc("platform_revenue_summary", {
    target_currency_code: url.searchParams.get("currency") ?? "NGN",
    target_from: url.searchParams.get("from"),
    target_until: url.searchParams.get("until"),
  }));
  return json({ ok: true, data, requestId });
}

async function revenueActivity(
  client: SupabaseClient,
  request: Request,
  requestId: string,
): Promise<Response> {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const data = await requireRpc(client.rpc("platform_revenue_activity", {
    target_currency_code: url.searchParams.get("currency") ?? "NGN",
    target_from: url.searchParams.get("from"),
    target_until: url.searchParams.get("until"),
    target_limit: Number.isFinite(limit) ? Math.min(Math.max(Math.round(limit), 1), 500) : 100,
  }));
  return json({ ok: true, data, requestId });
}

async function moneySettings(client: SupabaseClient, requestId: string): Promise<Response> {
  await requireRevenueAccess(client);
  const specifications = [
    { key: "fees.deposit.default", moduleKey: null, serviceKey: "wallet.deposit" },
    { key: "fees.withdrawal.default", moduleKey: null, serviceKey: "wallet.withdrawal" },
    { key: "pricing.lpg.platform_markup_per_kg", moduleKey: "lpg", serviceKey: "lpg.refill" },
    { key: "pricing.lpg.delivery", moduleKey: "lpg", serviceKey: "lpg.refill.delivery" },
    { key: "payout.lpg.driver", moduleKey: "lpg", serviceKey: "lpg.refill.delivery" },
    { key: "settlement.lpg.beneficiaries", moduleKey: "lpg", serviceKey: "lpg.refill.settlement" },
  ] as const;

  const data: Record<string, unknown> = {};
  for (const specification of specifications) {
    const result = await client.rpc("resolve_financial_policy", {
      target_policy_key: specification.key,
      target_currency_code: "NGN",
      target_module_key: specification.moduleKey,
      target_organization_id: null,
      target_service_key: specification.serviceKey,
      target_geography_type: "global",
      target_geography_key: null,
    });
    if (result.error) {
      data[specification.key] = { error: result.error.message };
    } else {
      data[specification.key] = result.data;
    }
  }
  return json({ ok: true, data, requestId });
}

function financeErrorFromPaystack(error: unknown): FinanceError {
  if (error instanceof PaystackPayoutError) {
    return new FinanceError(error.code, error.message, error.status);
  }
  return new FinanceError(
    "paystack_payout_error",
    error instanceof Error ? error.message : "Paystack payout request failed.",
    502,
  );
}

async function activePaymentProvider(serviceClient: SupabaseClient): Promise<string> {
  const paystack = await serviceClient
    .from("provider_adapters")
    .select("key")
    .eq("provider_kind", "payment")
    .eq("key", "provider.payment.paystack")
    .eq("status", "active")
    .maybeSingle();
  if (paystack.error) throw new FinanceError("database_error", paystack.error.message);
  if (paystack.data) return paystack.data.key;

  const sandbox = await serviceClient
    .from("provider_adapters")
    .select("key")
    .eq("provider_kind", "payment")
    .eq("key", "provider.payment.sandbox")
    .eq("status", "active")
    .maybeSingle();
  if (sandbox.error) throw new FinanceError("database_error", sandbox.error.message);
  if (sandbox.data) return sandbox.data.key;
  throw new FinanceError("payment_provider_unavailable", "No active payment provider is configured.", 503);
}

async function assertConfiguredBank(serviceClient: SupabaseClient, bankCode: string): Promise<void> {
  const currency = await serviceClient
    .from("currency_definitions")
    .select("metadata")
    .eq("code", "NGN")
    .eq("status", "enabled")
    .maybeSingle();
  if (currency.error) throw new FinanceError("database_error", currency.error.message);
  const publicPayout = optionalRecord(optionalRecord(currency.data?.metadata).public_payout);
  const banks = Array.isArray(publicPayout.banks) ? publicPayout.banks : [];
  const configured = banks.some((bank) => optionalString(optionalRecord(bank).code) === bankCode);
  if (!configured) throw new FinanceError("unsupported_bank", "The selected bank is not currently enabled for SKIMA payouts.");
}
