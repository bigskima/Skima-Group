export interface AiProviderRoute {
  readonly capabilityKey: string;
  readonly responseMode: "text" | "json" | "image";
  readonly controlMode: "assist_only" | "read_only";
  readonly modelKey: string;
  readonly providerAdapterId: string;
  readonly providerAdapterKey: string;
  readonly providerDisplayName: string;
  readonly providerConfig: Readonly<Record<string, unknown>>;
  readonly routeConfig: Readonly<Record<string, unknown>>;
  readonly capabilityConfig: Readonly<Record<string, unknown>>;
  readonly secretRef: string | null;
}

export interface AiTextRequest {
  readonly system: string;
  readonly message: string;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly history?: readonly {
    readonly role: "user" | "assistant";
    readonly content: string;
  }[];
}

export interface AiTextResponse {
  readonly text: string;
  readonly inputUnits: number | null;
  readonly outputUnits: number | null;
  readonly providerMetadata: Readonly<Record<string, unknown>>;
}

interface RpcClient {
  rpc(
    fn: string,
    args?: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message?: string } | null }>;
}

export class AiProviderRuntimeError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(code: string, message: string, retryable = false) {
    super(message);
    this.name = "AiProviderRuntimeError";
    this.code = code;
    this.retryable = retryable;
  }
}

export async function resolveAiProviderRoute(
  client: RpcClient,
  capabilityKey: string,
): Promise<AiProviderRoute | null> {
  const { data, error } = await client.rpc("resolve_ai_provider_route", {
    target_capability_key: capabilityKey,
  });

  if (error) {
    throw new AiProviderRuntimeError(
      "route_resolution_failed",
      error.message ?? "AI provider route could not be resolved.",
    );
  }

  if (!isRecord(data)) {
    return null;
  }

  const modelKey = stringValue(data.modelKey);
  const providerAdapterId = stringValue(data.providerAdapterId);
  const providerAdapterKey = stringValue(data.providerAdapterKey);
  const capability = stringValue(data.capabilityKey);

  if (!modelKey || !providerAdapterId || !providerAdapterKey || !capability) {
    return null;
  }

  const responseMode = stringValue(data.responseMode);
  const controlMode = stringValue(data.controlMode);

  return {
    capabilityKey: capability,
    responseMode: responseMode === "json" || responseMode === "image" ? responseMode : "text",
    controlMode: controlMode === "read_only" ? "read_only" : "assist_only",
    modelKey,
    providerAdapterId,
    providerAdapterKey,
    providerDisplayName: stringValue(data.providerDisplayName) ?? "Configured AI provider",
    providerConfig: recordValue(data.providerConfig),
    routeConfig: recordValue(data.routeConfig),
    capabilityConfig: recordValue(data.capabilityConfig),
    secretRef: stringValue(data.secretRef),
  };
}

export async function invokeAiText(
  route: AiProviderRoute,
  request: AiTextRequest,
): Promise<AiTextResponse> {
  if (route.responseMode !== "text" && route.responseMode !== "json") {
    throw new AiProviderRuntimeError(
      "unsupported_response_mode",
      "The configured AI route does not support text responses.",
    );
  }

  const transport = stringValue(route.providerConfig.transport);
  if (transport === "google_generate_content") {
    return invokeGoogleGenerateContent(route, request);
  }

  if (transport === "openai_compatible_chat") {
    return invokeOpenAiCompatibleChat(route, request);
  }

  throw new AiProviderRuntimeError(
    "unsupported_transport",
    "The configured AI provider transport is not supported by this runtime.",
  );
}

async function invokeGoogleGenerateContent(
  route: AiProviderRoute,
  request: AiTextRequest,
): Promise<AiTextResponse> {
  const secret = readProviderSecret(route.secretRef);
  const baseUrl = normalizedBaseUrl(
    stringValue(route.providerConfig.api_base_url) ??
      "https://generativelanguage.googleapis.com/v1beta",
  );
  const endpoint = baseUrl + "/models/" + encodeURIComponent(route.modelKey) + ":generateContent";

  const contents = [
    ...(request.history ?? []).map((item) => ({
      role: item.role === "assistant" ? "model" : "user",
      parts: [{ text: item.content }],
    })),
    {
      role: "user",
      parts: [{
        text: composeUserMessage(request.message, request.context),
      }],
    },
  ];

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": secret,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: request.system }],
      },
      contents,
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const payload = await readJson(response);
  if (!response.ok) {
    throw providerHttpError("google_generate_content", response.status, payload);
  }

  const candidate = arrayValue(payload.candidates)[0];
  const responseContent = isRecord(candidate) ? recordValue(candidate.content) : {};
  const parts = arrayValue(responseContent.parts);
  const text = parts
    .map((part) => isRecord(part) ? stringValue(part.text) : null)
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .trim();

  if (!text) {
    throw new AiProviderRuntimeError(
      "empty_provider_response",
      "The configured AI provider returned an empty response.",
      true,
    );
  }

  const usage = recordValue(payload.usageMetadata);
  return {
    text,
    inputUnits: numberValue(usage.promptTokenCount),
    outputUnits: numberValue(usage.candidatesTokenCount),
    providerMetadata: {
      finishReason: isRecord(candidate) ? stringValue(candidate.finishReason) : null,
      totalTokenCount: numberValue(usage.totalTokenCount),
      transport: "google_generate_content",
    },
  };
}

async function invokeOpenAiCompatibleChat(
  route: AiProviderRoute,
  request: AiTextRequest,
): Promise<AiTextResponse> {
  const secret = readProviderSecret(route.secretRef);
  const baseUrl = normalizedBaseUrl(stringValue(route.providerConfig.api_base_url));
  if (!baseUrl) {
    throw new AiProviderRuntimeError(
      "provider_not_configured",
      "The configured AI provider is missing an API base URL.",
    );
  }

  const response = await fetch(baseUrl + "/chat/completions", {
    method: "POST",
    headers: {
      authorization: "Bearer " + secret,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: route.modelKey,
      messages: [
        { role: "system", content: request.system },
        ...(request.history ?? []).map((item) => ({
          role: item.role,
          content: item.content,
        })),
        {
          role: "user",
          content: composeUserMessage(request.message, request.context),
        },
      ],
    }),
    signal: AbortSignal.timeout(45_000),
  });

  const payload = await readJson(response);
  if (!response.ok) {
    throw providerHttpError("openai_compatible_chat", response.status, payload);
  }

  const choice = arrayValue(payload.choices)[0];
  const message = isRecord(choice) ? recordValue(choice.message) : {};
  const rawContent = message.content;
  const text = typeof rawContent === "string"
    ? rawContent.trim()
    : arrayValue(rawContent)
      .map((part) => isRecord(part) ? stringValue(part.text) : null)
      .filter((value): value is string => Boolean(value))
      .join("\n")
      .trim();

  if (!text) {
    throw new AiProviderRuntimeError(
      "empty_provider_response",
      "The configured AI provider returned an empty response.",
      true,
    );
  }

  const usage = recordValue(payload.usage);
  return {
    text,
    inputUnits: numberValue(usage.prompt_tokens),
    outputUnits: numberValue(usage.completion_tokens),
    providerMetadata: {
      finishReason: isRecord(choice) ? stringValue(choice.finish_reason) : null,
      requestId: stringValue(payload.id),
      transport: "openai_compatible_chat",
    },
  };
}

function composeUserMessage(
  message: string,
  context?: Readonly<Record<string, unknown>>,
): string {
  if (!context || Object.keys(context).length === 0) {
    return message;
  }

  return [
    message,
    "",
    "SKIMA ACCOUNT CONTEXT (authoritative application data; do not invent values beyond this object):",
    JSON.stringify(context),
  ].join("\n");
}

function readProviderSecret(secretRef: string | null): string {
  if (!secretRef?.startsWith("SUPABASE_SECRET:")) {
    throw new AiProviderRuntimeError(
      "provider_not_configured",
      "The configured AI provider does not have a server-side credential reference.",
    );
  }

  const envName = secretRef.slice("SUPABASE_SECRET:".length).trim();
  if (!/^[A-Z][A-Z0-9_]{2,100}$/.test(envName)) {
    throw new AiProviderRuntimeError(
      "provider_not_configured",
      "The configured AI provider credential reference is invalid.",
    );
  }

  const value = Deno.env.get(envName)?.trim();
  if (!value) {
    throw new AiProviderRuntimeError(
      "provider_not_configured",
      "The configured AI provider credential is not available on the server.",
    );
  }

  return value;
}

function providerHttpError(
  transport: string,
  status: number,
  payload: Readonly<Record<string, unknown>>,
): AiProviderRuntimeError {
  const nestedError = recordValue(payload.error);
  const providerMessage =
    stringValue(nestedError.message) ??
    stringValue(payload.message) ??
    "The configured AI provider rejected the request.";
  const retryable = status === 408 || status === 409 || status === 429 || status >= 500;
  return new AiProviderRuntimeError(
    status === 429 ? "provider_rate_limited" : "provider_request_failed",
    providerMessage + " (" + transport + ", HTTP " + String(status) + ")",
    retryable,
  );
}

async function readJson(response: Response): Promise<Readonly<Record<string, unknown>>> {
  const payload = await response.json().catch(() => null);
  return isRecord(payload) ? payload : {};
}

function normalizedBaseUrl(value: string | null): string {
  return (value ?? "").trim().replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function recordValue(value: unknown): Readonly<Record<string, unknown>> {
  return isRecord(value) ? value : {};
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
