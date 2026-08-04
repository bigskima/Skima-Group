import { workspaceConfigs } from "../../features/permissions/workspaceAccess";
import { useWorkspace } from "../../features/permissions/WorkspaceProvider";

export function WorkspaceSelector() {
  const workspace = useWorkspace();

  if (workspace.available.length < 2) return null;

  return (
    <div className="workspace-switcher" aria-label="Switch workspace">
      {workspace.available.map((item) => (
        <button
          key={item}
          type="button"
          className={workspace.current === item ? "is-active" : ""}
          aria-pressed={workspace.current === item}
          onClick={() => workspace.select(item)}
        >
          {workspaceConfigs[item].label}
        </button>
      ))}
    </div>
  );
}
