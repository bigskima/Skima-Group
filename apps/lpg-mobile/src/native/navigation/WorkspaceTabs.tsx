import { BlurView } from "expo-blur";
import { Tabs } from "expo-router";
import { BriefcaseBusiness, CircleUserRound, ClipboardList, Home, QrCode, WalletCards } from "lucide-react-native";
import type { ComponentType } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors } from "../theme/tokens";

type Tab = { name: string; title: string; icon: ComponentType<{ color?: string; size?: number; strokeWidth?: number }> };

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
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: palette.muted,
        tabBarHideOnKeyboard: true,
        tabBarBackground: desktop ? undefined : () => <BlurView intensity={90} tint={scheme} style={StyleSheet.absoluteFill} />,
        tabBarStyle: desktop
          ? { backgroundColor: palette.surface, borderRightColor: palette.border, width: 218, paddingTop: 24 }
          : {
              position: "absolute",
              left: 12,
              right: 12,
              bottom: 10,
              height: 66,
              overflow: "hidden",
              borderTopWidth: 0,
              borderRadius: 22,
              backgroundColor: scheme === "dark" ? "rgba(21,33,26,.90)" : "rgba(255,255,255,.91)",
              shadowColor: "#000",
              shadowOpacity: .15,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 8 },
              elevation: 9,
            },
        tabBarItemStyle: desktop ? undefined : { paddingVertical: 6 },
        tabBarLabelStyle: { fontSize: desktop ? 13 : 9, fontWeight: "800", paddingBottom: desktop ? 0 : 2 },
      }}
    >
      {tabs.map(({ name, title, icon: Icon }) => (
        <Tabs.Screen
          key={name}
          name={name}
          options={{
            title,
            tabBarIcon: ({ color, size, focused }) => (
              <View style={[styles.icon, !desktop && focused && { backgroundColor: palette.brandSoft }]}>
                <Icon color={String(color)} size={desktop ? size : 20} strokeWidth={focused ? 2.6 : 2} />
              </View>
            ),
          }}
        />
      ))}
      {hidden.map((name) => <Tabs.Screen key={name} name={name} options={{ href: null }} />)}
    </Tabs>
  );
}

const styles = StyleSheet.create({ icon: { width: 36, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 12 } });

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
