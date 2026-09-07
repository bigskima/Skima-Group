import { WorkspaceTabs, stationTabs } from "../../src/native/navigation/WorkspaceTabs";
import { WorkspaceGate } from "../../src/native/navigation/WorkspaceGate";

export default function Layout() {
  return (
    <WorkspaceGate workspace="station">
      <WorkspaceTabs
        tabs={stationTabs}
        hidden={[
          "assistant",
          "job/[id]",
          "notifications",
          "locations",
          "location-editor",
          "application",
          "documents",
          "staff",
          "settings",
          "operating-settings",
          "pricing-settings",
          "support",
          "inventory",
          "withdraw",
          "profile",
          "reports",
          "roles",
          "account-tools",
          "account-settings",
        ]}
      />
    </WorkspaceGate>
  );
}
