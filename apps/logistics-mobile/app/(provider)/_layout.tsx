import { Redirect } from "expo-router";
import { ProviderTabs } from "../../src/navigation/ProviderTabs";
import { useSession } from "../../src/session/SessionProvider";

export default function ProviderLayout() {
  const { status } = useSession();
  if (status === "unauthenticated") return <Redirect href="/(auth)/sign-in" />;
  return <ProviderTabs />;
}
