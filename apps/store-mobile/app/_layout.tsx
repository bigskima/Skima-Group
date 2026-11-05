import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProviders } from "../src/providers/AppProviders";
import { useAppTheme } from "../src/theme/ThemeProvider";

export default function RootLayout() {
  return <AppProviders><Navigation /></AppProviders>;
}
function Navigation() {
  const { scheme, palette } = useAppTheme();
  return <><StatusBar style={scheme === "dark" ? "light" : "dark"} /><Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.canvas } }} /></>;
}
