const ORDERS_BASE_PATH = "/operations/orders";

export type OrderRecordRoute =
  | { readonly kind: "queue" }
  | { readonly kind: "order"; readonly reference: string }
  | { readonly kind: "invalid" };

export function parseOrderRecordRoute(rawRoute: string): OrderRecordRoute {
  const path = cleanPath(rawRoute);
  if (path === ORDERS_BASE_PATH) return { kind: "queue" };
  if (!path.startsWith(ORDERS_BASE_PATH + "/")) return { kind: "invalid" };

  const remainder = path.slice(ORDERS_BASE_PATH.length + 1);
  if (!remainder || remainder.includes("/")) return { kind: "invalid" };

  try {
    const reference = decodeURIComponent(remainder).trim();
    return reference ? { kind: "order", reference } : { kind: "invalid" };
  } catch {
    return { kind: "invalid" };
  }
}

export function buildOrderRecordRoute(reference: string): string {
  return ORDERS_BASE_PATH + "/" + encodeURIComponent(reference.trim());
}

function cleanPath(rawRoute: string): string {
  const beforeQuery = rawRoute.split("?")[0] ?? rawRoute;
  const beforeHash = beforeQuery.split("#")[0] ?? beforeQuery;
  const trimmed = beforeHash.trim();
  const withSlash = trimmed.startsWith("/") ? trimmed : "/" + trimmed;
  return withSlash.endsWith("/") && withSlash !== "/" ? withSlash.slice(0, -1) : withSlash;
}
