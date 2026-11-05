export type BillsPage = "bills" | "activity" | "wallet" | "store" | "account" | "top-up" | "withdraw" | "notifications" | "saved" | "receipt";
export type BillsNavigationEvent = { page: BillsPage; receiptId?: string };
type Listener = (event: BillsNavigationEvent) => void;
const listeners = new Set<Listener>();

function isUuid(value: string) {
  const expected = [8, 4, 4, 4, 12];
  const groups = value.split("-");
  return groups.length === 5 && groups.every((group, index) =>
    group.length === expected[index] &&
    [...group].every((character) => "0123456789abcdef".includes(character.toLowerCase()))
  );
}

export function subscribeBillsNavigation(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function navigateBillsRoute(route: unknown) {
  if (typeof route !== "string" || !route.startsWith("/") || route.startsWith("//") || route.includes("://")) return false;
  const path = route.split("?")[0].split("#")[0];
  const normalized = path.replace(/^\/\(customer\)/, "");
  const pages: Record<string, BillsPage> = {
    "": "bills",
    "/bills": "bills",
    "/activity": "activity",
    "/wallet": "wallet",
    "/store": "store",
    "/account": "account",
    "/top-up": "top-up",
    "/withdraw": "withdraw",
    "/notifications": "notifications",
    "/beneficiaries": "saved",
    "/saved-billers": "saved",
  };
  if (normalized.startsWith("/receipt/")) {
    const id = normalized.slice("/receipt/".length);
    if (!isUuid(id)) return false;
    for (const listener of listeners) listener({ page: "receipt", receiptId: id });
    return true;
  }
  const page = pages[normalized];
  if (!page) return false;
  for (const listener of listeners) listener({ page });
  return true;
}
