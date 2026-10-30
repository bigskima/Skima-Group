import { Redirect } from "expo-router";

/**
 * Compatibility route for an older vehicle-document submission destination.
 * Vehicle applications live in the driver workspace, not the customer area.
 */
export default function CustomerVehicleApplicationCompatibilityRoute() {
  return <Redirect href="/(driver)/vehicles" />;
}
