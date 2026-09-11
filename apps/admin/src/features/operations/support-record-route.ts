const SUPPORT_BASE_PATH = "/operations/support";

export type SupportRecordRoute =
  | { readonly kind: "queue" }
  | { readonly kind: "thread"; readonly threadId: string }
  | { readonly kind: "invalid" };

export function parseSupportRecordRoute(rawRoute: string): SupportRecordRoute {
  const path = cleanPath(rawRoute);
  if (path === SUPPORT_BASE_PATH) return { kind: "queue" };
  if (!path.startsWith(SUPPORT_BASE_PATH + "/")) return { kind: "invalid" };

  const remainder = path.slice(SUPPORT_BASE_PATH.length + 1);
  if (!remainder || remainder.includes("/")) return { kind: "invalid" };

  try {
    const threadId = decodeURIComponent(remainder).trim();
    return threadId ? { kind: "thread", threadId } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

export function buildSupportThreadRoute(threadId: string): string {
  return SUPPORT_BASE_PATH + "/" + encodeURIComponent(threadId.trim());
}

function cleanPath(rawRoute: string): string {
  const beforeQuery = rawRoute.split("?")[0] ?? rawRoute;
  const beforeHash = beforeQuery.split("#")[0] ?? beforeQuery;
  const trimmed = beforeHash.trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : "/" + trimmed;
  return withSlash.endsWith("/") && withSlash !== "/" ? withSlash.slice(0, -1) : withSlash;
}
