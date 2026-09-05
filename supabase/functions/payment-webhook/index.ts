import { createClient } from "npm:@supabase/supabase-js@2.110.9";

import { jsonResponse, optionsResponse, requestId } from "../_shared/http.ts";

Deno.serve(async (request: Request): Promise<Response> => {
  const id = requestId(request);

  if (request.method === "OPTIONS") {
    return optionsResponse();
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed", requestId: id }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
  }

  let rawBody: string;
  let verification: WebhookVerification;
  let payload: Record<string, unknown>;
  let normalized: NormalizedPaymentWebhook;

  try {
    rawBody = await request.text();
    verification = await verifyWebhookRequest(request, rawBody);
    payload = readWebhookPayload(rawBody);
    normalized = normalizePaymentWebhook(payload, verification, id);
  } catch (error) {
    if (error instanceof WebhookAuthenticationError) {
      return jsonResponse({ ok: false, error: "unauthorized", requestId: id }, 401);
    }

    if (error instanceof WebhookConfigurationError) {
      return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
    }

    return jsonResponse(
      {
        ok: false,
        error: "invalid_request",
        message: error instanceof Error ? error.message : "invalid webhook payload",
        requestId: id,
      },
      400,
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  if (
    normalized.providerStatus &&
    (normalized.eventTypeKey.includes("transfer") ||
      String(normalized.metadata?.paystackEvent).startsWith("transfer."))
  ) {
    const { data: withdrawalRecord } = await supabase
      .from("withdrawal_requests")
      .select("id")
      .or(
        `provider_reference.eq.${normalized.providerReference},public_reference.eq.${normalized.providerReference}`,
      )
      .maybeSingle();

    if (withdrawalRecord) {
      const withdrawalResult = await supabase.rpc("process_wallet_withdrawal_transfer", {
        target_idempotency_key: normalized.idempotencyKey,
        target_metadata: {
          ...normalized.metadata,
          requestId: id,
          source: "payment-webhook",
        },
        target_provider_reference: normalized.providerReference,
        target_provider_status: normalized.providerStatus,
        target_response_payload: payload,
        target_source: normalized.source,
        target_withdrawal_request_id: withdrawalRecord.id,
      });

      if (!withdrawalResult.error) {
        await recordProviderExecution(
          supabase,
          normalized,
          payload,
          { withdrawalRequestId: withdrawalResult.data },
          "succeeded",
          id,
        );

        return jsonResponse({
          ok: true,
          requestId: id,
          withdrawalRequestId: withdrawalResult.data,
        });
      }
    }
  }

  if (
    normalized.providerStatus &&
    (normalized.depositRequestId || normalized.providerReference)
  ) {
    const depositResult = await supabase.rpc("process_wallet_deposit_provider_event", {
      target_deposit_request_id: normalized.depositRequestId,
      target_idempotency_key: normalized.idempotencyKey,
      target_metadata: {
        ...normalized.metadata,
        requestId: id,
        source: "payment-webhook",
      },
      target_payload: payload,
      target_provider_reference: normalized.providerReference,
      target_provider_status: normalized.providerStatus,
      target_signature_verified: verification.signatureVerified,
      target_source: normalized.source,
    });

    if (depositResult.error) {
      await supabase.from("error_reports").upsert({
        context: {
          code: depositResult.error.code,
          payload,
          requestId: id,
        },
        fingerprint: `payment-deposit-webhook:${normalized.idempotencyKey}`,
        message: depositResult.error.message,
        severity: "error",
        source: "payment-webhook",
        status: "open",
      });

      return jsonResponse(
        {
          error: "database_error",
          message: depositResult.error.message,
          ok: false,
          requestId: id,
        },
        400,
      );
    }

    const providerResult = await recordProviderExecution(
      supabase,
      normalized,
      payload,
      { depositRequestId: depositResult.data },
      "succeeded",
      id,
    );

    if (providerResult) {
      return providerResult;
    }

    return jsonResponse({
      depositRequestId: depositResult.data,
      ok: true,
      requestId: id,
    });
  }

  const eventResult = await supabase.rpc("record_platform_event", {
    target_event_type_key: normalized.eventTypeKey,
    target_idempotency_key: normalized.idempotencyKey,
    target_occurred_at: normalized.occurredAt ?? new Date().toISOString(),
    target_payload: payload,
    target_source: normalized.source,
    target_subject_id: normalized.subjectId ?? crypto.randomUUID(),
    target_subject_type: normalized.subjectType,
  });

  if (eventResult.error) {
    await supabase.from("error_reports").upsert({
      context: {
        code: eventResult.error.code,
        payload,
        requestId: id,
      },
      fingerprint: `payment-webhook:${normalized.eventTypeKey}:${normalized.idempotencyKey}`,
      message: eventResult.error.message,
      severity: "error",
      source: "payment-webhook",
      status: "open",
    });

    return jsonResponse(
      {
        ok: false,
        error: "database_error",
        message: eventResult.error.message,
        requestId: id,
      },
      400,
    );
  }

  const providerResult = await recordProviderExecution(
    supabase,
    normalized,
    payload,
    { eventId: eventResult.data, received: true },
    "succeeded",
    id,
  );

  if (providerResult) {
    return providerResult;
  }

  return jsonResponse({
    ok: true,
    eventId: eventResult.data,
    requestId: id,
  });
});

interface WebhookVerification {
  readonly providerAdapterKey: string;
  readonly providerName: "paystack" | "sandbox";
  readonly signatureHeader: string;
  readonly signatureVerified: boolean;
}

interface NormalizedPaymentWebhook {
  readonly depositRequestId: string | null;
  readonly eventTypeKey: string;
  readonly idempotencyKey: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  readonly occurredAt: string | null;
  readonly providerAdapterKey: string;
  readonly providerReference: string | null;
  readonly providerStatus: "succeeded" | "failed" | "reversed" | null;
  readonly source: string;
  readonly subjectId: string | null;
  readonly subjectType: string;
}

interface RpcClient {
  rpc(
    functionName: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
}

class WebhookAuthenticationError extends Error {
  override readonly name = "WebhookAuthenticationError";
}

class WebhookConfigurationError extends Error {
  override readonly name = "WebhookConfigurationError";
}

async function verifyWebhookRequest(
  request: Request,
  rawBody: string,
): Promise<WebhookVerification> {
  const paystackSignature = request.headers.get("x-paystack-signature");

  if (paystackSignature) {
    const paystackSecret = Deno.env.get("PAYSTACK_SECRET_KEY");

    if (!paystackSecret) {
      throw new WebhookConfigurationError("PAYSTACK_SECRET_KEY is required for Paystack webhooks.");
    }

    const expectedSignature = await hmacHex("SHA-512", paystackSecret, rawBody);

    if (!constantTimeEqual(paystackSignature.toLowerCase(), expectedSignature)) {
      throw new WebhookAuthenticationError("Paystack webhook signature verification failed.");
    }

    return {
      providerAdapterKey: "provider.payment.paystack",
      providerName: "paystack",
      signatureHeader: "x-paystack-signature",
      signatureVerified: true,
    };
  }

  const webhookSecret = Deno.env.get("SKIMA_PAYMENT_WEBHOOK_SECRET");
  const suppliedSecret = request.headers.get("x-skima-webhook-secret");

  if (!webhookSecret || suppliedSecret !== webhookSecret) {
    throw new WebhookAuthenticationError("Payment webhook signature verification failed.");
  }

  return {
    providerAdapterKey: "provider.payment.sandbox",
    providerName: "sandbox",
    signatureHeader: "x-skima-webhook-secret",
    signatureVerified: true,
  };
}

function readWebhookPayload(rawBody: string): Record<string, unknown> {
  const value = JSON.parse(rawBody);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("webhook payload must be a JSON object");
  }

  return value as Record<string, unknown>;
}

function normalizePaymentWebhook(
  payload: Readonly<Record<string, unknown>>,
  verification: WebhookVerification,
  requestIdValue: string,
): NormalizedPaymentWebhook {
  if (verification.providerName === "paystack") {
    return normalizePaystackWebhook(payload, verification);
  }

  const providerReference = optionalString(payload.providerReference) ??
    optionalString(payload.provider_reference) ??
    optionalString(payload.externalReference);

  return {
    depositRequestId: optionalUuid(payload.depositRequestId) ??
      optionalUuid(payload.deposit_request_id),
    eventTypeKey: optionalString(payload.eventTypeKey) ?? "event.payment.received",
    idempotencyKey: optionalString(payload.idempotencyKey) ??
      optionalString(payload.externalReference) ??
      requestIdValue,
    metadata: {
      provider: verification.providerName,
      providerAdapterKey: verification.providerAdapterKey,
      signatureHeader: verification.signatureHeader,
    },
    occurredAt: optionalString(payload.occurredAt),
    providerAdapterKey: verification.providerAdapterKey,
    providerReference,
    providerStatus: normalizeSandboxProviderStatus(
      optionalString(payload.providerStatus) ?? optionalString(payload.status),
    ),
    source: optionalString(payload.source) ?? "provider.payment.sandbox.webhook",
    subjectId: optionalUuid(payload.subjectId),
    subjectType: optionalString(payload.subjectType) ?? "payment.webhook",
  };
}

function normalizePaystackWebhook(
  payload: Readonly<Record<string, unknown>>,
  verification: WebhookVerification,
): NormalizedPaymentWebhook {
  const eventName = requireString(payload.event, "event");
  const data = requireRecord(payload.data, "data");
  const reference = requireString(data.reference, "data.reference");
  const providerStatus = normalizePaystackProviderStatus(eventName, optionalString(data.status));
  const paystackEventId = optionalStringOrNumber(data.id);

  return {
    depositRequestId: optionalUuid(data.deposit_request_id) ??
      optionalUuid(requireRecordOrEmpty(data.metadata).depositRequestId) ??
      optionalUuid(requireRecordOrEmpty(data.metadata).deposit_request_id),
    eventTypeKey: `event.payment.paystack.${eventName.replaceAll(".", "_")}`,
    idempotencyKey: `paystack:${eventName}:${reference}:${paystackEventId ?? "event"}`,
    metadata: {
      paystackEvent: eventName,
      provider: verification.providerName,
      providerAdapterKey: verification.providerAdapterKey,
      signatureHeader: verification.signatureHeader,
    },
    occurredAt: optionalString(data.paid_at) ?? optionalString(data.created_at),
    providerAdapterKey: verification.providerAdapterKey,
    providerReference: reference,
    providerStatus,
    source: "provider.payment.paystack.webhook",
    subjectId: null,
    subjectType: "payment.webhook",
  };
}

function normalizeSandboxProviderStatus(
  status: string | null,
): "succeeded" | "failed" | "reversed" | null {
  if (!status) {
    return null;
  }

  if (status === "success") {
    return "succeeded";
  }

  if (status === "succeeded" || status === "failed" || status === "reversed") {
    return status;
  }

  return null;
}

function normalizePaystackProviderStatus(
  eventName: string,
  status: string | null,
): "succeeded" | "failed" | "reversed" | null {
  // Reversal must be resolved before the generic non-success transfer branch.
  // Paystack can send transfer.reversed with status=reversed; treating that as
  // failed would skip the provider-reversal ledger path.
  if (
    eventName === "transfer.reversed" ||
    eventName === "refund.processed" ||
    status === "reversed"
  ) {
    return "reversed";
  }

  if (
    (eventName === "charge.success" && status === "success") ||
    eventName === "transfer.success" ||
    (eventName.startsWith("transfer.") && status === "success")
  ) {
    return "succeeded";
  }

  if (
    eventName === "transfer.failed" ||
    (eventName.startsWith("transfer.") && status && status !== "success")
  ) {
    return "failed";
  }

  if (eventName.startsWith("charge.") && status && status !== "success") {
    return "failed";
  }

  return null;
}

async function recordProviderExecution(
  supabase: RpcClient,
  normalized: NormalizedPaymentWebhook,
  payload: Record<string, unknown>,
  responsePayload: Record<string, unknown>,
  status: "succeeded" | "failed",
  requestIdValue: string,
): Promise<Response | null> {
  const providerResult = await supabase.rpc("record_provider_execution", {
    target_error_message: null,
    target_idempotency_key: `${normalized.idempotencyKey}:provider`,
    target_operation_key: "provider.payment.webhook",
    target_provider_adapter_key: normalized.providerAdapterKey,
    target_provider_kind: "payment",
    target_request_payload: payload,
    target_response_payload: responsePayload,
    target_status: status,
  });

  if (providerResult.error) {
    return jsonResponse(
      {
        ok: false,
        error: "database_error",
        message: providerResult.error.message,
        requestId: requestIdValue,
      },
      400,
    );
  }

  return null;
}

async function hmacHex(
  algorithm: "SHA-256" | "SHA-512",
  secret: string,
  message: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    {
      hash: algorithm,
      name: "HMAC",
    },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(message));

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length === rightBytes.length ? 0 : 1;

  for (let index = 0; index < maxLength; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return difference === 0;
}

function requireRecord(value: unknown, fieldName: string): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be a JSON object`);
  }

  return value as Readonly<Record<string, unknown>>;
}

function requireRecordOrEmpty(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Readonly<Record<string, unknown>>;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} is required`);
  }

  return value;
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("optional string field must be a non-empty string");
  }

  return value;
}

function optionalStringOrNumber(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  throw new Error("optional string-or-number field must be valid");
}

function optionalUuid(value: unknown): string | null {
  const text = optionalString(value);

  if (!text) {
    return null;
  }

  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .exec(text)
  ) {
    throw new Error("optional UUID field must be valid");
  }

  return text;
}
