import { Redirect } from "expo-router";

export default function LegacyProviderHomeRoute() {
  return <Redirect href="/(provider)/index" />;
}
