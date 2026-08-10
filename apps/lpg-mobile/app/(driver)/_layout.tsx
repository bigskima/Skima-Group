import {
  WorkspaceTabs,
  driverTabs,
} from "../../src/native/navigation/WorkspaceTabs";
import { WorkspaceGate } from "../../src/native/navigation/WorkspaceGate";
export default function Layout() {
  return (
    <WorkspaceGate workspace="driver">
      <WorkspaceTabs
        tabs={driverTabs}
        hidden={[
          "job/[id]",
          "notifications",
          "application",
          "vehicles",
          "documents",
          "vehicle-documents",
          "availability",
          "support",
          "withdraw",
          "profile",
          "service-zone",
        ]}
      />
    </WorkspaceGate>
  );
}
