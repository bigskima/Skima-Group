import { createClient } from "npm:@supabase/supabase-js@2.110.9";

import { jsonResponse, optionsResponse, requestId } from "../_shared/http.ts";

const MAX_BODY_BYTES = 1_000_000;

Deno.serve(async (request: Request): Promise<Response> => {
  const id = requestId(request);
  if (request.method === "OPTIONS") return optionsResponse();
  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed", requestId: id }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });
  let receiptId: string | null = null;
  let connectionId: string | null = null;
  const startedAt = performance.now();

  try {
    const connectionReference = readConnectionReference(request);
    const context = record(
      await rpcData(supabase.rpc(
        "read_lpg_inventory_provider_webhook_context",
        { target_connection_public_reference: connectionReference },
      )),
    );
    connectionId = string(context.connectionId);
    const providerKey = string(context.providerKey);
    const adapterConfig = record(context.adapterConfig);
    const webhook = record(adapterConfig.webhook);
    const mapping = record(webhook.responseMapping);
    const secret = resolveSecret(
      optionalString(webhook.signingSecretRef) ?? optionalString(context.credentialSecretRef),
    );

    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
      throw new WebhookError("payload_too_large", 413);
    }
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
      throw new WebhookError("payload_too_large", 413);
    }

    const signatureHeader = safeHeaderName(string(webhook.signatureHeader));
    const timestampHeader = safeHeaderName(string(webhook.timestampHeader));
    const suppliedSignature = request.headers.get(signatureHeader);
    const suppliedTimestamp = request.headers.get(timestampHeader);
    if (!suppliedSignature || !suppliedTimestamp) {
      throw new WebhookError("signature_required", 401);
    }

    const providerTimestamp = parseTimestamp(suppliedTimestamp);
    const maximumSkewSeconds = integer(webhook.maximumSkewSeconds, 300, 30, 900);
    if (Math.abs(Date.now() - providerTimestamp.valueOf()) > maximumSkewSeconds * 1_000) {
      throw new WebhookError("timestamp_outside_window", 401);
    }

    const signaturePayloadMode = optionalString(webhook.signaturePayload) ?? "timestamp.raw";
    const signaturePayload = signaturePayloadMode === "raw"
      ? rawBody
      : signaturePayloadMode === "timestamp.raw"
      ? `${suppliedTimestamp}.${rawBody}`
      : (() => {
        throw new WebhookError("signature_configuration_invalid", 500);
      })();
    const expectedSignature = await hmacSha256(secret, signaturePayload);
    const signaturePrefix = optionalString(webhook.signaturePrefix) ?? "";
    const normalizedSignature = suppliedSignature.startsWith(signaturePrefix)
      ? suppliedSignature.slice(signaturePrefix.length)
      : suppliedSignature;
    if (!constantTimeEqual(normalizedSignature.toLowerCase(), expectedSignature)) {
      throw new WebhookError("signature_invalid", 401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody);
    } catch {
      throw new WebhookError("payload_invalid_json", 400);
    }

    const payloadDigest = await sha256Hex(rawBody);
    const sourceIpHash = await hmacSha256(secret, sourceIp(request));
    const rateLimit = record(
      await rpcData(supabase.rpc("check_rate_limit", {
        target_increment: 1,
        target_policy_key: "webhook.inventory-provider.default",
        target_subject: `${connectionId}:${sourceIpHash}`,
      })),
    );
    if (rateLimit.allowed !== true) throw new WebhookError("rate_limited", 429);

    const eventIdHeader = optionalString(webhook.eventIdHeader);
    const mappedEventReference = optionalString(mapping.eventReferencePath)
      ? readPath(payload, string(mapping.eventReferencePath))
      : null;
    const providerEventReference =
      (eventIdHeader ? request.headers.get(safeHeaderName(eventIdHeader)) : null) ??
        (mappedEventReference === null || mappedEventReference === undefined
          ? payloadDigest
          : String(mappedEventReference));
    if (!providerEventReference.trim() || providerEventReference.length > 500) {
      throw new WebhookError("event_reference_invalid", 400);
    }

    const signatureDigest = await sha256Hex(normalizedSignature.toLowerCase());
    const begin = record(
      await rpcData(supabase.rpc("begin_lpg_inventory_provider_webhook", {
        target_connection_id: connectionId,
        target_metadata: { providerKey, requestId: id },
        target_payload_digest: payloadDigest,
        target_provider_event_reference: providerEventReference,
        target_provider_timestamp: providerTimestamp.toISOString(),
        target_signature_digest: signatureDigest,
        target_source_ip_hash: sourceIpHash,
      })),
    );
    receiptId = string(begin.receiptId);
    if (begin.duplicate === true) {
      return jsonResponse({ ok: true, duplicate: true, requestId: id }, 200);
    }

    const stockKg = number(readPath(payload, string(mapping.stockKgPath)), "stock_invalid");
    if (stockKg < 0) throw new WebhookError("stock_invalid", 400);
    const observedAtValue = optionalString(mapping.observedAtPath)
      ? readPath(payload, string(mapping.observedAtPath))
      : suppliedTimestamp;
    const observedAt = parseTimestamp(String(observedAtValue));
    const sequenceValue = optionalString(mapping.providerSequencePath)
      ? readPath(payload, string(mapping.providerSequencePath))
      : null;
    const providerSequence = sequenceValue === null || sequenceValue === undefined
      ? null
      : integer(sequenceValue, 0, 0, Number.MAX_SAFE_INTEGER);
    const providerDeviceReferenceValue = optionalString(mapping.providerDeviceReferencePath)
      ? readPath(payload, string(mapping.providerDeviceReferencePath))
      : null;
    const device = resolveDevice(
      context.devices,
      providerDeviceReferenceValue === null || providerDeviceReferenceValue === undefined
        ? null
        : String(providerDeviceReferenceValue),
    );
    const rawValue = optionalString(mapping.rawValuePath)
      ? number(readPath(payload, string(mapping.rawValuePath)), "raw_value_invalid")
      : stockKg;
    const rawUnitValue = optionalString(mapping.rawUnitPath)
      ? readPath(payload, string(mapping.rawUnitPath))
      : "kg";

    const observationId = await rpcData(supabase.rpc(
      "ingest_lpg_inventory_provider_observation",
      {
        target_connection_id: connectionId,
        target_idempotency_key: `${connectionId}:${providerEventReference}`,
        target_observed_at: observedAt.toISOString(),
        target_payload: {
          normalizationVersion: device?.normalizationVersion ?? 1,
          providerKey,
          requestId: id,
          responseDigest: payloadDigest,
        },
        target_provider_event_reference: providerEventReference,
        target_provider_sequence: providerSequence,
        target_raw_unit: String(rawUnitValue ?? "kg").slice(0, 40),
        target_raw_value: rawValue,
        target_source: providerSource(providerKey),
        target_stock_kg: stockKg,
        target_tank_id: device?.tankId ?? null,
        target_telemetry_device_id: device?.deviceId ?? null,
      },
    ));
    if (typeof observationId !== "string") throw new WebhookError("ingestion_failed", 500);

    await rpcData(supabase.rpc("complete_lpg_inventory_provider_webhook", {
      target_metadata: { requestId: id },
      target_observation_id: observationId,
      target_receipt_id: receiptId,
      target_rejection_code: null,
      target_status: "accepted",
    }));
    await rpcData(supabase.rpc("record_lpg_inventory_provider_sync_result", {
      target_connection_id: connectionId,
      target_error_code: null,
      target_latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
      target_metadata: { requestId: id, transport: "webhook" },
      target_succeeded: true,
    }));

    return jsonResponse({ ok: true, requestId: id }, 200);
  } catch (error) {
    const webhookError = error instanceof WebhookError
      ? error
      : new WebhookError("webhook_failed", 500);
    if (receiptId) {
      await supabase.rpc("complete_lpg_inventory_provider_webhook", {
        target_metadata: { requestId: id },
        target_observation_id: null,
        target_receipt_id: receiptId,
        target_rejection_code: webhookError.code,
        target_status: webhookError.status >= 500 ? "failed" : "rejected",
      });
    }
    if (connectionId) {
      await supabase.rpc("record_lpg_inventory_provider_sync_result", {
        target_connection_id: connectionId,
        target_error_code: `webhook_${webhookError.code}`,
        target_latency_ms: Math.max(0, Math.round(performance.now() - startedAt)),
        target_metadata: { requestId: id, transport: "webhook" },
        target_succeeded: false,
      });
    }
    console.error(JSON.stringify({
      code: webhookError.code,
      requestId: id,
      severity: webhookError.status >= 500 ? "error" : "warning",
      source: "inventory-provider-webhook",
    }));
    return jsonResponse(
      { ok: false, error: webhookError.code, requestId: id },
      webhookError.status,
    );
  }
});

class WebhookError extends Error {
  constructor(readonly code: string, readonly status: number) {
    super(code);
    this.name = "WebhookError";
  }
}

function readConnectionReference(request: Request): string {
  const pathValue = new URL(request.url).pathname.split("/").filter(Boolean).at(-1);
  const value = request.headers.get("x-skima-inventory-connection") ?? pathValue;
  if (!value || !/^[A-Z0-9][A-Z0-9_-]{2,80}$/.test(value.toUpperCase())) {
    throw new WebhookError("connection_reference_invalid", 404);
  }
  return value.toUpperCase();
}

function resolveSecret(reference: string | null): string {
  if (!reference || !/^SUPABASE_SECRET:[A-Za-z0-9_.:-]{3,180}$/.test(reference)) {
    throw new WebhookError("secret_configuration_invalid", 500);
  }
  const value = Deno.env.get(reference.slice("SUPABASE_SECRET:".length));
  if (!value) throw new WebhookError("secret_configuration_missing", 500);
  return value;
}

function parseTimestamp(value: string): Date {
  const numericValue = Number(value);
  const result = Number.isFinite(numericValue)
    ? new Date(numericValue < 10_000_000_000 ? numericValue * 1_000 : numericValue)
    : new Date(value);
  if (Number.isNaN(result.valueOf())) throw new WebhookError("timestamp_invalid", 400);
  return result;
}

function safeHeaderName(value: string): string {
  if (!/^[A-Za-z0-9-]{1,80}$/.test(value)) {
    throw new WebhookError("header_configuration_invalid", 500);
  }
  return value;
}

function sourceIp(request: Request): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("cf-connecting-ip") || "unknown";
}

async function rpcData(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<unknown> {
  const { data, error } = await query;
  if (error) throw new WebhookError("database_operation_failed", 500);
  return data;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WebhookError("configuration_invalid", 500);
  }
  return value as Readonly<Record<string, unknown>>;
}

function string(value: unknown): string {
  if (typeof value !== "string" || !value) throw new WebhookError("configuration_invalid", 500);
  return value;
}

function optionalString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return string(value);
}

function integer(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = value === null || value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new WebhookError("number_invalid", 400);
  }
  return parsed;
}

function number(value: unknown, code: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) throw new WebhookError(code, 400);
  return parsed;
}

function readPath(value: unknown, path: string): unknown {
  if (!/^[A-Za-z0-9_.-]{1,300}$/.test(path)) {
    throw new WebhookError("response_path_invalid", 500);
  }
  let current = value;
  for (const segment of path.split(".")) {
    if (Array.isArray(current)) {
      const index = Number(segment);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw new WebhookError("response_path_missing", 400);
      }
      current = current[index];
    } else {
      const currentRecord = record(current);
      if (!Object.prototype.hasOwnProperty.call(currentRecord, segment)) {
        throw new WebhookError("response_path_missing", 400);
      }
      current = currentRecord[segment];
    }
  }
  return current;
}

function resolveDevice(
  value: unknown,
  providerDeviceReference: string | null,
): Readonly<{ deviceId: string; tankId: string; normalizationVersion: number }> | null {
  const devices = Array.isArray(value) ? value.map(record) : [];
  const selected = providerDeviceReference
    ? devices.find((device) => device.providerDeviceReference === providerDeviceReference)
    : devices.length === 1
    ? devices[0]
    : undefined;
  if (providerDeviceReference && !selected) throw new WebhookError("device_unmapped", 400);
  if (!selected) return null;
  return {
    deviceId: string(selected.deviceId),
    normalizationVersion: integer(selected.normalizationVersion, 1, 1, 10_000),
    tankId: string(selected.tankId),
  };
}

function providerSource(providerKey: string): string {
  const source = `inventory.provider.${providerKey}`.toLowerCase();
  if (!/^[a-z][a-z0-9_.:-]{2,105}$/.test(source)) {
    throw new WebhookError("provider_key_invalid", 500);
  }
  return source;
}

async function hmacSha256(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return hex(new Uint8Array(signature));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return hex(new Uint8Array(digest));
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
