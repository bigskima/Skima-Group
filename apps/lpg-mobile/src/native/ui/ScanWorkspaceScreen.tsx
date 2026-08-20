import type { UseQueryResult } from "@tanstack/react-query";
import { router } from "expo-router";
import { CheckCircle2, QrCode, ScanLine, ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  displayReference,
  displayStatus,
  recordId,
  type PlatformRecord,
} from "../api/records";
import { Scanner } from "../device/Scanner";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

export function ScanWorkspaceScreen({
  jobs,
}: {
  jobs: UseQueryResult<PlatformRecord[], Error>;
}) {
  const { palette } = useAppTheme();
  const actionable = (jobs.data ?? []).filter((job) => scanReady(displayStatus(job) ?? ""));
  const [selectedId, setSelectedId] = useState("");
  const [manualCylinderId, setManualCylinderId] = useState("");
  const jobId = selectedId || (actionable.length === 1 ? (recordId(actionable[0]) ?? "") : "");

  const detected = (value: string) => {
    if (!jobId) return;
    router.push(
      `/(driver)/job/${encodeURIComponent(jobId)}?scannedToken=${encodeURIComponent(value)}` as never,
    );
  };

  const useManualCylinderId = () => {
    const value = manualCylinderId.trim().toUpperCase();
    if (!jobId || !value) return;
    detected(value);
  };

  return (
    <Screen
      eyebrow="Driver verification"
      title="Verify SKIMA cylinder"
      subtitle="Choose the assigned job first. Scan the cylinder when possible, or use its permanent SKIMA Cylinder ID when the physical code cannot be read."
      action={<Pressable onPress={() => router.back()}><Text style={[styles.back, { color: palette.brand }]}>Back</Text></Pressable>}
    >
      <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
        <View style={styles.heroIcon}><ScanLine color="#FFFFFF" size={26} /></View>
        <View style={styles.heroCopy}>
          <Text style={styles.heroEyebrow}>DRIVER HAND-OFF VERIFICATION</Text>
          <Text style={styles.heroTitle}>
            {actionable.length
              ? `${actionable.length} ${actionable.length === 1 ? "job" : "jobs"} ready for cylinder verification`
              : "No job needs verification right now"}
          </Text>
          <Text style={styles.heroBody}>SKIMA keeps the job, cylinder and verification method together at customer pickup, station reception and final customer hand-over.</Text>
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
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setSelectedId(id);
                    setManualCylinderId("");
                  }}
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
                  <View style={[styles.jobIcon, { backgroundColor: selected ? palette.brandSoft : palette.surfaceSubtle }]}>
                    <QrCode color={selected ? palette.brand : palette.mutedStrong} size={20} />
                  </View>
                  <View style={styles.jobCopy}>
                    <Text numberOfLines={1} style={[styles.jobTitle, { color: palette.ink }]}>{displayReference(job) ?? "LPG fulfilment job"}</Text>
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
          title="Nothing to verify yet"
          description="An assigned job appears here only when its current lifecycle stage requires the driver to verify the SKIMA cylinder."
        />
      )}

      {jobId ? (
        <View style={[styles.scannerCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.scannerHead}>
            <View style={[styles.scannerIcon, { backgroundColor: palette.brandSoft }]}><ScanLine color={palette.brand} size={22} /></View>
            <View style={styles.scannerCopy}>
              <Text style={[styles.scannerTitle, { color: palette.ink }]}>Scan the SKIMA cylinder code</Text>
              <Text style={[styles.scannerBody, { color: palette.muted }]}>After detection, SKIMA opens the selected job and validates the cylinder against its current hand-off stage.</Text>
            </View>
          </View>
          <Scanner enabled onDetected={detected} allowManualEntry={false} />

          <View style={[styles.fallbackDivider, { backgroundColor: palette.border }]} />
          <View style={styles.fallbackCopy}>
            <Text style={[styles.fallbackEyebrow, { color: palette.muted }]}>CAN'T SCAN?</Text>
            <Text style={[styles.fallbackTitle, { color: palette.ink }]}>Enter the permanent Cylinder ID</Text>
            <Text style={[styles.fallbackBody, { color: palette.muted }]}>Use the human-readable SKIMA reference printed on the tag or shown in the assigned job. SKIMA records this as a manual verification method; it does not bypass order or assignment checks.</Text>
          </View>
          <TextInput
            autoCapitalize="characters"
            autoCorrect={false}
            accessibilityLabel="SKIMA Cylinder ID"
            onChangeText={setManualCylinderId}
            onSubmitEditing={useManualCylinderId}
            placeholder="Example: CYL-00000001"
            placeholderTextColor={palette.muted}
            returnKeyType="go"
            style={[
              styles.manualInput,
              { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink },
            ]}
            value={manualCylinderId}
          />
          <AppButton
            label="Verify with Cylinder ID"
            fullWidth
            variant="secondary"
            disabled={!manualCylinderId.trim()}
            onPress={useManualCylinderId}
          />
        </View>
      ) : null}

      <View style={[styles.security, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <ShieldCheck color={palette.mutedStrong} size={18} />
        <Text style={[styles.securityText, { color: palette.muted }]}>QR is the fastest method, not the only method. Station staff do not need a separate cylinder scanner: reception verifies the assigned job and driver in the station workspace while SKIMA keeps the backend order state authoritative.</Text>
      </View>
    </Screen>
  );
}

function scanReady(status: string) {
  const value = status.toLowerCase().replace(/[\s-]+/g, "_");
  return [
    "driver_accepted",
    "pickup_pending",
    "pickup_arrived",
    "pickup_en_route",
    "pickup_verified",
    "station_en_route",
    "delivery_verification_pending",
    "return_en_route",
  ].includes(value);
}

function scanStatus(value: string) {
  const normalized = value.replace(/[-\s]+/g, "_").toLowerCase();
  const labels: Record<string, string> = {
    driver_accepted: "Ready to begin pickup",
    pickup_pending: "Pickup waiting",
    pickup_arrived: "At customer pickup",
    pickup_en_route: "Heading to customer",
    pickup_verified: "Verify again at station reception",
    station_en_route: "Heading to station",
    delivery_verification_pending: "Ready for final hand-over",
    return_en_route: "Returning to customer",
  };
  return labels[normalized] ?? "Ready to verify";
}

const styles = StyleSheet.create({
  back: { ...typography.caption, fontWeight: "900" },
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
  fallbackDivider: { height: StyleSheet.hairlineWidth, width: "100%" },
  fallbackCopy: { gap: 4 },
  fallbackEyebrow: { ...typography.eyebrow, fontSize: 9 },
  fallbackTitle: { ...typography.subheading, fontSize: 15 },
  fallbackBody: { ...typography.caption, lineHeight: 18 },
  manualInput: { minHeight: 50, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, ...typography.bodyStrong, fontSize: 15, letterSpacing: 0.4 },
  security: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  securityText: { flex: 1, ...typography.caption, lineHeight: 18 },
});