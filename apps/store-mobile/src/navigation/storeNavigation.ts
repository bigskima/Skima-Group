export type StorePage = "shop" | "orders" | "wallet" | "account" | "top-up" | "withdraw" | "notifications";
type StoreNavigationEvent = { page: StorePage };
type Listener = (event: StoreNavigationEvent) => void;
const listeners = new Set<Listener>();

export function subscribeStoreNavigation(listener: Listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function navigateStoreRoute(route: unknown) {
  if (typeof route !== "string" || !route.startsWith("/") || route.startsWith("//") || route.includes("://")) return false;
  const path = route.split("?")[0].split("#")[0].replace(/^\/\(customer\)/, "");
  const pages: Record<string, StorePage> = {
    "": "shop", "/": "shop", "/store": "shop", "/shop": "shop",
    "/orders": "orders", "/store/orders": "orders", "/wallet": "wallet",
    "/account": "account", "/top-up": "top-up", "/withdraw": "withdraw",
    "/notifications": "notifications",
  };
  const page = pages[path];
  if (!page) return false;
  for (const listener of listeners) listener({ page });
  return true;
}
