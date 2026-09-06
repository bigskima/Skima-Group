import type { UseQueryResult } from "@tanstack/react-query";
import { router } from "expo-router";
import { CheckCircle2, QrCode, ScanLine, ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import {
  displayReference,
  displayStatus,
  firstString,
  recordId,
  type PlatformRecord,
} from "../api/records";
import { Scanner } from "../device/Scanner";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { StatusPill } from "./StatusPill";

export function ScanWorkspaceScreen({
  jobs,
  workspace = "driver",
}: {
  jobs: UseQueryResult<PlatformRecord[], Error>;
  workspace?: "driver" | "station";
}) {
  const { palette } = useAppTheme();
  const session = useSession();
  const actionable = (jobs.data ?? []).filter((job) => scanReady(displayStatus(job) ?? ""));
  const [selectedId, setSelectedId] = useState("");
  const [manualCylinderId, setManualCylinderId] = useState("");
  const [physicalTagReference, setPhysicalTagReference] = useState("");
  const [tagNotice, setTagNotice] = useState<string | null>(null);
  const [bindingTag, setBindingTag] = useState(false);
  const jobId = selectedId || (actionable.length === 1 ? (recordId(actionable[0]) ?? "") : "");
  const selectedJob = actionable.find((job) => recordId(job) === jobId) ?? (actionable.length === 1 ? actionable[0] : null);
  const cylinderId = firstString(selectedJob, ["cylinderId", "cylinder_id"]);
  const cylinderReference = firstString(selectedJob, ["cylinderReference", "cylinderIdentifier", "cylinder_reference", "cylinder_identifier"]);
  const cylinderTagStatus = firstString(selectedJob, ["cylinderTagStatus", "tagStatus", "cylinder_tag_status", "tag_status"]) ?? "unknown";
  const activeTagReference = firstString(selectedJob, ["activeTagReference", "active_tag_reference"]);
  const canBindFirstTag = Boolean(
    jobId && cylinderId && ["untagged", "tag_pending"].includes(cylinderTagStatus.toLowerCase()),
  );

  const detected = (value: string) => {
    if (!jobId) return;
    router.push(
      `/(${workspace})/job/${encodeURIComponent(jobId)}?scannedToken=${encodeURIComponent(value)}` as never,
    );
  };

  const useManualCylinderId = () => {
    const value = manualCylinderId.trim().toUpperCase();
    if (!jobId || !value) return;
    detected(value);
  };

  const bindFirstPhysicalTag = async () => {
    const reference = physicalTagReference.trim().toUpperCase();
    if (!jobId || !cylinderId || !reference || !canBindFirstTag || bindingTag) return;
    setBindingTag(true);
    setTagNotice(null);
    try {
      const { error } = await session.supabase.rpc("bind_lpg_cylinder_tag", {
        target_public_tag_reference: reference,
        target_cylinder_id: cylinderId,
        target_idempotency_key: idempotencyKey("driver-bind-first-cylinder-tag", `${jobId}:${reference}`),
        target_lpg_order_id: jobId,
        target_metadata: { source: "skima.lpg.mobile", operation: "first_service_tag_binding" },
      });
      if (error) throw error;
      setPhysicalTagReference("");
      setTagNotice(`Physical tag ${reference} is now bound to ${cylinderReference ?? "this cylinder"}. The permanent Cylinder ID did not change.`);
      await jobs.refetch();
    } catch (cause) {
      setTagNotice(friendlyError(cause, "SKIMA could not bind this physical tag. Confirm that the tag is unused and assigned to you."));
    } finally {
      setBindingTag(false);
    }
  };

  return (
    <Screen
      eyebrow="Cylinder scan"
      title="Verify SKIMA cylinder"
      subtitle="Choose the assigned job first. Scan the cylinder when possible, or use its permanent SKIMA Cylinder ID when the physical code cannot be read."
      action={<Pressable onPress={() => router.back()}><Text style={[styles.back, { color: palette.brand }]}>Back</Text></Pressable>}
    >
      <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
        <View style={styles.heroIcon}><ScanLine color="#FFFFFF" size={26} /></View>
        <View style={styles.heroCopy}>
          <Text style={styles.heroEyebrow}>CYLINDER HAND-OVER</Text>
          <Text style={styles.heroTitle}>
            {actionable.length
              ? `${actionable.length} ${actionable.length === 1 ? "job" : "jobs"} ready for cylinder verification`
              : "No job needs verification right now"}
          </Text>
          <Text style={styles.heroBody}>Scan or enter the Cylinder ID at pickup, station reception and final delivery.</Text>
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
              const tagStatus = firstString(job, ["cylinderTagStatus", "tagStatus", "tag_status"]);
              return (
                <Pressable
                  key={id}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setSelectedId(id);
                    setManualCylinderId("");
                    setPhysicalTagReference("");
                    setTagNotice(null);
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
                    <Text numberOfLines={1} style={[styles.jobTitle, { color: palette.ink }]}>{displayReference(job) ?? "LPG order"}</Text>
                    <Text style={[styles.jobMeta, { color: palette.muted }]}>{scanStatus(status)}</Text>
                    {tagStatus ? <Text style={[styles.jobMeta, { color: palette.muted }]}>Physical tag: {tagStatusLabel(tagStatus)}</Text> : null}
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
            <Text style={[styles.singleJobTitle, { color: palette.ink }]}>{displayReference(actionable[0]) ?? "LPG order"}</Text>
            <Text style={[styles.singleJobMeta, { color: palette.muted }]}>{scanStatus(displayStatus(actionable[0]) ?? "active")}</Text>
            <Text style={[styles.singleJobMeta, { color: palette.muted }]}>Physical tag: {tagStatusLabel(cylinderTagStatus)}</Text>
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

      {jobId && selectedJob ? (
        <View style={[styles.identityCard, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
          <View style={styles.identityHeader}>
            <ShieldCheck color={palette.brand} size={20} />
            <View style={styles.identityCopy}>
              <Text style={[styles.identityTitle, { color: palette.ink }]}>SKIMA Cylinder ID</Text>
              <Text style={[styles.identityBody, { color: palette.muted }]}>
                {cylinderReference ?? "SKIMA cylinder"} · {tagStatusLabel(cylinderTagStatus)}
              </Text>
            </View>
            <StatusPill
              label={activeTagReference ? "Tagged" : canBindFirstTag ? "Untagged" : tagStatusLabel(cylinderTagStatus)}
              tone={activeTagReference ? "success" : canBindFirstTag ? "warning" : "neutral"}
            />
          </View>

          {activeTagReference ? (
            <Text style={[styles.identityNote, { color: palette.muted }]}>Active physical tag: {activeTagReference}</Text>
          ) : canBindFirstTag ? (
            <>
              <Text style={[styles.identityNote, { color: palette.muted }]}>This customer does not need to print anything. At the verified first pickup, attach one unused SKIMA-issued physical tag and bind its reference here.</Text>
              <TextInput
                autoCapitalize="characters"
                autoCorrect={false}
                accessibilityLabel="SKIMA physical tag reference"
                onChangeText={setPhysicalTagReference}
                onSubmitEditing={() => void bindFirstPhysicalTag()}
                placeholder="SKTAG-..."
                placeholderTextColor={palette.muted}
                returnKeyType="go"
                style={[styles.manualInput, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]}
                value={physicalTagReference}
              />
              <AppButton
                label="Bind first physical tag"
                fullWidth
                variant="secondary"
                loading={bindingTag}
                disabled={!physicalTagReference.trim()}
                onPress={() => void bindFirstPhysicalTag()}
              />
            </>
          ) : null}

          {tagNotice ? <Text style={[styles.tagNotice, { color: palette.mutedStrong }]}>{tagNotice}</Text> : null}
        </View>
      ) : null}

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
            <Text style={[styles.fallbackBody, { color: palette.muted }]}>Enter the SKIMA Cylinder ID printed on the tag or shown in the order. SKIMA will confirm that it belongs to this job.</Text>
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
        <Text style={[styles.securityText, { color: palette.muted }]}>QR is the fastest option, but station staff can also enter the Cylinder ID. SKIMA will confirm the assigned job and driver before reception.</Text>
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

function tagStatusLabel(value: string) {
  const normalized = value.replace(/[-\s]+/g, "_").toLowerCase();
  const labels: Record<string, string> = {
    untagged: "Not physically tagged yet",
    tag_pending: "Tag pending",
    tagged: "Physical tag active",
    tag_damaged: "Tag damaged",
    tag_lost: "Tag lost",
    replacement_pending: "Replacement pending",
    retired: "Retired",
    unknown: "Tag status unavailable",
  };
  return labels[normalized] ?? normalized.replace(/_/g, " ");
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
  identityCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.md },
  identityHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  identityCopy: { flex: 1, gap: 2 },
  identityTitle: { ...typography.bodyStrong, fontSize: 14 },
  identityBody: { ...typography.caption, lineHeight: 18 },
  identityNote: { ...typography.caption, lineHeight: 18 },
  tagNotice: { ...typography.caption, lineHeight: 18, fontWeight: "700" },
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
