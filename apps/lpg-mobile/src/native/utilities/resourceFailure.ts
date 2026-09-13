import { ApiGatewayError } from "@skima/frontend-core";

export type ResourceFailureKind =
  | "permission"
  | "role"
  | "ownership"
  | "network"
  | "missing"
  | "temporary"
  | "server"
  | "unknown";

export interface ResourceFailureState {
  readonly kind: ResourceFailureKind;
  readonly retryable: boolean;
}

function messageFrom(cause: unknown) {
  if (cause instanceof Error) return cause.message.toLowerCase();
  if (typeof cause === "string") return cause.toLowerCase();
  if (cause && typeof cause === "object") {
    const record = cause as Record<string, unknown>;
    for (const key of ["message", "error", "details", "code"]) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value.toLowerCase();
    }
  }
  return "";
}

export function classifyResourceFailure(cause: unknown): ResourceFailureState {
  const message = messageFrom(cause);

  if (cause instanceof ApiGatewayError) {
    if (cause.status === 403) return { kind: "permission", retryable: false };
    if (cause.status === 404) return { kind: "missing", retryable: false };
    if (cause.status === 408 || cause.status === 425 || cause.status === 429)
      return { kind: "temporary", retryable: true };
    if ([502, 503, 504].includes(cause.status))
      return { kind: "temporary", retryable: true };
    if (cause.status >= 500) return { kind: "server", retryable: true };
  }

  if (
    message.includes("another station") ||
    message.includes("station ownership") ||
    message.includes("station branch") && message.includes("access")
  )
    return { kind: "ownership", retryable: false };

  if (
    message.includes("role restriction") ||
    message.includes("role is required") ||
    message.includes("station owner") && message.includes("required")
  )
    return { kind: "role", retryable: false };

  if (
    message.includes("permission denied") ||
    message.includes("forbidden") ||
    message.includes("insufficient permission") ||
    message.includes("not permitted") ||
    message.includes("42501") ||
    message.includes("row-level security")
  )
    return { kind: "permission", retryable: false };

  if (
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("connection") ||
    message.includes("offline") ||
    message.includes("timeout")
  )
    return { kind: "network", retryable: true };

  if (
    message.includes("not found") ||
    message.includes("no rows") ||
    message.includes("does not exist")
  )
    return { kind: "missing", retryable: false };

  if (
    message.includes("temporarily unavailable") ||
    message.includes("try again later") ||
    message.includes("service unavailable")
  )
    return { kind: "temporary", retryable: true };

  return { kind: "unknown", retryable: true };
}
