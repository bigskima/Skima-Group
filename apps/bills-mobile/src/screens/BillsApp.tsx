import { useCallback, useEffect, useState } from "react";
import { Bell, BookOpen, History, ShoppingBag, UserRound, WalletCards, ArrowLeft } from "lucide-react-native";
import { Pressable, SafeAreaView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { BillsBrandMark } from "../ui/BrandMark";
import { subscribeBillsNavigation } from "../navigation/billsNavigation";
import { BillsHomeScreen } from "./BillsHomeScreen";
import { BillsActivityScreen } from "./BillsActivityScreen";
import { BillsWalletScreen, BillsTopUpScreen, BillsWithdrawScreen } from "./BillsWalletScreens";
import { BillsStoreScreen } from "./BillsStoreScreen";
import { BillsAccountScreen } from "./BillsAccountScreen";
import { BillsNotificationsScreen } from "./BillsNotificationsScreen";
import { BillsBeneficiariesScreen } from "./BillsBeneficiariesScreen";
import { BillsReceiptScreen } from "./BillsReceiptScreen";
import { BillsReferralsScreen } from "./BillsReferralsScreen";
import { useBillsGuide } from "../onboarding/BillsGuideProvider";

type Page = "bills" | "activity" | "wallet" | "store" | "account" | "top-up" | "withdraw" | "notifications" | "saved" | "receipt" | "referrals";
const tabs = [
  { key: "bills", label: "Bills", icon: BookOpen },
  { key: "activity", label: "Activity", icon: History },
  { key: "wallet", label: "Wallet", icon: WalletCards },
  { key: "store", label: "Store", icon: ShoppingBag },
  { key: "account", label: "Account", icon: UserRound },
] as const;

export function BillsApp() {
  const { palette } = useAppTheme();
  const guide = useBillsGuide();
  const { width } = useWindowDimensions();
  const desktop = width >= 960;
  const [page, setPage] = useState<Page>("bills");
  const [receiptId, setReceiptId] = useState<string | null>(null);

  const open = useCallback((next: Page) => {
    setPage(next);
    guide.setCurrentPage(next);
  }, [guide.setCurrentPage]);

  useEffect(() => subscribeBillsNavigation((event) => {
    open(event.page);
    setReceiptId(event.receiptId ?? null);
  }), [open]);

  const onReceipt = (id: string) => {
    setReceiptId(id);
    open("receipt");
  };
  const isTab = tabs.some((tab) => tab.key === page);
  const title = page === "bills" ? "Pay bills"
    : page === "activity" ? "Bill activity"
    : page === "wallet" ? "SKIMA Wallet"
    : page === "store" ? "SKIMA Store"
    : page === "account" ? "Account"
    : page === "top-up" ? "Add funds"
    : page === "withdraw" ? "Withdraw funds"
    : page === "notifications" ? "Notifications"
    : page === "saved" ? "Saved billers" : page === "referrals" ? "Referrals & rewards" : "Receipt";

  const navigationItem = (tab: typeof tabs[number], variant: "side" | "bottom") => {
    const Icon = tab.icon;
    const selected = tab.key === page;
    return (
      <Pressable
        key={tab.key}
        onPress={() => open(tab.key)}
        accessibilityRole="button"
        accessibilityState={{ selected }}
        style={variant === "side"
          ? [styles.sideItem, { backgroundColor: selected ? palette.brandSoft : "transparent" }]
          : styles.tab}
      >
        <Icon color={selected ? palette.brand : palette.muted} size={19} />
        <Text style={{
          fontSize: variant === "side" ? 12 : 10,
          fontWeight: selected ? "900" : "700",
          color: selected ? palette.brand : palette.muted,
        }}>{tab.label}</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]}>
      <View style={desktop ? styles.desktopShell : styles.mobileShell}>
        {desktop ? (
          <View style={[styles.sidebar, { backgroundColor: palette.surface, borderRightColor: palette.border }]}>
            <View style={styles.sidebarBrand}>
              <BillsBrandMark size={44} />
              <View>
                <Text style={[styles.brand, { color: palette.ink }]}>SKIMA <Text style={{ color: palette.brand }}>BILLS</Text></Text>
                <Text style={[styles.pageTitle, { color: palette.muted }]}>Everyday payments</Text>
              </View>
            </View>
            <View style={styles.sideNav}>{tabs.map((tab) => navigationItem(tab, "side"))}</View>
            <View style={{ flex: 1 }} />
            <Pressable
              onPress={() => open("notifications")}
              style={[styles.sideItem, { backgroundColor: page === "notifications" ? palette.brandSoft : "transparent" }]}
            >
              <Bell color={page === "notifications" ? palette.brand : palette.muted} size={18} />
              <Text style={{ fontSize: 12, fontWeight: "800", color: page === "notifications" ? palette.brand : palette.muted }}>Notifications</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.main}>
          <View style={[styles.header, { borderBottomColor: palette.border, backgroundColor: palette.surface }]}>
            <View style={styles.identity}>
              {!isTab ? (
                <Pressable onPress={() => setPage("bills")} style={[styles.back, { backgroundColor: palette.brandSoft }]}>
                  <ArrowLeft color={palette.brand} size={18} />
                </Pressable>
              ) : !desktop ? <BillsBrandMark size={40} /> : null}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.brand, { color: palette.ink }]}>
                  {desktop ? title : <><Text style={{ color: palette.ink }}>SKIMA </Text><Text style={{ color: palette.brand }}>BILLS</Text></>}
                </Text>
                <Text style={[styles.pageTitle, { color: palette.muted }]}>{desktop ? "Customer workspace" : title}</Text>
              </View>
            </View>
            {!desktop ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Notifications"
                onPress={() => open("notifications")}
                style={[styles.bell, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}
              >
                <Bell color={palette.ink} size={19} />
              </Pressable>
            ) : null}
          </View>

          <View style={styles.content}>
            {page === "bills" ? <BillsHomeScreen onOpenPage={open} onReceipt={onReceipt} /> : null}
            {page === "activity" ? <BillsActivityScreen onReceipt={onReceipt} /> : null}
            {page === "wallet" ? <BillsWalletScreen onOpenPage={open} /> : null}
            {page === "top-up" ? <BillsTopUpScreen onBack={() => open("wallet")} /> : null}
            {page === "withdraw" ? <BillsWithdrawScreen onBack={() => open("wallet")} /> : null}
            {page === "store" ? <BillsStoreScreen /> : null}
            {page === "account" ? <BillsAccountScreen onOpenPage={open} /> : null}
            {page === "notifications" ? <BillsNotificationsScreen /> : null}
            {page === "saved" ? <BillsBeneficiariesScreen onOpenPage={open} /> : null}
            {page === "receipt" && receiptId ? <BillsReceiptScreen id={receiptId} /> : null}
            {page === "referrals" ? <BillsReferralsScreen /> : null}
          </View>

          {!desktop && isTab ? (
            <View style={[styles.tabs, { backgroundColor: palette.surface, borderTopColor: palette.border }]}>
              {tabs.map((tab) => navigationItem(tab, "bottom"))}
            </View>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  mobileShell: { flex: 1 },
  desktopShell: { flex: 1, flexDirection: "row" },
  sidebar: { width: 228, paddingHorizontal: 13, paddingVertical: 22, borderRightWidth: StyleSheet.hairlineWidth, gap: 24 },
  sidebarBrand: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 5 },
  sideNav: { gap: 5 },
  sideItem: { minHeight: 47, borderRadius: 13, paddingHorizontal: 13, flexDirection: "row", alignItems: "center", gap: 11 },
  main: { flex: 1, minWidth: 0 },
  header: { minHeight: 66, paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 14 },
  identity: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 11 },
  brand: { fontSize: 12, fontWeight: "900", letterSpacing: 0.8 },
  pageTitle: { fontSize: 10, fontWeight: "700", marginTop: 2 },
  back: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  bell: { width: 38, height: 38, borderRadius: 13, borderWidth: StyleSheet.hairlineWidth, alignItems: "center", justifyContent: "center" },
  content: { flex: 1, minHeight: 0 },
  tabs: { minHeight: 68, borderTopWidth: StyleSheet.hairlineWidth, flexDirection: "row", alignItems: "center", justifyContent: "space-around", paddingHorizontal: 8, paddingBottom: 5 },
  tab: { flex: 1, minHeight: 58, alignItems: "center", justifyContent: "center", gap: 4 },
});
