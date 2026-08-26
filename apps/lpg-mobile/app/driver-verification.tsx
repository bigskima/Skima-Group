import { Redirect } from "expo-router";
import { useSession } from "../src/native/session/SessionProvider";
import { DriverVerificationScreen } from "../src/native/ui/DriverVerificationScreen";

export default function DriverVerification() {
  const session = useSession();
  if (session.status !== "authenticated") return <Redirect href="/(auth)/login" />;
  return <DriverVerificationScreen />;
}
