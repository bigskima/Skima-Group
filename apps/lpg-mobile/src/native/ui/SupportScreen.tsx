import { AlertTriangle, FileWarning, ShieldAlert, ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { domainQueries, useLpgConfig } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
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
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";

export function SupportScreen() {
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

  const mutation = useGatewayMutation({
    path: "/lpg/safety-incidents",
    schema: ActionResponseSchema,
    invalidate: [["safety-incidents"]],
  });

  const submit = async () => {
    setMessage(null);
    if (!type || !severity || !description.trim()) {
      setMessageSuccess(false);
      setMessage("Choose an issue type and severity, then describe what happened.");
      return;
    }
    try {
      await mutation.mutateAsync({
        lpgOrderId: orderId || undefined,
        incidentType: type,
        severity,
        description: description.trim(),
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("safety-incident", orderId || type),
      });
      setDescription("");
      setMessageSuccess(true);
      setMessage("Your safety report has been submitted to SKIMA operations.");
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
      subtitle="Send a structured safety or fulfilment incident to SKIMA operations."
    >
      {config.isPending || orders.isPending ? (
        <ScreenSkeleton cards={3} />
      ) : config.error || orders.error ? (
        <EmptyState
          icon={<FileWarning color={palette.brand} size={27} />}
          title="Support form could not be loaded"
          description="Check your connection and try again."
          action={<AppButton label="Retry" onPress={() => void Promise.all([config.refetch(), orders.refetch()])} />}
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
              description="Link the report to an order when the issue happened during a specific SKIMA fulfilment."
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
              description="Choose how serious the issue is according to the available SKIMA safety policy."
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
              <Text style={[styles.authText, { color: palette.muted }]}>This report is submitted from your authenticated SKIMA account and becomes part of the operational incident record.</Text>
            </View>

            <AppButton
              label="Submit safety report"
              fullWidth
              size="lg"
              loading={mutation.isPending}
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

      {message ? (
        <View style={[styles.message, { backgroundColor: messageSuccess ? palette.successSoft : palette.dangerSoft }]}>
          <Text accessibilityRole="alert" style={[styles.messageText, { color: messageSuccess ? palette.success : palette.danger }]}>{message}</Text>
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
});