import { useCallback, useEffect, useState } from "react";

import { resolveAdminPath } from "./admin-v2-navigation";

function readLocationPath(): string {
  const legacyHashRoute = window.location.hash.startsWith("#/")
    ? window.location.hash.slice(1)
    : null;

  return resolveAdminPath(legacyHashRoute ?? window.location.pathname);
}

function replaceBrowserLocation(path: string) {
  const nextUrl = `${path}${window.location.search}`;
  window.history.replaceState({}, "", nextUrl);
}

export function useAdminRoute(): readonly [string, (href: string, options?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState(readLocationPath);

  useEffect(() => {
    const canonical = readLocationPath();
    const currentPath = window.location.pathname;
    const hasLegacyHash = window.location.hash.startsWith("#/");

    if (canonical !== currentPath || hasLegacyHash) {
      replaceBrowserLocation(canonical);
    }

    setRoute(canonical);

    const handleNavigation = () => {
      const next = readLocationPath();
      if (next !== window.location.pathname || window.location.hash.startsWith("#/")) {
        replaceBrowserLocation(next);
      }
      setRoute(next);
    };

    window.addEventListener("popstate", handleNavigation);
    window.addEventListener("hashchange", handleNavigation);

    return () => {
      window.removeEventListener("popstate", handleNavigation);
      window.removeEventListener("hashchange", handleNavigation);
    };
  }, []);

  const navigate = useCallback((href: string, options?: { replace?: boolean }) => {
    const next = resolveAdminPath(href);
    const nextUrl = `${next}${window.location.search}`;

    if (options?.replace) {
      window.history.replaceState({}, "", nextUrl);
    } else {
      window.history.pushState({}, "", nextUrl);
    }

    setRoute(next);
    window.scrollTo({ top: 0, behavior: "auto" });
  }, []);

  return [route, navigate] as const;
}
