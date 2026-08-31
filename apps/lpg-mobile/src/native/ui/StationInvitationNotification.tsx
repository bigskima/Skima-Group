import { CheckCircle2, Clock3, ShieldCheck, XCircle } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, type PlatformRecord } from "../api/records";
import { resolveStationInvitation, type StationInvitationStatus } from "../api/stationInvitations";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { AppButton } from "./AppButton";
import { Card } from "./Card";

export function StationInvitationNotification({
  message,
  invitation,
  showDetails = false,
  onOpen,
}: {
  message: PlatformRecord;
  invitation?: PlatformRecord | null;
  showDetails?: boolean;
  onOpen?: () => void;
}) {
  const { palette } = useAppTheme();
  const [notice, setNotice] = useState<string | null>(null);
  const view = resolveStationInvitation(message, invitation);
  const accept = useGatewayMutation({
    path: "/runtime/organization-invitations/accept",
    schema: ActionResponseSchema,
    invalidate: [["organization-invitations"], ["messages"]],
  });
  const decline = useGatewayMutation({
    path: "/runtime/organization-invitations/decline",
    schema: ActionResponseSchema,
    invalidate: [["organization-invitations"], ["messages"]],
  });

  if (!view) return null;
  const responding = accept.isPending || decline.isPending;

  const respond = async (decision: "accept" | "decline") => {
    setNotice(null);
    try {
      await (decision === "accept" ? accept : decline).mutateAsync({
        invitationId: view.id,
        idempotencyKey: `lpg-expo:organization-invitation:${decision}:${view.id}`,
        metadata: { sourceSurface: showDetails ? "invitation.details" : "notifications" },
      });
      setNotice(decision === "accept" ? "Invitation accepted." : "Invitation declined.");
    } catch (cause) {
      setNotice(friendlyError(cause, "Your response could not be saved. Please try again."));
    }
  };

  return (
    <Card variant="outline">
      <View style={styles.heading}>
        <View style={[styles.icon, { backgroundColor: statusBackground(view.status, palette.successSoft, palette.warningSoft, palette.soft) }]}>
          {statusIcon(view.status, palette.success, palette.danger, palette.brand)}
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: palette.ink }]}>{view.title}</Text>
          <Text style={[styles.body, { color: palette.mutedStrong }]}>{view.body}</Text>
        </View>
      </View>

      {showDetails ? (
        <View style={[styles.details, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
          <Detail label="Station" value={view.stationName} />
          <Detail label="Role" value={view.roleName} />
          <Detail label="Status" value={statusLabel(view.status)} />
          {view.expiresAt ? <Detail label="Invitation expires" value={formatDate(view.expiresAt)} /> : null}
        </View>
      ) : null}

      {view.status === "pending" ? (
        <View style={styles.actions}>
          <AppButton
            label="Accept invitation"
            loading={accept.isPending}
            disabled={responding}
            fullWidth
            onPress={() => void respond("accept")}
          />
          <AppButton
            label="Decline"
            variant="secondary"
            loading={decline.isPending}
            disabled={responding}
            fullWidth
            onPress={() => void respond("decline")}
          />
        </View>
      ) : (
        <View style={[styles.finalState, { backgroundColor: palette.surfaceSubtle }]}>
          <Text style={[styles.finalStateText, { color: palette.mutedStrong }]}>{statusLabel(view.status)}</Text>
        </View>
      )}

      {!showDetails && onOpen ? (
        <AppButton label="View invitation details" variant="ghost" size="sm" onPress={onOpen} />
      ) : null}
      {notice ? <Text accessibilityRole="alert" style={[styles.notice, { color: notice.includes("could not") ? palette.danger : palette.success }]}>{notice}</Text> : null}
    </Card>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return <View style={styles.detailRow}><Text style={[styles.detailLabel, { color: palette.muted }]}>{label}</Text><Text style={[styles.detailValue, { color: palette.ink }]}>{value}</Text></View>;
}

function statusLabel(status: StationInvitationStatus) {
  if (status === "accepted") return "Invitation accepted";
  if (status === "declined") return "Invitation declined";
  if (status === "expired") return "Invitation expired";
  if (status === "revoked") return "Invitation no longer available";
  return "Awaiting your response";
}

function statusIcon(status: string, success: string, danger: string, brand: string) {
  if (status === "accepted") return <CheckCircle2 color={success} size={20} />;
  if (status === "declined" || status === "revoked") return <XCircle color={danger} size={20} />;
  if (status === "expired") return <Clock3 color={brand} size={20} />;
  return <ShieldCheck color={brand} size={20} />;
}

function statusBackground(status: string, success: string, warning: string, neutral: string) {
  if (status === "accepted") return success;
  if (status === "expired") return warning;
  return neutral;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

const styles = StyleSheet.create({
  heading: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  icon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 4 },
  title: { ...typography.bodyStrong, fontSize: 15 },
  body: { ...typography.caption, fontSize: 12, lineHeight: 18 },
  details: { gap: spacing.sm, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md },
  detailRow: { gap: 2 },
  detailLabel: { ...typography.caption, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  detailValue: { ...typography.bodyStrong, fontSize: 13 },
  actions: { gap: spacing.sm },
  finalState: { alignSelf: "flex-start", borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6 },
  finalStateText: { ...typography.caption, fontWeight: "800" },
  notice: { ...typography.caption, lineHeight: 18 },
});
