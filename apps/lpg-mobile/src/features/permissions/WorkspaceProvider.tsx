import type { SessionContext } from "@skima/frontend-core";
import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from "react";

import { useWorkspaceAccessQuery } from "./api";
import { resolveAvailableWorkspaces, type LpgWorkspace } from "./workspaceAccess";

interface WorkspaceState {
  readonly available: readonly LpgWorkspace[];
  readonly current: LpgWorkspace;
  readonly select: (workspace: LpgWorkspace) => void;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);
const storageKey = "skima.lpg.workspace";

export function WorkspaceProvider(props: {
  readonly children: ReactNode;
  readonly session: SessionContext;
}) {
  const access = useWorkspaceAccessQuery();
  const available = useMemo(
    () => resolveAvailableWorkspaces(props.session, access.data ?? { workspaces: [] }),
    [access.data, props.session],
  );
  const [current, setCurrent] = useState<LpgWorkspace>("customer");

  useEffect(() => {
    if (!available.includes(current)) setCurrent(available[0] ?? "customer");
  }, [available, current]);

  const select = (workspace: LpgWorkspace) => {
    if (!available.includes(workspace)) return;
    setCurrent(workspace);
    window.localStorage.setItem(storageKey, workspace);
  };

  return (
    <WorkspaceContext.Provider value={{ available, current, select }}>
      {props.children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceState {
  const value = useContext(WorkspaceContext);
  if (!value) throw new Error("useWorkspace must be used within WorkspaceProvider.");
  return value;
}
