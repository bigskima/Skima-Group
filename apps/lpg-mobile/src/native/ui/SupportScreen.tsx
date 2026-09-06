import { AlertTriangle, FileWarning, ShieldAlert, ShieldCheck } from "lucide-react-native";
import { useSegments } from "expo-router";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { domainQueries, useLpgConfig } from "../api/domains";
import { useGatewayMutation, useGatewayQuery } from "../api/gateway";
import {
  ActionResponseSchema,
  RecordArraySchema,
  displayReference,
  firstString,
  nestedRecords,
  recordId,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { AppModal } from "./AppModal";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";

export function SupportScreen() {
  const segments = useSegments();
  const workspace = String(segments[0] ?? "customer").replace(/[()]/g, "");
  const { palette } = useAppTheme();
  const orders = domainQueries.orders();
  const config = useLpgConfig();
  const incidentTypes = nestedRecords(config.data, "safetyIncidentTypes");
  const severities = nestedRecords(config.data, "safetySeverities");
  const [orderId, setOrderId] = useState("");
  const [type, setType] = useState("");
  const [severity, setSeverity] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [messageSuccess, setMessageSuccess] = useState(false);
  const [replyThreadId, setReplyThreadId] = useState<string | null>(null);
  const [reply, setReply] = useState("");

  const mutation = useGatewayMutation({
    path: "/lpg/safety-incidents",
    schema: ActionResponseSchema,
    invalidate: [["safety-incidents"]],
  });
  const inbox = useGatewayQuery({
    key: ["support", "threads"],
    path: "/runtime/support/threads",
    schema: RecordArraySchema,
  });
  const supportMutation = useGatewayMutation({
    path: "/runtime/support/threads",
    schema: ActionResponseSchema,
    invalidate: [["support", "threads"]],
  });
  const replyMutation = useGatewayMutation({
    path: "/runtime/support/reply",
    schema: ActionResponseSchema,
    invalidate: [["support", "threads"]],
  });

  const submit = async () => {
    setMessage(null);
    if (!type || !severity || !description.trim()) {
      setMessageSuccess(false);
      setMessage("Choose an issue type and severity, then describe what happened.");
      return;
    }
    try {
      const requestKey = idempotencyKey("support", `${workspace}:${orderId || type}`);
      await supportMutation.mutateAsync({
        workspace,
        category: type,
        subject: orderId ? `Issue with order ${orderId.slice(0, 8)}` : "Service support request",
        message: description.trim(),
        priority: severity === "critical" ? "urgent" : severity === "high" ? "high" : "normal",
        source: "skima.mobile.support",
        idempotencyKey: requestKey,
        metadata: { orderId: orderId || null, incidentType: type, severity },
      });
      // Safety incidents are module evidence in addition to the platform support
      // conversation. They must never prevent a customer, driver or station from
      // reaching the support inbox.
      if (workspace === "customer") {
        await mutation.mutateAsync({
          lpgOrderId: orderId || undefined,
          incidentType: type,
          severity,
          description: description.trim(),
          source: "skima.lpg.mobile",
          idempotencyKey: `${requestKey}:incident`,
        }).catch(() => undefined);
      }
      setDescription("");
      setMessageSuccess(true);
      setMessage("Your support request has been sent to SKIMA. You can continue the conversation below.");
    } catch (cause) {
      setMessageSuccess(false);
      setMessage(friendlyError(cause, "Your safety report could not be submitted."));
    }
  };

  const policiesUnavailable = incidentTypes.length === 0 || severities.length === 0;

  return (
    <Screen
      eyebrow="Safety & support"
      title="Report an LPG issue"
      subtitle="Tell SKIMA about a safety concern or problem with an order."
    >
      {config.isPending ? (
        <ScreenSkeleton cards={3} />
      ) : config.error ? (
        <EmptyState
          icon={<FileWarning color={palette.brand} size={27} />}
          title="Support form could not be loaded"
          description="Check your connection and try again."
          action={<AppButton label="Retry" onPress={() => void config.refetch()} />}
        />
      ) : (
        <>
          <View style={[styles.emergency, shadows.soft, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
            <View style={[styles.emergencyIcon, { backgroundColor: palette.surface }]}>
              <ShieldAlert color={palette.danger} size={25} />
            </View>
            <View style={styles.emergencyCopy}>
              <Text style={[styles.emergencyEyebrow, { color: palette.danger }]}>IMMEDIATE DANGER</Text>
              <Text style={[styles.emergencyTitle, { color: palette.ink }]}>Gas leak, fire or unsafe cylinder situation</Text>
              <Text style={[styles.emergencyBody, { color: palette.muted }]}>Move away from immediate danger and avoid flames or electrical switching. Use the appropriate emergency channel for urgent danger before relying on this report form.</Text>
            </View>
          </View>

          <View style={[styles.form, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <FormSection
              step="1"
              title="Related order"
              description="Choose the order if the issue happened during a pickup, refill or delivery."
            >
              <View style={styles.options}>
                <AppButton label="No related order" variant={!orderId ? "primary" : "secondary"} size="sm" onPress={() => setOrderId("")} />
                {(orders.data ?? []).slice(0, 10).map((order) => {
                  const id = recordId(order) ?? "";
                  return (
                    <AppButton
                      key={id}
                      label={displayReference(order) ?? "Order"}
                      variant={orderId === id ? "primary" : "secondary"}
                      size="sm"
                      onPress={() => setOrderId(id)}
                    />
                  );
                })}
              </View>
            </FormSection>

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            <FormSection
              step="2"
              title="Issue type"
              description="Choose the category that best describes what happened."
            >
              <View style={styles.options}>
                {incidentTypes.map((item, index) => {
                  const key = firstString(item, ["key"]) ?? String(index);
                  const label = firstString(item, ["displayName", "display_name"]) ?? key;
                  return (
                    <AppButton key={key} label={label} variant={type === key ? "primary" : "secondary"} size="sm" onPress={() => setType(key)} />
                  );
                })}
              </View>
            </FormSection>

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            <FormSection
              step="3"
              title="Severity"
              description="Choose how serious the issue is."
            >
              <View style={styles.options}>
                {severities.map((item, index) => {
                  const key = firstString(item, ["key"]) ?? String(index);
                  const label = firstString(item, ["displayName", "display_name"]) ?? key;
                  return (
                    <AppButton key={key} label={label} variant={severity === key ? "primary" : "secondary"} size="sm" onPress={() => setSeverity(key)} />
                  );
                })}
              </View>
            </FormSection>

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            <FormSection
              step="4"
              title="Tell us what happened"
              description="Include the location, what you observed and any immediate safety concern."
            >
              <TextInput
                value={description}
                onChangeText={setDescription}
                multiline
                placeholder="Describe the issue clearly"
                placeholderTextColor={palette.muted}
                style={[styles.input, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]}
              />
            </FormSection>

            <View style={[styles.auth, { backgroundColor: palette.surfaceSubtle }]}>
              <ShieldCheck color={palette.mutedStrong} size={18} />
              <Text style={[styles.authText, { color: palette.muted }]}>This report is securely linked to your SKIMA account so our safety team can follow up.</Text>
            </View>

            <AppButton
              label="Send to SKIMA support"
              fullWidth
              size="lg"
              loading={mutation.isPending || supportMutation.isPending}
              disabled={policiesUnavailable || !type || !severity || !description.trim()}
              icon={<AlertTriangle color="#FFFFFF" size={18} />}
              onPress={() => void submit()}
            />
          </View>

          {policiesUnavailable ? (
            <View style={[styles.policyError, { backgroundColor: palette.dangerSoft }]}>
              <Text style={[styles.policyErrorText, { color: palette.danger }]}>Safety reporting options are currently unavailable. Do not use this form as a substitute for urgent emergency assistance.</Text>
            </View>
          ) : null}
        </>
      )}

      <AppModal visible={Boolean(message)} title={messageSuccess ? "Report sent" : "We couldn't send that"} tone={messageSuccess ? "success" : "danger"} onClose={() => setMessage(null)}>
        <Text accessibilityRole="alert" style={[styles.messageText, { color: palette.ink }]}>{message}</Text>
        <AppButton label="Okay" fullWidth onPress={() => setMessage(null)} />
      </AppModal>

      {(inbox.data ?? []).length ? (
        <View style={[styles.form, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.sectionTitle, { color: palette.ink }]}>Your support conversations</Text>
          {(inbox.data ?? []).slice(0, 5).map((thread) => (
            <View key={recordId(thread) ?? JSON.stringify(thread)} style={[styles.thread, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
              <Text style={[styles.threadTitle, { color: palette.ink }]}>{firstString(thread, ["subject"]) ?? "Support request"}</Text>
              <Text style={[styles.threadStatus, { color: palette.brand }]}>{(firstString(thread, ["status"]) ?? "open").replace(/_/g, " ")}</Text>
              {nestedRecords(thread, "messages").slice(-2).map((entry, index) => (
                <Text key={firstString(entry, ["id"]) ?? index} style={[styles.threadMessage, { color: palette.muted }]}>
                  {firstString(entry, ["authorKind"]) === "admin" ? "SKIMA: " : "You: "}{firstString(entry, ["body"]) ?? ""}
                </Text>
              ))}
              {replyThreadId === recordId(thread) ? <>
                <TextInput value={reply} onChangeText={setReply} multiline maxLength={4000} placeholder="Write your reply" placeholderTextColor={palette.muted} style={[styles.input, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]} />
                <View style={styles.options}><AppButton label="Cancel" size="sm" variant="secondary" onPress={() => { setReplyThreadId(null); setReply(""); }} /><AppButton label="Send reply" size="sm" loading={replyMutation.isPending} disabled={!reply.trim()} onPress={() => void replyMutation.mutateAsync({ threadId: recordId(thread), message: reply.trim(), source: "skima.mobile.support", idempotencyKey: idempotencyKey("support-reply", recordId(thread) ?? "thread") }).then(() => { setReply(""); setReplyThreadId(null); setMessageSuccess(true); setMessage("Your reply was sent to SKIMA support."); }).catch((cause) => { setMessageSuccess(false); setMessage(friendlyError(cause, "Your reply could not be sent. Try again.")); })} /></View>
              </> : <AppButton label="Reply" size="sm" variant="secondary" onPress={() => setReplyThreadId(recordId(thread))} />}
            </View>
          ))}
        </View>
      ) : null}
    </Screen>
  );
}

function FormSection({ step, title, description, children }: { step: string; title: string; description: string; children: React.ReactNode }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}>
        <View style={[styles.stepBadge, { backgroundColor: palette.brandSoft }]}><Text style={[styles.stepText, { color: palette.brand }]}>{step}</Text></View>
        <View style={styles.sectionCopy}>
          <Text style={[styles.sectionTitle, { color: palette.ink }]}>{title}</Text>
          <Text style={[styles.sectionBody, { color: palette.muted }]}>{description}</Text>
        </View>
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  emergency: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  emergencyIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  emergencyCopy: { flex: 1, gap: 4 },
  emergencyEyebrow: { ...typography.eyebrow, fontSize: 9 },
  emergencyTitle: { ...typography.subheading, fontSize: 16 },
  emergencyBody: { ...typography.caption, lineHeight: 18 },
  form: { gap: spacing.lg, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  section: { gap: spacing.md },
  sectionHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  stepBadge: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  stepText: { ...typography.bodyStrong, fontSize: 13 },
  sectionCopy: { flex: 1, gap: 2 },
  sectionTitle: { ...typography.subheading, fontSize: 15 },
  sectionBody: { ...typography.caption, lineHeight: 17 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth },
  input: { minHeight: 140, borderWidth: 1, borderRadius: radii.md, padding: spacing.md, fontSize: 15, textAlignVertical: "top" },
  auth: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderRadius: radii.md, padding: spacing.md },
  authText: { flex: 1, ...typography.caption, lineHeight: 18 },
  policyError: { borderRadius: radii.md, padding: spacing.md },
  policyErrorText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
  message: { borderRadius: radii.md, padding: spacing.md },
  messageText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
  thread: { gap: 4, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md },
  threadTitle: { ...typography.bodyStrong },
  threadStatus: { ...typography.eyebrow, textTransform: "capitalize" },
  threadMessage: { ...typography.caption, lineHeight: 18 },
});
