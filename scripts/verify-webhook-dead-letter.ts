import { createClient } from "npm:@supabase/supabase-js@2.110.9";

import { resolveSupabaseRuntime } from "./supabase-runtime.ts";

const runtime = await resolveSupabaseRuntime({ serviceRoleKey: true });
const supabaseUrl = runtime.supabaseUrl;
const serviceRoleKey = runtime.serviceRoleKey!;
const workerSecret = requireEnv("SKIMA_WORKER_SECRET");

const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    persistSession: false,
  },
});

const runId = crypto.randomUUID();
const source = "platform.webhook_dead_letter_gate";

console.log(`Running outbound webhook dead-letter gate ${runId}...`);

const endpointId = await createFailingWebhookEndpoint();
const eventId = await recordWebhookEvent();

await runWorker();

const delivery = await requireWebhookDelivery(endpointId, eventId);
await requireDeadLetterAttempt(delivery.id);
await requireDeadLetterJob(delivery.id);
await requireProviderFailure(delivery.id);

console.log("Outbound webhook dead-letter gate completed.");
console.log(`webhook_delivery_id=${delivery.id}`);

async function createFailingWebhookEndpoint(): Promise<string> {
  const { data, error } = await serviceClient
    .from("webhook_endpoints")
    .insert({
      delivery_config: {
        backoffSeconds: [0],
        maxAttempts: 1,
        requestTimeoutMs: 5000,
      },
      event_type_keys: ["event.payment.received"],
      signing_secret_ref: "SUPABASE_SECRET:SKIMA_MISSING_WEBHOOK_GATE_SECRET",
      status: "active",
      url: `${supabaseUrl}/functions/v1/webhook-sandbox-receiver`,
    })
    .select("id")
    .single();

  if (error) {
    throw error;
  }

  return data.id;
}

async function recordWebhookEvent(): Promise<string> {
  const { data, error } = await serviceClient.rpc("record_platform_event", {
    target_event_type_key: "event.payment.received",
    target_idempotency_key: idempotency("event"),
    target_occurred_at: new Date().toISOString(),
    target_payload: {
      gate: "webhook_dead_letter",
      runId,
    },
    target_source: source,
    target_subject_id: crypto.randomUUID(),
    target_subject_type: "platform.webhook_dead_letter_gate",
  });

  if (error) {
    throw new Error(`record webhook event failed: ${error.message}`);
  }

  if (typeof data !== "string") {
    throw new Error("record webhook event did not return an event id.");
  }

  return data;
}

async function runWorker(): Promise<void> {
  const response = await fetch(`${supabaseUrl}/functions/v1/runtime-worker`, {
    body: JSON.stringify({ limit: 25 }),
    headers: {
      "Content-Type": "application/json",
      "x-skima-worker-secret": workerSecret,
    },
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`runtime worker returned HTTP ${response.status}: ${body}`);
  }
}

async function requireWebhookDelivery(
  endpointId: string,
  eventId: string,
): Promise<{ readonly id: string }> {
  const { data, error } = await serviceClient
    .from("webhook_deliveries")
    .select("id,status,attempt_count,last_error")
    .eq("endpoint_id", endpointId)
    .eq("event_id", eventId)
    .single();

  if (error) {
    throw error;
  }

  requireCondition(data.status === "failed", `expected failed delivery, found ${data.status}.`);
  requireCondition(Number(data.attempt_count) === 1, "failed delivery should use one attempt.");
  requireCondition(
    typeof data.last_error === "string" && data.last_error.includes("signing secret"),
    "failed delivery did not record the missing signing secret error.",
  );

  return { id: data.id };
}

async function requireDeadLetterAttempt(deliveryId: string): Promise<void> {
  const { data, error } = await serviceClient
    .from("webhook_delivery_attempts")
    .select("id,status,error_message")
    .eq("delivery_id", deliveryId)
    .eq("status", "dead_lettered")
    .single();

  if (error) {
    throw error;
  }

  requireCondition(Boolean(data.id), "dead-lettered webhook attempt is missing.");
}

async function requireDeadLetterJob(deliveryId: string): Promise<void> {
  const { data, error } = await serviceClient
    .from("background_jobs")
    .select("id,status,payload")
    .eq("source", "platform.webhook_engine")
    .eq("job_type_key", "platform.dead_letter.record")
    .contains("payload", { failedDeliveryId: deliveryId })
    .limit(1);

  if (error) {
    throw error;
  }

  requireCondition((data ?? []).length === 1, "dead-letter background job is missing.");
}

async function requireProviderFailure(deliveryId: string): Promise<void> {
  const { data, error } = await serviceClient
    .from("provider_execution_logs")
    .select("id,status,error_message")
    .eq("provider_kind", "queue")
    .eq("operation_key", "provider.webhook.deliver")
    .eq("status", "failed")
    .contains("request_payload", { deliveryId })
    .limit(1);

  if (error) {
    throw error;
  }

  requireCondition((data ?? []).length === 1, "webhook provider failure log is missing.");
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

function requireCondition(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}
