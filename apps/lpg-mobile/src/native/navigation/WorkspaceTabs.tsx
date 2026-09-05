import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import {
  BriefcaseBusiness,
  CircleUserRound,
  ClipboardList,
  Home,
  QrCode,
  WalletCards,
} from "lucide-react-native";
import type { ComponentType } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows } from "../theme/tokens";

type Tab = {
  name: string;
  title: string;
  icon: ComponentType<{ color?: string; size?: number; strokeWidth?: number }>;
};

export function WorkspaceTabs({ tabs, hidden = [] }: { tabs: readonly Tab[]; hidden?: readonly string[] }) {
  const { scheme, palette } = useAppTheme();
  const desktop = useWindowDimensions().width >= 900;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: palette.canvas },
        tabBarPosition: desktop ? "left" : "bottom",
        tabBarVariant: desktop ? "material" : "uikit",
        tabBarActiveTintColor: palette.brand,
        tabBarInactiveTintColor: palette.muted,
        tabBarHideOnKeyboard: true,
        tabBarBackground: desktop
          ? undefined
          : () => <BlurView intensity={88} tint={scheme} style={StyleSheet.absoluteFill} />,
        tabBarStyle: desktop
          ? {
              backgroundColor: palette.surface,
              borderRightColor: palette.border,
              borderRightWidth: StyleSheet.hairlineWidth,
              width: 224,
              paddingTop: 26,
              paddingHorizontal: 10,
            }
          : {
              position: "absolute",
              left: 14,
              right: 14,
              bottom: 12,
              height: 72,
              overflow: "hidden",
              borderTopWidth: 0,
              borderWidth: StyleSheet.hairlineWidth,
              borderColor: scheme === "dark" ? "rgba(255,255,255,.10)" : "rgba(25,25,27,.08)",
              borderRadius: 26,
              backgroundColor: scheme === "dark" ? "rgba(25,25,28,.92)" : "rgba(255,255,255,.93)",
              ...shadows.raised,
            },
        tabBarItemStyle: desktop
          ? { marginVertical: 3, borderRadius: radii.md }
          : { paddingVertical: 7, marginHorizontal: 2 },
        tabBarLabelStyle: {
          fontSize: desktop ? 13 : 9.5,
          fontWeight: "900",
          paddingBottom: desktop ? 0 : 3,
        },
      }}
    >
      {tabs.map(({ name, title, icon: Icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ color, size, focused }) => (
              <View
                style={[
                  styles.icon,
                  desktop && focused && { backgroundColor: palette.brandSofter },
                  !desktop && focused && { backgroundColor: palette.brandSoft },
                ]}
              >
                <Icon
                  color={String(color)}
                  size={desktop ? Math.min(size, 21) : 20}
                  strokeWidth={focused ? 2.6 : 2}
                />
              </View>
            ),
          }}
        />
      ))}
      {hidden.map((name) => <Tabs.Screen key={name} name={name} options={{ href: null }} />)}
    </Tabs>
  );
}

const styles = StyleSheet.create({
  icon: {
    width: 42,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
});

export const customerTabs = [
  { name: "index", title: "Home", icon: Home },
  { name: "cylinders", title: "Cylinders", icon: QrCode },
  { name: "orders", title: "Orders", icon: ClipboardList },
  { name: "wallet", title: "Wallet", icon: WalletCards },
  { name: "account", title: "Account", icon: CircleUserRound },
] as const;

export const driverTabs = [
  { name: "index", title: "Today", icon: Home },
  { name: "jobs", title: "Jobs", icon: BriefcaseBusiness },
  { name: "scan", title: "Scan", icon: QrCode },
  { name: "earnings", title: "Earnings", icon: WalletCards },
  { name: "account", title: "Account", icon: CircleUserRound },
] as const;

export const stationTabs = [
  { name: "index", title: "Today", icon: Home },
  { name: "jobs", title: "Queue", icon: BriefcaseBusiness },
  { name: "scan", title: "Scan", icon: QrCode },
  { name: "settlements", title: "Money", icon: WalletCards },
  { name: "account", title: "Account", icon: CircleUserRound },
] as const;
