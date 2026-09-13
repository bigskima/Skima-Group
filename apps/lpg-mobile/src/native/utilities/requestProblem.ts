import { ApiGatewayError } from "@skima/frontend-core";

export type RequestProblemKind =
  | "network"
  | "server"
  | "missing"
  | "permission"
  | "role"
  | "station_scope"
  | "service_unavailable"
  | "session"
  | "unknown";

export interface RequestProblem {
  readonly kind: RequestProblemKind;
  readonly retryable: boolean;
  readonly status: number | null;
  readonly code: string | null;
  readonly requestId: string | null;
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message.toLowerCase() : typeof error === "string" ? error.toLowerCase() : "";
}

export function classifyRequestProblem(error: unknown): RequestProblem {
  const message = messageOf(error);
  const gateway = error instanceof ApiGatewayError ? error : null;
  const status = gateway?.status ?? null;
  const code = gateway?.code?.toLowerCase() ?? null;
  const combined = `${code ?? ""} ${message}`;

  if (status === 401 || /missing_session|unauthori[sz]ed|session|token/.test(combined)) {
    return { kind: "session", retryable: false, status, code, requestId: gateway?.requestId ?? null };
  }
  if (/station branch|branch-scoped|station ownership|station_scope/.test(combined)) {
    return { kind: "station_scope", retryable: false, status, code, requestId: gateway?.requestId ?? null };
  }
  if (/role restriction|role_required|role required|wrong role/.test(combined)) {
    return { kind: "role", retryable: false, status, code, requestId: gateway?.requestId ?? null };
  }
  if (status === 403 || /permission|forbidden|access denied|not allowed/.test(combined)) {
    return { kind: "permission", retryable: false, status, code, requestId: gateway?.requestId ?? null };
  }
  if (status === 404 || /not found|missing resource/.test(combined)) {
    return { kind: "missing", retryable: false, status, code, requestId: gateway?.requestId ?? null };
  }
  if (status === 0 || /network|fetch|offline|connection/.test(combined)) {
    return { kind: "network", retryable: true, status, code, requestId: gateway?.requestId ?? null };
  }
  if (status === 408 || status === 429 || status === 502 || status === 503 || status === 504 || /temporar|timeout|rate limit/.test(combined)) {
    return { kind: "service_unavailable", retryable: true, status, code, requestId: gateway?.requestId ?? null };
  }
  if (status !== null && status >= 500) {
    return { kind: "server", retryable: true, status, code, requestId: gateway?.requestId ?? null };
  }
  return { kind: "unknown", retryable: true, status, code, requestId: gateway?.requestId ?? null };
}
