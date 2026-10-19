import { Stack } from "expo-router";
import { WorkspaceGate } from "../../src/native/navigation/WorkspaceGate";

export default function StationManagedDriverLayout() {
  return (
    <WorkspaceGate workspace="station_driver">
      <Stack screenOptions={{ headerShown: false }} />
    </WorkspaceGate>
  );
}
