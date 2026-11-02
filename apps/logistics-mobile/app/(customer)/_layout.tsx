import { Redirect } from "expo-router";
import { CustomerTabs } from "../../src/navigation/CustomerTabs";
import { useSession } from "../../src/session/SessionProvider";
export default function CustomerLayout() {
  const { status } = useSession();
  if (status === "unauthenticated") return <Redirect href="/(auth)/sign-in" />;
  return <CustomerTabs />;
}
