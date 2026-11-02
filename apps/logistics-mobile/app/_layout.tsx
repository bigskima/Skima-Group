import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProviders } from "../src/providers/AppProviders";

export default function RootLayout() {
  return (
    <AppProviders>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false, animation: "fade", contentStyle: { backgroundColor: "#F7F7F8" } }} />
    </AppProviders>
  );
}
