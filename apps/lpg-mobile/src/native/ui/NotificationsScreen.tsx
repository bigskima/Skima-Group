import * as Linking from "expo-linking";
import { router } from "expo-router";
import {
  Bell,
  BellRing,
  CheckCircle2,
  ChevronRight,
  Flame,
  Package,
  ShieldCheck,
  Truck,
  UserCheck,
  Wallet,
} from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { domainQueries } from "../api/domains";
import {
  displayStatus,
  firstString,
  nestedRecord,
  recordId,
  type PlatformRecord,
} from "../api/records";
import { enableNotifications } from "../notifications/useNotificationLifecycle";
import { colors, radii, spacing } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { Card } from "./Card";
import { Screen } from "./Screen";

type NotificationCategory = "all" | "wallet" | "order" | "partner";

export function NotificationsScreen() {
  const query = domainQueries.notifications();
  const [selectedCategory, setSelectedCategory] = useState<NotificationCategory>("all");
  const [notice, setNotice] = useState<string | null>(null);

  const enable = async () => {
    try {
      await enableNotifications();
      setNotice("Device notifications enabled successfully.");
    } catch (cause) {
      setNotice(friendlyError(cause, "Notifications could not be enabled."));
    }
  };

  const openDeepLink = async (message: PlatformRecord) => {
    const payload = nestedRecord(message, "payload");
    const target =
      firstString(payload, ["deepLink", "deep_link", "url", "route"]) ??
      firstString(message, ["metadata", "deepLink"]);

    if (!target) return;

    if (target.startsWith("/")) {
      router.push(target as never);
    } else if (await Linking.canOpenURL(target)) {
      await Linking.openURL(target);
    }
  };

  const allMessages = query.data ?? [];

  const filteredMessages = allMessages.filter((msg) => {
    if (selectedCategory === "all") return true;
    const payload = nestedRecord(msg, "payload");
    const purpose = firstString(msg, ["purpose"]) ?? "";
    const category = (firstString(payload, ["category"]) ?? firstString(msg, ["metadata", "category"]) ?? "").toLowerCase();

    if (selectedCategory === "wallet") {
      return category === "wallet" || purpose.includes("wallet") || purpose.includes("deposit") || purpose.includes("withdrawal");
    }
    if (selectedCategory === "order") {
      return category === "order" || purpose.includes("order") || purpose.includes("refill") || purpose.includes("delivery");
    }
    if (selectedCategory === "partner") {
      return category === "partner" || purpose.includes("application") || purpose.includes("driver") || purpose.includes("station");
    }
    return true;
  });

  return (
    <Screen
      eyebrow="Activity & Updates"
      title="Notifications"
      action={
        <Pressable onPress={() => void enable()} style={styles.enable}>
          <BellRing color="white" size={16} />
          <Text style={styles.enableText}>Enable</Text>
        </Pressable>
      }
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching}
          onRefresh={() => void query.refetch()}
          tintColor={colors.brand}
        />
      }
    >
      {/* Category Tabs */}
      <View style={styles.tabBar}>
        <TabItem
          label="All"
          count={allMessages.length}
          active={selectedCategory === "all"}
          onPress={() => setSelectedCategory("all")}
        />
        <TabItem
          label="Wallet"
          active={selectedCategory === "wallet"}
          onPress={() => setSelectedCategory("wallet")}
        />
        <TabItem
          label="Orders"
          active={selectedCategory === "order"}
          onPress={() => setSelectedCategory("order")}
        />
        <TabItem
          label="Partner"
          active={selectedCategory === "partner"}
          onPress={() => setSelectedCategory("partner")}
        />
      </View>

      {query.isPending ? (
        <ActivityIndicator color={colors.brand} style={{ marginTop: spacing.xl }} />
      ) : query.error ? (
        <Card>
          <Text style={styles.error}>
            {friendlyError(query.error, "Notifications could not be loaded.")}
          </Text>
          <Pressable onPress={() => void query.refetch()} style={{ marginTop: 8 }}>
            <Text style={styles.link}>Try again</Text>
          </Pressable>
        </Card>
      ) : (
        <>
          {filteredMessages.map((message, index) => {
            const payload = nestedRecord(message, "payload");
            const status = displayStatus(message) ?? "delivered";
            const purpose = firstString(message, ["purpose"]) ?? "";
            const category = (firstString(payload, ["category"]) ?? "").toLowerCase();

            const title =
              firstString(payload, ["title", "subject"]) ??
              purpose.replace(/[_-]/g, " ");

            const body =
              firstString(payload, ["body", "message", "text"]) ??
              "You have a new update from SKIMA.";

            const created = firstString(message, ["created_at", "createdAt"]);
            const target =
              firstString(payload, ["deepLink", "deep_link", "url", "route"]);

            const isWallet = category === "wallet" || purpose.includes("wallet");
            const isOrder = category === "order" || purpose.includes("order");
            const isPartner = category === "partner" || purpose.includes("application");

            return (
              <Pressable
                key={recordId(message) ?? String(index)}
                disabled={!target}
                onPress={() => void openDeepLink(message)}
                style={styles.item}
              >
                <View
                  style={[
                    styles.iconBox,
                    isWallet
                      ? styles.iconWallet
                      : isOrder
                      ? styles.iconOrder
                      : isPartner
                      ? styles.iconPartner
                      : styles.iconGeneral,
                  ]}
                >
                  {isWallet ? (
                    <Wallet color={colors.brand} size={20} />
                  ) : isOrder ? (
                    <Truck color="#0284C7" size={20} />
                  ) : isPartner ? (
                    <ShieldCheck color="#16A34A" size={20} />
                  ) : (
                    <Bell color={colors.ink} size={20} />
                  )}
                </View>

                <View style={{ flex: 1, gap: 4 }}>
                  <View style={styles.row}>
                    <Text style={styles.title}>{title}</Text>
                  </View>
                  <Text style={styles.body}>{body}</Text>
                  <Text style={styles.time}>{formatDate(created)}</Text>
                </View>

                {target ? (
                  <ChevronRight color={colors.muted} size={18} />
                ) : null}
              </Pressable>
            );
          })}

          {filteredMessages.length === 0 ? (
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <Bell color={colors.brand} size={32} />
              </View>
              <Text style={styles.emptyTitle}>No notifications in this category</Text>
              <Text style={styles.emptyBody}>
                Updates for wallet top-ups, cylinder refill orders, and partner milestones will appear here.
              </Text>
            </View>
          ) : null}
        </>
      )}

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    </Screen>
  );
}

function TabItem({
  label,
  count,
  active,
  onPress,
}: {
  label: string;
  count?: number;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.tab, active && styles.tabActive]}
    >
      <Text style={[styles.tabText, active && styles.tabTextActive]}>
        {label} {count !== undefined && count > 0 ? `(${count})` : ""}
      </Text>
    </Pressable>
  );
}

function formatDate(value: string | null) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const styles = StyleSheet.create({
  enable: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.brand,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.pill,
  },
  enableText: { color: "white", fontWeight: "900", fontSize: 12 },
  tabBar: {
    flexDirection: "row",
    gap: spacing.xs,
    marginBottom: spacing.md,
  },
  tab: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.pill,
    backgroundColor: "#F3F4F6",
  },
  tabActive: {
    backgroundColor: colors.brand,
  },
  tabText: {
    fontSize: 13,
    fontWeight: "700",
    color: colors.muted,
  },
  tabTextActive: {
    color: "white",
    fontWeight: "900",
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    marginBottom: spacing.xs,
  },
  iconBox: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  iconWallet: { backgroundColor: "#FFF0F1" },
  iconOrder: { backgroundColor: "#F0F9FF" },
  iconPartner: { backgroundColor: "#F0FDF4" },
  iconGeneral: { backgroundColor: "#F9FAFB" },
  row: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  title: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.ink,
  },
  body: {
    fontSize: 13,
    color: colors.ink,
    lineHeight: 18,
  },
  time: {
    fontSize: 11,
    color: colors.muted,
    fontWeight: "600",
    marginTop: 2,
  },
  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: spacing.xxl,
    gap: spacing.sm,
  },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: "#FFF0F1",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.xs,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "900",
    color: colors.ink,
  },
  emptyBody: {
    fontSize: 13,
    color: colors.muted,
    textAlign: "center",
    lineHeight: 19,
    paddingHorizontal: spacing.lg,
  },
  error: { color: colors.danger, fontWeight: "800" },
  link: { color: colors.brand, fontWeight: "900" },
  notice: {
    color: colors.brandDark,
    fontWeight: "800",
    textAlign: "center",
    marginTop: spacing.md,
  },
});
