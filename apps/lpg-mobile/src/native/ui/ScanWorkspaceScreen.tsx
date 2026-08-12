import type { UseQueryResult } from "@tanstack/react-query";
import { router } from "expo-router";
import { CheckCircle2, Layers3, ScanLine } from "lucide-react-native";
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
    <Screen eyebrow={workspace === "Station" ? "Reception" : "Cylinder check"} title={workspace === "Station" ? "Scan incoming cylinders" : "Scan a SKIMA cylinder"}>
      <View style={styles.queueSummary}>
        <View style={[styles.queueIcon, { backgroundColor: palette.brandSoft }]}>{workspace === "Station" ? <Layers3 color={colors.brand} size={22} /> : <ScanLine color={colors.brand} size={22} />}</View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: palette.ink }]}>{actionable.length ? `${actionable.length} ${actionable.length === 1 ? "cylinder" : "cylinders"} ready` : "No cylinder is waiting"}</Text>
          <Text style={[styles.body, { color: palette.muted }]}>{workspace === "Station" ? "Choose a job, scan its SKIMA code, then move straight to the next one." : "Choose the delivery you are working on before scanning."}</Text>
        </View>
      </View>
      {actionable.length > 1 ? (
        <View style={styles.jobs}>
          <Text style={[styles.sectionLabel, { color: palette.muted }]}>CHOOSE JOB</Text>
          {actionable.map((job, index) => {
            const id = recordId(job) ?? String(index);
            const selected = id === jobId;
            return (
              <Pressable
                key={id}
                onPress={() => setSelectedId(id)}
                style={[styles.job, { borderColor: selected ? colors.brand : palette.border }, selected && { backgroundColor: palette.brandSoft }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={[styles.jobTitle, { color: palette.ink }]}>
                    {displayReference(job) ?? "LPG job"}
                  </Text>
                  <Text style={[styles.body, { color: palette.muted }]}>
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
        <Text style={[styles.note, { color: palette.muted }]}>
          The code is checked inside SKIMA. Unknown or mismatched codes cannot open another app or change this job.
        </Text>
      ) : null}
    </Screen>
  );
}
const styles = StyleSheet.create({
  jobs: { gap: spacing.sm },
  title: { fontSize: 18, fontWeight: "900" },
  body: { fontSize: 13, lineHeight: 19 },
  job: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
  },
  selected: { paddingHorizontal: spacing.md, borderRadius: radii.md },
  jobTitle: { fontSize: 16, fontWeight: "900" },
  note: { lineHeight: 20 },
  queueSummary: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm },
  queueIcon: { width: 46, height: 46, alignItems: "center", justifyContent: "center", borderRadius: 23 },
  sectionLabel: { fontSize: 10, fontWeight: "900", letterSpacing: 1.2 },
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
