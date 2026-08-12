import type { UseQueryResult } from "@tanstack/react-query";
import { router } from "expo-router";
import { CheckCircle2 } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  displayReference,
  displayStatus,
  recordId,
  type PlatformRecord,
} from "../api/records";
import { Scanner } from "../device/Scanner";
import { colors, radii, spacing } from "../theme/tokens";
import { Screen } from "./Screen";
import { useAppTheme } from "../theme/ThemeProvider";

export function ScanWorkspaceScreen({
  workspace,
  jobs,
}: {
  workspace: "Driver" | "Station";
  jobs: UseQueryResult<PlatformRecord[], Error>;
}) {
  const { palette } = useAppTheme();
  const actionable = (jobs.data ?? []).filter((job) =>
    scanReady(workspace, displayStatus(job) ?? ""),
  );
  const [selectedId, setSelectedId] = useState("");
  const jobId =
    selectedId ||
    (actionable.length === 1 ? (recordId(actionable[0]) ?? "") : "");
  const detected = (value: string) => {
    if (!jobId) return;
    const group = workspace === "Driver" ? "driver" : "station";
    router.push(
      `/${`(${group})`}/job/${encodeURIComponent(jobId)}?scannedToken=${encodeURIComponent(value)}` as never,
    );
  };
  return (
    <Screen eyebrow={`${workspace} tools`} title="Scan a SKIMA cylinder">
      {actionable.length > 1 ? (
        <View style={styles.jobs}>
          <Text style={styles.title}>Choose the active job</Text>
          <Text style={styles.body}>
            Pick the job you’re working on so SKIMA can check the right cylinder and next step.
          </Text>
          {actionable.map((job, index) => {
            const id = recordId(job) ?? String(index);
            const selected = id === jobId;
            return (
              <Pressable
                key={id}
                onPress={() => setSelectedId(id)}
                style={[styles.job, { backgroundColor: palette.surface, borderColor: selected ? colors.brand : palette.border }, selected && styles.selected]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.jobTitle}>
                    {displayReference(job) ?? "LPG job"}
                  </Text>
                  <Text style={styles.body}>
                    {scanStatus(displayStatus(job) ?? "active")}
                  </Text>
                </View>
                {selected ? (
                  <CheckCircle2 color={colors.brand} size={22} />
                ) : null}
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Scanner enabled={Boolean(jobId)} onDetected={detected} />
      {jobId ? (
        <Text style={styles.note}>
          We’ll check the code against this job before anything changes.
        </Text>
      ) : null}
    </Screen>
  );
}
const styles = StyleSheet.create({
  jobs: { gap: spacing.sm },
  title: { color: colors.ink, fontSize: 19, fontWeight: "900" },
  body: { color: colors.muted, lineHeight: 20, textTransform: "capitalize" },
  job: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderWidth: 1,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  selected: { backgroundColor: "#FFF6F7" },
  jobTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  note: { color: colors.muted, lineHeight: 20 },
});
function scanReady(workspace: "Driver" | "Station", status: string) {
  return workspace === "Driver"
    ? [
        "assigned",
        "pickup_pending",
        "pickup_arrived",
        "pickup_en_route",
        "delivery_verification_pending",
        "return_en_route",
      ].some((value) => status.includes(value))
    : [
        "pickup_verified",
        "station_en_route",
        "refill_confirmed",
        "station_settled",
      ].some((value) => status.includes(value));
}
function scanStatus(value: string) {
  const normalized = value.replace(/[-\s]+/g, "_").toLowerCase();
  const labels: Record<string, string> = {
    assigned: "Ready for pickup",
    pickup_pending: "Pickup waiting",
    pickup_arrived: "At pickup",
    pickup_en_route: "Heading to pickup",
    pickup_verified: "Cylinder collected",
    station_en_route: "Heading to station",
    refill_confirmed: "Refill complete",
    station_settled: "Ready to return",
    delivery_verification_pending: "Ready for delivery",
    return_en_route: "Returning to customer",
  };
  return labels[normalized] ?? "Ready to scan";
}
