import {
  WorkspaceTabs,
  stationDriverTabs,
} from "../../src/native/navigation/WorkspaceTabs";
import { WorkspaceGate } from "../../src/native/navigation/WorkspaceGate";

export default function StationManagedDriverLayout() {
  return (
    <WorkspaceGate workspace="station_driver">
      <WorkspaceTabs
        guideScope="driver"
        tabs={stationDriverTabs}
        hidden={["job/[id]"]}
      />
    </WorkspaceGate>
  );
}
