import type { SessionContext } from "@skima/frontend-core";
import type { ReactNode } from "react";

import { hasAnyPermission, hasPermission } from "../../shared/api/records";

export function PermissionGuard(props: {
  readonly context: SessionContext;
  readonly permissions: readonly string[];
  readonly match?: "all" | "any";
  readonly children: ReactNode;
  readonly fallback?: ReactNode;
}) {
  const allowed = props.match === "all"
    ? props.permissions.every((permission) => hasPermission(props.context, permission))
    : hasAnyPermission(props.context, props.permissions);

  return allowed ? props.children : props.fallback ?? null;
}
