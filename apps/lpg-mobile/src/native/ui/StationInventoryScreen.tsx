import { router } from "expo-router";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useStationRuntime } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayReference,
  displayStatus,
  firstNumber,
  nestedRecord,
  nestedRecords,
  recordId,
} from "../api/records";
import { colors, radii, spacing } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";
import { useSession } from "../session/SessionProvider";
import { Card } from "./Card";
import { Screen } from "./Screen";
export function StationInventoryScreen() {
  const session = useSession();
  const canManage = Boolean(
    session.context?.platformAdmin ||
    session.context?.permissions.includes("lpg.stations.manage") ||
    session.context?.roles.some((role) =>
      role.permissions.includes("lpg.stations.manage"),
    ),
  );
  const runtime = useStationRuntime();
  const branch = nestedRecord(runtime.data, "branch");
  const branchId = branch ? recordId(branch) : null;
  const orders = nestedRecords(runtime.data, "orders");
  const active = orders.filter((item) =>
    [
      "station_verified",
      "refill_in_progress",
      "refill_confirmed",
      "station_settled",
    ].includes(displayStatus(item) ?? ""),
  );
  const available = firstNumber(branch, [
    "currentAvailableKg",
    "current_available_kg",
  ]);
  const capacity = firstNumber(branch, [
    "refillCapacityKg",
    "refill_capacity_kg",
  ]);
  const remaining =
    capacity !== null && available !== null
      ? Math.max(0, capacity - available)
      : null;
  const [amount, setAmount] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const mutation = useGatewayMutation({
    path: "/lpg/stations/capacity-adjustments",
    schema: ActionResponseSchema,
    invalidate: [["station-runtime"], ["stations"]],
  });
  const submit = async () => {
    const value = Number(amount);
    setMessage(null);
    if (
      !branchId ||
      !Number.isFinite(value) ||
      value <= 0 ||
      (remaining !== null && value > remaining)
    ) {
      setMessage(
        "Enter a valid replenishment amount within the remaining branch capacity.",
      );
      return;
    }
    try {
      await mutation.mutateAsync({
        stationBranchId: branchId,
        adjustmentKg: value,
        reasonKey: "lpg.capacity.replenishment",
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey(
          "station-capacity-replenishment",
          branchId,
        ),
      });
      setAmount("");
      setMessage("Capacity replenishment recorded.");
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : "Capacity could not be updated.",
      );
    }
  };
  return (
    <Screen
      eyebrow="Station operations"
      title="Inventory and capacity"
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
      }
    >
      {runtime.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <>
          <View style={styles.hero}>
            <Text style={styles.heroLabel}>AVAILABLE REFILL STOCK</Text>
            <Text style={styles.heroValue}>{available ?? "—"} kg</Text>
            <Text style={styles.heroBody}>
              of {capacity ?? "unconfigured"} kg verified capacity
            </Text>
            <View style={styles.track}>
              <View
                style={[
                  styles.fill,
                  {
                    width: `${capacity && available !== null ? Math.min(100, Math.max(0, (available / capacity) * 100)) : 0}%`,
                  },
                ]}
              />
            </View>
          </View>
          <Text style={styles.section}>Cylinders at station</Text>
          {active.map((order, index) => {
            const cylinder = nestedRecord(order, "cylinder");
            return (
              <Card key={recordId(order) ?? String(index)}>
                <View style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>
                      {cylinder
                        ? displayReference(cylinder)
                        : displayReference(order)}
                    </Text>
                    <Text style={styles.meta}>
                      {cylinder
                        ? `${firstNumber(cylinder, ["sizeKg", "size_kg"]) ?? "Configured"} kg`
                        : "Cylinder"}
                    </Text>
                  </View>
                  <Text style={styles.chip}>
                    {(displayStatus(order) ?? "active").replace(/[_-]/g, " ")}
                  </Text>
                </View>
              </Card>
            );
          })}
          {active.length === 0 ? (
            <Text style={styles.empty}>
              No verified cylinders are currently at this station.
            </Text>
          ) : null}
          {canManage && remaining !== null && remaining > 0 ? (
            <Card>
              <Text style={styles.title}>Record replenishment</Text>
              <Text style={styles.meta}>
                Remaining capacity: {remaining} kg
              </Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={setAmount}
                keyboardType="decimal-pad"
                placeholder="Kilograms received"
                placeholderTextColor={colors.muted}
              />
              <Pressable
                style={styles.primary}
                disabled={mutation.isPending}
                onPress={() => void submit()}
              >
                {mutation.isPending ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text style={styles.primaryText}>Record replenishment</Text>
                )}
              </Pressable>
            </Card>
          ) : !canManage ? (
            <Text style={styles.empty}>
              Inventory is read-only for your current station role.
            </Text>
          ) : null}
          {message ? <Text style={styles.message}>{message}</Text> : null}
        </>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  back: { color: colors.brand, fontWeight: "800" },
  hero: {
    padding: spacing.xl,
    gap: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.brand,
  },
  heroLabel: { color: "#FFDDE1", fontSize: 11, fontWeight: "900" },
  heroValue: { color: "white", fontSize: 36, fontWeight: "900" },
  heroBody: { color: "#FFF1F2" },
  track: {
    height: 8,
    borderRadius: 4,
    overflow: "hidden",
    backgroundColor: "#A91222",
  },
  fill: { height: 8, backgroundColor: "white" },
  section: { color: colors.ink, fontSize: 20, fontWeight: "900" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  title: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  meta: { color: colors.muted },
  chip: {
    color: colors.brandDark,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  empty: { color: colors.muted, padding: spacing.lg, textAlign: "center" },
  input: {
    minHeight: 54,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    color: colors.ink,
  },
  primary: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontWeight: "900" },
  message: { color: colors.brandDark, fontWeight: "700" },
});
