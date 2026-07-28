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

  const secret = Deno.env.get("SKIMA_OUTBOUND_WEBHOOK_SANDBOX_SECRET");
  const suppliedSignature = request.headers.get("x-skima-signature");
  const rawBody = await request.text();

  if (!secret || !suppliedSignature) {
    return jsonResponse({ ok: false, error: "unauthorized", requestId: id }, 401);
  }

  const expectedSignature = `sha256=${await hmacSha256(secret, rawBody)}`;

  if (!timingSafeEqual(suppliedSignature, expectedSignature)) {
    return jsonResponse({ ok: false, error: "unauthorized", requestId: id }, 401);
  }

  let payload: Readonly<Record<string, unknown>>;

  try {
    payload = readJsonRecord(rawBody);
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

  const delivery = requireRecord(payload.delivery, "delivery");
  const event = requireRecord(payload.event, "event");
  const deliveryId = requireString(delivery.id, "delivery.id");
  const eventId = requireString(event.id, "event.id");
  const eventTypeKey = requireString(event.type, "event.type");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ ok: false, error: "server_misconfigured", requestId: id }, 500);
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  const providerResult = await supabase.rpc("record_provider_execution", {
    target_error_message: null,
    target_idempotency_key: `${deliveryId}:${eventId}:sandbox-receiver`,
    target_operation_key: "provider.webhook.sandbox_receive",
    target_provider_adapter_key: "provider.observability.database",
    target_provider_kind: "observability",
    target_request_payload: {
      deliveryId,
      eventId,
      eventTypeKey,
    },
    target_response_payload: {
      received: true,
      requestId: id,
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
    deliveryId,
    eventId,
    requestId: id,
  });
});

function readJsonRecord(rawBody: string): Readonly<Record<string, unknown>> {
  const value = JSON.parse(rawBody);

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("webhook payload must be a JSON object");
  }

  return value as Readonly<Record<string, unknown>>;
}

function requireRecord(
  value: unknown,
  fieldName: string,
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${fieldName} must be a JSON object`);
  }

  return value as Readonly<Record<string, unknown>>;
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }

  return value;
}

async function hmacSha256(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { hash: "SHA-256", name: "HMAC" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));

  return bytesToHex(new Uint8Array(signature));
}

function timingSafeEqual(left: string, right: string): boolean {
  const encoder = new TextEncoder();
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);

  if (leftBytes.length !== rightBytes.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }

  return difference === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
