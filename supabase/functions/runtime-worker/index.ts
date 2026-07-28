import { createClient } from "npm:@supabase/supabase-js@2.110.9";

import { jsonResponse, optionsResponse, requestId } from "../_shared/http.ts";

const DEFAULT_LIMIT = 25;
const DEFAULT_WEBHOOK_TIMEOUT_MS = 5_000;

Deno.serve(async (request: Request): Promise<Response> => {
  const id = requestId(request);

  if (request.method === "OPTIONS") {
    return optionsResponse();
  }

  if (request.method !== "POST") {
    return jsonResponse({ ok: false, error: "method_not_allowed", requestId: id }, 405);
  }

  const workerSecret = Deno.env.get("SKIMA_WORKER_SECRET");
  const suppliedSecret = request.headers.get("x-skima-worker-secret");

  if (!workerSecret || suppliedSecret !== workerSecret) {
    return jsonResponse({ ok: false, error: "unauthorized", requestId: id }, 401);
  }

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
  }) as unknown as RuntimeSupabaseClient;

  try {
    const body = await readWorkerBody(request);
    const limit = body.limit ?? DEFAULT_LIMIT;

    const notifications = await processNotifications(supabase, limit);
    const aiTasks = await processAiTasks(supabase, limit);
    const webhooks = await processWebhooks(supabase, limit);
    const jobs = await processBackgroundJobs(supabase, limit);
    const expirations = await expireEscrowHolds(supabase, limit);

    await supabase.rpc("record_health_check", {
      target_details: {
        aiTasks,
        expirations,
        jobs,
        notifications,
        webhooks,
        requestId: id,
      },
      target_service_key: "platform.runtime_worker",
      target_status: "healthy",
    });

    return jsonResponse({
      ok: true,
      data: {
        aiTasks,
        expirations,
        jobs,
        notifications,
        webhooks,
      },
      requestId: id,
    });
  } catch (error) {
    console.error(JSON.stringify({
      severity: "error",
      source: "runtime-worker",
      requestId: id,
      message: error instanceof Error ? error.message : "unknown worker error",
    }));

    return jsonResponse(
      {
        ok: false,
        error: "worker_failed",
        message: error instanceof Error ? error.message : "unknown worker error",
        requestId: id,
      },
      500,
    );
  }
});

interface WorkerBody {
  readonly limit?: number;
}

interface RuntimeSupabaseClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        lte(column: string, value: unknown): {
          order(column: string, options: { ascending: boolean }): {
            limit(count: number): QueryResult<RuntimeRow[] | null>;
          };
        };
        order(column: string, options: { ascending: boolean }): {
          limit(count: number): QueryResult<RuntimeRow[] | null>;
        };
      };
    };
    update(values: Record<string, unknown>): {
      eq(column: string, value: unknown): PromiseLike<{ error: RuntimeError | null }>;
    };
  };
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): QueryResult<unknown>;
}

type QueryResult<TData> = PromiseLike<{ data: TData; error: RuntimeError | null }>;

interface RuntimeRow {
  readonly id: string;
  readonly [key: string]: unknown;
}

interface WebhookDeliveryClaim {
  readonly deliveryId: string;
  readonly endpointId: string;
  readonly eventId: string;
  readonly attemptNumber: number;
  readonly url: string;
  readonly signingSecretRef: string;
  readonly deliveryConfig: Readonly<Record<string, unknown>>;
  readonly eventTypeKey: string;
  readonly eventSource: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly occurredAt: string;
}

interface RuntimeError {
  readonly message: string;
}

async function readWorkerBody(request: Request): Promise<WorkerBody> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    return {};
  }

  const value = await request.json();

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("request body must be a JSON object");
  }

  const limit = (value as { limit?: unknown }).limit;

  if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit))) {
    throw new Error("limit must be an integer");
  }

  return {
    limit: typeof limit === "number" ? Math.min(Math.max(limit, 1), 100) : undefined,
  };
}

async function processNotifications(
  supabase: RuntimeSupabaseClient,
  limit: number,
): Promise<number> {
  const { data, error } = await supabase
    .from("notification_messages")
    .select("id,channel,payload,source,idempotency_key")
    .eq("status", "queued")
    .order("queued_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  let processed = 0;

  for (const message of data ?? []) {
    const messageId = requireString(message.id);
    const idempotencyKey = requireString(message.idempotency_key);
    const providerMessageId = `sandbox-notification-${messageId}`;

    await requireRpc(supabase.rpc("update_notification_message_status", {
      target_error_message: null,
      target_idempotency_key: `${idempotencyKey}:sent`,
      target_metadata: { worker: "runtime-worker" },
      target_notification_message_id: messageId,
      target_provider_message_id: providerMessageId,
      target_status: "sent",
    }));

    await requireRpc(supabase.rpc("update_notification_message_status", {
      target_error_message: null,
      target_idempotency_key: `${idempotencyKey}:delivered`,
      target_metadata: { worker: "runtime-worker" },
      target_notification_message_id: messageId,
      target_provider_message_id: providerMessageId,
      target_status: "delivered",
    }));

    await requireRpc(supabase.rpc("record_provider_execution", {
      target_error_message: null,
      target_idempotency_key: `${idempotencyKey}:provider`,
      target_operation_key: "provider.notification.deliver",
      target_provider_adapter_key: "provider.notification.sandbox",
      target_provider_kind: "notification",
      target_request_payload: {
        channel: message.channel,
        messageId,
      },
      target_response_payload: {
        delivered: true,
        providerMessageId,
      },
      target_status: "succeeded",
    }));

    processed += 1;
  }

  return processed;
}

async function processAiTasks(supabase: RuntimeSupabaseClient, limit: number): Promise<number> {
  const { data, error } = await supabase
    .from("ai_task_runs")
    .select("id,input,source,idempotency_key")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  let processed = 0;

  for (const task of data ?? []) {
    const taskRunId = requireString(task.id);
    const idempotencyKey = requireString(task.idempotency_key);

    await requireRpc(supabase.rpc("update_ai_task_run_status", {
      target_ai_task_run_id: taskRunId,
      target_error_message: null,
      target_idempotency_key: `${idempotencyKey}:running`,
      target_metadata: { worker: "runtime-worker" },
      target_model_info: { adapter: "provider.ai.sandbox", mode: "assist_only" },
      target_output: {},
      target_status: "running",
    }));

    const output = {
      control: "assist_only",
      recommendation: "sandbox_assistive_output",
      reviewedByPolicy: false,
    };

    await requireRpc(supabase.rpc("update_ai_task_run_status", {
      target_ai_task_run_id: taskRunId,
      target_error_message: null,
      target_idempotency_key: `${idempotencyKey}:completed`,
      target_metadata: { worker: "runtime-worker" },
      target_model_info: { adapter: "provider.ai.sandbox", mode: "assist_only" },
      target_output: output,
      target_status: "completed",
    }));

    await requireRpc(supabase.rpc("record_provider_execution", {
      target_error_message: null,
      target_idempotency_key: `${idempotencyKey}:provider`,
      target_operation_key: "provider.ai.assist",
      target_provider_adapter_key: "provider.ai.sandbox",
      target_provider_kind: "ai",
      target_request_payload: { input: task.input, taskRunId },
      target_response_payload: output,
      target_status: "succeeded",
    }));

    processed += 1;
  }

  return processed;
}

async function processWebhooks(supabase: RuntimeSupabaseClient, limit: number): Promise<number> {
  const { data, error } = await supabase.rpc("claim_pending_webhook_deliveries", {
    target_limit: limit,
    target_worker_id: "runtime-worker",
  });

  if (error) {
    throw new Error(error.message);
  }

  const deliveries = parseWebhookClaims(data);
  let processed = 0;

  for (const delivery of deliveries) {
    const attemptIdempotencyKey = `${delivery.deliveryId}:${delivery.attemptNumber}`;
    const requestPayload = buildWebhookPayload(delivery);
    const requestBody = JSON.stringify(requestPayload);
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "User-Agent": "skima-runtime-worker/0.1",
      "x-skima-delivery-id": delivery.deliveryId,
      "x-skima-event-id": delivery.eventId,
      "x-skima-event-type": delivery.eventTypeKey,
    };
    const secretHeaderNames = new Set<string>();

    try {
      const signingSecret = resolveSecretValue(delivery.signingSecretRef);

      if (!signingSecret) {
        throw new Error("webhook signing secret is not configured");
      }

      headers["x-skima-signature"] = `sha256=${await hmacSha256(signingSecret, requestBody)}`;
      headers["x-skima-signature-algorithm"] = "hmac-sha256";
      applyConfiguredHeaders(headers, delivery.deliveryConfig, secretHeaderNames);

      const response = await fetch(delivery.url, {
        body: requestBody,
        headers,
        method: "POST",
        signal: AbortSignal.timeout(readWebhookTimeout(delivery.deliveryConfig)),
      });
      const responseBody = (await response.text()).slice(0, 4_000);
      const providerLogId = await recordWebhookProviderExecution(
        supabase,
        delivery,
        requestPayload,
        sanitizeHeaders(headers, secretHeaderNames),
        response.ok ? "succeeded" : "failed",
        {
          responseBody,
          responseStatus: response.status,
        },
        response.ok ? null : `webhook returned HTTP ${response.status}`,
      );

      await recordWebhookAttempt(
        supabase,
        delivery,
        response.ok ? "delivered" : "failed",
        requestPayload,
        sanitizeHeaders(headers, secretHeaderNames),
        response.status,
        responseBody,
        response.ok ? null : `webhook returned HTTP ${response.status}`,
        attemptIdempotencyKey,
        providerLogId,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "webhook delivery failed";
      const providerLogId = await recordWebhookProviderExecution(
        supabase,
        delivery,
        requestPayload,
        sanitizeHeaders(headers, secretHeaderNames),
        "failed",
        {},
        message,
      );

      await recordWebhookAttempt(
        supabase,
        delivery,
        "failed",
        requestPayload,
        sanitizeHeaders(headers, secretHeaderNames),
        null,
        null,
        message,
        attemptIdempotencyKey,
        providerLogId,
      );
    }

    processed += 1;
  }

  return processed;
}

async function processBackgroundJobs(
  supabase: RuntimeSupabaseClient,
  limit: number,
): Promise<number> {
  const { data, error } = await supabase
    .from("background_jobs")
    .select("id,job_type_key,payload,attempts,max_attempts,source,idempotency_key")
    .eq("status", "queued")
    .lte("run_at", new Date().toISOString())
    .order("run_at", { ascending: true })
    .limit(limit);

  if (error) {
    throw new Error(error.message);
  }

  let processed = 0;

  for (const job of data ?? []) {
    const jobId = requireString(job.id);
    const attempts = Number(job.attempts ?? 0) + 1;
    const maxAttempts = Number(job.max_attempts ?? 1);
    const knownJobType = String(job.job_type_key).startsWith("platform.");

    await requireUpdate(
      supabase.from("background_jobs").update({
        attempts,
        locked_by: "runtime-worker",
        locked_until: new Date(Date.now() + 60_000).toISOString(),
        status: "running",
        updated_at: new Date().toISOString(),
      }).eq("id", jobId),
    );

    if (knownJobType) {
      await requireUpdate(
        supabase.from("background_jobs").update({
          locked_by: null,
          locked_until: null,
          status: "completed",
          updated_at: new Date().toISOString(),
        }).eq("id", jobId),
      );

      processed += 1;
      continue;
    }

    await requireUpdate(
      supabase.from("background_jobs").update({
        last_error: "unknown job type",
        locked_by: null,
        locked_until: null,
        status: attempts >= maxAttempts ? "failed" : "queued",
        updated_at: new Date().toISOString(),
      }).eq("id", jobId),
    );

    if (attempts >= maxAttempts) {
      await requireRpc(supabase.rpc("enqueue_background_job", {
        target_idempotency_key: `${requireString(job.idempotency_key)}:dead-letter`,
        target_job_type_key: "platform.dead_letter.record",
        target_max_attempts: 1,
        target_payload: {
          failedJobId: jobId,
          reason: "unknown job type",
        },
        target_queue_key: "platform.dead_letters",
        target_run_at: new Date().toISOString(),
        target_source: "platform.runtime_worker",
      }));
    }
  }

  return processed;
}

async function expireEscrowHolds(supabase: RuntimeSupabaseClient, limit: number): Promise<number> {
  const { data, error } = await supabase.rpc("expire_escrow_holds", {
    target_limit: limit,
  });

  if (error) {
    throw new Error(error.message);
  }

  return typeof data === "number" ? data : 0;
}

async function requireRpc(
  resultPromise: QueryResult<unknown>,
): Promise<void> {
  const { error } = await resultPromise;

  if (error) {
    throw new Error(error.message);
  }
}

async function requireUpdate(
  resultPromise: PromiseLike<{ error: RuntimeError | null }>,
): Promise<void> {
  const { error } = await resultPromise;

  if (error) {
    throw new Error(error.message);
  }
}

async function recordWebhookProviderExecution(
  supabase: RuntimeSupabaseClient,
  delivery: WebhookDeliveryClaim,
  requestPayload: Readonly<Record<string, unknown>>,
  requestHeaders: Readonly<Record<string, unknown>>,
  status: "succeeded" | "failed",
  responsePayload: Readonly<Record<string, unknown>>,
  errorMessage: string | null,
): Promise<string | null> {
  const { data, error } = await supabase.rpc("record_provider_execution", {
    target_error_message: errorMessage,
    target_idempotency_key: `${delivery.deliveryId}:${delivery.attemptNumber}:provider:${status}`,
    target_operation_key: "provider.webhook.deliver",
    target_provider_adapter_key: "provider.queue.webhook-delivery",
    target_provider_kind: "queue",
    target_request_payload: {
      deliveryId: delivery.deliveryId,
      endpointId: delivery.endpointId,
      eventId: delivery.eventId,
      eventTypeKey: delivery.eventTypeKey,
      headers: requestHeaders,
      payload: requestPayload,
      url: delivery.url,
    },
    target_response_payload: responsePayload,
    target_status: status,
  });

  if (error) {
    throw new Error(error.message);
  }

  return typeof data === "string" ? data : null;
}

async function recordWebhookAttempt(
  supabase: RuntimeSupabaseClient,
  delivery: WebhookDeliveryClaim,
  status: "delivered" | "failed",
  requestPayload: Readonly<Record<string, unknown>>,
  requestHeaders: Readonly<Record<string, unknown>>,
  responseStatus: number | null,
  responseBody: string | null,
  errorMessage: string | null,
  idempotencyKey: string,
  providerExecutionLogId: string | null,
): Promise<void> {
  await requireRpc(supabase.rpc("record_webhook_delivery_attempt", {
    target_delivery_id: delivery.deliveryId,
    target_error_message: errorMessage,
    target_idempotency_key: idempotencyKey,
    target_provider_execution_log_id: providerExecutionLogId,
    target_request_headers: requestHeaders,
    target_request_payload: requestPayload,
    target_response_body: responseBody,
    target_response_status: responseStatus,
    target_status: status,
  }));
}

function parseWebhookClaims(data: unknown): WebhookDeliveryClaim[] {
  if (!Array.isArray(data)) {
    return [];
  }

  return data.map((item) => {
    const record = requireRecord(item);

    return {
      attemptNumber: requireNumber(record.attemptNumber),
      deliveryConfig: optionalRecord(record.deliveryConfig) ?? {},
      deliveryId: requireString(record.deliveryId),
      endpointId: requireString(record.endpointId),
      eventId: requireString(record.eventId),
      eventSource: requireString(record.eventSource),
      eventTypeKey: requireString(record.eventTypeKey),
      occurredAt: requireString(record.occurredAt),
      payload: optionalRecord(record.payload) ?? {},
      signingSecretRef: requireString(record.signingSecretRef),
      subjectId: requireString(record.subjectId),
      subjectType: requireString(record.subjectType),
      url: requireString(record.url),
    };
  });
}

function buildWebhookPayload(
  delivery: WebhookDeliveryClaim,
): Readonly<Record<string, unknown>> {
  return {
    delivery: {
      attemptNumber: delivery.attemptNumber,
      id: delivery.deliveryId,
    },
    event: {
      id: delivery.eventId,
      occurredAt: delivery.occurredAt,
      payload: delivery.payload,
      source: delivery.eventSource,
      subjectId: delivery.subjectId,
      subjectType: delivery.subjectType,
      type: delivery.eventTypeKey,
    },
  };
}

function applyConfiguredHeaders(
  headers: Record<string, string>,
  deliveryConfig: Readonly<Record<string, unknown>>,
  secretHeaderNames: Set<string>,
): void {
  const headerConfigs = deliveryConfig.headers;

  if (!Array.isArray(headerConfigs)) {
    return;
  }

  for (const headerConfig of headerConfigs) {
    const record = requireRecord(headerConfig);
    const name = requireString(record.name);
    const normalizedName = name.toLowerCase();
    const value = typeof record.value === "string"
      ? record.value
      : resolveSecretValue(optionalString(record.secretRef) ?? optionalString(record.secret_ref));

    if (!value) {
      throw new Error(`configured webhook header ${name} has no value`);
    }

    headers[name] = value;

    if (record.secretRef || record.secret_ref) {
      secretHeaderNames.add(normalizedName);
    }
  }
}

function readWebhookTimeout(deliveryConfig: Readonly<Record<string, unknown>>): number {
  const timeout = deliveryConfig.requestTimeoutMs ?? deliveryConfig.request_timeout_ms;

  if (typeof timeout !== "number" || !Number.isInteger(timeout)) {
    return DEFAULT_WEBHOOK_TIMEOUT_MS;
  }

  return Math.min(Math.max(timeout, 1_000), 30_000);
}

function sanitizeHeaders(
  headers: Readonly<Record<string, string>>,
  secretHeaderNames: ReadonlySet<string>,
): Readonly<Record<string, unknown>> {
  const sanitized: Record<string, unknown> = {};

  for (const [name, value] of Object.entries(headers)) {
    const lowerName = name.toLowerCase();
    sanitized[name] = lowerName.includes("signature") || secretHeaderNames.has(lowerName)
      ? "[redacted]"
      : value;
  }

  return sanitized;
}

function resolveSecretValue(secretRef: string | null): string | null {
  if (!secretRef) {
    return null;
  }

  if (secretRef.startsWith("SUPABASE_SECRET:")) {
    return Deno.env.get(secretRef.slice("SUPABASE_SECRET:".length)) ?? null;
  }

  return Deno.env.get(secretRef) ?? null;
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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function requireRecord(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("expected JSON object");
  }

  return value as Readonly<Record<string, unknown>>;
}

function optionalRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requireRecord(value);
}

function optionalString(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  return requireString(value);
}

function requireNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error("expected finite number");
  }

  return value;
}

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("expected non-empty string");
  }

  return value;
}
