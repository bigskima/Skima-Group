import { useCallback, useState } from "react";

import type { NestedNavigator } from "../types/navigation";

interface RouteEntry<TRoute extends string> {
  readonly route: TRoute;
  readonly params: Readonly<Record<string, string>>;
}

export function useNestedNavigator<TRoute extends string>(
  initialRoute: TRoute,
): NestedNavigator<TRoute> {
  const [stack, setStack] = useState<readonly RouteEntry<TRoute>[]>([
    { params: {}, route: initialRoute },
  ]);
  const current = stack[stack.length - 1] ?? { params: {}, route: initialRoute };

  const navigate = useCallback((route: TRoute, params: Readonly<Record<string, string>> = {}) => {
    setStack((entries) => [...entries, { params, route }]);
  }, []);

  const replace = useCallback((route: TRoute, params: Readonly<Record<string, string>> = {}) => {
    setStack((entries) => [...entries.slice(0, -1), { params, route }]);
  }, []);

  const goBack = useCallback(() => {
    setStack((entries) => entries.length > 1 ? entries.slice(0, -1) : entries);
  }, []);

  return {
    canGoBack: stack.length > 1,
    goBack,
    navigate,
    params: current.params,
    replace,
    route: current.route,
  };
}
