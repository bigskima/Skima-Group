import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Bell, Package, ShoppingBag, UserRound, WalletCards } from "lucide-react-native";
import { Pressable, SafeAreaView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { StoreBrandMark } from "../ui/BrandMark";
import { subscribeStoreNavigation, type StorePage } from "../navigation/storeNavigation";
import { StoreShopScreen } from "./StoreShopScreen";
import { StoreOrdersScreen } from "./StoreOrdersScreen";
import { StoreWalletScreen, StoreTopUpScreen, StoreWithdrawScreen } from "./StoreWalletScreens";
import { StoreAccountScreen } from "./StoreAccountScreen";
import { StoreNotificationsScreen } from "./StoreNotificationsScreen";
import { StoreReferralsScreen } from "./StoreReferralsScreen";
import { useStoreGuide } from "../onboarding/StoreGuideProvider";

const tabs = [
  { key: "shop", label: "Shop", icon: ShoppingBag },
  { key: "orders", label: "Orders", icon: Package },
  { key: "wallet", label: "Wallet", icon: WalletCards },
  { key: "account", label: "Account", icon: UserRound },
] as const;

export function StoreApp() {
  const { palette } = useAppTheme();
  const guide = useStoreGuide();
  const { width } = useWindowDimensions();
  const desktop = width >= 960;
  const [page, setPage] = useState<StorePage>("shop");
  const open = useCallback((next: StorePage) => {
    setPage(next);
    guide.setCurrentPage(next);
  }, [guide.setCurrentPage]);
  useEffect(() => subscribeStoreNavigation((event) => open(event.page)), [open]);
  const title = page === "shop" ? "Shop SKIMA" : page === "orders" ? "Your orders" :
    page === "wallet" ? "SKIMA Wallet" : page === "account" ? "Account" :
    page === "top-up" ? "Add funds" : page === "withdraw" ? "Withdraw funds" : page === "referrals" ? "Referrals & rewards" : "Notifications";
  const isTab = tabs.some((tab) => tab.key === page);
  const navigationItem = (tab: typeof tabs[number], variant: "side" | "bottom") => {
    const Icon = tab.icon;
    const selected = tab.key === page;
    return <Pressable key={tab.key} onPress={() => open(tab.key)} accessibilityRole="button" accessibilityState={{ selected }}
      style={variant === "side" ? [styles.sideItem, { backgroundColor: selected ? palette.brandSoft : "transparent" }] : styles.tab}>
      <Icon color={selected ? palette.brand : palette.muted} size={19} />
      <Text style={{ fontSize: variant === "side" ? 12 : 10, fontWeight: selected ? "900" : "700", color: selected ? palette.brand : palette.muted }}>{tab.label}</Text>
    </Pressable>;
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]}>
      <View style={desktop ? styles.desktopShell : styles.mobileShell}>
        {desktop ? <View style={[styles.sidebar, { backgroundColor: palette.surface, borderRightColor: palette.border }]}>
          <View style={styles.sidebarBrand}>
            <StoreBrandMark compact />
            <View><Text style={[styles.brand, { color: palette.ink }]}>SKIMA <Text style={{ color: palette.brand }}>STORE</Text></Text><Text style={[styles.pageTitle, { color: palette.muted }]}>Everyday shopping</Text></View>
          </View>
          <View style={styles.sideNav}>{tabs.map((tab) => navigationItem(tab, "side"))}</View>
          <View style={{ flex: 1 }} />
          <Pressable onPress={() => open("notifications")} style={[styles.sideItem, { backgroundColor: page === "notifications" ? palette.brandSoft : "transparent" }]}>
            <Bell color={page === "notifications" ? palette.brand : palette.muted} size={18} />
            <Text style={{ fontSize: 12, fontWeight: "800", color: page === "notifications" ? palette.brand : palette.muted }}>Notifications</Text>
          </Pressable>
        </View> : null}
        <View style={styles.main}>
          <View style={[styles.header, { borderBottomColor: palette.border, backgroundColor: palette.surface }]}>
            <View style={styles.identity}>
              {!isTab ? <Pressable onPress={() => setPage("shop")} style={[styles.back, { backgroundColor: palette.brandSoft }]}><ArrowLeft color={palette.brand} size={18} /></Pressable> :
                !desktop ? <StoreBrandMark compact /> : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.brand, { color: palette.ink }]}>{desktop ? title : <><Text style={{ color: palette.ink }}>SKIMA </Text><Text style={{ color: palette.brand }}>STORE</Text></>}</Text>
                <Text style={[styles.pageTitle, { color: palette.muted }]}>{desktop ? "Customer workspace" : title}</Text>
              </View>
            </View>
            {!desktop ? <Pressable accessibilityRole="button" accessibilityLabel="Notifications" onPress={() => open("notifications")}
              style={[styles.bell, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}><Bell color={palette.ink} size={18} /></Pressable> : null}
          </View>
          <View style={styles.content}>
            {page === "shop" ? <StoreShopScreen /> : null}
            {page === "orders" ? <StoreOrdersScreen /> : null}
            {page === "wallet" ? <StoreWalletScreen onOpenPage={open} /> : null}
            {page === "account" ? <StoreAccountScreen onOpenPage={open} /> : null}
            {page === "top-up" ? <StoreTopUpScreen onBack={() => setPage("wallet")} /> : null}
            {page === "withdraw" ? <StoreWithdrawScreen onBack={() => setPage("wallet")} /> : null}
            {page === "notifications" ? <StoreNotificationsScreen /> : null}
            {page === "referrals" ? <StoreReferralsScreen /> : null}
          </View>
          {!desktop && isTab ? <View style={[styles.tabs, { backgroundColor: palette.surface, borderTopColor: palette.border }]}>{tabs.map((tab) => navigationItem(tab, "bottom"))}</View> : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, mobileShell: { flex: 1 }, desktopShell: { flex: 1, flexDirection: "row" },
  sidebar: { width: 228, paddingHorizontal: 13, paddingVertical: 22, borderRightWidth: StyleSheet.hairlineWidth, gap: 24 },
  sidebarBrand: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 5 }, sideNav: { gap: 5 },
  sideItem: { minHeight: 47, borderRadius: 13, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 11 },
  main: { flex: 1, minWidth: 0 }, header: { minHeight: 66, paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  identity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 11 },
  brand: { fontSize: 12, fontWeight: "900", letterSpacing: 0.8 }, pageTitle: { fontSize: 10, fontWeight: "700", marginTop: 2 },
  back: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  bell: { width: 38, height: 38, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  content: { flex: 1, minHeight: 0 }, tabs: { minHeight: 68, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 8, paddingBottom: 5 },
  tab: { flex: 1, minHeight: 58, alignItems: "center", justifyContent: "center", gap: 4 },
});
