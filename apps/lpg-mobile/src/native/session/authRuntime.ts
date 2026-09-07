export type AuthRuntimeState = "checking" | "ready" | "unavailable";

export class AuthRuntimeError extends Error {
  readonly kind: "network" | "configuration";

  constructor(kind: "network" | "configuration", message: string) {
    super(message);
    this.name = "AuthRuntimeError";
    this.kind = kind;
  }
}

interface VerifyAuthRuntimeInput {
  readonly supabaseUrl: string;
  readonly anonKey: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

export async function verifySkimaAuthRuntime(input: VerifyAuthRuntimeInput): Promise<void> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const controller = typeof AbortController === "undefined" ? null : new AbortController();
  const timeout = controller
    ? setTimeout(() => controller.abort(), input.timeoutMs ?? 7000)
    : null;

  try {
    const response = await fetchImpl(
      `${input.supabaseUrl.replace(/\/$/, "")}/functions/v1/health`,
      {
        method: "GET",
        headers: {
          apikey: input.anonKey,
          "x-skima-client": "lpg-auth-preflight",
        },
        signal: controller?.signal,
      },
    );

    if (!response.ok) {
      throw new AuthRuntimeError(
        "configuration",
        "SKIMA account access is temporarily unavailable because this app is not connected to the SKIMA account service.",
      );
    }

    const payload = await response.json().catch(() => null) as
      | { ok?: unknown; service?: unknown; backend?: unknown }
      | null;

    if (
      payload?.ok !== true ||
      payload.service !== "skima-platform" ||
      payload.backend !== "supabase"
    ) {
      throw new AuthRuntimeError(
        "configuration",
        "SKIMA account access is temporarily unavailable because this app is not connected to the SKIMA account service.",
      );
    }
  } catch (cause) {
    if (cause instanceof AuthRuntimeError) throw cause;
    throw new AuthRuntimeError(
      "network",
      "SKIMA could not verify the secure account service. Check your connection and try again.",
    );
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
