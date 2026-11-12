import { useLocalSearchParams } from "expo-router";
import { FleetInviteAcceptanceScreen } from "../../src/native/ui/FleetPartnerPortalScreen";

export default function FleetInviteRoute() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = Array.isArray(params.token) ? params.token[0] ?? "" : params.token ?? "";
  return <FleetInviteAcceptanceScreen token={token} />;
}
