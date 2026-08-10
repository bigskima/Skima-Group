import { Tabs } from "expo-router";
import { BriefcaseBusiness, CircleUserRound, ClipboardList, Home, QrCode, WalletCards } from "lucide-react-native";
import type { ComponentType } from "react";
import { useColorScheme, useWindowDimensions } from "react-native";
import { colors } from "../theme/tokens";

type Tab = { name: string; title: string; icon: ComponentType<{ color?: string; size?: number }> };
export function WorkspaceTabs({ tabs, hidden = [] }: { tabs: readonly Tab[]; hidden?: readonly string[] }) {
  const dark = useColorScheme() === "dark";
  const desktop = useWindowDimensions().width >= 900;
  return <Tabs screenOptions={{ headerShown: false, tabBarPosition: desktop ? "left" : "bottom", tabBarVariant: desktop ? "material" : "uikit", tabBarActiveTintColor: colors.brand, tabBarInactiveTintColor: dark ? colors.darkMuted : colors.muted, tabBarStyle: desktop ? { backgroundColor: dark ? colors.darkSurface : colors.surface, borderRightColor: dark ? "#29382F" : colors.border, width: 236, paddingTop: 28 } : { backgroundColor: dark ? colors.darkSurface : colors.surface, borderTopColor: dark ? "#29382F" : colors.border, height: 64, paddingTop: 6 }, tabBarLabelStyle: { fontSize: desktop ? 14 : 11, fontWeight: "700", paddingBottom: desktop ? 0 : 5 } }}>
    {tabs.map(({ name, title, icon: Icon }) => <Tabs.Screen key={name} name={name} options={{ title, tabBarIcon: ({ color, size }) => <Icon color={String(color)} size={size} /> }} />)}
    {hidden.map((name) => <Tabs.Screen key={name} name={name} options={{ href: null }} />)}
  </Tabs>;
}
export const customerTabs = [{ name: "index", title: "Home", icon: Home }, { name: "cylinders", title: "Cylinders", icon: QrCode }, { name: "orders", title: "Orders", icon: ClipboardList }, { name: "wallet", title: "Wallet", icon: WalletCards }, { name: "account", title: "Account", icon: CircleUserRound }] as const;
export const driverTabs = [{ name: "index", title: "Home", icon: Home }, { name: "jobs", title: "Jobs", icon: BriefcaseBusiness }, { name: "scan", title: "Scan", icon: QrCode }, { name: "earnings", title: "Earnings", icon: WalletCards }, { name: "account", title: "Account", icon: CircleUserRound }] as const;
export const stationTabs = [{ name: "index", title: "Dashboard", icon: Home }, { name: "jobs", title: "Jobs", icon: BriefcaseBusiness }, { name: "scan", title: "Scan", icon: QrCode }, { name: "settlements", title: "Settlements", icon: WalletCards }, { name: "account", title: "Account", icon: CircleUserRound }] as const;
