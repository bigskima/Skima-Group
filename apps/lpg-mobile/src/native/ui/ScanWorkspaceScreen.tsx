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

export function ScanWorkspaceScreen({
  workspace,
  jobs,
}: {
  workspace: "Driver" | "Station";
  jobs: UseQueryResult<PlatformRecord[], Error>;
}) {
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
    <Screen eyebrow={`${workspace} verification`} title="Scan cylinder">
      {actionable.length > 1 ? (
        <View style={styles.jobs}>
          <Text style={styles.title}>Choose the active job</Text>
          <Text style={styles.body}>
            The scanned credential is submitted only against the job you select.
          </Text>
          {actionable.map((job, index) => {
            const id = recordId(job) ?? String(index);
            const selected = id === jobId;
            return (
              <Pressable
                key={id}
                onPress={() => setSelectedId(id)}
                style={[styles.job, selected && styles.selected]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.jobTitle}>
                    {displayReference(job) ?? "LPG job"}
                  </Text>
                  <Text style={styles.body}>
                    {(displayStatus(job) ?? "active").replace(/[_-]/g, " ")}
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
          After detection, SKIMA opens this job for backend verification.
          Scanning alone never changes workflow state.
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
    borderColor: colors.border,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  selected: { borderColor: colors.brand, backgroundColor: "#FFF6F7" },
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
