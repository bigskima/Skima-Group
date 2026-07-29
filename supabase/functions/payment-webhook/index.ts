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

  const webhookSecret = Deno.env.get("SKIMA_PAYMENT_WEBHOOK_SECRET");
  const suppliedSecret = request.headers.get("x-skima-webhook-secret");

  if (!webhookSecret || suppliedSecret !== webhookSecret) {
    return jsonResponse({ ok: false, error: "unauthorized", requestId: id }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
  }

  let payload: Record<string, unknown>;

  try {
    payload = await readWebhookPayload(request);
  } catch (error) {
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

  const eventTypeKey = optionalString(payload.eventTypeKey) ?? "event.payment.received";
  const subjectType = optionalString(payload.subjectType) ?? "payment.webhook";
  const subjectId = optionalUuid(payload.subjectId);
  const idempotencyKey = optionalString(payload.idempotencyKey) ??
    optionalString(payload.externalReference) ??
    id;

  const depositRequestId = optionalUuid(payload.depositRequestId) ??
    optionalUuid(payload.deposit_request_id);
  const providerStatus = optionalString(payload.providerStatus) ?? optionalString(payload.status);

  if (depositRequestId || providerStatus) {
    const depositResult = await supabase.rpc("process_wallet_deposit_provider_event", {
      target_deposit_request_id: depositRequestId,
      target_idempotency_key: idempotencyKey,
      target_metadata: {
        requestId: id,
        source: "payment-webhook",
      },
      target_payload: payload,
      target_provider_reference: optionalString(payload.providerReference) ??
        optionalString(payload.provider_reference) ??
        optionalString(payload.externalReference),
      target_provider_status: providerStatus ?? "succeeded",
      target_signature_verified: true,
      target_source: optionalString(payload.source) ?? "provider.payment.webhook",
    });

    if (depositResult.error) {
      await supabase.from("error_reports").upsert({
        context: {
          code: depositResult.error.code,
          payload,
          requestId: id,
        },
        fingerprint: `payment-deposit-webhook:${idempotencyKey}`,
        message: depositResult.error.message,
        severity: "error",
        source: "payment-webhook",
        status: "open",
      });

      return jsonResponse(
        {
          ok: false,
          error: "database_error",
          message: depositResult.error.message,
          requestId: id,
        },
        400,
      );
    }

    return jsonResponse({
      ok: true,
      depositRequestId: depositResult.data,
      requestId: id,
    });
  }

  const eventResult = await supabase.rpc("record_platform_event", {
    target_event_type_key: eventTypeKey,
    target_idempotency_key: idempotencyKey,
    target_occurred_at: optionalString(payload.occurredAt) ?? new Date().toISOString(),
    target_payload: payload,
    target_source: optionalString(payload.source) ?? "provider.payment.webhook",
    target_subject_id: subjectId ?? crypto.randomUUID(),
    target_subject_type: subjectType,
  });

  if (eventResult.error) {
    await supabase.from("error_reports").upsert({
      context: {
        code: eventResult.error.code,
        payload,
        requestId: id,
      },
      fingerprint: `payment-webhook:${eventTypeKey}:${idempotencyKey}`,
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

  const providerResult = await supabase.rpc("record_provider_execution", {
    target_error_message: null,
    target_idempotency_key: `${idempotencyKey}:provider`,
    target_operation_key: "provider.payment.webhook",
    target_provider_adapter_key: "provider.payment.sandbox",
    target_provider_kind: "payment",
    target_request_payload: payload,
    target_response_payload: {
      eventId: eventResult.data,
      received: true,
    },
    target_status: "succeeded",
  });

  if (providerResult.error) {
    return jsonResponse(
      {
        ok: false,
        error: "database_error",
        message: providerResult.error.message,
        requestId: id,
      },
      400,
    );
  }

  return jsonResponse({
    ok: true,
    eventId: eventResult.data,
    requestId: id,
  });
});

async function readWebhookPayload(request: Request): Promise<Record<string, unknown>> {
  const value = await request.json();

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("webhook payload must be a JSON object");
  }

  return value as Record<string, unknown>;
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
