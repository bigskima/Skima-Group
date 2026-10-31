import { CheckCircle2, ClipboardCheck, Fuel, ScanLine, ShieldAlert } from "lucide-react-native";
import { useMemo, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  type PlatformRecord,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { operationIdempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { StatusPill } from "./StatusPill";

type StationWorkRow = {
  id: string;
  reference: string;
  cylinderId: string;
  status: string;
  inspection: string;
  requestedKg: number | null;
  notes: string | null;
};

export function StationBatchOperationsPanel({
  jobs,
  onRefresh,
}: {
  jobs: PlatformRecord[];
  onRefresh(): Promise<unknown> | void;
}) {
  const { palette } = useAppTheme();
  const [actualKgByOrder, setActualKgByOrder] = useState<Record<string, string>>({});
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeSuccess, setNoticeSuccess] = useState(false);

  const inspection = useGatewayMutation({
    path: "/lpg/inspections",
    schema: ActionResponseSchema,
    invalidate: [["jobs"], ["inspections"], ["station-runtime"]],
  });
  const startRefill = useGatewayMutation({
    path: "/lpg/orders/actions",
    schema: ActionResponseSchema,
    invalidate: [["jobs"], ["orders"], ["station-runtime"]],
  });
  const confirmRefill = useGatewayMutation({
    path: "/lpg/refills/confirm",
    schema: ActionResponseSchema,
    invalidate: [["jobs"], ["orders"], ["station-runtime"], ["settlements"], ["wallets"]],
  });

  const rows = useMemo<StationWorkRow[]>(() => jobs.flatMap((job) => {
    const id = firstString(job, ["lpgOrderId", "lpg_order_id", "id"]);
    if (!id) return [];
    return [{
      id,
      reference: displayReference(job) ?? "LPG order",
      cylinderId: firstString(job, ["cylinderIdentifier", "cylinderReference", "cylinder_identifier", "cylinder_reference"]) ?? "Cylinder",
      status: (displayStatus(job) ?? "unknown").toLowerCase().replace(/[\\s-]+/g, "_"),
      inspection: (firstString(job, ["latestInspectionResult", "latest_inspection_result"]) ?? "").toLowerCase(),
      requestedKg: firstNumber(job, ["requestedKg", "requested_kg"]),
      notes: firstString(job, ["latestInspectionNotes", "latest_inspection_notes"]),
    }];
  }), [jobs]);

  const incomingCount = rows.filter((row) => row.status === "station_en_route").length;
  const inspectionRows = rows.filter((row) => row.status === "station_verified" && !row.inspection);
  const reviewRows = rows.filter((row) =>
    row.status === "station_verified" && ["manual_review", "unsafe", "rejected"].includes(row.inspection),
  );
  const refillRows = rows.filter((row) =>
    ["station_verified", "refill_in_progress"].includes(row.status)
      && row.inspection === "safe",
  );
  const releaseCount = rows.filter((row) => ["refill_confirmed", "station_settled"].includes(row.status)).length;
  const enteredRows = refillRows.filter((row) => {
    const value = Number(actualKgByOrder[row.id]);
    return Number.isFinite(value) && value > 0;
  });

  const saveInspection = async (row: StationWorkRow, result: "safe" | "manual_review") => {
    setBusyOrderId(row.id);
    setNotice(null);
    try {
      await inspection.mutateAsync({
        lpgOrderId: row.id,
        result,
        observations: {
          recordedBy: "station_operator",
          workflow: "station_quick_operations",
          notes: result === "safe" ? undefined : "Flagged for supervisor review from the station worklist.",
        },
        evidenceMediaAssetIds: [],
        source: "skima.lpg.mobile",
        idempotencyKey: operationIdempotencyKey("station-inspection", row.id),
      });
      setNoticeSuccess(result === "safe");
      setNotice(result === "safe"
        ? `${row.reference}: safety check saved. The refill is now ready to record.`
        : `${row.reference}: sent for supervisor review. Refill remains blocked.`);
      await onRefresh();
    } catch (cause) {
      setNoticeSuccess(false);
      setNotice(friendlyError(cause, `Could not save the safety check for ${row.reference}.`));
    } finally {
      setBusyOrderId(null);
    }
  };

  const submitBatchRefills = async () => {
    if (batchBusy || enteredRows.length === 0) return;
    setBatchBusy(true);
    setNotice(null);
    let confirmed = 0;
    const failures: string[] = [];

    for (const row of enteredRows) {
      const actualKg = Number(actualKgByOrder[row.id]);
      try {
        if (row.status === "station_verified") {
          await startRefill.mutateAsync({
            actionKey: "lpg.refill.start",
            lpgOrderId: row.id,
            source: "skima.lpg.mobile",
            idempotencyKey: operationIdempotencyKey("lpg.refill.start", row.id),
          });
        }
        await confirmRefill.mutateAsync({
          lpgOrderId: row.id,
          actualKg,
          safetyObservations: { result: "safe", workflow: "station_batch_refill" },
          source: "skima.lpg.mobile",
          idempotencyKey: operationIdempotencyKey("station-refill-confirm", row.id),
        });
        confirmed += 1;
        setActualKgByOrder((current) => {
          const next = { ...current };
          delete next[row.id];
          return next;
        });
      } catch (cause) {
        failures.push(`${row.reference}: ${friendlyError(cause, "refill confirmation failed")}`);
      }
    }

    setNoticeSuccess(confirmed > 0 && failures.length === 0);
    setNotice(failures.length
      ? `${confirmed} refill(s) confirmed. ${failures.length} need attention: ${failures.slice(0, 2).join(" · ")}`
      : `${confirmed} refill(s) confirmed. Each order was processed and settled independently.`);
    setBatchBusy(false);
    await onRefresh();
  };

  if (rows.length === 0) return null;

  return (
    <View style={[styles.card, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.header}>
        <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}>
          <ClipboardCheck color={palette.brand} size={20} />
        </View>
        <View style={styles.headerCopy}>
          <Text style={[styles.title, { color: palette.ink }]}>Quick station processing</Text>
          <Text style={[styles.body, { color: palette.muted }]}>Receive, inspect and confirm multiple orders from this screen.</Text>
        </View>
      </View>

      <View style={styles.metrics}>
        <View style={[styles.metric, { backgroundColor: palette.surfaceSubtle }]}>
          <Text style={[styles.metricValue, { color: palette.ink }]}>{incomingCount}</Text>
          <Text style={[styles.metricLabel, { color: palette.muted }]}>INCOMING</Text>
        </View>
        <View style={[styles.metric, { backgroundColor: palette.surfaceSubtle }]}>
          <Text style={[styles.metricValue, { color: palette.ink }]}>{inspectionRows.length}</Text>
          <Text style={[styles.metricLabel, { color: palette.muted }]}>SAFETY CHECKS</Text>
        </View>
        <View style={[styles.metric, { backgroundColor: palette.surfaceSubtle }]}>
          <Text style={[styles.metricValue, { color: palette.ink }]}>{refillRows.length}</Text>
          <Text style={[styles.metricLabel, { color: palette.muted }]}>READY TO FILL</Text>
        </View>
      </View>

      {incomingCount > 0 ? (
        <View style={[styles.stageHint, { backgroundColor: palette.brandSofter }]}>
          <ScanLine color={palette.brand} size={18} />
          <Text style={[styles.stageHintText, { color: palette.ink }]}>
            {incomingCount} incoming cylinder(s). Use the Scan tab and scan each cylinder once. SKIMA matches it to this station automatically.
          </Text>
        </View>
      ) : null}

      {inspectionRows.length > 0 ? (
        <View style={styles.section}>
          <Text style={[styles.sectionTitle, { color: palette.ink }]}>Safety checks · one per cylinder</Text>
          {inspectionRows.map((row) => (
            <View key={row.id} style={[styles.workRow, { borderColor: palette.border }]}>
              <View style={styles.rowCopy}>
                <Text style={[styles.rowTitle, { color: palette.ink }]}>{row.reference}</Text>
                <Text style={[styles.rowMeta, { color: palette.muted }]}>{row.cylinderId} · {row.requestedKg ?? "—"} kg requested</Text>
              </View>
              <AppButton
                label="Safe"
                size="sm"
                variant="primary"
                loading={busyOrderId === row.id}
                disabled={busyOrderId !== null || batchBusy}
                onPress={() => void saveInspection(row, "safe")}
              />
              <AppButton
                label="Review"
                size="sm"
                variant="secondary"
                loading={busyOrderId === row.id && inspection.isPending}
                disabled={busyOrderId !== null || batchBusy}
                onPress={() => void saveInspection(row, "manual_review")}
              />
            </View>
          ))}
        </View>
      ) : null}

      {reviewRows.length > 0 ? (
        <View style={[styles.stageHint, { backgroundColor: palette.warningSoft }]}>
          <ShieldAlert color={palette.warning} size={18} />
          <Text style={[styles.stageHintText, { color: palette.ink }]}>
            {reviewRows.length} cylinder(s) are held for review. Open those orders to resolve the inspection; they are excluded from refill confirmation.
          </Text>
        </View>
      ) : null}

      {refillRows.length > 0 ? (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={[styles.sectionTitle, { color: palette.ink }]}>Refill quantities</Text>
            <StatusPill label={`${enteredRows.length} entered`} tone={enteredRows.length ? "success" : "neutral"} />
          </View>
          {refillRows.map((row) => (
            <View key={row.id} style={[styles.refillRow, { borderColor: palette.border }]}>
              <View style={styles.rowCopy}>
                <Text style={[styles.rowTitle, { color: palette.ink }]}>{row.reference} · {row.cylinderId}</Text>
                <Text style={[styles.rowMeta, { color: palette.muted }]}>Requested {row.requestedKg ?? "—"} kg · inspected safe</Text>
              </View>
              <TextInput
                value={actualKgByOrder[row.id] ?? ""}
                onChangeText={(value) => setActualKgByOrder((current) => ({ ...current, [row.id]: value.replace(/[^0-9.]/g, "") }))}
                keyboardType="decimal-pad"
                accessibilityLabel={`Actual kilograms for ${row.reference}`}
                placeholder="Actual kg"
                placeholderTextColor={palette.muted}
                style={[styles.kgInput, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]}
              />
            </View>
          ))}
          <AppButton
            label={batchBusy ? "Confirming refills…" : `Confirm ${enteredRows.length} entered refill(s)`}
            fullWidth
            size="lg"
            loading={batchBusy}
            disabled={enteredRows.length === 0}
            onPress={() => void submitBatchRefills()}
            icon={<Fuel color="#FFFFFF" size={18} />}
          />
          <Text style={[styles.body, { color: palette.muted }]}>
            Each order is confirmed separately. One failed order does not block the other entered refills.
          </Text>
        </View>
      ) : null}

      {releaseCount > 0 ? (
        <View style={[styles.stageHint, { backgroundColor: palette.successSoft }]}>
          <CheckCircle2 color={palette.success} size={18} />
          <Text style={[styles.stageHintText, { color: palette.ink }]}>
            {releaseCount} refill(s) ready for release verification. Use the Scan tab and scan each cylinder once before handover.
          </Text>
        </View>
      ) : null}

      {notice ? (
        <View style={[styles.notice, { backgroundColor: noticeSuccess ? palette.successSoft : palette.dangerSoft }]}>
          <Text accessibilityRole="alert" style={[styles.noticeText, { color: noticeSuccess ? palette.success : palette.danger }]}>{notice}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.md, gap: spacing.md },
  header: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, gap: 3 },
  title: { ...typography.subheading, fontSize: 16 },
  body: { ...typography.caption, lineHeight: 17 },
  metrics: { flexDirection: "row", gap: spacing.sm },
  metric: { flex: 1, minHeight: 56, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  metricValue: { fontSize: 19, fontWeight: "900" },
  metricLabel: { ...typography.eyebrow, fontSize: 8, marginTop: 2 },
  stageHint: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderRadius: radii.md, padding: spacing.md },
  stageHintText: { flex: 1, ...typography.caption, lineHeight: 18, fontWeight: "700" },
  section: { gap: spacing.sm },
  sectionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { ...typography.bodyStrong, fontSize: 13 },
  workRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  refillRow: { gap: spacing.sm, paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth },
  rowCopy: { flex: 1, minWidth: 0, gap: 3 },
  rowTitle: { ...typography.bodyStrong, fontSize: 13 },
  rowMeta: { ...typography.caption, fontSize: 11 },
  kgInput: { minHeight: 46, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, ...typography.bodyStrong, fontSize: 15 },
  notice: { borderRadius: radii.md, padding: spacing.md },
  noticeText: { ...typography.caption, lineHeight: 18, fontWeight: "800" },
});
