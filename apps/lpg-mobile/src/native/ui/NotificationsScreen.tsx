import * as Linking from "expo-linking";
import { router } from "expo-router";
import { Bell, BellRing, CheckCheck, ChevronRight, ShieldCheck, Truck, Wallet } from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { useOrganizationInvitations } from "../api/domains";
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotificationCenter } from "../api/notifications";
import { firstString, nestedRecord, recordId, type PlatformRecord } from "../api/records";
import { invitationIdFromMessage, isStationInvitationMessage } from "../api/stationInvitations";
import { enableNotifications } from "../notifications/useNotificationLifecycle";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { RequestFailureState } from "./RequestFailureState";
import { Screen } from "./Screen";
import { StationInvitationNotification } from "./StationInvitationNotification";

type NotificationCategory = "all" | "wallet" | "order" | "partner";
const PAGE_SIZE = 20;

export function NotificationsScreen() {
  const { palette } = useAppTheme();
  const [selectedCategory, setSelectedCategory] = useState<NotificationCategory>("all");
  const [showRead, setShowRead] = useState(true);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [notice, setNotice] = useState<string | null>(null);
  const center = useNotificationCenter(visibleCount, showRead);
  const invitations = useOrganizationInvitations();
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
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

  const markMessageRead = async (message: PlatformRecord) => {
    const id = recordId(message);
    if (!id || message.isRead === true) return;
    try {
      await markRead.mutateAsync({ messageId: id });
    } catch (cause) {
      setNotice(friendlyError(cause, "This notification could not be marked as read."));
    }
  };

  const openDeepLink = async (message: PlatformRecord) => {
    await markMessageRead(message);
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

  const markEverythingRead = async () => {
    try {
      const affected = await markAllRead.mutateAsync();
      setNotice(affected > 0 ? "Notifications marked as read." : "You’re already caught up.");
    } catch (cause) {
      setNotice(friendlyError(cause, "Notifications could not be updated."));
    }
  };

  const allMessages = center.data?.items ?? [];
  const unreadCount = center.data?.unreadCount ?? 0;
  const filteredMessages = allMessages.filter((message) => messageMatchesCategory(message, selectedCategory));
  const unreadMessages = filteredMessages.filter((message) => message.isRead !== true);
  const readMessages = filteredMessages.filter((message) => message.isRead === true);

  const renderMessage = (message: PlatformRecord, index: number) => {
    const messageId = recordId(message);
    const isRead = message.isRead === true;
    if (isStationInvitationMessage(message)) {
      const invitationId = invitationIdFromMessage(message);
      const invitation = invitationId ? invitationsById.get(invitationId) : undefined;
      return (
        <View key={messageId ?? invitationId ?? String(index)} style={isRead ? styles.readItem : styles.unreadItem}>
          <StationInvitationNotification
            message={message}
            invitation={invitation}
            onOpen={invitationId ? () => void (async () => {
              await markMessageRead(message);
              router.push(`/invitations/${invitationId}` as never);
            })() : undefined}
          />
        </View>
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
        key={messageId ?? String(index)}
        accessibilityRole="button"
        onPress={() => void openDeepLink(message)}
        style={({ pressed }) => [
          styles.item,
          shadows.soft,
          {
            backgroundColor: isRead ? palette.surface : palette.brandSofter,
            borderColor: isRead ? palette.border : palette.brandSoft,
            opacity: pressed ? 0.78 : 1,
            transform: [{ scale: pressed ? 0.99 : 1 }],
          },
        ]}
      >
        <View style={[styles.iconBox, { backgroundColor: iconBackground }]}>{icon}</View>
        <View style={styles.itemCopy}>
          <View style={styles.titleRow}>
            {!isRead ? <View style={[styles.unreadDot, { backgroundColor: palette.brand }]} /> : null}
            <Text numberOfLines={1} style={[styles.title, { color: palette.ink }]}>{title}</Text>
            <Text numberOfLines={1} style={[styles.time, { color: palette.muted }]}>{formatDate(created)}</Text>
          </View>
          <Text numberOfLines={2} style={[styles.body, { color: palette.mutedStrong }]}>{body}</Text>
        </View>
        {target ? <ChevronRight color={palette.muted} size={17} /> : !isRead ? <CheckCheck color={palette.muted} size={17} /> : null}
      </Pressable>
    );
  };

  return (
    <Screen
      eyebrow="Updates"
      title="Notifications"
      subtitle={unreadCount ? `${unreadCount} unread update${unreadCount === 1 ? "" : "s"} need your attention.` : "You’re caught up with SKIMA."}
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
          refreshing={center.isRefetching}
          onRefresh={() => void Promise.all([center.refetch(), invitations.refetch()])}
          tintColor={palette.brand}
        />
      }
    >
      <View style={styles.tabBar}>
        <TabItem label="All" count={center.data?.totalCount} active={selectedCategory === "all"} onPress={() => setSelectedCategory("all")} />
        <TabItem label="Wallet" active={selectedCategory === "wallet"} onPress={() => setSelectedCategory("wallet")} />
        <TabItem label="Orders" active={selectedCategory === "order"} onPress={() => setSelectedCategory("order")} />
        <TabItem label="Partner" active={selectedCategory === "partner"} onPress={() => setSelectedCategory("partner")} />
      </View>

      <View style={styles.controlRow}>
        <AppButton
          label={showRead ? "Hide read" : "Show read"}
          variant="secondary"
          size="sm"
          onPress={() => {
            setShowRead((value) => !value);
            setVisibleCount(PAGE_SIZE);
          }}
        />
        {unreadCount > 0 ? (
          <AppButton
            label="Mark all read"
            variant="ghost"
            size="sm"
            loading={markAllRead.isPending}
            onPress={() => void markEverythingRead()}
          />
        ) : null}
      </View>

      {notice ? (
        <View style={[styles.notice, { backgroundColor: palette.brandSofter, borderColor: palette.brandSoft }]}>
          <BellRing color={palette.brand} size={16} />
          <Text style={[styles.noticeText, { color: palette.ink }]}>{notice}</Text>
        </View>
      ) : null}

      {center.isPending ? (
        <View style={styles.loading}>
          <ActivityIndicator color={palette.brand} />
        </View>
      ) : center.error ? (
        <RequestFailureState error={center.error} onRetry={() => void center.refetch()} />
      ) : filteredMessages.length ? (
        <View style={styles.sections}>
          {unreadMessages.length ? (
            <View style={styles.section}>
              <SectionLabel label="New" count={unreadMessages.length} />
              <View style={styles.list}>{unreadMessages.map(renderMessage)}</View>
            </View>
          ) : null}
          {showRead && readMessages.length ? (
            <View style={styles.section}>
              <SectionLabel label="Read" count={readMessages.length} />
              <View style={styles.list}>{readMessages.map((message, index) => renderMessage(message, unreadMessages.length + index))}</View>
            </View>
          ) : null}
          {center.data?.hasMore ? (
            <AppButton
              label="Load older notifications"
              variant="secondary"
              fullWidth
              onPress={() => setVisibleCount((count) => count + PAGE_SIZE)}
            />
          ) : null}
        </View>
      ) : (
        <EmptyState
          icon={<Bell color={palette.brand} size={26} />}
          title={!showRead && unreadCount === 0 ? "You’re all caught up" : selectedCategory === "all" ? "No notifications yet" : `No ${selectedCategory} updates`}
          description={!showRead && unreadCount === 0 ? "There are no unread notifications." : selectedCategory === "all" ? "Important wallet, refill, delivery, and partner updates will appear here." : "There are no notifications in this category right now."}
        />
      )}
    </Screen>
  );
}

function SectionLabel({ label, count }: { label: string; count: number }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.sectionLabelRow}>
      <Text style={[styles.sectionLabel, { color: palette.ink }]}>{label}</Text>
      <Text style={[styles.sectionCount, { color: palette.muted }]}>{count}</Text>
    </View>
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
  if (category === "wallet" || /wallet|deposit|withdrawal|payment|refund|settlement|commission/.test(purpose)) return "wallet";
  if (category === "order" || /order|refill|delivery|pickup|dispatch|cylinder/.test(purpose)) return "order";
  if (category === "partner" || /application|driver|station|partner|activation|verification|role|delegation|access/.test(purpose)) return "partner";
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
  controlRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, alignItems: "center" },
  notice: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md, borderWidth: StyleSheet.hairlineWidth },
  noticeText: { ...typography.caption, flex: 1 },
  loading: { minHeight: 160, alignItems: "center", justifyContent: "center" },
  sections: { gap: spacing.lg },
  section: { gap: spacing.sm },
  sectionLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionLabel: { ...typography.subheading, fontSize: 15 },
  sectionCount: { ...typography.caption, fontWeight: "800" },
  list: { gap: spacing.sm },
  unreadItem: { opacity: 1 },
  readItem: { opacity: 0.88 },
  item: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: 12, padding: 13, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl },
  iconBox: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  itemCopy: { flex: 1, minWidth: 0, gap: 4 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  unreadDot: { width: 7, height: 7, borderRadius: 4 },
  title: { flex: 1, minWidth: 0, ...typography.bodyStrong, fontSize: 13 },
  body: { ...typography.caption, fontSize: 11, lineHeight: 16 },
  time: { flexShrink: 0, ...typography.caption, fontSize: 9 },
});
