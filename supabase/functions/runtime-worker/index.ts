import { createClient } from "npm:@supabase/supabase-js@2.110.9";

import { jsonResponse, optionsResponse, requestId } from "../_shared/http.ts";

const DEFAULT_LIMIT = 25;

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
    const jobs = await processBackgroundJobs(supabase, limit);
    const expirations = await expireEscrowHolds(supabase, limit);

    await supabase.rpc("record_health_check", {
      target_details: {
        aiTasks,
        expirations,
        jobs,
        notifications,
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

function requireString(value: unknown): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("expected non-empty string");
  }

  return value;
}
