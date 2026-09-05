import * as Linking from "expo-linking";
import { router } from "expo-router";
import { Bell, BellRing, ChevronRight, ShieldCheck, Truck, Wallet } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { domainQueries, useOrganizationInvitations } from "../api/domains";
import { firstString, nestedRecord, recordId, type PlatformRecord } from "../api/records";
import { invitationIdFromMessage, isStationInvitationMessage } from "../api/stationInvitations";
import { enableNotifications } from "../notifications/useNotificationLifecycle";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StationInvitationNotification } from "./StationInvitationNotification";

type NotificationCategory = "all" | "wallet" | "order" | "partner";

export function NotificationsScreen() {
  const { palette } = useAppTheme();
  const query = domainQueries.notifications();
  const invitations = useOrganizationInvitations();
  const [selectedCategory, setSelectedCategory] = useState<NotificationCategory>("all");
  const [notice, setNotice] = useState<string | null>(null);
  const invitationsById = useMemo(
    () => new Map((invitations.data ?? []).flatMap((invitation) => {
      const id = recordId(invitation);
      return id ? [[id, invitation] as const] : [];
    })),
    [invitations.data],
  );

  const enable = async () => {
    try {
      await enableNotifications();
      setNotice("Device notifications are enabled.");
    } catch (cause) {
      setNotice(friendlyError(cause, "Notifications could not be enabled."));
    }
  };

  const openDeepLink = async (message: PlatformRecord) => {
    const payload = nestedRecord(message, "payload");
    const metadata = nestedRecord(message, "metadata");
    const target =
      firstString(payload, ["deepLink", "deep_link", "path", "url", "route"]) ??
      firstString(metadata, ["deepLink", "deep_link", "path", "url", "route"]);

    if (!target) return;
    if (target.startsWith("/")) {
      router.push(target as never);
      return;
    }
    if (await Linking.canOpenURL(target)) await Linking.openURL(target);
  };

  const allMessages = query.data ?? [];
  const filteredMessages = allMessages.filter((message) => messageMatchesCategory(message, selectedCategory));

  return (
    <Screen
      eyebrow="Updates"
      title="Notifications"
      subtitle="The SKIMA updates that need your attention."
      action={
        <AppButton
          label="Alerts"
          size="sm"
          icon={<BellRing color="#FFFFFF" size={15} />}
          onPress={() => void enable()}
        />
      }
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching}
          onRefresh={() => void Promise.all([query.refetch(), invitations.refetch()])}
          tintColor={palette.brand}
        />
      }
    >
      <View style={styles.tabBar}>
        <TabItem label="All" count={allMessages.length} active={selectedCategory === "all"} onPress={() => setSelectedCategory("all")} />
        <TabItem label="Wallet" active={selectedCategory === "wallet"} onPress={() => setSelectedCategory("wallet")} />
        <TabItem label="Orders" active={selectedCategory === "order"} onPress={() => setSelectedCategory("order")} />
        <TabItem label="Partner" active={selectedCategory === "partner"} onPress={() => setSelectedCategory("partner")} />
      </View>

      {notice ? (
        <View style={[styles.notice, { backgroundColor: palette.brandSofter, borderColor: palette.brandSoft }]}>
          <BellRing color={palette.brand} size={16} />
          <Text style={[styles.noticeText, { color: palette.ink }]}>{notice}</Text>
        </View>
      ) : null}

      {query.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
        </View>
      ) : query.error ? (
        <Card variant="outline">
          <Text style={[styles.errorTitle, { color: palette.ink }]}>Couldn’t load notifications</Text>
          <Text style={[styles.errorBody, { color: palette.muted }]}>{friendlyError(query.error, "Check your connection and try again.")}</Text>
          <View style={styles.retryButton}>
            <AppButton label="Try again" variant="secondary" onPress={() => void query.refetch()} />
          </View>
        </Card>
      ) : filteredMessages.length ? (
        <View style={styles.list}>
          {filteredMessages.map((message, index) => {
            if (isStationInvitationMessage(message)) {
              const invitationId = invitationIdFromMessage(message);
              const invitation = invitationId ? invitationsById.get(invitationId) : undefined;
              return (
                <StationInvitationNotification
                  key={recordId(message) ?? invitationId ?? String(index)}
                  message={message}
                  invitation={invitation}
                  onOpen={invitationId ? () => router.push(`/invitations/${invitationId}` as never) : undefined}
                />
              );
            }
            const payload = nestedRecord(message, "payload");
            const metadata = nestedRecord(message, "metadata");
            const purpose = firstString(message, ["purpose"]) ?? "";
            const category = notificationCategory(message);
            const title = firstString(payload, ["title", "subject"]) ?? friendlyPurpose(purpose);
            const body = firstString(payload, ["body", "message", "text"]) ?? "You have a new update from SKIMA.";
            const created = firstString(message, ["created_at", "createdAt"]);
            const target =
              firstString(payload, ["deepLink", "deep_link", "path", "url", "route"]) ??
              firstString(metadata, ["deepLink", "deep_link", "path", "url", "route"]);
            const icon = categoryIcon(category, palette.brand, palette.success);
            const iconBackground =
              category === "wallet"
                ? palette.brandSoft
                : category === "order"
                  ? palette.warningSoft
                  : category === "partner"
                    ? palette.successSoft
                    : palette.soft;

            return (
              <Pressable
                key={recordId(message) ?? String(index)}
                accessibilityRole={target ? "button" : undefined}
                disabled={!target}
                onPress={() => void openDeepLink(message)}
                style={({ pressed }) => [
                  styles.item,
                  shadows.soft,
                  {
                    backgroundColor: palette.surface,
                    borderColor: palette.border,
                    opacity: target && pressed ? 0.78 : 1,
                    transform: [{ scale: target && pressed ? 0.99 : 1 }],
                  },
                ]}
              >
                <View style={[styles.iconBox, { backgroundColor: iconBackground }]}>{icon}</View>
                <View style={styles.itemCopy}>
                  <View style={styles.titleRow}>
                    <Text numberOfLines={1} style={[styles.title, { color: palette.ink }]}>{title}</Text>
                    <Text numberOfLines={1} style={[styles.time, { color: palette.muted }]}>{formatDate(created)}</Text>
                  </View>
                  <Text numberOfLines={2} style={[styles.body, { color: palette.mutedStrong }]}>{body}</Text>
                </View>
                {target ? <ChevronRight color={palette.muted} size={17} /> : null}
              </Pressable>
            );
          })}
        </View>
      ) : (
        <EmptyState
          icon={<Bell color={palette.brand} size={26} />}
          title={selectedCategory === "all" ? "No notifications yet" : `No ${selectedCategory} updates`}
          description={
            selectedCategory === "all"
              ? "Important wallet, refill, delivery, and partner updates will appear here."
              : "There are no notifications in this category right now."
          }
        />
      )}
    </Screen>
  );
}

function TabItem({ label, count, active, onPress }: { label: string; count?: number; active: boolean; onPress(): void }) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        {
          backgroundColor: active ? palette.brand : palette.surface,
          borderColor: active ? palette.brand : palette.border,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
    >
      <Text style={[styles.tabText, { color: active ? "#FFFFFF" : palette.mutedStrong }]}>
        {label}{count !== undefined && count > 0 ? ` ${count}` : ""}
      </Text>
    </Pressable>
  );
}

function notificationCategory(message: PlatformRecord): Exclude<NotificationCategory, "all"> | "general" {
  const payload = nestedRecord(message, "payload");
  const metadata = nestedRecord(message, "metadata");
  const purpose = (firstString(message, ["purpose"]) ?? "").toLowerCase();
  const category = (firstString(payload, ["category"]) ?? firstString(metadata, ["category"]) ?? "").toLowerCase();
  if (category === "wallet" || /wallet|deposit|withdrawal|payment|refund/.test(purpose)) return "wallet";
  if (category === "order" || /order|refill|delivery|pickup|dispatch/.test(purpose)) return "order";
  if (category === "partner" || /application|driver|station|partner|activation/.test(purpose)) return "partner";
  return "general";
}

function messageMatchesCategory(message: PlatformRecord, selected: NotificationCategory) {
  if (selected === "all") return true;
  return notificationCategory(message) === selected;
}

function categoryIcon(category: ReturnType<typeof notificationCategory>, brand: string, success: string) {
  if (category === "wallet") return <Wallet color={brand} size={20} />;
  if (category === "order") return <Truck color="#B76A00" size={20} />;
  if (category === "partner") return <ShieldCheck color={success} size={20} />;
  return <Bell color={brand} size={20} />;
}

function friendlyPurpose(value: string) {
  const cleaned = value.replace(/[._-]+/g, " ").trim();
  if (!cleaned) return "SKIMA update";
  return cleaned.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null) {
  if (!value) return "Just now";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

const styles = StyleSheet.create({
  tabBar: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: spacing.xs },
  tab: { minHeight: 36, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 6, borderRadius: radii.pill, borderWidth: StyleSheet.hairlineWidth },
  tabText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  notice: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth },
  noticeText: { ...typography.caption, flex: 1 },
  loading: { minHeight: 160, alignItems: "center", justifyContent: "center" },
  list: { gap: spacing.sm },
  item: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl },
  iconBox: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  itemCopy: { flex: 1, minWidth: 0, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  title: { flex: 1, minWidth: 0, ...typography.bodyStrong, fontSize: 13 },
  body: { ...typography.caption, fontSize: 11, lineHeight: 16 },
  time: { flexShrink: 0, ...typography.caption, fontSize: 9 },
  errorTitle: { ...typography.subheading, fontSize: 15 },
  errorBody: { ...typography.caption, lineHeight: 18 },
  retryButton: { alignSelf: "flex-start", minWidth: 130, marginTop: spacing.xs },
});
