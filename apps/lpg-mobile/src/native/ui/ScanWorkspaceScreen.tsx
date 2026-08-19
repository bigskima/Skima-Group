import type { UseQueryResult } from "@tanstack/react-query";
import { router } from "expo-router";
import { CheckCircle2, Layers3, QrCode, ScanLine, ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  displayReference,
  displayStatus,
  recordId,
  type PlatformRecord,
} from "../api/records";
import { Scanner } from "../device/Scanner";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

export function ScanWorkspaceScreen({
  workspace,
  jobs,
}: {
  workspace: "Driver" | "Station";
  jobs: UseQueryResult<PlatformRecord[], Error>;
}) {
  const { palette } = useAppTheme();
  const actionable = (jobs.data ?? []).filter((job) => scanReady(workspace, displayStatus(job) ?? ""));
  const [selectedId, setSelectedId] = useState("");
  const jobId = selectedId || (actionable.length === 1 ? (recordId(actionable[0]) ?? "") : "");

  const detected = (value: string) => {
    if (!jobId) return;
    const group = workspace === "Driver" ? "driver" : "station";
    router.push(
      `/${`(${group})`}/job/${encodeURIComponent(jobId)}?scannedToken=${encodeURIComponent(value)}` as never,
    );
  };

  const isStation = workspace === "Station";

  return (
    <Screen
      eyebrow={isStation ? "Station verification" : "Driver verification"}
      title={isStation ? "Scan incoming cylinder" : "Scan SKIMA cylinder"}
      subtitle={
        isStation
          ? "Select the refill job first, then verify the cylinder identity before operational processing."
          : "Select the active job before scanning so SKIMA can match the cylinder to the correct fulfilment record."
      }
    >
      <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
        <View style={styles.heroIcon}>
          {isStation ? <Layers3 color="#FFFFFF" size={26} /> : <ScanLine color="#FFFFFF" size={26} />}
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.heroEyebrow}>READY TO VERIFY</Text>
          <Text style={styles.heroTitle}>
            {actionable.length
              ? `${actionable.length} ${actionable.length === 1 ? "job" : "jobs"} ready for scanning`
              : "No eligible scan job right now"}
          </Text>
          <Text style={styles.heroBody}>
            {isStation
              ? "Use the SKIMA identity attached to the cylinder or presented by the driver for this order."
              : "Only scan the cylinder connected to the job you are currently fulfilling."}
          </Text>
        </View>
      </View>

      {actionable.length > 1 ? (
        <View style={styles.jobsSection}>
          <Text style={[styles.sectionLabel, { color: palette.muted }]}>CHOOSE THE JOB FIRST</Text>
          <View style={styles.jobs}>
            {actionable.map((job, index) => {
              const id = recordId(job) ?? String(index);
              const selected = id === jobId;
              const status = displayStatus(job) ?? "active";
              return (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  onPress={() => setSelectedId(id)}
                  style={({ pressed }) => [
                    styles.job,
                    shadows.soft,
                    {
                      backgroundColor: selected ? palette.brandSofter : palette.surface,
                      borderColor: selected ? palette.brand : palette.border,
                      opacity: pressed ? 0.78 : 1,
                    },
                  ]}
                >
                  <View style={[styles.jobIcon, { backgroundColor: selected ? palette.brandSoft : palette.soft }]}>
                    <QrCode color={selected ? palette.brand : palette.mutedStrong} size={20} />
                  </View>
                  <View style={styles.jobCopy}>
                    <Text numberOfLines={1} style={[styles.jobTitle, { color: palette.ink }]}>
                      {displayReference(job) ?? "LPG fulfilment job"}
                    </Text>
                    <Text style={[styles.jobMeta, { color: palette.muted }]}>{scanStatus(status)}</Text>
                  </View>
                  {selected ? <CheckCircle2 color={palette.brand} size={21} /> : <StatusPill label="Select" tone="neutral" />}
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : actionable.length === 1 ? (
        <View style={[styles.singleJob, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
          <CheckCircle2 color={palette.success} size={20} />
          <View style={styles.singleJobCopy}>
            <Text style={[styles.singleJobTitle, { color: palette.ink }]}>{displayReference(actionable[0]) ?? "LPG fulfilment job"}</Text>
            <Text style={[styles.singleJobMeta, { color: palette.muted }]}>{scanStatus(displayStatus(actionable[0]) ?? "active")}</Text>
          </View>
          <StatusPill label="Selected" tone="success" />
        </View>
      ) : (
        <EmptyState
          icon={<ScanLine color={palette.brand} size={27} />}
          title="Nothing to scan yet"
          description={
            isStation
              ? "A cylinder becomes available here when its fulfilment record reaches a station scan stage."
              : "An assigned job becomes available here when its current lifecycle stage requires a cylinder scan."
          }
        />
      )}

      {jobId ? (
        <View style={[styles.scannerCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.scannerHead}>
            <View style={[styles.scannerIcon, { backgroundColor: palette.brandSoft }]}><ScanLine color={palette.brand} size={22} /></View>
            <View style={styles.scannerCopy}>
              <Text style={[styles.scannerTitle, { color: palette.ink }]}>Align the SKIMA code inside the scanner</Text>
              <Text style={[styles.scannerBody, { color: palette.muted }]}>The scan is matched to the selected job before any operational action can continue.</Text>
            </View>
          </View>
          <Scanner enabled onDetected={detected} />
        </View>
      ) : null}

      <View style={[styles.security, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <ShieldCheck color={palette.mutedStrong} size={18} />
        <Text style={[styles.securityText, { color: palette.muted }]}>Unknown, reused or mismatched cylinder identities must not silently change the selected job. SKIMA verification remains the authority for the next workflow step.</Text>
      </View>
    </Screen>
  );
}

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
    : ["pickup_verified", "station_en_route", "refill_confirmed", "station_settled"].some((value) => status.includes(value));
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

const styles = StyleSheet.create({
  hero: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, gap: 4 },
  heroEyebrow: { color: "rgba(255,255,255,.74)", ...typography.eyebrow, fontSize: 9 },
  heroTitle: { color: "#FFFFFF", ...typography.heading, fontSize: 20 },
  heroBody: { color: "rgba(255,255,255,.84)", ...typography.caption, lineHeight: 18 },
  jobsSection: { gap: spacing.sm },
  sectionLabel: { ...typography.eyebrow, fontSize: 9 },
  jobs: { gap: spacing.sm },
  job: { minHeight: 74, flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  jobIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  jobCopy: { flex: 1, minWidth: 0, gap: 3 },
  jobTitle: { ...typography.bodyStrong, fontSize: 14 },
  jobMeta: { ...typography.caption },
  singleJob: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  singleJobCopy: { flex: 1, minWidth: 0 },
  singleJobTitle: { ...typography.bodyStrong, fontSize: 14 },
  singleJobMeta: { ...typography.caption, marginTop: 3 },
  scannerCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.md },
  scannerHead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  scannerIcon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  scannerCopy: { flex: 1, gap: 3 },
  scannerTitle: { ...typography.subheading, fontSize: 15 },
  scannerBody: { ...typography.caption, lineHeight: 18 },
  security: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  securityText: { flex: 1, ...typography.caption, lineHeight: 18 },
});