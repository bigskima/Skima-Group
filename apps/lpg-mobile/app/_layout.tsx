import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useColorScheme } from "react-native";
import { AppProviders } from "../src/native/providers/AppProviders";

export default function RootLayout() {
  const scheme = useColorScheme();
  return <AppProviders><StatusBar style={scheme === "dark" ? "light" : "dark"} /><Stack screenOptions={{ headerShown: false }} /></AppProviders>;
}
