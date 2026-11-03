import { Redirect } from "expo-router";
import { SignInScreen } from "../../src/auth/SignInScreen";
import { useSession } from "../../src/session/SessionProvider";
export default function SignInRoute() {
  const { status } = useSession();
  if (status === "authenticated") return <Redirect href="/(customer)" />;
  return <SignInScreen />;
}
