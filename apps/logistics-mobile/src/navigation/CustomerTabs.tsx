import { Tabs } from "expo-router";
import { BlurView } from "expo-blur";
import { ClipboardList, Home, Plus, UserRound } from "lucide-react-native";
import { StyleSheet, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows } from "../theme/tokens";

export function CustomerTabs() {
  const { palette, scheme } = useAppTheme();
  const desktop = useWindowDimensions().width >= 900;
  const insets = useSafeAreaInsets();
  return (
    <Tabs screenOptions={{
      headerShown: false,
      sceneStyle: { backgroundColor: palette.canvas },
      tabBarPosition: desktop ? "left" : "bottom",
      tabBarVariant: desktop ? "material" : "uikit",
      tabBarActiveTintColor: palette.brand,
      tabBarInactiveTintColor: palette.muted,
      tabBarHideOnKeyboard: true,
      tabBarBackground: desktop ? undefined : () => <BlurView intensity={88} tint={scheme} style={StyleSheet.absoluteFill} />,
      tabBarStyle: desktop ? {
        backgroundColor: palette.surface, borderRightColor: palette.border, borderRightWidth: StyleSheet.hairlineWidth,
        width: 224, paddingTop: Math.max(26, insets.top + 10), paddingHorizontal: 10,
      } : {
        position: "absolute", left: 14, right: 14, bottom: Math.max(12, insets.bottom), height: 72,
        overflow: "hidden", borderTopWidth: 0, borderWidth: StyleSheet.hairlineWidth,
        borderColor: scheme === "dark" ? "rgba(255,255,255,.10)" : "rgba(25,25,27,.08)",
        borderRadius: 26, backgroundColor: scheme === "dark" ? "rgba(25,25,28,.92)" : "rgba(255,255,255,.93)",
        ...shadows.raised,
      },
      tabBarItemStyle: desktop ? { marginVertical: 3, borderRadius: radii.md } : { paddingVertical: 7, marginHorizontal: 2 },
      tabBarLabelStyle: { fontSize: desktop ? 13 : 10, fontWeight: "900", paddingBottom: desktop ? 0 : 3 },
    }}>
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: ({ color, size }) => <Home color={String(color)} size={size} /> }} />
      <Tabs.Screen name="request" options={{ title: "Request", tabBarIcon: ({ color }) => <Plus color={String(color)} size={21} strokeWidth={3} /> }} />
      <Tabs.Screen name="jobs" options={{ title: "Activity", tabBarIcon: ({ color, size }) => <ClipboardList color={String(color)} size={size} /> }} />
      <Tabs.Screen name="account" options={{ title: "Account", tabBarIcon: ({ color, size }) => <UserRound color={String(color)} size={size} /> }} />
      <Tabs.Screen name="jobs/[id]" options={{ href: null }} />
    </Tabs>
  );
}
