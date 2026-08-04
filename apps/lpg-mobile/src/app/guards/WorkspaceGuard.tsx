import type { ReactNode } from "react";

import type { LpgWorkspace } from "../../features/permissions/workspaceAccess";
import { useWorkspace } from "../../features/permissions/WorkspaceProvider";
import { StateScreen } from "../../shared/ui/lpgComponents";

export function WorkspaceGuard(props: {
  readonly workspace: LpgWorkspace;
  readonly children: ReactNode;
}) {
  const workspace = useWorkspace();

  if (!workspace.available.includes(props.workspace)) {
    return (
      <StateScreen
        title="Workspace unavailable"
        message="Your current account does not have access to this workspace."
      />
    );
  }

  return props.children;
}
