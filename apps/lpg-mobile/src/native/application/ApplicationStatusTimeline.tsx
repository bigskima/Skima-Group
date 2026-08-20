import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileEdit,
  ShieldCheck,
} from "lucide-react-native";
import { router, usePathname } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";

export interface TimelineMilestone {
  key: string;
  title: string;
  description: string;
  status: "completed" | "current" | "upcoming" | "action_required" | "rejected";
  timestamp?: string | null;
}

export interface ApplicationStatusTimelineProps {
  applicationStatus: string;
  operationalStatus?: string | null;
  applicantMessage?: string | null;
  submittedAt?: string | null;
  decidedAt?: string | null;
  activatedAt?: string | null;
  onFixRequestedChanges?: () => void;
}

export function ApplicationStatusTimeline({
  applicationStatus,
  operationalStatus,
  applicantMessage,
  submittedAt,
  decidedAt,
  activatedAt,
  onFixRequestedChanges,
}: ApplicationStatusTimelineProps) {
  const { palette } = useAppTheme();
  const pathname = usePathname();
  const isChangesRequested = ["changes_requested", "additional_info_required", "incomplete"].includes(applicationStatus);
  const isApproved = applicationStatus === "approved";
  const isRejected = applicationStatus === "rejected";
  const isSuspended = applicationStatus === "suspended" || operationalStatus === "suspended" || operationalStatus === "deactivated";
  const isActivated = operationalStatus === "active";
  const isUnderReview = ["under_review", "submitted", "resubmitted"].includes(applicationStatus);
  const correctionWorkspace = pathname.includes("station")
    ? "station"
    : pathname.includes("driver")
      ? "driver"
      : null;

  const openRequestedChanges = () => {
    if (correctionWorkspace) {
      router.push(`/(customer)/${correctionWorkspace}-documents` as never);
      return;
    }

    onFixRequestedChanges?.();
  };

  const milestones: TimelineMilestone[] = [
    {
      key: "submitted",
      title: applicationStatus === "resubmitted" ? "Application Resubmitted" : "Application Submitted",
      description: "Your application and uploaded evidence were received by SKIMA.",
      status: "completed",
      timestamp: submittedAt,
    },
    {
      key: "review",
      title: "Administrative Review",
      description: isUnderReview
        ? "SKIMA is reviewing your identity, documents, and operational information."
        : "Administrative and document review has been completed for this decision.",
      status: isChangesRequested ? "completed" : isUnderReview ? "current" : "completed",
    },
    {
      key: "decision",
      title: isChangesRequested
        ? "Update Required"
        : isRejected
          ? "Application Rejected"
          : isApproved
            ? "Application Approved"
            : isSuspended
              ? "Partner Access Suspended"
              : "Approval Decision",
      description: isChangesRequested
        ? "A reviewer requested corrections or replacement evidence before review can continue."
        : isRejected
          ? "This application was not approved. Review the message from SKIMA below."
          : isApproved
            ? "Your application is approved. Approval alone does not make the partner operational."
            : isSuspended
              ? "Operational access is currently unavailable until SKIMA restores it."
              : "A decision will appear here after administrative review.",
      status: isChangesRequested
        ? "action_required"
        : isRejected || isSuspended
          ? "rejected"
          : isApproved
            ? "completed"
            : "upcoming",
      timestamp: decidedAt,
    },
    {
      key: "activation",
      title: "Operational Activation",
      description: isActivated
        ? "Your partner workspace is live on the SKIMA operational network."
        : isApproved
          ? "Waiting for the separate SKIMA operational activation step."
          : "Operational activation happens only after application approval.",
      status: isActivated ? "completed" : isApproved ? "current" : "upcoming",
      timestamp: activatedAt,
    },
  ];

  return (
    <View style={styles.container}>
      {applicantMessage ? (
        <View
          style={[
            styles.messageBox,
            {
              backgroundColor: isChangesRequested || isRejected ? palette.dangerSoft : palette.brandSofter,
              borderColor: isChangesRequested || isRejected ? palette.danger : palette.brandSoft,
            },
          ]}
        >
          {isChangesRequested || isRejected ? (
            <AlertCircle color={palette.danger} size={20} />
          ) : (
            <ShieldCheck color={palette.brand} size={20} />
          )}
          <View style={styles.messageCopy}>
            <Text style={[styles.messageTitle, { color: isChangesRequested || isRejected ? palette.danger : palette.brand }]}>
              {isChangesRequested ? "Reviewer feedback" : isRejected ? "Decision message" : "SKIMA notice"}
            </Text>
            <Text style={[styles.messageBody, { color: palette.ink }]}>{applicantMessage}</Text>
          </View>
        </View>
      ) : null}

      {isChangesRequested && (correctionWorkspace || onFixRequestedChanges) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open requested application updates"
          accessibilityHint="Shows the exact documents that need to be replaced before review can continue"
          onPress={openRequestedChanges}
          style={({ pressed }) => [styles.actionBanner, { backgroundColor: palette.brand, opacity: pressed ? 0.84 : 1 }]}
        >
          <View style={styles.actionIcon}>
            <FileEdit color="#FFFFFF" size={18} />
          </View>
          <View style={styles.actionCopy}>
            <Text style={styles.actionBannerTitle}>Fix requested items</Text>
            <Text style={styles.actionBannerSub}>Open the requested documents and replace the exact item highlighted by the reviewer.</Text>
          </View>
        </Pressable>
      ) : null}

      <View style={[styles.timeline, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        {milestones.map((step, idx) => {
          const isLast = idx === milestones.length - 1;
          const nodeColor =
            step.status === "completed"
              ? palette.success
              : step.status === "current"
                ? palette.brand
                : step.status === "action_required" || step.status === "rejected"
                  ? palette.danger
                  : palette.borderStrong;

          return (
            <View key={step.key} style={styles.stepRow}>
              <View style={styles.indicatorCol}>
                <View style={[styles.node, { backgroundColor: nodeColor }]}>
                  {step.status === "completed" ? (
                    <CheckCircle2 color="#FFFFFF" size={14} />
                  ) : step.status === "current" ? (
                    <Clock color="#FFFFFF" size={14} />
                  ) : step.status === "action_required" || step.status === "rejected" ? (
                    <AlertCircle color="#FFFFFF" size={14} />
                  ) : (
                    <View style={[styles.upcomingDot, { backgroundColor: palette.muted }]} />
                  )}
                </View>

                {!isLast ? (
                  <View
                    style={[
                      styles.connector,
                      { backgroundColor: step.status === "completed" ? palette.success : palette.border },
                    ]}
                  />
                ) : null}
              </View>

              <View style={styles.contentCol}>
                <View style={styles.stepHead}>
                  <Text style={[styles.stepTitle, { color: palette.ink }]}>{step.title}</Text>
                  {step.timestamp ? (
                    <Text style={[styles.stepTime, { color: palette.muted }]}>{formatDate(step.timestamp)}</Text>
                  ) : null}
                </View>
                <Text style={[styles.stepDesc, { color: palette.muted }]}>{step.description}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

const styles = StyleSheet.create({
  container: { gap: spacing.md },
  messageBox: {
    flexDirection: "row",
    gap: spacing.sm + 2,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "flex-start",
  },
  messageCopy: { flex: 1, gap: 3 },
  messageTitle: { ...typography.caption, fontSize: 13, fontWeight: "900" },
  messageBody: { ...typography.body, fontSize: 13, lineHeight: 19 },
  actionBanner: {
    padding: spacing.md,
    borderRadius: radii.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm + 2,
  },
  actionIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  actionCopy: { flex: 1, gap: 2 },
  actionBannerTitle: { color: "#FFFFFF", ...typography.bodyStrong, fontSize: 14 },
  actionBannerSub: { color: "rgba(255,255,255,.84)", ...typography.caption },
  timeline: { borderRadius: radii.xl, padding: spacing.lg, borderWidth: StyleSheet.hairlineWidth },
  stepRow: { flexDirection: "row", gap: spacing.md },
  indicatorCol: { alignItems: "center", width: 28 },
  node: { width: 27, height: 27, borderRadius: 14, alignItems: "center", justifyContent: "center", zIndex: 2 },
  upcomingDot: { width: 6, height: 6, borderRadius: 3 },
  connector: { width: 2, flex: 1, minHeight: 38, marginVertical: 4 },
  contentCol: { flex: 1, paddingBottom: spacing.lg },
  stepHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: spacing.sm, marginBottom: 3 },
  stepTitle: { ...typography.bodyStrong, fontSize: 14, flex: 1 },
  stepTime: { ...typography.caption, fontSize: 11 },
  stepDesc: { ...typography.caption, fontSize: 12, lineHeight: 17 },
});
