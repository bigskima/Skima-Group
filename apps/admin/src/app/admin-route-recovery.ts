export function shouldShowWorkspaceRouteUnavailable(input: {
  readonly route: string;
  readonly workspaceBasePath: string;
  readonly workspaceVisible: boolean;
  readonly hasVisibleScreen: boolean;
}): boolean {
  if (input.hasVisibleScreen || !input.workspaceVisible) return false;

  const route = normalizePath(input.route);
  const basePath = normalizePath(input.workspaceBasePath);
  return route === basePath || route.startsWith(basePath + "/");
}

function normalizePath(value: string): string {
  const beforeQuery = value.split("?")[0] ?? value;
  const beforeHash = beforeQuery.split("#")[0] ?? beforeQuery;
  const trimmed = beforeHash.trim() || "/";
  const withSlash = trimmed.startsWith("/") ? trimmed : "/" + trimmed;
  return withSlash.length > 1 && withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
}
