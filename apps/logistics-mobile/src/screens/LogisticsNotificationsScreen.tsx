import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { ArrowLeft, Bell, CheckCheck, CheckCircle2, ChevronRight, ShieldCheck, XCircle } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";
import { registerLogisticsPushDevice, requestLogisticsNotificationPermission } from "../notifications/LogisticsNotificationLifecycle";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, typography } from "../theme/tokens";
import { Screen } from "../ui/Screen";
import { StatePanel } from "../ui/StatePanel";

const MessageSchema = z.record(z.string(), z.unknown());
const CenterSchema = z.object({
  items: z.array(MessageSchema),
  unreadCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
});

function getString(value: unknown, ...keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  for (const key of keys) {
    const candidate = row[key];
    if (typeof candidate === "string" && candidate.trim()) return candidate;
  }
  return null;
}

function getNested(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const child = (value as Record<string, unknown>)[key];
  return child && typeof child === "object" && !Array.isArray(child)
    ? child as Record<string, unknown>
    : null;
}

function dateLabel(value: string | null) {
  if (!value) return "Recent";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? "Recent"
    : new Intl.DateTimeFormat("en-NG", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      }).format(parsed);
}

function invitationIdFor(message: Record<string, unknown>) {
  const payload = getNested(message, "payload");
  return getString(payload, "invitationId", "invitation_id")
    ?? getString(getNested(message, "metadata"), "invitationId", "invitation_id");
}

function isLogisticsInvitation(message: Record<string, unknown>) {
  const payload = getNested(message, "payload");
  return getString(message, "purpose") === "organization.staff.invitation"
    && getString(payload, "module", "moduleKey", "module_key") === "logistics_network"
    && Boolean(invitationIdFor(message));
}

function getInvitationStatus(message: Record<string, unknown>) {
  const payload = getNested(message, "payload");
  const status = getString(payload, "invitationStatus", "invitation_status") ?? "pending";
  if (status !== "pending") return status;
  const expiresAt = getString(payload, "expiresAt", "expires_at");
  if (!expiresAt) return status;
  const expiry = new Date(expiresAt);
  return !Number.isNaN(expiry.getTime()) && expiry.getTime() <= Date.now() ? "expired" : status;
}

function formatInvitationExpiry(value: string | null) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

export function LogisticsNotificationsScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const queryClient = useQueryClient();
  const [responseNotice, setResponseNotice] = useState<string | null>(null);
  const [pushNotice, setPushNotice] = useState<string | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const enablePush = async () => {
    if (pushBusy) return;
    setPushBusy(true); setPushNotice(null);
    try {
      await requestLogisticsNotificationPermission();
      const registered = await registerLogisticsPushDevice(session.session, session.supabase);
      setPushNotice(registered ? "This device is registered for Logistics push notifications." : "Permission is enabled. Complete the Expo project and provider credentials to register remote push.");
    } catch (cause) {
      setPushNotice(cause instanceof Error ? cause.message : "Push notifications could not be enabled.");
    } finally { setPushBusy(false); }
  };

  const center = useQuery({
    queryKey: ["logistics-notifications", session.session?.user.id],
    enabled: session.status === "authenticated",
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await session.supabase.rpc("read_logistics_notification_center", {
        target_limit: 100,
        target_offset: 0,
        target_include_read: true,
      });
      if (error) throw error;
      return CenterSchema.parse(data);
    },
  });

  const refreshNotifications = async () => {
    await queryClient.invalidateQueries({
      queryKey: ["logistics-notifications", session.session?.user.id],
    });
  };

  const markRead = useMutation({
    mutationFn: async (messageId: string) => {
      const { data, error } = await session.supabase.rpc("mark_notification_read", {
        target_message_id: messageId,
        target_read: true,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: refreshNotifications,
  });

  const markAll = useMutation({
    mutationFn: async () => {
      const { data, error } = await session.supabase.rpc("mark_all_logistics_notifications_read");
      if (error) throw error;
      return data;
    },
    onSuccess: refreshNotifications,
  });

  const respondToInvitation = useMutation({
    mutationFn: async (input: { invitationId: string; decision: "accept" | "decline" }) => {
      const path = input.decision === "accept"
        ? "/runtime/organization-invitations/accept"
        : "/runtime/organization-invitations/decline";
      return session.api.post(
        path,
        {
          invitationId: input.invitationId,
          idempotencyKey: createClientIdempotencyKey(
            "logistics.organization.invitation." + input.decision,
            input.invitationId,
          ),
          metadata: {
            module: "logistics_network",
            sourceSurface: "logistics.notifications",
          },
        },
        z.string().uuid(),
      );
    },
    onSuccess: async (_result, input) => {
      setResponseNotice(
        input.decision === "accept"
          ? "Invitation accepted. Your company workspace access is now active."
          : "Invitation declined.",
      );
      const message = center.data?.items.find(
        (item) => invitationIdFor(item) === input.invitationId,
      );
      const messageId = message ? getString(message, "id", "message_id") : null;
      if (messageId) {
        const { error } = await session.supabase.rpc("mark_notification_read", {
          target_message_id: messageId,
          target_read: true,
        });
        // Receipt/acceptance is already committed. A read-state write failure
        // must not misreport the invitation action as failed.
        if (error) console.warn("Could not mark accepted invitation notification as read.", error.message);
      }
      await refreshNotifications();
    },
    onError: (cause) => {
      setResponseNotice(
        cause instanceof Error
          ? cause.message
          : "Your invitation response could not be saved. Please try again.",
      );
    },
  });

  const messages = center.data?.items ?? [];
  const open = async (message: Record<string, unknown>) => {
    const id = getString(message, "id", "message_id");
    if (id && message.isRead !== true) await markRead.mutateAsync(id);
    if (isLogisticsInvitation(message)) return;
    const target =
      getString(getNested(message, "payload"), "deepLink", "deep_link", "path", "route", "url")
      ?? getString(getNested(message, "metadata"), "deepLink", "deep_link", "path", "route", "url");
    if (target?.startsWith("/") && !target.startsWith("/notifications")) {
      router.push(target as never);
    }
  };

  return (
    <Screen
      title="Notifications"
      denseHeader
      action={(
        <View style={styles.topActions}>
          <Bell color={palette.brand} size={18} />
          {center.data?.unreadCount ? (
            <Text style={[styles.unread, { color: palette.brand }]}>{center.data.unreadCount} new</Text>
          ) : null}
        </View>
      )}
      refreshControl={(
        <RefreshControl
          refreshing={center.isRefetching}
          onRefresh={() => void center.refetch()}
          tintColor={palette.brand}
        />
      )}
    >
      <Pressable onPress={() => router.back()} style={styles.back}>
        <ArrowLeft color={palette.ink} size={17} />
        <Text style={{ color: palette.ink, fontSize: 11, fontWeight: "800" }}>Back</Text>
      </Pressable>
      <Text style={[styles.scopeNote, { color: palette.muted }]}>
        Store orders and Logistics activity only.
      </Text>
      <View style={[styles.pushCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={[styles.messageIcon, { backgroundColor: palette.brandSoft }]}><Bell color={palette.brand} size={17} /></View>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[styles.messageTitle, { color: palette.ink }]}>Delivery alerts on this device</Text>
          <Text style={[styles.body, { color: palette.muted }]}>Get booking, chat and delivery updates when the app is closed.</Text>
          {pushNotice ? <Text style={[styles.detailMuted, { color: palette.muted }]}>{pushNotice}</Text> : null}
        </View>
        <Pressable disabled={pushBusy} onPress={() => void enablePush()} style={[styles.pushEnable, { backgroundColor: palette.brand, opacity: pushBusy ? 0.55 : 1 }]}>
          {pushBusy ? <ActivityIndicator color="#fff" size="small" /> : <Text style={styles.acceptText}>Enable</Text>}
        </Pressable>
      </View>

      {center.isPending ? (
        <View style={styles.loading}><ActivityIndicator color={palette.brand} /></View>
      ) : center.error ? (
        <StatePanel
          title="Notifications unavailable"
          description="Refresh to reconnect to your Logistics notification inbox."
          retry={() => void center.refetch()}
        />
      ) : messages.length ? (
        <>
          {responseNotice ? (
            <Text
              accessibilityRole="alert"
              style={[
                styles.responseNotice,
                { color: responseNotice.toLowerCase().includes("could not") ? palette.danger : palette.success },
              ]}
            >
              {responseNotice}
            </Text>
          ) : null}
          {center.data?.unreadCount ? (
            <Pressable
              disabled={markAll.isPending}
              onPress={() => markAll.mutate()}
              style={[styles.markAll, { borderColor: palette.border, backgroundColor: palette.surface }]}
            >
              {markAll.isPending
                ? <ActivityIndicator color={palette.brand} />
                : <CheckCheck color={palette.brand} size={16} />}
              <Text style={{ color: palette.brand, fontSize: 10, fontWeight: "900" }}>Mark all read</Text>
            </Pressable>
          ) : null}

          <View style={{ gap: 8 }}>
            {messages.map((message, index) => {
              const id = getString(message, "id", "message_id") ?? String(index);
              const payload = getNested(message, "payload");
              const metadata = getNested(message, "metadata");
              const read = message.isRead === true;
              const invitation = isLogisticsInvitation(message);
              const invitationId = invitationIdFor(message);
              const target =
                getString(payload, "deepLink", "deep_link", "path", "route", "url")
                ?? getString(metadata, "deepLink", "deep_link", "path", "route", "url");

              if (invitation) {
                const status = getInvitationStatus(message);
                const expiresAt = formatInvitationExpiry(getString(payload, "expiresAt", "expires_at"));
                const organizationName =
                  getString(payload, "organizationName", "organization_name") ?? "Logistics company";
                const roleName = getString(payload, "roleDisplayName", "roleName", "role_name");
                const body =
                  getString(payload, "body", "message", "text")
                  ?? "You have been invited to join a Logistics company workspace.";

                return (
                  <View
                    key={id}
                    style={[
                      styles.invitationCard,
                      {
                        backgroundColor: read ? palette.surface : palette.brandSofter,
                        borderColor: read ? palette.border : palette.brandSoft,
                      },
                    ]}
                  >
                    <View style={styles.invitationHead}>
                      <View style={[styles.messageIcon, { backgroundColor: palette.brandSoft }]}>
                        <ShieldCheck color={palette.brand} size={18} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                        <View style={styles.messageHead}>
                          {!read ? <View style={[styles.dot, { backgroundColor: palette.brand }]} /> : null}
                          <Text style={[styles.messageTitle, { color: palette.ink }]}>Company workspace invitation</Text>
                          <Text style={[styles.time, { color: palette.muted }]}>
                            {dateLabel(getString(message, "createdAt", "created_at"))}
                          </Text>
                        </View>
                        <Text style={[styles.body, { color: palette.muted }]}>{body}</Text>
                      </View>
                    </View>

                    <View style={[styles.invitationDetails, { borderColor: palette.border, backgroundColor: palette.surfaceSubtle }]}>
                      <Text style={[styles.detail, { color: palette.ink }]}>{organizationName}</Text>
                      {roleName ? (
                        <Text style={[styles.detailMuted, { color: palette.muted }]}>Role: {roleName}</Text>
                      ) : null}
                      {expiresAt ? (
                        <Text style={[styles.detailMuted, { color: palette.muted }]}>Expires: {expiresAt}</Text>
                      ) : null}
                      {status !== "pending" ? (
                        <Text style={[styles.detailMuted, { color: status === "accepted" ? palette.success : palette.mutedStrong }]}>
                          {status === "accepted" ? "Invitation accepted"
                            : status === "declined" ? "Invitation declined"
                            : status === "expired" ? "Invitation expired"
                            : "Invitation no longer available"}
                        </Text>
                      ) : null}
                    </View>

                    {status === "pending" && invitationId ? (
                      <View style={styles.invitationActions}>
                        <Pressable
                          disabled={respondToInvitation.isPending}
                          onPress={() => respondToInvitation.mutate({ invitationId, decision: "accept" })}
                          style={[
                            styles.acceptButton,
                            { backgroundColor: palette.brand, opacity: respondToInvitation.isPending ? 0.55 : 1 },
                          ]}
                        >
                          {respondToInvitation.isPending
                            ? <ActivityIndicator color="#FFFFFF" size="small" />
                            : <CheckCircle2 color="#FFFFFF" size={15} />}
                          <Text style={styles.acceptText}>Accept invitation</Text>
                        </Pressable>
                        <Pressable
                          disabled={respondToInvitation.isPending}
                          onPress={() => respondToInvitation.mutate({ invitationId, decision: "decline" })}
                          style={[styles.declineButton, { borderColor: palette.border, opacity: respondToInvitation.isPending ? 0.55 : 1 }]}
                        >
                          <XCircle color={palette.muted} size={15} />
                          <Text style={[styles.declineText, { color: palette.muted }]}>Decline</Text>
                        </Pressable>
                      </View>
                    ) : null}
                  </View>
                );
              }

              const title =
                getString(payload, "title", "subject")
                ?? getString(message, "purpose")?.replace(/[._]/g, " ")
                ?? "SKIMA update";
              const body = getString(payload, "body", "message", "text")
                ?? "You have a new Store or Logistics update.";

              return (
                <Pressable
                  key={id}
                  onPress={() => void open(message)}
                  style={[
                    styles.message,
                    {
                      backgroundColor: read ? palette.surface : palette.brandSofter,
                      borderColor: read ? palette.border : palette.brandSoft,
                    },
                  ]}
                >
                  <View style={[styles.messageIcon, { backgroundColor: palette.brandSoft }]}>
                    <Bell color={palette.brand} size={17} />
                  </View>
                  <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
                    <View style={styles.messageHead}>
                      {!read ? <View style={[styles.dot, { backgroundColor: palette.brand }]} /> : null}
                      <Text numberOfLines={1} style={[styles.messageTitle, { color: palette.ink }]}>{title}</Text>
                      <Text style={[styles.time, { color: palette.muted }]}>
                        {dateLabel(getString(message, "createdAt", "created_at"))}
                      </Text>
                    </View>
                    <Text numberOfLines={2} style={[styles.body, { color: palette.muted }]}>{body}</Text>
                  </View>
                  {target && !target.startsWith("/notifications") ? <ChevronRight color={palette.muted} size={17} /> : null}
                </Pressable>
              );
            })}
          </View>
        </>
      ) : (
        <StatePanel
          title="You are all caught up"
          description="Store orders and Logistics updates will appear here."
          icon={<Bell color={palette.brand} size={22} />}
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  topActions: { flexDirection: "row", alignItems: "center", gap: 6 },
  pushCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderWidth: 1, borderRadius: 14 },
  pushEnable: { minHeight: 34, minWidth: 58, paddingHorizontal: 12, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  unread: { fontSize: 10, fontWeight: "900" },
  back: { flexDirection: "row", alignItems: "center", gap: 7 },
  scopeNote: { fontSize: 10, lineHeight: 14 },
  loading: { padding: 28, alignItems: "center" },
  responseNotice: { fontSize: 11, fontWeight: "700", lineHeight: 16 },
  markAll: { minHeight: 39, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  message: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 11 },
  invitationCard: { gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 12 },
  invitationHead: { flexDirection: "row", alignItems: "flex-start", gap: 9 },
  invitationDetails: { gap: 4, padding: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md },
  detail: { fontSize: 11, fontWeight: "900" },
  detailMuted: { fontSize: 10, fontWeight: "700" },
  invitationActions: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  acceptButton: { minHeight: 38, paddingHorizontal: 12, borderRadius: radii.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  acceptText: { fontSize: 10, fontWeight: "900", color: "#FFFFFF" },
  declineButton: { minHeight: 38, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7 },
  declineText: { fontSize: 10, fontWeight: "900" },
  messageIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  messageHead: { flexDirection: "row", alignItems: "center", gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  messageTitle: { flex: 1, minWidth: 0, fontSize: 11, fontWeight: "900" },
  time: { fontSize: 8, fontWeight: "700" },
  body: { ...typography.caption, fontSize: 10, lineHeight: 14 },
});
