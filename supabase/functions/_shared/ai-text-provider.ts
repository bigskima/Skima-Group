export type AiTextProtocol =
  | "gemini_generate_content"
  | "openai_chat_completions"
  | "anthropic_messages";

export interface AiTextMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface AiTextRoute {
  readonly adapterKey: string;
  readonly modelKey: string;
  readonly protocol: AiTextProtocol;
  readonly endpoint: string;
  readonly secretRef: string;
  readonly config: Readonly<Record<string, unknown>>;
}

export interface AiTextResult {
  readonly text: string;
  readonly usage: Readonly<Record<string, unknown>>;
  readonly providerMetadata: Readonly<Record<string, unknown>>;
}

export async function executeAiTextProvider(
  route: AiTextRoute,
  systemPrompt: string,
  messages: readonly AiTextMessage[],
): Promise<AiTextResult> {
  const secret = resolveProviderSecret(route.secretRef, route.config);
  const timeoutMs = readPositiveInteger(route.config.timeout_ms, 25_000);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    if (route.protocol === "gemini_generate_content") {
      return await executeGemini(route, secret, systemPrompt, messages, controller.signal);
    }

    if (route.protocol === "openai_chat_completions") {
      return await executeOpenAiCompatible(route, secret, systemPrompt, messages, controller.signal);
    }

    if (route.protocol === "anthropic_messages") {
      return await executeAnthropic(route, secret, systemPrompt, messages, controller.signal);
    }

    throw new Error(`AI protocol '${String(route.protocol)}' is not supported`);
  } finally {
    clearTimeout(timeout);
  }
}

export function resolveProviderSecret(
  secretRef: string,
  config: Readonly<Record<string, unknown>>,
): string {
  const configuredEnv = readString(config.api_key_env);
  const envName = configuredEnv ??
    (secretRef.startsWith("SUPABASE_SECRET:") ? secretRef.slice("SUPABASE_SECRET:".length) : null) ??
    (secretRef.startsWith("ENV:") ? secretRef.slice("ENV:".length) : null);

  if (!envName) {
    throw new Error("AI provider secret reference is not configured");
  }

  const value = Deno.env.get(envName);
  if (!value) {
    throw new Error(`AI provider secret '${envName}' is not available to the runtime`);
  }

  return value;
}

async function executeGemini(
  route: AiTextRoute,
  secret: string,
  systemPrompt: string,
  messages: readonly AiTextMessage[],
  signal: AbortSignal,
): Promise<AiTextResult> {
  const endpoint = trimTrailingSlash(route.endpoint);
  const response = await fetch(
    `${endpoint}/models/${encodeURIComponent(route.modelKey)}:generateContent`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": secret,
      },
      body: JSON.stringify({
        systemInstruction: systemPrompt
          ? { parts: [{ text: systemPrompt }] }
          : undefined,
        contents: messages.map((message) => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        generationConfig: {
          temperature: readFiniteNumber(route.config.temperature, 0.25),
          maxOutputTokens: readPositiveInteger(route.config.max_output_tokens, 900),
        },
      }),
      signal,
    },
  );

  const payload = await readJsonResponse(response, route.adapterKey);
  const candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
  const candidate = asRecord(candidates[0]);
  const content = asRecord(candidate?.content);
  const parts = Array.isArray(content?.parts) ? content?.parts : [];
  const text = parts
    .map((part) => readString(asRecord(part)?.text))
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("AI provider returned an empty response");
  }

  return {
    text,
    usage: asRecord(payload.usageMetadata) ?? {},
    providerMetadata: {
      finishReason: readString(candidate?.finishReason),
      protocol: route.protocol,
    },
  };
}

async function executeOpenAiCompatible(
  route: AiTextRoute,
  secret: string,
  systemPrompt: string,
  messages: readonly AiTextMessage[],
  signal: AbortSignal,
): Promise<AiTextResult> {
  const endpoint = trimTrailingSlash(route.endpoint);
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${secret}`,
      "content-type": "application/json",
      ...readStringRecord(route.config.headers),
    },
    body: JSON.stringify({
      model: route.modelKey,
      messages: [
        ...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []),
        ...messages,
      ],
      temperature: readFiniteNumber(route.config.temperature, 0.25),
      max_tokens: readPositiveInteger(route.config.max_output_tokens, 900),
    }),
    signal,
  });

  const payload = await readJsonResponse(response, route.adapterKey);
  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  const choice = asRecord(choices[0]);
  const message = asRecord(choice?.message);
  const text = readString(message?.content)?.trim();

  if (!text) {
    throw new Error("AI provider returned an empty response");
  }

  return {
    text,
    usage: asRecord(payload.usage) ?? {},
    providerMetadata: {
      finishReason: readString(choice?.finish_reason),
      protocol: route.protocol,
    },
  };
}

async function executeAnthropic(
  route: AiTextRoute,
  secret: string,
  systemPrompt: string,
  messages: readonly AiTextMessage[],
  signal: AbortSignal,
): Promise<AiTextResult> {
  const endpoint = trimTrailingSlash(route.endpoint);
  const response = await fetch(`${endpoint}/messages`, {
    method: "POST",
    headers: {
      "anthropic-version": readString(route.config.anthropic_version) ?? "2023-06-01",
      "content-type": "application/json",
      "x-api-key": secret,
      ...readStringRecord(route.config.headers),
    },
    body: JSON.stringify({
      model: route.modelKey,
      max_tokens: readPositiveInteger(route.config.max_output_tokens, 900),
      temperature: readFiniteNumber(route.config.temperature, 0.25),
      system: systemPrompt || undefined,
      messages,
    }),
    signal,
  });

  const payload = await readJsonResponse(response, route.adapterKey);
  const blocks = Array.isArray(payload.content) ? payload.content : [];
  const text = blocks
    .map((block) => readString(asRecord(block)?.text))
    .filter((value): value is string => Boolean(value))
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("AI provider returned an empty response");
  }

  return {
    text,
    usage: asRecord(payload.usage) ?? {},
    providerMetadata: {
      stopReason: readString(payload.stop_reason),
      protocol: route.protocol,
    },
  };
}

async function readJsonResponse(
  response: Response,
  adapterKey: string,
): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => null);
  const record = asRecord(payload);

  if (!response.ok) {
    const errorRecord = asRecord(record?.error);
    const detail = readString(errorRecord?.message) ?? readString(record?.message) ??
      `HTTP ${response.status}`;
    throw new Error(`${adapterKey} request failed: ${detail}`);
  }

  if (!record) {
    throw new Error(`${adapterKey} returned an invalid response`);
  }

  return record;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPositiveInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function readFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value);
  if (!record) return {};

  return Object.fromEntries(
    Object.entries(record)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}
