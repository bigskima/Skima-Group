import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.110.9";

import { jsonResponse, optionsResponse, requestId } from "../_shared/http.ts";
import {
  readUtilityPurchaseStatus,
  UtilityProviderRuntimeError,
} from "../_shared/utility-provider-runtime.ts";

type JsonRecord = Readonly<Record<string, unknown>>;

const MAX_BODY_BYTES = 1_000_000;

Deno.serve(async (request: Request): Promise<Response> => {
  const id = requestId(request);

  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed", requestId: id }, 405);
  }

  const providerSlug = providerSlugFromUrl(request.url);
  if (!providerSlug) {
    return jsonResponse({ ok: false, error: "provider_not_found", requestId: id }, 404);
  }

  const providerKey = `provider.utility.${providerSlug}`;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
  }

  const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  try {
    const provider = await readProviderWebhookConfiguration(serviceClient, providerKey);
    const rawBody = await readBoundedBody(request);
    await verifyProviderWebhook(request, rawBody, provider.webhook, providerKey);
    const payload = parsePayload(rawBody);
    const references = extractUtilityReferences(payload);

    if (references.length === 0) {
      await recordWebhookExecution(serviceClient, provider, {
        eventId: await webhookEventId(rawBody),
        status: "succeeded",
        references: [],
        result: { ignored: true, reason: "event_without_utility_reference" },
      });
      return jsonResponse({
        ok: true,
        ignored: true,
        reason: "event_without_utility_reference",
        requestId: id,
      });
    }

    const resolved = await rpcRecordOrNull(
      serviceClient,
      "resolve_utility_webhook_request",
      {
        target_provider_key: providerKey,
        target_references: references,
      },
    );

    if (!resolved) {
      // A signed provider callback can race the SKIMA request update. A 503
      // asks the provider to retry without ever creating a second purchase.
      return jsonResponse({
        ok: false,
        error: "utility_request_not_ready",
        requestId: id,
      }, 503);
    }

    const requestIdValue = requireString(resolved.requestId);
    const publicReference = requireString(resolved.publicReference);
    const currentStatus = requireString(resolved.status);
    const eventId = await webhookEventId(rawBody);

    if (["succeeded", "failed", "reversed"].includes(currentStatus)) {
      await recordWebhookExecution(serviceClient, provider, {
        eventId,
        status: "succeeded",
        references,
        result: {
          duplicate: true,
          requestId: requestIdValue,
          requestStatus: currentStatus,
        },
      });
      return jsonResponse({
        ok: true,
        duplicate: true,
        data: {
          requestId: requestIdValue,
          status: currentStatus,
        },
        requestId: id,
      });
    }

    // Never settle from callback contents alone. The signed callback wakes
    // reconciliation; SKIMA independently queries the provider using tx_ref.
    const authoritative = await readUtilityPurchaseStatus(serviceClient, {
      providerKey,
      reference: publicReference,
    });
    const providerStatus = optionalString(authoritative.status) ?? "processing";
    const providerReference =
      optionalString(authoritative.providerReference) ?? publicReference;

    if (["succeeded", "failed", "reversed"].includes(providerStatus)) {
      await requireRpc(serviceClient.rpc("finalize_utility_payment_request", {
        target_request_id: requestIdValue,
        target_provider_status: providerStatus,
        target_provider_reference: providerReference,
        target_provider_response: {
          ...authoritative,
          webhookEventId: eventId,
          webhookWakeup: true,
        },
        target_error_code: providerStatus === "succeeded"
          ? null
          : `provider_${providerStatus}`,
        target_error_message: providerStatus === "succeeded"
          ? null
          : optionalString(authoritative.rawStatus) ?? `Provider reported ${providerStatus}.`,
      }));
    } else {
      await requireRpc(serviceClient.rpc("mark_utility_payment_processing", {
        target_request_id: requestIdValue,
        target_provider_reference: providerReference,
        target_provider_response: {
          ...authoritative,
          webhookEventId: eventId,
          webhookWakeup: true,
        },
        target_error_code: null,
        target_error_message: null,
        target_retry_after_seconds: 120,
      }));
    }

    await recordWebhookExecution(serviceClient, provider, {
      eventId,
      status: "succeeded",
      references,
      result: {
        authoritativeStatus: providerStatus,
        requestId: requestIdValue,
      },
    });

    return jsonResponse({
      ok: true,
      data: {
        requestId: requestIdValue,
        status: providerStatus,
      },
      requestId: id,
    });
  } catch (error) {
    const normalized = normalizeWebhookError(error);
    console.error(JSON.stringify({
      severity: "error",
      source: "utility-provider-webhook",
      providerKey,
      requestId: id,
      code: normalized.code,
    }));
    return jsonResponse({
      ok: false,
      error: normalized.code,
      message: normalized.publicMessage,
      requestId: id,
    }, normalized.status);
  }
});

type ProviderWebhookContext = Readonly<{
  id: string;
  key: string;
  config: JsonRecord;
  webhook: JsonRecord;
}>;

async function readProviderWebhookConfiguration(
  client: SupabaseClient,
  providerKey: string,
): Promise<ProviderWebhookContext> {
  if (!/^provider\.utility\.[a-z0-9][a-z0-9_.:-]{1,90}$/.test(providerKey)) {
    throw new WebhookRuntimeError("provider_not_found", 404);
  }

  const { data, error } = await client
    .from("provider_adapters")
    .select("id,key,config")
    .eq("provider_kind", "utility")
    .eq("key", providerKey)
    .maybeSingle();

  if (error) throw new WebhookRuntimeError("database_operation_failed", 500);
  if (!data) throw new WebhookRuntimeError("provider_not_found", 404);

  const config = optionalRecord(data.config) ?? {};
  const webhook = optionalRecord(config.webhook);
  if (!webhook) throw new WebhookRuntimeError("webhook_not_configured", 503);

  return {
    id: requireString(data.id),
    key: requireString(data.key),
    config,
    webhook,
  };
}

async function verifyProviderWebhook(
  request: Request,
  rawBody: string,
  webhook: JsonRecord,
  providerKey: string,
): Promise<void> {
  const secretRef = optionalString(webhook.secretRef);
  const scheme = optionalString(webhook.signatureScheme);

  if (!secretRef || !/^SUPABASE_SECRET:[A-Z][A-Z0-9_]{2,100}$/.test(secretRef)) {
    throw new WebhookRuntimeError("webhook_secret_reference_missing", 503);
  }
  const secretName = secretRef.slice("SUPABASE_SECRET:".length);
  const secret = Deno.env.get(secretName)?.trim();
  if (!secret) {
    throw new WebhookRuntimeError("webhook_secret_missing", 503);
  }

  if (scheme === "flutterwave-hmac-or-verif-hash" || providerKey === "provider.utility.flutterwave") {
    const legacyHash = request.headers.get("verif-hash")?.trim() ?? "";
    const signature = request.headers.get("flutterwave-signature")?.trim() ?? "";

    const legacyValid = legacyHash
      ? timingSafeEqualText(legacyHash, secret)
      : false;
    const modernValid = signature
      ? timingSafeEqualText(signature, await hmacSha256Base64(secret, rawBody))
      : false;

    if (!legacyValid && !modernValid) {
      throw new WebhookRuntimeError("invalid_webhook_signature", 401);
    }
    return;
  }

  throw new WebhookRuntimeError("webhook_signature_scheme_not_supported", 503);
}

function extractUtilityReferences(payload: JsonRecord): string[] {
  const data = optionalRecord(payload.data) ?? {};
  const candidates = [
    optionalString(data.tx_ref),
    optionalString(data.customer_reference),
    optionalString(data.flw_ref),
    optionalString(data.reference),
    optionalString(payload.tx_ref),
    optionalString(payload.customer_reference),
    optionalString(payload.reference),
  ];

  return [...new Set(
    candidates
      .filter((value): value is string => Boolean(value))
      .map((value) => value.trim())
      .filter((value) => value.length > 0 && value.length <= 200),
  )].slice(0, 8);
}

async function recordWebhookExecution(
  client: SupabaseClient,
  provider: ProviderWebhookContext,
  input: Readonly<{
    eventId: string;
    status: "succeeded" | "failed";
    references: string[];
    result: JsonRecord;
  }>,
): Promise<void> {
  const { error } = await client.from("provider_execution_logs").upsert({
    provider_adapter_id: provider.id,
    provider_kind: "utility",
    operation_key: "utility.webhook.receive",
    status: input.status,
    request_payload: {
      providerKey: provider.key,
      referenceCount: input.references.length,
      references: input.references.map(maskReference),
    },
    response_payload: input.result,
    idempotency_key: input.eventId,
    error_message: null,
  }, {
    onConflict: "provider_kind,operation_key,idempotency_key",
  });

  if (error) {
    console.warn(JSON.stringify({
      severity: "warning",
      source: "utility-provider-webhook.execution-log",
      message: error.message,
    }));
  }
}

async function readBoundedBody(request: Request): Promise<string> {
  const body = await request.text();
  if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) {
    throw new WebhookRuntimeError("webhook_payload_too_large", 413);
  }
  return body;
}

function parsePayload(rawBody: string): JsonRecord {
  try {
    const value = JSON.parse(rawBody);
    return requireRecord(value);
  } catch {
    throw new WebhookRuntimeError("invalid_webhook_payload", 400);
  }
}

function providerSlugFromUrl(value: string): string | null {
  const segments = new URL(value).pathname.split("/").filter(Boolean);
  const marker = segments.lastIndexOf("utility-provider-webhook");
  const slug = marker >= 0 ? segments[marker + 1] : null;
  return slug && /^[a-z0-9][a-z0-9_.:-]{1,90}$/.test(slug) ? slug : null;
}

async function webhookEventId(rawBody: string): Promise<string> {
  const bytes = new TextEncoder().encode(rawBody);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `utility-webhook:${hex.slice(0, 48)}`;
}

async function hmacSha256Base64(secret: string, body: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  return bytesToBase64(new Uint8Array(signature));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function timingSafeEqualText(left: string, right: string): boolean {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}

function maskReference(value: string): string {
  if (value.length <= 6) return "***";
  return `${value.slice(0, 3)}***${value.slice(-3)}`;
}

async function rpcRecordOrNull(
  client: SupabaseClient,
  fn: string,
  args: JsonRecord,
): Promise<JsonRecord | null> {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new WebhookRuntimeError("database_operation_failed", 500);
  return data === null ? null : requireRecord(data);
}

async function requireRpc(
  result: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<unknown> {
  const resolved = await result;
  if (resolved.error) throw new WebhookRuntimeError("database_operation_failed", 500);
  return resolved.data;
}

class WebhookRuntimeError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly publicMessage = "The utility provider webhook could not be processed.",
  ) {
    super(code);
  }
}

function normalizeWebhookError(error: unknown): WebhookRuntimeError {
  if (error instanceof WebhookRuntimeError) return error;
  if (error instanceof UtilityProviderRuntimeError) {
    return new WebhookRuntimeError(
      error.code,
      error.status >= 400 && error.status < 600 ? error.status : 502,
      error.message,
    );
  }
  return new WebhookRuntimeError("webhook_processing_failed", 500);
}

function requireRecord(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WebhookRuntimeError("invalid_webhook_payload", 400);
  }
  return value as JsonRecord;
}

function optionalRecord(value: unknown): JsonRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonRecord;
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new WebhookRuntimeError("invalid_webhook_payload", 400);
  }
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
