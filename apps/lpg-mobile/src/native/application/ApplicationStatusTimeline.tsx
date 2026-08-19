import {
  AlertCircle,
  CheckCircle2,
  Clock,
  FileEdit,
  ShieldCheck,
  Zap,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing } from "../theme/tokens";

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
  const isChangesRequested = applicationStatus === "changes_requested";
  const isApproved = applicationStatus === "approved";
  const isRejected = applicationStatus === "rejected";
  const isActivated = operationalStatus === "active";
  const isUnderReview = applicationStatus === "under_review" || applicationStatus === "submitted";

  const milestones: TimelineMilestone[] = [
    {
      key: "submitted",
      title: "Application Submitted",
      description: "Your application and uploaded documents were received by SKIMA.",
      status: "completed",
      timestamp: submittedAt,
    },
    {
      key: "review",
      title: "Administrative Review",
      description: isUnderReview
        ? "SKIMA compliance team is actively reviewing your submission."
        : "Compliance and document verification completed.",
      status: isUnderReview ? "current" : "completed",
    },
    {
      key: "decision",
      title: isChangesRequested
        ? "Changes Requested"
        : isRejected
        ? "Application Rejected"
        : isApproved
        ? "Application Approved"
        : "Approval Decision",
      description: isChangesRequested
        ? "The reviewer has requested updates or clearer replacements for some evidence."
        : isRejected
        ? "Your application was not approved. Please see message below."
        : isApproved
        ? "All documentation has been verified and approved by SKIMA admin."
        : "Pending completion of review.",
      status: isChangesRequested
        ? "action_required"
        : isRejected
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
        ? "Your account is active on the SKIMA live operational network."
        : isApproved
        ? "Final administrative onboarding & radius provisioning is underway."
        : "Activated after administrative approval.",
      status: isActivated ? "completed" : isApproved ? "current" : "upcoming",
      timestamp: activatedAt,
    },
  ];

  return (
    <View style={styles.container}>
      {/* Reviewer Note Banner */}
      {applicantMessage ? (
        <View
          style={[
            styles.messageBox,
            isChangesRequested ? styles.messageBoxWarning : styles.messageBoxInfo,
          ]}
        >
          {isChangesRequested ? (
            <AlertCircle color={colors.danger} size={20} />
          ) : (
            <ShieldCheck color={colors.brand} size={20} />
          )}
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.messageTitle,
                isChangesRequested ? styles.messageTitleWarning : styles.messageTitleInfo,
              ]}
            >
              {isChangesRequested ? "Feedback from Reviewer" : "Review Notice"}
            </Text>
            <Text style={styles.messageBody}>{applicantMessage}</Text>
          </View>
        </View>
      ) : null}

      {/* Changes Requested Action Card */}
      {isChangesRequested && onFixRequestedChanges ? (
        <Pressable onPress={onFixRequestedChanges} style={styles.actionBanner}>
          <FileEdit color="white" size={18} />
          <View style={{ flex: 1 }}>
            <Text style={styles.actionBannerTitle}>Update Required Documents</Text>
            <Text style={styles.actionBannerSub}>Tap to upload requested replacements</Text>
          </View>
        </Pressable>
      ) : null}

      {/* Timeline Steps */}
      <View style={styles.timeline}>
        {milestones.map((step, idx) => {
          const isLast = idx === milestones.length - 1;

          return (
            <View key={step.key} style={styles.stepRow}>
              <View style={styles.indicatorCol}>
                <View
                  style={[
                    styles.node,
                    step.status === "completed" && styles.nodeCompleted,
                    step.status === "current" && styles.nodeCurrent,
                    step.status === "action_required" && styles.nodeWarning,
                    step.status === "rejected" && styles.nodeDanger,
                    step.status === "upcoming" && styles.nodeUpcoming,
                  ]}
                >
                  {step.status === "completed" ? (
                    <CheckCircle2 color="white" size={14} />
                  ) : step.status === "current" ? (
                    <Clock color="white" size={14} />
                  ) : step.status === "action_required" ? (
                    <AlertCircle color="white" size={14} />
                  ) : (
                    <View style={styles.upcomingDot} />
                  )}
                </View>

                {!isLast ? (
                  <View
                    style={[
                      styles.connector,
                      step.status === "completed" && styles.connectorActive,
                    ]}
                  />
                ) : null}
              </View>

              <View style={styles.contentCol}>
                <View style={styles.stepHead}>
                  <Text style={styles.stepTitle}>{step.title}</Text>
                  {step.timestamp ? (
                    <Text style={styles.stepTime}>
                      {new Date(step.timestamp).toLocaleDateString()}
                    </Text>
                  ) : null}
                </View>
                <Text style={styles.stepDesc}>{step.description}</Text>
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: spacing.md,
  },
  messageBox: {
    flexDirection: "row",
    gap: 10,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    alignItems: "flex-start",
  },
  messageBoxWarning: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FEE2E2",
  },
  messageBoxInfo: {
    backgroundColor: "#FFF0F1",
    borderColor: "#FCE7F3",
  },
  messageTitle: {
    fontSize: 13,
    fontWeight: "900",
  },
  messageTitleWarning: {
    color: colors.danger,
  },
  messageTitleInfo: {
    color: colors.brand,
  },
  messageBody: {
    fontSize: 12,
    color: colors.ink,
    lineHeight: 17,
    marginTop: 2,
  },
  actionBanner: {
    backgroundColor: colors.brand,
    padding: spacing.md,
    borderRadius: radii.md,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  actionBannerTitle: {
    color: "white",
    fontSize: 14,
    fontWeight: "900",
  },
  actionBannerSub: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
  },
  timeline: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  stepRow: {
    flexDirection: "row",
    gap: spacing.md,
  },
  indicatorCol: {
    alignItems: "center",
    width: 28,
  },
  node: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  nodeCompleted: {
    backgroundColor: colors.success,
  },
  nodeCurrent: {
    backgroundColor: colors.brand,
  },
  nodeWarning: {
    backgroundColor: colors.danger,
  },
  nodeDanger: {
    backgroundColor: colors.danger,
  },
  nodeUpcoming: {
    backgroundColor: "#E5E7EB",
  },
  upcomingDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.muted,
  },
  connector: {
    width: 2,
    flex: 1,
    minHeight: 36,
    backgroundColor: "#E5E7EB",
    marginVertical: 4,
  },
  connectorActive: {
    backgroundColor: colors.success,
  },
  contentCol: {
    flex: 1,
    paddingBottom: spacing.lg,
  },
  stepHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 2,
  },
  stepTitle: {
    fontSize: 14,
    fontWeight: "900",
    color: colors.ink,
  },
  stepTime: {
    fontSize: 11,
    fontWeight: "700",
    color: colors.muted,
  },
  stepDesc: {
    fontSize: 12,
    color: colors.muted,
    lineHeight: 16,
  },
});
