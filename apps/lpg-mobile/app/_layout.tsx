import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { AppProviders } from "../src/native/providers/AppProviders";
import { useAppTheme } from "../src/native/theme/ThemeProvider";
import * as SplashScreen from "expo-splash-screen";

void SplashScreen.preventAutoHideAsync();
SplashScreen.setOptions({ duration: 250, fade: true });

export default function RootLayout() {
  return <AppProviders><AppNavigator /></AppProviders>;
}

function AppNavigator() {
  const { scheme, palette } = useAppTheme();
  return <><StatusBar style={scheme === "dark" ? "light" : "dark"} /><Stack screenOptions={{ headerShown: false, title: "SKIMA LPG", contentStyle: { backgroundColor: palette.canvas } }} /></>;
}
