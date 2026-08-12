import { AlertTriangle, ShieldAlert } from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { domainQueries, useLpgConfig } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayReference,
  firstString,
  nestedRecords,
  recordId,
} from "../api/records";
import { colors, radii, spacing } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";
import { Card } from "./Card";
import { Screen } from "./Screen";
export function SupportScreen() {
  const orders = domainQueries.orders();
  const config = useLpgConfig();
  const incidentTypes = nestedRecords(config.data, "safetyIncidentTypes");
  const severities = nestedRecords(config.data, "safetySeverities");
  const [orderId, setOrderId] = useState("");
  const [type, setType] = useState("");
  const [severity, setSeverity] = useState("");
  const [description, setDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const mutation = useGatewayMutation({
    path: "/lpg/safety-incidents",
    schema: ActionResponseSchema,
    invalidate: [["safety-incidents"]],
  });
  const submit = async () => {
    if (!type || !severity || !description.trim()) {
      setMessage(
        "Choose an issue type and severity, then describe what happened.",
      );
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
      setMessage("Safety report submitted to SKIMA operations.");
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Safety report could not be submitted.",
      );
    }
  };
  return (
    <Screen eyebrow="Safety and support" title="Report an LPG issue">
      {config.isPending || orders.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <>
          <View style={styles.emergency}>
            <ShieldAlert color={colors.brand} size={30} />
            <View style={{ flex: 1 }}>
              <Text style={styles.emergencyTitle}>
                Immediate danger or gas leak
              </Text>
              <Text style={styles.body}>
                Move away, avoid flames and electrical switches, and contact the
                appropriate local emergency service before using this form.
              </Text>
            </View>
          </View>
          <Card>
            <Text style={styles.title}>Related order</Text>
            <View style={styles.options}>
              <Pressable
                onPress={() => setOrderId("")}
                style={[styles.option, !orderId && styles.selected]}
              >
                <Text style={styles.optionText}>No related order</Text>
              </Pressable>
              {(orders.data ?? []).slice(0, 10).map((order) => {
                const id = recordId(order) ?? "";
                return (
                  <Pressable
                    key={id}
                    onPress={() => setOrderId(id)}
                    style={[styles.option, orderId === id && styles.selected]}
                  >
                    <Text style={styles.optionText}>
                      {displayReference(order) ?? "Order"}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.title}>Issue type</Text>
            <View style={styles.options}>
              {incidentTypes.map((item, index) => {
                const key = firstString(item, ["key"]) ?? String(index);
                return (
                  <Pressable
                    key={key}
                    onPress={() => setType(key)}
                    style={[styles.option, type === key && styles.selected]}
                  >
                    <Text style={styles.optionText}>
                      {firstString(item, ["displayName", "display_name"]) ??
                        key}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.title}>Severity</Text>
            <View style={styles.options}>
              {severities.map((item, index) => {
                const key = firstString(item, ["key"]) ?? String(index);
                return (
                  <Pressable
                    key={key}
                    onPress={() => setSeverity(key)}
                    style={[styles.option, severity === key && styles.selected]}
                  >
                    <Text style={styles.optionText}>
                      {firstString(item, ["displayName", "display_name"]) ??
                        key}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <TextInput
              value={description}
              onChangeText={setDescription}
              multiline
              placeholder="Describe the issue, location, and immediate safety concerns"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <View style={styles.auth}>
              <AlertTriangle color={colors.brand} size={18} />
              <Text style={styles.body}>
                This report is recorded against your authenticated account.
              </Text>
            </View>
            <Pressable
              disabled={
                mutation.isPending ||
                incidentTypes.length === 0 ||
                severities.length === 0
              }
              onPress={() => void submit()}
              style={styles.primary}
            >
              {mutation.isPending ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.primaryText}>Submit safety report</Text>
              )}
            </Pressable>
          </Card>
          {incidentTypes.length === 0 || severities.length === 0 ? (
            <Text style={styles.error}>
              Safety reporting policy is unavailable. Use emergency services for
              immediate danger.
            </Text>
          ) : null}
        </>
      )}
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </Screen>
  );
}
const styles = StyleSheet.create({
  emergency: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: "#FFF0F1",
    borderWidth: 1,
    borderColor: "#F4C5CA",
  },
  emergencyTitle: { color: colors.ink, fontSize: 18, fontWeight: "900" },
  title: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  body: { flex: 1, color: colors.muted, lineHeight: 21 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  option: {
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.pill,
  },
  selected: { borderColor: colors.brand, backgroundColor: "#FFF0F1" },
  optionText: {
    color: colors.ink,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  input: {
    minHeight: 130,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.md,
    color: colors.ink,
    textAlignVertical: "top",
  },
  auth: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  primary: {
    minHeight: 55,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontWeight: "900" },
  error: { color: colors.danger, fontWeight: "700" },
  message: { color: colors.brandDark, fontWeight: "800" },
});
