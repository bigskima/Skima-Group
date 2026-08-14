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

    const lpgLifecycle = await processLpgOrderLifecycle(supabase, limit);
    const notifications = await processNotifications(supabase, limit);
    const communications = await syncCommunicationMessages(supabase, limit);
    const aiTasks = await processAiTasks(supabase, limit);
    const webhooks = await processWebhooks(supabase, limit);
    const jobs = await processBackgroundJobs(supabase, limit);
    const expirations = await expireEscrowHolds(supabase, limit);

    await supabase.rpc("record_health_check", {
      target_details: {
        aiTasks,
        communications,
        expirations,
        jobs,
        lpgLifecycle,
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
        communications,
        expirations,
        jobs,
        lpgLifecycle,
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

interface ImageProviderConfig {
  readonly provider: "cloudflare" | "gemini";
  readonly adapter: string;
  readonly model: string;
}

interface SourceImage {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

interface GeneratedImage {
  readonly base64: string;
  readonly contentType: string;
  readonly providerMetadata: Readonly<Record<string, unknown>>;
}

interface RuntimeSupabaseClient {
  storage: {
    from(bucket: string): {
      download(path: string): PromiseLike<{ data: Blob | null; error: RuntimeError | null }>;
      upload(path: string, body: Uint8Array, options: { contentType: string; upsert: boolean }): PromiseLike<{ data: unknown; error: RuntimeError | null }>;
    };
  };
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

async function syncCommunicationMessages(
  supabase: RuntimeSupabaseClient,
  limit: number,
): Promise<number> {
  const result = await supabase.rpc("sync_communication_message_statuses", {
    target_limit: limit,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return typeof result.data === "number" ? result.data : 0;
}

async function processLpgOrderLifecycle(
  supabase: RuntimeSupabaseClient,
  limit: number,
): Promise<unknown> {
  const result = await supabase.rpc("process_lpg_order_lifecycle", {
    target_limit: limit,
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result.data ?? {};
}

async function processAiTasks(supabase: RuntimeSupabaseClient, limit: number): Promise<number> {
  const { data, error } = await supabase
    .from("ai_task_runs")
    .select("id,input,source,idempotency_key,subject_type,subject_id,requested_by")
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
    const input = optionalRecord(task.input) ?? {};
    const subjectType = requireString(task.subject_type);
    const isPresentation = subjectType === "lpg_cylinder" && input.purpose === "public_presentation";
    const isDriverCardPhoto = subjectType === "driver_profile" && input.purpose === "public_driver_card_photo";
    const imageProvider = isPresentation || isDriverCardPhoto ? resolveImageProvider() : null;
    const adapter = imageProvider?.adapter ?? "provider.ai.sandbox";
    const model = imageProvider?.model ?? "sandbox";

    try {
      await requireRpc(supabase.rpc("update_ai_task_run_status", {
        target_ai_task_run_id: taskRunId,
        target_error_message: null,
        target_idempotency_key: `${idempotencyKey}:running`,
        target_metadata: { worker: "runtime-worker" },
        target_model_info: { adapter, control: "assist_only", model },
        target_output: {},
        target_status: "running",
      }));

      const output = isPresentation
        ? await generateCylinderPresentation(supabase, task, input, imageProvider)
        : isDriverCardPhoto
        ? await generateDriverCardPhoto(supabase, task, input, imageProvider)
        : {
          control: "assist_only",
          recommendation: "sandbox_assistive_output",
          reviewedByPolicy: false,
        };

      await requireRpc(supabase.rpc("update_ai_task_run_status", {
        target_ai_task_run_id: taskRunId,
        target_error_message: null,
        target_idempotency_key: `${idempotencyKey}:completed`,
        target_metadata: { worker: "runtime-worker" },
        target_model_info: { adapter, control: "assist_only", model },
        target_output: output,
        target_status: "completed",
      }));

      await requireRpc(supabase.rpc("record_provider_execution", {
        target_error_message: null,
        target_idempotency_key: `${idempotencyKey}:provider`,
        target_operation_key: isPresentation || isDriverCardPhoto ? "provider.ai.image.generate" : "provider.ai.assist",
        target_provider_adapter_key: adapter,
        target_provider_kind: "ai",
        target_request_payload: { input: task.input, subjectType, taskRunId },
        target_response_payload: output,
        target_status: "succeeded",
      }));

      processed += 1;
    } catch (cause) {
      const message = (cause instanceof Error ? cause.message : "AI task failed").slice(0, 1_000);
      await requireRpc(supabase.rpc("update_ai_task_run_status", {
        target_ai_task_run_id: taskRunId,
        target_error_message: message,
        target_idempotency_key: `${idempotencyKey}:failed`,
        target_metadata: { worker: "runtime-worker" },
        target_model_info: { adapter, control: "assist_only", model },
        target_output: { generated: false },
        target_status: "failed",
      }));
      await requireRpc(supabase.rpc("record_provider_execution", {
        target_error_message: message,
        target_idempotency_key: `${idempotencyKey}:provider-failed`,
        target_operation_key: isPresentation || isDriverCardPhoto ? "provider.ai.image.generate" : "provider.ai.assist",
        target_provider_adapter_key: adapter,
        target_provider_kind: "ai",
        target_request_payload: { subjectType, taskRunId },
        target_response_payload: {},
        target_status: "failed",
      }));
    }
  }

  return processed;
}

async function generateDriverCardPhoto(
  supabase: RuntimeSupabaseClient,
  task: RuntimeRow,
  input: Readonly<Record<string, unknown>>,
  provider: ImageProviderConfig | null,
): Promise<Readonly<Record<string, unknown>>> {
  const resolvedProvider = provider ?? resolveImageProvider();
  const taskRunId = requireString(task.id);
  const driverProfileId = requireString(task.subject_id);
  const ownerUserId = requireString(task.requested_by);
  const sourceMediaAssetId = optionalString(input.sourceMediaAssetId) ?? optionalString(input.source_media_asset_id);
  if (!sourceMediaAssetId) throw new Error("source driver photo is required");

  const driverResult = await supabase
    .from("driver_profiles")
    .select("id,user_id,driver_display_name,verification_status,metadata,created_at")
    .eq("id", driverProfileId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (driverResult.error) throw new Error(driverResult.error.message);

  const driver = optionalRecord(driverResult.data?.[0]);
  if (!driver || driver.user_id !== ownerUserId) {
    throw new Error("owned driver profile was not found");
  }

  const sourceResult = await supabase
    .from("media_assets")
    .select("id,owner_user_id,storage_bucket,storage_path,content_type,status,created_at")
    .eq("id", sourceMediaAssetId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (sourceResult.error) throw new Error(sourceResult.error.message);

  const source = sourceResult.data?.[0];
  if (!source || source.owner_user_id !== ownerUserId || source.status !== "active") {
    throw new Error("owned active source driver photo was not found");
  }

  const contentType = optionalString(source.content_type) ?? "image/jpeg";
  if (!contentType.startsWith("image/")) {
    throw new Error("source driver photo must be an image");
  }

  const sourceDownload = await supabase.storage
    .from(requireString(source.storage_bucket))
    .download(requireString(source.storage_path));
  if (sourceDownload.error || !sourceDownload.data) {
    throw new Error(sourceDownload.error?.message ?? "source driver photo could not be downloaded");
  }

  const sourceBytes = new Uint8Array(await sourceDownload.data.arrayBuffer());
  const stylePrompt = optionalString(input.stylePrompt) ?? optionalString(input.style_prompt);
  const avoidPreviousResult = input.avoidPreviousResult === true || input.avoid_previous_result === true;
  const prompt = buildDriverCardPhotoPrompt(driver, stylePrompt, avoidPreviousResult);
  const generated = resolvedProvider.provider === "cloudflare"
    ? await generateWithCloudflare(prompt, { bytes: sourceBytes, contentType }, resolvedProvider.model)
    : await generateWithGemini(prompt, { bytes: sourceBytes, contentType }, resolvedProvider.model);
  const bytes = base64ToBytes(generated.base64);
  const generatedContentType = generated.contentType;
  const extension = generatedContentType.includes("jpeg") || generatedContentType.includes("jpg") ? "jpg" : "png";
  const storageBucket = "skima-platform-media";
  const storagePath = `${ownerUserId}/ai-driver-card-photos/${taskRunId}.${extension}`;
  const upload = await supabase.storage.from(storageBucket).upload(storagePath, bytes, {
    contentType: generatedContentType,
    upsert: false,
  });
  if (upload.error) throw new Error(upload.error.message);

  const checksum = await sha256Hex(bytes);
  const mediaResult = await supabase.rpc("register_media_asset", {
    target_asset_type_key: "media.driver_card_photo.ai",
    target_byte_size: bytes.byteLength,
    target_checksum: checksum,
    target_content_type: generatedContentType,
    target_idempotency_key: `${taskRunId}:media`,
    target_metadata: {
      derivative: true,
      generatedBy: resolvedProvider.adapter,
      model: resolvedProvider.model,
      provider: resolvedProvider.provider,
      providerMetadata: generated.providerMetadata,
      publicDriverCardPhoto: true,
      sourceMediaAssetId,
      subjectId: driverProfileId,
      subjectType: "driver_profile",
    },
    target_organization_id: null,
    target_owner_user_id: ownerUserId,
    target_source: "platform.ai_engine",
    target_status: "active",
    target_storage_bucket: storageBucket,
    target_storage_path: storagePath,
  });
  if (mediaResult.error) throw new Error(mediaResult.error.message);
  const mediaAssetId = requireString(mediaResult.data);

  const currentMetadata = optionalRecord(driver.metadata) ?? {};
  const updateResult = await supabase
    .from("driver_profiles")
    .update({
      metadata: {
        ...currentMetadata,
        driver_card_photo: {
          aiTaskRunId: taskRunId,
          generatedAt: new Date().toISOString(),
          generatedMediaAssetId: mediaAssetId,
          model: resolvedProvider.model,
          provider: resolvedProvider.adapter,
          sourceMediaAssetId,
        },
      },
      profile_photo_asset_id: mediaAssetId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", driverProfileId);
  if (updateResult.error) throw new Error(updateResult.error.message);

  return {
    generated: true,
    mediaAssetId,
    mediaRole: "driver-card-photo.ai",
    model: resolvedProvider.model,
    preserveOriginal: true,
    provider: resolvedProvider.adapter,
  };
}

async function generateCylinderPresentation(
  supabase: RuntimeSupabaseClient,
  task: RuntimeRow,
  input: Readonly<Record<string, unknown>>,
  provider: ImageProviderConfig | null,
): Promise<Readonly<Record<string, unknown>>> {
  const resolvedProvider = provider ?? resolveImageProvider();

  const taskRunId = requireString(task.id);
  const subjectId = requireString(task.subject_id);
  const ownerUserId = requireString(task.requested_by);
  const sourceMediaAssetId = optionalString(input.sourceMediaAssetId) ?? optionalString(input.source_media_asset_id);
  const colour = optionalString(input.confirmedColour) ?? optionalString(input.confirmed_colour);
  const stylePrompt = optionalString(input.stylePrompt) ?? optionalString(input.style_prompt);
  const avoidPreviousResult = input.avoidPreviousResult === true || input.avoid_previous_result === true;
  const cylinder = await loadCylinderForPrompt(supabase, subjectId);
  const prompt = buildCylinderPresentationPrompt(cylinder, colour, stylePrompt, avoidPreviousResult);
  let sourceImage: SourceImage | null = null;

  if (sourceMediaAssetId) {
    const sourceResult = await supabase
      .from("media_assets")
      .select("id,owner_user_id,storage_bucket,storage_path,content_type,status,created_at")
      .eq("id", sourceMediaAssetId)
      .order("created_at", { ascending: false })
      .limit(1);
    if (sourceResult.error) throw new Error(sourceResult.error.message);
    const source = sourceResult.data?.[0];
    if (!source || source.owner_user_id !== ownerUserId || source.status !== "active") {
      throw new Error("owned active source cylinder image was not found");
    }
    const sourceDownload = await supabase.storage
      .from(requireString(source.storage_bucket))
      .download(requireString(source.storage_path));
    if (sourceDownload.error || !sourceDownload.data) {
      throw new Error(sourceDownload.error?.message ?? "source image could not be downloaded");
    }
    const sourceBytes = new Uint8Array(await sourceDownload.data.arrayBuffer());
    sourceImage = {
      bytes: sourceBytes,
      contentType: optionalString(source.content_type) ?? "image/jpeg",
    };
  }

  const generated = resolvedProvider.provider === "cloudflare"
    ? await generateWithCloudflare(prompt, sourceImage, resolvedProvider.model)
    : await generateWithGemini(prompt, sourceImage, resolvedProvider.model);
  const base64 = generated.base64;
  const contentType = generated.contentType;

  const bytes = base64ToBytes(base64);
  const extension = contentType.includes("jpeg") || contentType.includes("jpg") ? "jpg" : "png";
  const storageBucket = "skima-platform-media";
  const storagePath = `${ownerUserId}/ai-presentations/${taskRunId}.${extension}`;
  const upload = await supabase.storage.from(storageBucket).upload(storagePath, bytes, {
    contentType,
    upsert: false,
  });
  if (upload.error) throw new Error(upload.error.message);

  const checksum = await sha256Hex(bytes);
  const mediaResult = await supabase.rpc("register_media_asset", {
    target_asset_type_key: "media.presentation.ai",
    target_byte_size: bytes.byteLength,
    target_checksum: checksum,
    target_content_type: contentType,
    target_idempotency_key: `${taskRunId}:media`,
    target_metadata: {
      derivative: true,
      generatedBy: resolvedProvider.adapter,
      model: resolvedProvider.model,
      provider: resolvedProvider.provider,
      providerMetadata: generated.providerMetadata,
      sourceMediaAssetId,
      subjectId,
      subjectType: "lpg_cylinder",
    },
    target_organization_id: null,
    target_owner_user_id: ownerUserId,
    target_source: "platform.ai_engine",
    target_status: "active",
    target_storage_bucket: storageBucket,
    target_storage_path: storagePath,
  });
  if (mediaResult.error) throw new Error(mediaResult.error.message);
  const mediaAssetId = requireString(mediaResult.data);

  await requireRpc(supabase.rpc("register_entity_presentation_media", {
    target_entity_id: subjectId,
    target_entity_type: "lpg_cylinder",
    target_idempotency_key: `${taskRunId}:presentation-link`,
    target_media_asset_id: mediaAssetId,
    target_metadata: {
      aiTaskRunId: taskRunId,
      model: resolvedProvider.model,
      provider: resolvedProvider.adapter,
    },
  }));

  return {
    generated: true,
    mediaAssetId,
    mediaRole: "presentation.ai",
    model: resolvedProvider.model,
    preserveOriginal: true,
    provider: resolvedProvider.adapter,
  };
}

function resolveImageProvider(): ImageProviderConfig {
  const preferred = (Deno.env.get("AI_IMAGE_PROVIDER") ?? "").trim().toLowerCase();
  const cloudflareConfigured = Boolean(Deno.env.get("CLOUDFLARE_ACCOUNT_ID") && Deno.env.get("CLOUDFLARE_API_TOKEN"));

  if (preferred === "cloudflare" || (!preferred && cloudflareConfigured)) {
    return {
      provider: "cloudflare",
      adapter: "provider.ai.cloudflare-workers-ai",
      model: Deno.env.get("CLOUDFLARE_AI_MODEL") ?? "@cf/black-forest-labs/flux-1-schnell",
    };
  }

  if (preferred && preferred !== "gemini") {
    throw new Error(`AI_IMAGE_PROVIDER '${preferred}' is not supported`);
  }

  return {
    provider: "gemini",
    adapter: "provider.ai.google-gemini",
    model: Deno.env.get("GEMINI_IMAGE_MODEL") ?? "gemini-3.1-flash-image",
  };
}

async function loadCylinderForPrompt(
  supabase: RuntimeSupabaseClient,
  subjectId: string,
): Promise<Readonly<Record<string, unknown>> | null> {
  const result = await supabase
    .from("lpg_cylinders")
    .select("id,display_name,size_kg,max_capacity_kg,brand,colour,status,created_at")
    .eq("id", subjectId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (result.error) throw new Error(result.error.message);
  return optionalRecord(result.data?.[0]);
}

function buildCylinderPresentationPrompt(
  cylinder: Readonly<Record<string, unknown>> | null,
  colour: string | null,
  stylePrompt: string | null,
  avoidPreviousResult: boolean,
): string {
  const displayName = optionalString(cylinder?.display_name ?? cylinder?.displayName);
  const sizeKg = typeof cylinder?.size_kg === "number" ? cylinder.size_kg : optionalString(cylinder?.size_kg);
  const brand = optionalString(cylinder?.brand);
  const resolvedColour = colour ?? optionalString(cylinder?.colour);
  const details = [
    displayName ? `Owner label: ${displayName}.` : null,
    sizeKg ? `Cylinder size: ${sizeKg} kg LPG cylinder.` : null,
    brand ? `Visible brand or maker, if shown: ${brand}.` : null,
    resolvedColour ? `Owner-confirmed cylinder colour: ${resolvedColour}.` : "Use a common red LPG cylinder colour unless source evidence indicates otherwise.",
  ].filter(Boolean).join(" ");

  return [
    "Create a premium photorealistic product presentation image of one LPG gas cylinder.",
    "Use a clean neutral studio background, balanced soft lighting, full unobstructed cylinder body, realistic proportions, and a sharp ecommerce/product-catalog look.",
    "The cylinder should look safe, practical, modern, and suitable for a professional gas refill app.",
    details,
    stylePrompt ? `Preferred style direction: ${stylePrompt}.` : null,
    avoidPreviousResult ? "This is a regeneration request. Produce a visibly different but still accurate composition, lighting mood, and camera angle." : null,
    "Do not add people, hands, kitchens, fire, smoke, extra accessories, fake certification marks, serial numbers, QR codes, hardcoded app logos, or readable text.",
    "This is only a visual presentation derivative; do not imply safety inspection or certification.",
  ].filter(Boolean).join(" ").slice(0, 2048);
}

function buildDriverCardPhotoPrompt(
  driver: Readonly<Record<string, unknown>>,
  stylePrompt: string | null,
  avoidPreviousResult: boolean,
): string {
  const displayName = optionalString(driver.driver_display_name ?? driver.driverDisplayName);
  return [
    "Enhance the supplied driver portrait for a public professional driver ID card.",
    "Preserve the same person, face shape, age, skin tone, expression, and identity. Do not invent a different person.",
    "Use a clean premium app-profile portrait style: sharp face, natural lighting, neat background, shoulders visible, realistic colours, no distortion.",
    "Keep it suitable for public customer verification in a delivery app.",
    displayName ? `Driver display name for context only, do not render text: ${displayName}.` : null,
    stylePrompt ? `Preferred style direction: ${stylePrompt}.` : null,
    avoidPreviousResult ? "This is a regeneration request. Produce a cleaner alternate crop or background while preserving the same identity." : null,
    "Do not add logos, badges, QR codes, text, uniforms, extra people, ID numbers, watermarks, fake documents, or certification marks.",
  ].filter(Boolean).join(" ").slice(0, 2048);
}

async function generateWithCloudflare(
  prompt: string,
  sourceImage: SourceImage | null,
  model: string,
): Promise<GeneratedImage> {
  const accountId = Deno.env.get("CLOUDFLARE_ACCOUNT_ID");
  const apiToken = Deno.env.get("CLOUDFLARE_API_TOKEN");
  if (!accountId || !apiToken) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not configured");
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/ai/run/${model.replace(/^\/+/, "")}`;
  const useMultipart = model.includes("flux-2");
  const response = useMultipart
    ? await postCloudflareMultipart(url, apiToken, prompt, sourceImage, model)
    : await fetch(url, {
      method: "POST",
      headers: {
        "authorization": `Bearer ${apiToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        prompt,
        seed: Math.floor(Math.random() * 2_147_483_647),
        steps: readIntegerEnv("CLOUDFLARE_AI_STEPS", 8, 1, 8),
      }),
      signal: AbortSignal.timeout(45_000),
    });

  const responseBody = await response.json().catch(() => null) as Record<string, unknown> | null;
  if (!response.ok || responseBody?.success === false) {
    throw new Error(readCloudflareError(responseBody) ?? `Cloudflare Workers AI image generation failed with ${response.status}`);
  }

  const result = optionalRecord(responseBody?.result) ?? optionalRecord(responseBody) ?? {};
  const rawImage = optionalString(result.image) ?? optionalString(result.dataURI) ?? optionalString(result.dataUri);
  if (!rawImage) throw new Error("Cloudflare Workers AI returned no presentation image");
  const base64 = rawImage.includes(",") ? rawImage.split(",").pop() ?? "" : rawImage;
  if (!base64) throw new Error("Cloudflare Workers AI returned an empty presentation image");

  return {
    base64,
    contentType: optionalString(result.contentType ?? result.content_type) ?? "image/jpeg",
    providerMetadata: {
      model,
      sourceImageUsed: useMultipart && Boolean(sourceImage),
    },
  };
}

async function postCloudflareMultipart(
  url: string,
  apiToken: string,
  prompt: string,
  sourceImage: SourceImage | null,
  model: string,
): Promise<Response> {
  const form = new FormData();
  form.append("prompt", prompt);
  form.append("steps", String(readIntegerEnv("CLOUDFLARE_AI_STEPS", 8, 1, 25)));
  form.append("width", String(readIntegerEnv("CLOUDFLARE_AI_WIDTH", 1024, 512, 2048)));
  form.append("height", String(readIntegerEnv("CLOUDFLARE_AI_HEIGHT", 1024, 512, 2048)));
  if (sourceImage) {
    const imageBuffer = new ArrayBuffer(sourceImage.bytes.byteLength);
    new Uint8Array(imageBuffer).set(sourceImage.bytes);
    form.append("input_image_0", new Blob([imageBuffer], { type: sourceImage.contentType }), "source-cylinder.jpg");
  }

  return fetch(url, {
    method: "POST",
    headers: { "authorization": `Bearer ${apiToken}` },
    body: form,
    signal: AbortSignal.timeout(model.includes("flux-2") ? 90_000 : 45_000),
  });
}

async function generateWithGemini(
  prompt: string,
  sourceImage: SourceImage | null,
  model: string,
): Promise<GeneratedImage> {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");

  const promptParts: Array<Record<string, unknown>> = [{ text: prompt }];
  if (sourceImage) {
    promptParts.unshift({
      inlineData: {
        data: bytesToBase64(sourceImage.bytes),
        mimeType: sourceImage.contentType,
      },
    });
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: promptParts }],
        generationConfig: {
          responseModalities: ["IMAGE"],
          responseFormat: { image: { aspectRatio: "4:3", imageSize: "1K" } },
        },
      }),
      signal: AbortSignal.timeout(45_000),
    },
  );
  const responseBody = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const providerError = optionalRecord(responseBody.error);
    throw new Error(optionalString(providerError?.message) ?? `Gemini image generation failed with ${response.status}`);
  }

  const candidates = Array.isArray(responseBody.candidates) ? responseBody.candidates : [];
  const candidate = optionalRecord(candidates[0]);
  const content = optionalRecord(candidate?.content);
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const imagePart = parts.map(optionalRecord).find((part) => Boolean(part?.inlineData ?? part?.inline_data));
  const inlineData = optionalRecord(imagePart?.inlineData ?? imagePart?.inline_data);
  const base64 = optionalString(inlineData?.data);
  const contentType = optionalString(inlineData?.mimeType ?? inlineData?.mime_type) ?? "image/png";
  if (!base64) throw new Error("Gemini returned no presentation image");

  return {
    base64,
    contentType,
    providerMetadata: { model, sourceImageUsed: Boolean(sourceImage) },
  };
}

function readCloudflareError(responseBody: Record<string, unknown> | null): string | null {
  const errors = Array.isArray(responseBody?.errors) ? responseBody.errors : [];
  const firstError = optionalRecord(errors[0]);
  return optionalString(firstError?.message) ?? optionalString(responseBody?.message);
}

function readIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = Number(Deno.env.get(name));
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, Math.min(index + 0x8000, bytes.length)));
  }
  return btoa(binary);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return bytesToHex(new Uint8Array(digest));
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
