import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.9";

import { jsonResponse, optionsResponse, requestId } from "../_shared/http.ts";

const DIDIT_PROVIDER_KEY = "provider.verification.didit";
const DIDIT_WEBHOOK_SOURCE = "provider.verification.didit.webhook";
const DIDIT_WEBHOOK_OPERATION = "verification.webhook.didit";
const MAX_TIMESTAMP_SKEW_SECONDS = 300;

Deno.serve(async (request: Request): Promise<Response> => {
  const id = requestId(request);

  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed", requestId: id }, 405);
  }

  if (!isDiditPath(request.url)) {
    return jsonResponse({ ok: false, error: "provider_not_found", requestId: id }, 404);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const webhookSecret = Deno.env.get("DIDIT_WEBHOOK_SECRET");

  if (!supabaseUrl || !serviceRoleKey || !webhookSecret) {
    console.error(JSON.stringify({
      severity: "error",
      source: "verification-provider-webhook",
      requestId: id,
      message: "Didit webhook runtime is missing required Supabase or webhook secrets.",
    }));
    return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
  }

  let rawBody: string;
  let payload: WebhookPayload;

  try {
    rawBody = await request.text();
    payload = readPayload(rawBody);
    await verifyDiditWebhook(request, rawBody, payload, webhookSecret);
  } catch (error) {
    const webhookError = error instanceof WebhookError
      ? error
      : new WebhookError("invalid_request", 400);
    return jsonResponse(
      { ok: false, error: webhookError.code, requestId: id },
      webhookError.status,
    );
  }

  const eventId = requireString(payload.event_id, "event_id");
  const webhookType = requireString(payload.webhook_type, "webhook_type");

  if (!["status.updated", "data.updated"].includes(webhookType)) {
    return jsonResponse({
      ok: true,
      ignored: true,
      eventId,
      webhookType,
      requestId: id,
    });
  }

  const providerSessionId =
    optionalString(payload.session_id) ??
    optionalString(payload.business_session_id);

  if (!providerSessionId) {
    return jsonResponse({
      ok: true,
      ignored: true,
      eventId,
      webhookType,
      reason: "session_event_without_session_id",
      requestId: id,
    });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  try {
    const duplicate = await alreadyProcessed(supabase, eventId);
    if (duplicate) {
      return jsonResponse({ ok: true, duplicate: true, eventId, requestId: id });
    }

    const sessionResult = await supabase
      .from("application_verification_sessions")
      .select(
        "id,application_id,application_verification_requirement_id,applicant_user_id,provider_adapter_id,provider_session_id,status,provider_status,result_summary",
      )
      .eq("provider_session_id", providerSessionId)
      .maybeSingle();

    if (sessionResult.error) throw new WebhookError("database_operation_failed", 500);

    if (!sessionResult.data) {
      await recordUnmatchedWebhook(supabase, eventId, providerSessionId, webhookType, id);
      // A valid Didit delivery can race the SKIMA session insert by a few
      // milliseconds. Returning 503 asks Didit to retry with the same event_id.
      return jsonResponse(
        { ok: false, error: "verification_session_not_ready", eventId, requestId: id },
        503,
      );
    }

    const session = sessionResult.data;
    const provider = await readDiditProvider(supabase, session.provider_adapter_id);
    const providerStatus = requireString(payload.status, "status");
    const normalizedStatus = mapDiditStatus(providerStatus);
    const terminal = ["passed", "failed", "manual_review", "expired"].includes(normalizedStatus);
    const completedAt = terminal ? new Date().toISOString() : null;
    const currentSummary = recordValue(session.result_summary);
    const safeSummary = {
      ...currentSummary,
      provider: DIDIT_PROVIDER_KEY,
      providerStatus,
      sessionKind: optionalString(payload.session_kind) ?? "user",
      webhookEventId: eventId,
      webhookType,
      environment: optionalString(payload.environment) ?? undefined,
      deliveryTimestamp: numberValue(payload.timestamp),
    };

    const failureMessage = normalizedStatus === "failed"
      ? "The automatic check could not be approved. You can retry or use the permitted fallback evidence."
      : normalizedStatus === "manual_review"
      ? "The verification provider is reviewing this check. No additional evidence is required unless SKIMA asks for it."
      : null;

    const updateResult = await supabase
      .from("application_verification_sessions")
      .update({
        status: normalizedStatus,
        provider_status: providerStatus,
        result_summary: safeSummary,
        failure_code: normalizedStatus === "failed" ? "provider_declined" : null,
        failure_message: failureMessage,
        completed_at: completedAt,
        updated_at: new Date().toISOString(),
      })
      .eq("id", session.id);

    if (updateResult.error) throw new WebhookError("database_operation_failed", 500);

    const mappingResult = await supabase
      .from("application_verification_requirements")
      .select("verification_definition_id")
      .eq("id", session.application_verification_requirement_id)
      .single();

    if (mappingResult.error) throw new WebhookError("database_operation_failed", 500);

    const verificationEventResult = await supabase.from("verification_events").upsert(
      {
        definition_id: mappingResult.data.verification_definition_id,
        scanned_by: session.applicant_user_id,
        scanned_entity_type: "application",
        scanned_entity_id: session.application_id,
        purpose: "partner.onboarding",
        location: {},
        result: verificationEventResultValue(normalizedStatus),
        payload: {
          applicationVerificationSessionId: session.id,
          providerStatus,
          normalizedStatus,
          webhookEventId: eventId,
          webhookType,
          sessionKind: optionalString(payload.session_kind) ?? "user",
        },
        source: DIDIT_WEBHOOK_SOURCE,
        idempotency_key: eventId,
      },
      { onConflict: "source,idempotency_key" },
    );

    if (verificationEventResult.error) {
      throw new WebhookError("database_operation_failed", 500);
    }

    let reconciliation: unknown = null;
    if (normalizedStatus === "passed") {
      const reconciliationResult = await supabase.rpc("reconcile_application_verification", {
        target_application_id: session.application_id,
        target_idempotency_key: `didit-webhook:${eventId}`,
      });
      if (reconciliationResult.error) {
        throw new WebhookError("verification_reconciliation_failed", 500);
      }
      reconciliation = reconciliationResult.data;
    }

    const executionResult = await supabase.from("provider_execution_logs").upsert(
      {
        provider_adapter_id: provider.id,
        provider_kind: "verification",
        operation_key: DIDIT_WEBHOOK_OPERATION,
        status: "succeeded",
        request_payload: {
          eventId,
          webhookType,
          providerSessionId,
          providerStatus,
          sessionKind: optionalString(payload.session_kind) ?? "user",
        },
        response_payload: {
          applicationId: session.application_id,
          verificationSessionId: session.id,
          normalizedStatus,
          reconciled: normalizedStatus === "passed",
          requestId: id,
        },
        idempotency_key: eventId,
        error_message: null,
      },
      { onConflict: "provider_kind,operation_key,idempotency_key" },
    );

    if (executionResult.error) throw new WebhookError("database_operation_failed", 500);

    return jsonResponse({
      ok: true,
      eventId,
      verificationSessionId: session.id,
      status: normalizedStatus,
      reconciliation,
      requestId: id,
    });
  } catch (error) {
    const webhookError = error instanceof WebhookError
      ? error
      : new WebhookError("webhook_processing_failed", 500);

    console.error(JSON.stringify({
      severity: "error",
      source: "verification-provider-webhook",
      requestId: id,
      eventId,
      webhookType,
      code: webhookError.code,
    }));

    return jsonResponse(
      { ok: false, error: webhookError.code, eventId, requestId: id },
      webhookError.status,
    );
  }
});

type WebhookPayload = Readonly<Record<string, unknown>>;

class WebhookError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "WebhookError";
  }
}

function isDiditPath(urlValue: string): boolean {
  const parts = new URL(urlValue).pathname.split("/").filter(Boolean);
  const functionIndex = parts.lastIndexOf("verification-provider-webhook");
  if (functionIndex < 0) return false;
  const provider = parts[functionIndex + 1] ?? "didit";
  return provider.toLowerCase() === "didit";
}

async function verifyDiditWebhook(
  request: Request,
  rawBody: string,
  payload: WebhookPayload,
  secret: string,
): Promise<void> {
  const timestampHeader = request.headers.get("x-timestamp");
  if (!timestampHeader) throw new WebhookError("missing_signature_timestamp", 401);

  const timestamp = Number(timestampHeader);
  if (!Number.isSafeInteger(timestamp)) throw new WebhookError("invalid_signature_timestamp", 401);
  const current = Math.floor(Date.now() / 1000);
  if (Math.abs(current - timestamp) > MAX_TIMESTAMP_SKEW_SECONDS) {
    throw new WebhookError("stale_webhook", 401);
  }

  const signatureV2 = request.headers.get("x-signature-v2");
  if (signatureV2) {
    const canonical = canonicalJson(payload);
    const expected = await hmacSha256(secret, canonical);
    if (constantTimeEqual(signatureV2.toLowerCase(), expected)) return;
  }

  const rawSignature = request.headers.get("x-signature");
  if (rawSignature) {
    const expected = await hmacSha256(secret, rawBody);
    if (constantTimeEqual(rawSignature.toLowerCase(), expected)) return;
  }

  const simpleSignature = request.headers.get("x-signature-simple");
  if (simpleSignature) {
    const canonical = [
      stringOrEmpty(payload.timestamp),
      stringOrEmpty(payload.session_id),
      stringOrEmpty(payload.status),
      stringOrEmpty(payload.webhook_type),
    ].join(":");
    const expected = await hmacSha256(secret, canonical);
    if (constantTimeEqual(simpleSignature.toLowerCase(), expected)) return;
  }

  throw new WebhookError("invalid_signature", 401);
}

async function alreadyProcessed(
  supabase: SupabaseClient,
  eventId: string,
): Promise<boolean> {
  const result = await supabase
    .from("provider_execution_logs")
    .select("id,status")
    .eq("provider_kind", "verification")
    .eq("operation_key", DIDIT_WEBHOOK_OPERATION)
    .eq("idempotency_key", eventId)
    .eq("status", "succeeded")
    .maybeSingle();

  if (result.error) throw new WebhookError("database_operation_failed", 500);
  return Boolean(result.data);
}

async function readDiditProvider(
  supabase: SupabaseClient,
  expectedProviderAdapterId: unknown,
): Promise<{ id: string }> {
  const result = await supabase
    .from("provider_adapters")
    .select("id,key,status")
    .eq("key", DIDIT_PROVIDER_KEY)
    .eq("provider_kind", "verification")
    .single();

  if (result.error) throw new WebhookError("verification_provider_not_found", 500);
  // Webhook delivery must remain valid for in-flight sessions even if an
  // operator pauses new Didit sessions after this session was created.
  if (
    typeof expectedProviderAdapterId === "string" &&
    expectedProviderAdapterId &&
    expectedProviderAdapterId !== result.data.id
  ) {
    throw new WebhookError("verification_provider_mismatch", 409);
  }
  return { id: result.data.id };
}

async function recordUnmatchedWebhook(
  supabase: SupabaseClient,
  eventId: string,
  providerSessionId: string,
  webhookType: string,
  requestIdValue: string,
): Promise<void> {
  await supabase.from("error_reports").upsert({
    fingerprint: `didit-webhook-unmatched:${eventId}`,
    source: "verification-provider-webhook",
    severity: "warning",
    status: "open",
    message: "A verified Didit webhook arrived before its SKIMA verification session was available.",
    context: {
      eventId,
      providerSessionId,
      webhookType,
      requestId: requestIdValue,
    },
  });
}

function mapDiditStatus(value: string): string {
  const status = value.trim().toUpperCase().replace(/[\s-]+/g, "_");
  if (status === "APPROVED") return "passed";
  if (status === "DECLINED") return "failed";
  if (status === "IN_REVIEW") return "manual_review";
  if (["ABANDONED", "EXPIRED", "KYC_EXPIRED"].includes(status)) return "expired";
  if (
    ["RESUBMITTED", "IN_PROGRESS", "NOT_STARTED", "AWAITING_USER", "NOT_FINISHED"]
      .includes(status)
  ) {
    return "in_progress";
  }
  return "pending";
}

function verificationEventResultValue(
  status: string,
): "pending" | "passed" | "failed" | "flagged" | "cancelled" {
  if (status === "passed") return "passed";
  if (status === "failed") return "failed";
  if (status === "manual_review") return "flagged";
  if (status === "expired" || status === "cancelled") return "cancelled";
  return "pending";
}

function readPayload(rawBody: string): WebhookPayload {
  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    throw new WebhookError("invalid_json", 400);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WebhookError("invalid_payload", 400);
  }
  return value as WebhookPayload;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WebhookError(`missing_${field}`, 400);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringOrEmpty(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJsonKeys(value));
}

function sortJsonKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJsonKeys);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortJsonKeys(source[key]);
    }
    return sorted;
  }
  return value;
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
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
