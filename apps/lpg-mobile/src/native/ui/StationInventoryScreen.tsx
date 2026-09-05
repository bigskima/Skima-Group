import { router } from "expo-router";
import {
  AlertTriangle,
  CheckCircle2,
  Database,
  Gauge,
  History,
  PackageCheck,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Warehouse,
} from "lucide-react-native";
import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useStationInventory } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  firstNumber,
  firstString,
  nestedRecord,
  nestedRecords,
  type PlatformRecord,
} from "../api/records";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AiContextAction } from "./AiContextAction";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { EvidenceCapture } from "./EvidenceCapture";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";

type Editor = "report" | "adjust" | "source" | "availability" | "fallback" | "capacity" | "provider" | "device" | "issue" | null;

export function StationInventoryScreen() {
  const { palette } = useAppTheme();
  const runtime = useStationInventory();
  const station = nestedRecord(runtime.data, "station");
  const inventory = nestedRecord(runtime.data, "inventory");
  const configuration = nestedRecord(runtime.data, "configuration");
  const actions = nestedRecord(runtime.data, "actions");
  const operationalCapacity = nestedRecord(runtime.data, "operationalCapacity");
  const limits = nestedRecord(runtime.data, "limits");
  const tanks = nestedRecords(runtime.data, "tanks");
  const history = nestedRecords(runtime.data, "history");
  const reservations = nestedRecords(runtime.data, "reservations");
  const measurementMethods = nestedRecords(runtime.data, "measurementMethods");
  const adjustmentTypes = nestedRecords(runtime.data, "adjustmentTypes");
  const sourceTypes = nestedRecords(runtime.data, "sourceTypes");
  const providers = nestedRecords(runtime.data, "providers");
  const connections = nestedRecords(runtime.data, "connections");
  const devices = nestedRecords(runtime.data, "devices");
  const alerts = nestedRecords(runtime.data, "alerts");
  const reconciliationCases = nestedRecords(runtime.data, "reconciliationCases");
  const stationBranchId = firstString(station, ["stationBranchId"]);
  const physical = firstNumber(inventory, ["physicalStockKg"]);
  const allocation = firstNumber(inventory, ["skimaAllocationKg"]);
  const reserved = firstNumber(inventory, ["reservedKg"]);
  const dispatchable = firstNumber(inventory, ["dispatchableKg"]);
  const installed = firstNumber(station, ["installedCapacityKg"]);
  const inventoryStatus = firstString(inventory, ["inventoryStatus"]) ?? "UNKNOWN";
  const rolloutStatus = firstString(inventory, ["rolloutStatus"]);
  const inventoryVersion = firstNumber(inventory, ["version"]);
  const configurationVersion = firstNumber(configuration, ["version"]);
  const needsSetup = physical === null || rolloutStatus === "setup_required" || rolloutStatus === "legacy_shadow";
  const [editor, setEditor] = useState<Editor>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageSuccess, setMessageSuccess] = useState(false);

  const confirm = useGatewayMutation({
    path: "/lpg/stations/inventory/confirm",
    schema: ActionResponseSchema,
    invalidate: [["station-inventory"], ["station-runtime"], ["stations"]],
  });

  const canConfirm = actions?.canConfirm === true && physical !== null;
  const canUpdate = actions?.canUpdate === true;
  const canAdjust = actions?.canAdjust === true && physical !== null;
  const canManageSources = actions?.canManageSources === true;
  const canManageProviders = actions?.canManageProviders === true;
  const canManageAvailability = actions?.canManageAvailability === true;
  const canManageCapacity = actions?.canManageOperationalCapacity === true;
  const canReportIssue = actions?.canReportIssue === true;
  const dispatchBlockReason = firstString(inventory, ["dispatchBlockReason"]);
  const primarySource = firstString(configuration, ["primarySource"]) ?? "manual";
  const manualFallbackUntil = firstString(configuration, ["manualFallbackUntil"]);
  const fallbackExpiry = manualFallbackUntil ? Date.parse(manualFallbackUntil) : Number.NaN;
  const manualFallbackActive = Number.isFinite(fallbackExpiry) && fallbackExpiry > Date.now();
  const manualEditingAvailable = primarySource === "manual" || manualFallbackActive;
  const canUpdateStock = canUpdate && manualEditingAvailable;
  const canAdjustStock = canAdjust && manualEditingAvailable;

  const confirmUnchanged = async () => {
    if (!stationBranchId) return;
    setMessage(null);
    try {
      await confirm.mutateAsync({
        stationBranchId,
        expectedVersion: inventoryVersion ?? undefined,
        idempotencyKey: idempotencyKey("inventory-confirm", stationBranchId),
      });
      setMessageSuccess(true);
      setMessage("Inventory confirmed. Your dispatch availability is up to date.");
    } catch (cause) {
      setMessageSuccess(false);
      setMessage(friendlyError(cause, "Inventory could not be confirmed."));
    }
  };

  return (
    <Screen
      eyebrow="Station operations"
      title="Inventory"
      subtitle="Physical LPG stock, SKIMA allocation, reservations and source health in one place."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {runtime.isPending && !runtime.data ? (
        <ScreenSkeleton cards={4} />
      ) : runtime.error && !runtime.data ? (
        <EmptyState
          icon={<Database color={palette.brand} size={26} />}
          title="Inventory could not be loaded"
          description="Check your connection and try again. A saved reading will be shown when available."
          action={<AppButton label="Retry" onPress={() => void runtime.refetch()} />}
        />
      ) : !station || !inventory ? (
        <EmptyState
          icon={<Warehouse color={palette.brand} size={26} />}
          title="Inventory setup is not available yet"
          description="Your station must be activated before inventory can be configured."
        />
      ) : (
        <>
          {runtime.error ? (
            <Notice tone="warning" text="Showing the last saved inventory while SKIMA reconnects." />
          ) : null}

          {dispatchBlockReason ? (
            <Notice
              tone="warning"
              text={`New dispatch is paused: ${friendlyLabel(dispatchBlockReason)}. Review the latest stock and reconciliation status before restoring it.`}
            />
          ) : null}

          {alerts.slice(0, 3).map((alert) => (
            <Notice
              key={firstString(alert, ["key"]) ?? firstString(alert, ["firstObservedAt"]) ?? "inventory-alert"}
              tone={firstString(alert, ["severity"]) === "critical" ? "danger" : "warning"}
              text={friendlyLabel(firstString(alert, ["key"]) ?? "Inventory needs attention")}
            />
          ))}

          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroTop}>
              <View style={styles.heroCopy}>
                <Text style={styles.heroEyebrow}>AVAILABLE FOR NEW SKIMA ORDERS</Text>
                <Text adjustsFontSizeToFit numberOfLines={1} style={styles.heroValue}>
                  {kg(dispatchable)}
                </Text>
                <Text style={styles.heroBody}>{firstString(station, ["displayName"]) ?? "Station inventory"}</Text>
              </View>
              <View style={styles.heroIcon}><Gauge color="#FFFFFF" size={27} /></View>
            </View>
            <View style={styles.heroFooter}>
              <StatusPill label={friendlyLabel(inventoryStatus)} tone={statusTone(inventoryStatus)} />
              <Text style={styles.heroFooterText}>
                {friendlyLabel(firstString(inventory, ["freshnessStatus"]) ?? "UNKNOWN")} · {friendlyLabel(firstString(inventory, ["sourceConfidence"]) ?? "UNTRUSTED")} confidence
              </Text>
            </View>
          </View>

          <AiContextAction
            workspace="station"
            label="Explain inventory status"
            prompt={`Explain my station inventory status using the live SKIMA station context. Current inventory status: ${inventoryStatus}. Dispatchable stock shown here: ${dispatchable === null ? "not reported" : String(dispatchable) + " kg"}. ${dispatchBlockReason ? "Dispatch pause shown here: " + friendlyLabel(dispatchBlockReason) + "." : ""} Tell me what needs attention, including source freshness or demand outlook if available. Do not change stock, availability, capacity, provider settings or dispatch.`}
          />

          {needsSetup ? (
            <View style={[styles.attention, { backgroundColor: palette.warningSoft, borderColor: palette.warning }]}>
              <AlertTriangle color={palette.warning} size={22} />
              <View style={styles.flexCopy}>
                <Text style={[styles.cardTitle, { color: palette.ink }]}>Confirm real LPG stock</Text>
                <Text style={[styles.body, { color: palette.muted }]}>Installed tank capacity is not live stock. Enter the quantity physically at this station before new orders can be assigned.</Text>
              </View>
              {canUpdateStock ? <AppButton label="Set up" size="sm" onPress={() => setEditor("report")} /> : null}
            </View>
          ) : null}

          {!manualEditingAvailable && (canUpdate || canAdjust) ? (
            <Notice
              tone="warning"
              text="This station is managed by a connected inventory provider. Activate Manual fallback before reporting or adjusting stock; the provider connection will remain preserved."
            />
          ) : null}

          <View style={styles.metricGrid}>
            <Metric label="Physical stock" value={kg(physical)} />
            <Metric label="Allocated to SKIMA" value={kg(allocation)} />
            <Metric label="Reserved" value={kg(reserved)} />
            <Metric label="Installed capacity" value={kg(installed)} />
          </View>

          <View style={[styles.sourceCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.rowBetween}>
              <View style={styles.iconTitle}>
                <View style={[styles.smallIcon, { backgroundColor: palette.brandSoft }]}><Database color={palette.brand} size={19} /></View>
                <View style={styles.flexCopy}>
                  <Text style={[styles.cardTitle, { color: palette.ink }]}>Inventory source</Text>
                  <Text style={[styles.body, { color: palette.muted }]}>{friendlyLabel(firstString(inventory, ["activeSource"]) ?? firstString(configuration, ["primarySource"]) ?? "Not configured")}</Text>
                </View>
              </View>
              <StatusPill label={friendlyLabel(firstString(inventory, ["sourceHealth"]) ?? "Unknown")} tone={firstString(inventory, ["sourceHealth"]) === "healthy" ? "success" : "warning"} />
            </View>
            <Text style={[styles.caption, { color: palette.muted }]}>Last confirmed: {friendlyTime(firstString(inventory, ["lastVerifiedAt"]))}</Text>
          </View>

          <View style={styles.actionGrid}>
            {canConfirm ? <AppButton label="Confirm unchanged" variant="secondary" loading={confirm.isPending} onPress={() => void confirmUnchanged()} /> : null}
            {canUpdateStock ? <AppButton label={physical === null ? "Report opening stock" : "Update stock"} variant="secondary" onPress={() => setEditor("report")} /> : null}
            {canAdjustStock ? <AppButton label="Record adjustment" variant="secondary" onPress={() => setEditor("adjust")} /> : null}
            {canManageSources ? <AppButton label="Manage source" variant="secondary" onPress={() => setEditor("source")} /> : null}
            {canManageAvailability ? <AppButton label="Availability" variant="secondary" onPress={() => setEditor("availability")} /> : null}
            {canManageSources ? <AppButton label={manualFallbackActive ? "End fallback" : "Manual fallback"} variant="secondary" onPress={() => setEditor("fallback")} /> : null}
            {canManageCapacity ? <AppButton label="Processing capacity" variant="secondary" onPress={() => setEditor("capacity")} /> : null}
            {canManageProviders ? <AppButton label="Provider setup" variant="secondary" onPress={() => setEditor("provider")} /> : null}
            {canManageProviders && tanks.length > 0 && connections.length > 0 ? <AppButton label="Map device" variant="secondary" onPress={() => setEditor("device")} /> : null}
            {canReportIssue ? <AppButton label="Report stockout" variant="secondary" onPress={() => setEditor("issue")} /> : null}
          </View>

          {editor === "report" && stationBranchId ? (
            <StockReportEditor
              stationBranchId={stationBranchId}
              measurementMethods={measurementMethods}
              currentAllocation={allocation}
              expectedVersion={inventoryVersion}
              onClose={() => setEditor(null)}
              onResult={(text, success) => { setMessage(text); setMessageSuccess(success); setEditor(success ? null : "report"); }}
            />
          ) : null}
          {editor === "adjust" && stationBranchId ? (
            <AdjustmentEditor
              stationBranchId={stationBranchId}
              adjustmentTypes={adjustmentTypes}
              expectedVersion={inventoryVersion}
              onClose={() => setEditor(null)}
              onResult={(text, success) => { setMessage(text); setMessageSuccess(success); setEditor(success ? null : "adjust"); }}
            />
          ) : null}
          {editor === "source" && stationBranchId ? (
            <SourceEditor
              stationBranchId={stationBranchId}
              sourceTypes={sourceTypes}
              providers={providers}
              configuration={configuration}
              expectedVersion={configurationVersion}
              onClose={() => setEditor(null)}
              onResult={(text, success) => { setMessage(text); setMessageSuccess(success); setEditor(success ? null : "source"); }}
            />
          ) : null}
          {editor === "availability" && stationBranchId ? (
            <AvailabilityEditor
              stationBranchId={stationBranchId}
              expectedVersion={inventoryVersion}
              maximumPauseHours={firstNumber(limits, ["maximumAvailabilityPauseHours"]) ?? 168}
              onClose={() => setEditor(null)}
              onResult={(text, success) => { setMessage(text); setMessageSuccess(success); setEditor(success ? null : "availability"); }}
            />
          ) : null}
          {editor === "fallback" && stationBranchId ? (
            <FallbackEditor
              stationBranchId={stationBranchId}
              activeUntil={manualFallbackActive ? manualFallbackUntil : null}
              maximumHours={firstNumber(limits, ["manualFallbackMaximumHours"]) ?? 24}
              onClose={() => setEditor(null)}
              onResult={(text, success) => { setMessage(text); setMessageSuccess(success); setEditor(success ? null : "fallback"); }}
            />
          ) : null}
          {editor === "capacity" && stationBranchId ? (
            <CapacityEditor
              stationBranchId={stationBranchId}
              capacity={operationalCapacity}
              onClose={() => setEditor(null)}
              onResult={(text, success) => { setMessage(text); setMessageSuccess(success); setEditor(success ? null : "capacity"); }}
            />
          ) : null}
          {editor === "provider" && stationBranchId ? (
            <ProviderEditor
              stationBranchId={stationBranchId}
              providers={providers}
              connections={connections}
              onClose={() => setEditor(null)}
              onResult={(text, success) => { setMessage(text); setMessageSuccess(success); setEditor(success ? null : "provider"); }}
            />
          ) : null}
          {editor === "device" && stationBranchId ? (
            <DeviceEditor
              stationBranchId={stationBranchId}
              tanks={tanks}
              connections={connections}
              onClose={() => setEditor(null)}
              onResult={(text, success) => { setMessage(text); setMessageSuccess(success); setEditor(success ? null : "device"); }}
            />
          ) : null}
          {editor === "issue" && stationBranchId ? (
            <IssueEditor
              stationBranchId={stationBranchId}
              onClose={() => setEditor(null)}
              onResult={(text, success) => { setMessage(text); setMessageSuccess(success); setEditor(success ? null : "issue"); }}
            />
          ) : null}

          {message ? <Notice tone={messageSuccess ? "success" : "danger"} text={message} /> : null}

          {connections.length ? (
            <>
              <SectionHeader title="Connected sources" description="Provider status is monitored without exposing credentials in the app." />
              <View style={styles.list}>{connections.map((connection) => (
                <SimpleRow
                  key={firstString(connection, ["publicReference"]) ?? firstString(connection, ["displayName"]) ?? "provider"}
                  icon={<Database color={palette.brand} size={18} />}
                  title={firstString(connection, ["displayName", "providerName"]) ?? "Inventory provider"}
                  subtitle={`${friendlyLabel(firstString(connection, ["status"]) ?? "pending")} · ${friendlyLabel(firstString(connection, ["healthStatus"]) ?? "unknown")} · last sync ${friendlyTime(firstString(connection, ["lastSuccessfulSyncAt"]))}`}
                />
              ))}</View>
            </>
          ) : null}

          {devices.length ? (
            <>
              <SectionHeader title="Telemetry devices" description="Mapped tank sensors and their most recent health state." />
              <View style={styles.list}>{devices.map((device) => (
                <SimpleRow
                  key={firstString(device, ["publicReference"]) ?? firstString(device, ["displayName"]) ?? "device"}
                  icon={<Gauge color={palette.brand} size={18} />}
                  title={firstString(device, ["displayName"]) ?? "Tank device"}
                  subtitle={`${friendlyLabel(firstString(device, ["healthStatus"]) ?? "unknown")} · last reading ${friendlyTime(firstString(device, ["lastReadingAt"]))}`}
                />
              ))}</View>
            </>
          ) : null}

          <SectionHeader title="Tanks" description="Installed storage is infrastructure and never treated as current stock." />
          <View style={styles.list}>
            {tanks.length ? tanks.map((tank) => (
              <View key={firstString(tank, ["publicReference", "tankId"]) ?? firstString(tank, ["name"]) ?? "tank"} style={[styles.listCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={[styles.smallIcon, { backgroundColor: palette.brandSoft }]}><Warehouse color={palette.brand} size={19} /></View>
                <View style={styles.flexCopy}>
                  <Text style={[styles.cardTitle, { color: palette.ink }]}>{firstString(tank, ["name"]) ?? "LPG tank"}</Text>
                  <Text style={[styles.body, { color: palette.muted }]}>{kg(firstNumber(tank, ["physicalStockKg"]))} current · {kg(firstNumber(tank, ["ratedCapacityKg"]))} rated</Text>
                </View>
                <StatusPill label={friendlyLabel(firstString(tank, ["status"]) ?? "Unknown")} tone={firstString(tank, ["status"]) === "active" ? "success" : "warning"} />
              </View>
            )) : <EmptyState icon={<Warehouse color={palette.brand} size={24} />} title="No individual tanks configured" description="The station's existing installed capacity remains visible until tank details are added." />}
          </View>

          <SectionHeader title="Operational capacity" description="Stock and the station's ability to process refill jobs are evaluated together." />
          <View style={styles.metricGrid}>
            <Metric label="Active jobs" value={String(firstNumber(operationalCapacity, ["activeJobs"]) ?? 0)} />
            <Metric label="Concurrent limit" value={String(firstNumber(operationalCapacity, ["maximumConcurrentJobs"]) ?? 0)} />
          </View>

          {reservations.length ? (
            <>
              <SectionHeader title="Reserved stock" description="Kilograms held for active SKIMA orders." />
              <View style={styles.list}>{reservations.slice(0, 5).map((reservation) => (
                <SimpleRow
                  key={firstString(reservation, ["publicReference"]) ?? "reservation"}
                  icon={<PackageCheck color={palette.brand} size={18} />}
                  title={firstString(reservation, ["orderReference"]) ?? "SKIMA order"}
                  subtitle={`${kg(firstNumber(reservation, ["reservedKg"]))} · ${friendlyLabel(firstString(reservation, ["status"]) ?? "reserved")}`}
                />
              ))}</View>
            </>
          ) : null}

          {reconciliationCases.length ? (
            <>
              <SectionHeader title="Reconciliation needed" description="Conflicting evidence must be reviewed before normal inventory authority is restored." />
              <View style={styles.list}>{reconciliationCases.slice(0, 5).map((item) => (
                <SimpleRow
                  key={firstString(item, ["publicReference"]) ?? firstString(item, ["createdAt"]) ?? "reconciliation"}
                  icon={<AlertTriangle color={palette.warning} size={18} />}
                  title={firstString(item, ["summary"]) ?? friendlyLabel(firstString(item, ["caseType"]) ?? "Inventory discrepancy")}
                  subtitle={`${friendlyLabel(firstString(item, ["severity"]) ?? "medium")} · ${friendlyLabel(firstString(item, ["status"]) ?? "open")}`}
                />
              ))}</View>
            </>
          ) : null}

          {history.length ? (
            <>
              <SectionHeader title="Recent history" description="An auditable record of stock reports, adjustments and reservations." />
              <View style={styles.list}>{history.slice(0, 8).map((event) => (
                <SimpleRow
                  key={firstString(event, ["publicReference"]) ?? firstString(event, ["occurredAt"]) ?? "event"}
                  icon={<History color={palette.brand} size={18} />}
                  title={friendlyLabel(firstString(event, ["eventType"]) ?? "Inventory event")}
                  subtitle={`${signedKg(firstNumber(event, ["stockDeltaKg"]))} · ${friendlyTime(firstString(event, ["occurredAt"]))}`}
                />
              ))}</View>
            </>
          ) : null}

          {!canUpdate && !canAdjust && !canManageSources && !canManageAvailability && !canManageCapacity && !canManageProviders && !canReportIssue ? (
            <View style={[styles.readOnly, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
              <ShieldCheck color={palette.mutedStrong} size={18} />
              <Text style={[styles.body, styles.flexCopy, { color: palette.muted }]}>Your role can view operational availability. Inventory configuration and stock changes require an authorised station role.</Text>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function StockReportEditor({ stationBranchId, measurementMethods, currentAllocation, expectedVersion, onClose, onResult }: {
  stationBranchId: string; measurementMethods: PlatformRecord[]; currentAllocation: number | null;
  expectedVersion: number | null;
  onClose: () => void; onResult: (message: string, success: boolean) => void;
}) {
  const { palette } = useAppTheme();
  const [snapshotVersion] = useState(expectedVersion);
  const [physical, setPhysical] = useState("");
  const [allocation, setAllocation] = useState(currentAllocation === null ? "" : String(currentAllocation));
  const [method, setMethod] = useState(firstString(measurementMethods[0], ["key"]) ?? "operator_estimate");
  const [note, setNote] = useState("");
  const [evidenceAssetIds, setEvidenceAssetIds] = useState<string[]>([]);
  const selectedMethod = measurementMethods.find((item) => firstString(item, ["key"]) === method);
  const evidenceRequired = selectedMethod?.requiresEvidence === true;
  const mutation = useGatewayMutation({ path: "/lpg/stations/inventory/report", schema: ActionResponseSchema, invalidate: [["station-inventory"], ["station-runtime"], ["stations"]] });
  const submit = async () => {
    const physicalKg = Number(physical); const allocationKg = Number(allocation);
    if (!Number.isFinite(physicalKg) || physicalKg < 0 || !Number.isFinite(allocationKg) || allocationKg < 0) return onResult("Enter valid stock and allocation quantities.", false);
    if (evidenceRequired && evidenceAssetIds.length === 0) return onResult("Add the required measurement evidence before saving inventory.", false);
    try {
      await mutation.mutateAsync({ stationBranchId, physicalStockKg: physicalKg, skimaAllocationKg: allocationKg, measurementMethod: method, note: note.trim() || undefined, evidenceAssetIds, expectedVersion: snapshotVersion ?? undefined, idempotencyKey: idempotencyKey("inventory-report", stationBranchId) });
      onResult("Physical stock and SKIMA allocation were saved.", true);
    } catch (cause) { onResult(friendlyError(cause, "Inventory could not be updated."), false); }
  };
  return <EditorCard title="Report physical stock" icon={<Gauge color={palette.brand} size={20} />} onClose={onClose}>
    <Field label="Current physical LPG stock (kg)" value={physical} onChangeText={setPhysical} />
    <Field label="Amount available to SKIMA (kg)" value={allocation} onChangeText={setAllocation} />
    <ChoiceList label="How was this measured?" records={measurementMethods} selected={method} onSelect={setMethod} />
    <EvidenceCapture
      assetTypeKey="media.lpg.inventory_evidence"
      label={evidenceRequired ? "Add measurement evidence (required)" : "Add measurement evidence (optional)"}
      draftType={`station-inventory-report-${stationBranchId}`}
      onUploaded={async (assetId) => {
        setEvidenceAssetIds((current) => current.includes(assetId) ? current : [...current, assetId]);
      }}
    />
    {evidenceAssetIds.length > 0 ? <Text style={[styles.caption, { color: palette.success }]}>Evidence added and ready to save.</Text> : null}
    <Field label="Optional note" value={note} onChangeText={setNote} keyboardType="default" />
    <AppButton label="Save inventory" fullWidth disabled={evidenceRequired && evidenceAssetIds.length === 0} loading={mutation.isPending} onPress={() => void submit()} />
  </EditorCard>;
}

function AdjustmentEditor({ stationBranchId, adjustmentTypes, expectedVersion, onClose, onResult }: {
  stationBranchId: string; adjustmentTypes: PlatformRecord[]; expectedVersion: number | null; onClose: () => void; onResult: (message: string, success: boolean) => void;
}) {
  const { palette } = useAppTheme();
  const [snapshotVersion] = useState(expectedVersion);
  const selectable = useMemo(() => adjustmentTypes.filter((item) => firstString(item, ["direction"]) !== "neutral"), [adjustmentTypes]);
  const [type, setType] = useState(firstString(selectable[0], ["key"]) ?? "supplier_delivery");
  const [quantity, setQuantity] = useState(""); const [note, setNote] = useState("");
  const [evidenceAssetIds, setEvidenceAssetIds] = useState<string[]>([]);
  const selectedType = selectable.find((item) => firstString(item, ["key"]) === type);
  const evidenceRecommended = selectedType?.evidenceRecommended === true;
  const mutation = useGatewayMutation({ path: "/lpg/stations/inventory/adjustments", schema: ActionResponseSchema, invalidate: [["station-inventory"], ["station-runtime"], ["stations"]] });
  const submit = async () => {
    const value = Number(quantity); const selected = selectable.find((item) => firstString(item, ["key"]) === type); const direction = firstString(selected, ["direction"]);
    if (!Number.isFinite(value) || value <= 0) return onResult("Enter a quantity greater than zero.", false);
    const signed = direction === "decrease" ? -value : value;
    try {
      await mutation.mutateAsync({ stationBranchId, adjustmentKg: signed, adjustmentType: type, note: note.trim() || undefined, evidenceAssetIds, expectedVersion: snapshotVersion ?? undefined, idempotencyKey: idempotencyKey("inventory-adjustment", stationBranchId) });
      onResult("Inventory adjustment was recorded.", true);
    } catch (cause) { onResult(friendlyError(cause, "Inventory adjustment could not be recorded."), false); }
  };
  return <EditorCard title="Record stock adjustment" icon={<RefreshCw color={palette.brand} size={20} />} onClose={onClose}>
    <ChoiceList label="Adjustment type" records={selectable} selected={type} onSelect={setType} />
    <Field label="Quantity (kg)" value={quantity} onChangeText={setQuantity} />
    <EvidenceCapture
      assetTypeKey="media.lpg.inventory_evidence"
      label={evidenceRecommended ? "Add adjustment evidence (recommended)" : "Add adjustment evidence (optional)"}
      draftType={`station-inventory-adjustment-${stationBranchId}`}
      onUploaded={async (assetId) => {
        setEvidenceAssetIds((current) => current.includes(assetId) ? current : [...current, assetId]);
      }}
    />
    {evidenceAssetIds.length > 0 ? <Text style={[styles.caption, { color: palette.success }]}>Evidence added and ready to save.</Text> : null}
    <Field label="Note" value={note} onChangeText={setNote} keyboardType="default" />
    <AppButton label="Record adjustment" fullWidth loading={mutation.isPending} onPress={() => void submit()} />
  </EditorCard>;
}

function SourceEditor({ stationBranchId, sourceTypes, providers, configuration, expectedVersion, onClose, onResult }: {
  stationBranchId: string; sourceTypes: PlatformRecord[]; providers: PlatformRecord[]; configuration: PlatformRecord | null;
  expectedVersion: number | null;
  onClose: () => void; onResult: (message: string, success: boolean) => void;
}) {
  const { palette } = useAppTheme();
  const [snapshotVersion] = useState(expectedVersion);
  const current = firstString(configuration, ["primarySource"]) ?? "manual";
  const [source, setSource] = useState(current);
  const availableSources = useMemo(
    () => sourceTypes.filter((item) => {
      const key = firstString(item, ["key"]);
      return key === "manual" || key === current || providers.some((provider) => firstString(provider, ["providerType"]) === key);
    }),
    [current, providers, sourceTypes],
  );
  const providerCount = providers.filter((provider) => firstString(provider, ["providerType"]) === source).length;
  const providerUnavailable = source !== "manual" && providerCount === 0;
  const mutation = useGatewayMutation({ path: "/lpg/stations/inventory/configuration", schema: ActionResponseSchema, invalidate: [["station-inventory"]] });
  const submit = async () => {
    if (providerUnavailable) {
      onResult(`No ${friendlyLabel(source)} provider is currently available for this station.`, false);
      return;
    }
    try {
      await mutation.mutateAsync({ stationBranchId, trackingMode: source, primarySource: source, expectedVersion: snapshotVersion ?? undefined, idempotencyKey: idempotencyKey("inventory-source", stationBranchId) });
      onResult(source === "manual" ? "Manual inventory tracking is active." : "Inventory source saved. Connect a supported provider before automatic stock can become active.", true);
    } catch (cause) { onResult(friendlyError(cause, "Inventory source could not be saved."), false); }
  };
  return <EditorCard title="Inventory source" icon={<Settings2 color={palette.brand} size={20} />} onClose={onClose}>
    <Text style={[styles.body, { color: palette.muted }]}>Choose how SKIMA should receive this station's LPG availability. Manual tracking always remains available.</Text>
    <ChoiceList label="Tracking method" records={availableSources} selected={source} onSelect={setSource} />
    {source !== "manual" ? <Text style={[styles.caption, { color: providerUnavailable ? palette.danger : palette.muted }]}>{providerUnavailable ? `No ${friendlyLabel(source)} provider is currently available.` : `${providerCount} supported ${friendlyLabel(source)} provider(s) are currently enabled.`}</Text> : null}
    <AppButton label="Save source" fullWidth disabled={providerUnavailable} loading={mutation.isPending} onPress={() => void submit()} />
  </EditorCard>;
}

function AvailabilityEditor({ stationBranchId, expectedVersion, maximumPauseHours, onClose, onResult }: {
  stationBranchId: string; expectedVersion: number | null; maximumPauseHours: number; onClose: () => void;
  onResult: (message: string, success: boolean) => void;
}) {
  const { palette } = useAppTheme();
  const [snapshotVersion] = useState(expectedVersion);
  const choices: PlatformRecord[] = [
    { key: "temporarily_unavailable", name: "Pause temporarily" },
    { key: "out_of_stock", name: "Mark out of stock" },
    { key: "restore", name: "Restore verified stock" },
  ];
  const [action, setAction] = useState("temporarily_unavailable");
  const [durationHours, setDurationHours] = useState("2");
  const [reason, setReason] = useState("");
  const mutation = useGatewayMutation({ path: "/lpg/stations/inventory/availability", schema: ActionResponseSchema, invalidate: [["station-inventory"], ["station-runtime"], ["stations"]] });
  const submit = async () => {
    const hours = Number(durationHours);
    if (action === "temporarily_unavailable" && (!Number.isFinite(hours) || hours <= 0 || hours > maximumPauseHours)) return onResult(`Choose a pause between 1 and ${maximumPauseHours} hours.`, false);
    if (action !== "restore" && reason.trim().length < 5) return onResult("Add a short reason for this availability change.", false);
    try {
      await mutation.mutateAsync({
        action,
        expectedVersion: snapshotVersion ?? undefined,
        idempotencyKey: idempotencyKey(`inventory-availability-${action}`, stationBranchId),
        reason: reason.trim() || "Verified inventory is ready for dispatch again.",
        stationBranchId,
        until: action === "temporarily_unavailable" ? new Date(Date.now() + hours * 3_600_000).toISOString() : undefined,
      });
      onResult(action === "restore" ? "Verified inventory availability was restored." : "Inventory dispatch availability was updated.", true);
    } catch (cause) { onResult(friendlyError(cause, "Inventory availability could not be changed."), false); }
  };
  return <EditorCard title="Dispatch availability" icon={<ShieldCheck color={palette.brand} size={20} />} onClose={onClose}>
    <Text style={[styles.body, { color: palette.muted }]}>This pauses new assignments without rewriting the physical stock ledger.</Text>
    <ChoiceList label="Action" records={choices} selected={action} onSelect={setAction} />
    {action === "temporarily_unavailable" ? <Field label="Pause duration (hours)" value={durationHours} onChangeText={setDurationHours} /> : null}
    {action !== "restore" ? <Field label="Reason" value={reason} onChangeText={setReason} keyboardType="default" /> : null}
    <AppButton label="Apply availability" fullWidth loading={mutation.isPending} onPress={() => void submit()} />
  </EditorCard>;
}

function FallbackEditor({ stationBranchId, activeUntil, maximumHours, onClose, onResult }: {
  stationBranchId: string; activeUntil: string | null; maximumHours: number; onClose: () => void;
  onResult: (message: string, success: boolean) => void;
}) {
  const { palette } = useAppTheme();
  const [durationHours, setDurationHours] = useState("4");
  const [reason, setReason] = useState("");
  const start = useGatewayMutation({ path: "/lpg/stations/inventory/manual-fallback", schema: ActionResponseSchema, invalidate: [["station-inventory"]] });
  const end = useGatewayMutation({ path: "/lpg/stations/inventory/manual-fallback/end", schema: ActionResponseSchema, invalidate: [["station-inventory"]] });
  const submit = async () => {
    if (reason.trim().length < 5) return onResult("Add a short reason for the fallback change.", false);
    try {
      if (activeUntil) {
        await end.mutateAsync({ stationBranchId, reason: reason.trim(), idempotencyKey: idempotencyKey("inventory-fallback-end", stationBranchId) });
        onResult("Fallback ended. The recovered provider reading is waiting for reconciliation.", true);
      } else {
        const hours = Number(durationHours);
        if (!Number.isFinite(hours) || hours <= 0 || hours > maximumHours) return onResult(`Choose a fallback duration between 1 and ${maximumHours} hours.`, false);
        await start.mutateAsync({ stationBranchId, durationHours: hours, reason: reason.trim(), idempotencyKey: idempotencyKey("inventory-fallback", stationBranchId) });
        onResult("Temporary manual fallback is active.", true);
      }
    } catch (cause) { onResult(friendlyError(cause, "Manual fallback could not be changed."), false); }
  };
  return <EditorCard title={activeUntil ? "End manual fallback" : "Temporary manual fallback"} icon={<RefreshCw color={palette.brand} size={20} />} onClose={onClose}>
    <Text style={[styles.body, { color: palette.muted }]}>{activeUntil ? `Fallback is active until ${friendlyTime(activeUntil)}. A fresh provider reading is required before it can end.` : "Use manual reporting temporarily while an automatic provider is unavailable."}</Text>
    {!activeUntil ? <Field label="Duration (hours)" value={durationHours} onChangeText={setDurationHours} /> : null}
    <Field label="Reason" value={reason} onChangeText={setReason} keyboardType="default" />
    <AppButton label={activeUntil ? "End and reconcile" : "Start fallback"} fullWidth loading={start.isPending || end.isPending} onPress={() => void submit()} />
  </EditorCard>;
}

function CapacityEditor({ stationBranchId, capacity, onClose, onResult }: {
  stationBranchId: string; capacity: PlatformRecord | null; onClose: () => void;
  onResult: (message: string, success: boolean) => void;
}) {
  const { palette } = useAppTheme();
  const [snapshotVersion] = useState(() => firstNumber(capacity, ["version"]));
  const choices: PlatformRecord[] = [
    { key: "normal", name: "Normal" }, { key: "busy", name: "Busy" },
    { key: "congested", name: "Congested" }, { key: "paused", name: "Paused" },
  ];
  const [fillingPoints, setFillingPoints] = useState(String(firstNumber(capacity, ["fillingPoints"]) ?? 1));
  const [maximumJobs, setMaximumJobs] = useState(String(firstNumber(capacity, ["maximumConcurrentJobs"]) ?? 4));
  const [processingMinutes, setProcessingMinutes] = useState(String(firstNumber(capacity, ["estimatedProcessingMinutes"]) ?? ""));
  const [status, setStatus] = useState(firstString(capacity, ["congestionStatus"]) ?? "normal");
  const [reason, setReason] = useState("");
  const mutation = useGatewayMutation({ path: "/lpg/stations/inventory/operational-capacity", schema: ActionResponseSchema, invalidate: [["station-inventory"], ["station-runtime"]] });
  const submit = async () => {
    const points = Number(fillingPoints); const jobs = Number(maximumJobs); const minutes = processingMinutes ? Number(processingMinutes) : undefined;
    if (!Number.isInteger(points) || points <= 0 || !Number.isInteger(jobs) || jobs <= 0 || (minutes !== undefined && (!Number.isFinite(minutes) || minutes < 0))) return onResult("Enter valid processing capacity values.", false);
    if (status === "paused" && reason.trim().length < 5) return onResult("Add a reason before pausing refill processing.", false);
    try {
      await mutation.mutateAsync({ stationBranchId, fillingPoints: points, maximumConcurrentJobs: jobs, estimatedProcessingMinutes: minutes, congestionStatus: status, pauseReason: status === "paused" ? reason.trim() : undefined, expectedVersion: snapshotVersion ?? undefined, idempotencyKey: idempotencyKey("inventory-capacity", stationBranchId) });
      onResult("Station processing capacity was saved.", true);
    } catch (cause) { onResult(friendlyError(cause, "Processing capacity could not be saved."), false); }
  };
  return <EditorCard title="Refill processing capacity" icon={<Gauge color={palette.brand} size={20} />} onClose={onClose}>
    <Field label="Filling points" value={fillingPoints} onChangeText={setFillingPoints} />
    <Field label="Maximum jobs at once" value={maximumJobs} onChangeText={setMaximumJobs} />
    <Field label="Typical processing time (minutes)" value={processingMinutes} onChangeText={setProcessingMinutes} />
    <ChoiceList label="Current workload" records={choices} selected={status} onSelect={setStatus} />
    {status === "paused" ? <Field label="Pause reason" value={reason} onChangeText={setReason} keyboardType="default" /> : null}
    <AppButton label="Save capacity" fullWidth loading={mutation.isPending} onPress={() => void submit()} />
  </EditorCard>;
}

function ProviderEditor({ stationBranchId, providers, connections, onClose, onResult }: {
  stationBranchId: string; providers: PlatformRecord[]; connections: PlatformRecord[]; onClose: () => void;
  onResult: (message: string, success: boolean) => void;
}) {
  const { palette } = useAppTheme();
  const providerChoices = useMemo(() => providers.map((provider) => ({ key: firstString(provider, ["providerKey"]) ?? "", name: firstString(provider, ["providerName"]) ?? "Inventory provider" })).filter((provider) => provider.key), [providers]);
  const connectionChoices = useMemo(() => connections.map((connection) => ({ key: firstString(connection, ["publicReference"]) ?? "", name: firstString(connection, ["displayName", "providerName"]) ?? "Provider connection" })).filter((connection) => connection.key), [connections]);
  const [providerKey, setProviderKey] = useState(firstString(providerChoices[0], ["key"]) ?? "");
  const [displayName, setDisplayName] = useState("");
  const [connectionReference, setConnectionReference] = useState(firstString(connectionChoices[0], ["key"]) ?? "");
  const [reason, setReason] = useState("");
  const connect = useGatewayMutation({ path: "/lpg/stations/inventory/provider-connections", schema: ActionResponseSchema, invalidate: [["station-inventory"]] });
  const disconnect = useGatewayMutation({ path: "/lpg/stations/inventory/provider-connections/disconnect", schema: ActionResponseSchema, invalidate: [["station-inventory"]] });
  const add = async () => {
    if (!providerKey || displayName.trim().length < 2) return onResult("Choose a provider and give the connection a clear name.", false);
    try {
      await connect.mutateAsync({ stationBranchId, providerKey, displayName: displayName.trim(), idempotencyKey: idempotencyKey("inventory-provider", stationBranchId) });
      onResult("Provider setup was created. Credentials still need to be stored securely before it becomes active.", true);
    } catch (cause) { onResult(friendlyError(cause, "Provider setup could not be created."), false); }
  };
  const remove = async () => {
    if (!connectionReference || reason.trim().length < 5) return onResult("Choose a connection and explain why it is being disconnected.", false);
    try {
      await disconnect.mutateAsync({ connectionReference, reason: reason.trim(), idempotencyKey: idempotencyKey("inventory-provider-disconnect", connectionReference) });
      onResult("Provider connection was disconnected and its secret reference was removed.", true);
    } catch (cause) { onResult(friendlyError(cause, "Provider connection could not be disconnected."), false); }
  };
  return <EditorCard title="Inventory provider setup" icon={<Database color={palette.brand} size={20} />} onClose={onClose}>
    {providerChoices.length ? <><ChoiceList label="Provider" records={providerChoices} selected={providerKey} onSelect={setProviderKey} /><Field label="Connection name" value={displayName} onChangeText={setDisplayName} keyboardType="default" /><AppButton label="Create provider setup" fullWidth loading={connect.isPending} onPress={() => void add()} /></> : <Text style={[styles.body, { color: palette.muted }]}>No inventory provider is enabled in the platform catalog yet. Manual inventory remains available.</Text>}
    {connectionChoices.length ? <><ChoiceList label="Existing connection" records={connectionChoices} selected={connectionReference} onSelect={setConnectionReference} /><Field label="Disconnect reason" value={reason} onChangeText={setReason} keyboardType="default" /><AppButton label="Disconnect provider" variant="secondary" fullWidth loading={disconnect.isPending} onPress={() => void remove()} /></> : null}
  </EditorCard>;
}

function DeviceEditor({ stationBranchId, tanks, connections, onClose, onResult }: {
  stationBranchId: string; tanks: PlatformRecord[]; connections: PlatformRecord[]; onClose: () => void;
  onResult: (message: string, success: boolean) => void;
}) {
  const { palette } = useAppTheme();
  const tankChoices = useMemo(() => tanks.map((tank) => ({ key: firstString(tank, ["publicReference"]) ?? "", name: firstString(tank, ["name"]) ?? "LPG tank" })).filter((tank) => tank.key), [tanks]);
  const connectionChoices = useMemo(() => connections.filter((connection) => firstString(connection, ["sourceType"]) === "telemetry").map((connection) => ({ key: firstString(connection, ["publicReference"]) ?? "", name: firstString(connection, ["displayName", "providerName"]) ?? "Telemetry provider" })).filter((connection) => connection.key), [connections]);
  const measurementChoices: PlatformRecord[] = [{ key: "mass_kg", name: "Mass in kilograms" }, { key: "fill_percentage", name: "Fill percentage" }, { key: "volume_litres", name: "Volume in litres" }, { key: "multi_metric", name: "Multiple measurements" }];
  const [tankReference, setTankReference] = useState(firstString(tankChoices[0], ["key"]) ?? "");
  const [connectionReference, setConnectionReference] = useState(firstString(connectionChoices[0], ["key"]) ?? "");
  const [measurementKind, setMeasurementKind] = useState("mass_kg");
  const [displayName, setDisplayName] = useState("");
  const [providerDeviceReference, setProviderDeviceReference] = useState("");
  const mutation = useGatewayMutation({ path: "/lpg/stations/inventory/telemetry-devices", schema: ActionResponseSchema, invalidate: [["station-inventory"]] });
  const submit = async () => {
    if (!tankReference || !connectionReference || displayName.trim().length < 2 || !providerDeviceReference.trim()) return onResult("Choose the tank and telemetry connection, then enter the device name and provider device ID.", false);
    try {
      await mutation.mutateAsync({ stationBranchId, tankReference, connectionReference, displayName: displayName.trim(), providerDeviceReference: providerDeviceReference.trim(), measurementKind, idempotencyKey: idempotencyKey("inventory-device", tankReference) });
      onResult("Telemetry device was mapped to the selected tank.", true);
    } catch (cause) { onResult(friendlyError(cause, "Telemetry device could not be mapped."), false); }
  };
  return <EditorCard title="Map a tank device" icon={<Gauge color={palette.brand} size={20} />} onClose={onClose}>
    {!connectionChoices.length ? <Text style={[styles.body, { color: palette.muted }]}>Create an enabled telemetry provider connection before mapping a device.</Text> : <><ChoiceList label="Tank" records={tankChoices} selected={tankReference} onSelect={setTankReference} /><ChoiceList label="Telemetry connection" records={connectionChoices} selected={connectionReference} onSelect={setConnectionReference} /><ChoiceList label="Measurement" records={measurementChoices} selected={measurementKind} onSelect={setMeasurementKind} /><Field label="Device name" value={displayName} onChangeText={setDisplayName} keyboardType="default" /><Field label="Provider device ID" value={providerDeviceReference} onChangeText={setProviderDeviceReference} keyboardType="default" /><AppButton label="Map device" fullWidth loading={mutation.isPending} onPress={() => void submit()} /></>}
  </EditorCard>;
}

function IssueEditor({ stationBranchId, onClose, onResult }: {
  stationBranchId: string; onClose: () => void; onResult: (message: string, success: boolean) => void;
}) {
  const { palette } = useAppTheme();
  const [orderReference, setOrderReference] = useState("");
  const [reason, setReason] = useState("");
  const mutation = useGatewayMutation({ path: "/lpg/stations/inventory/issues/unexpected-stockout", schema: ActionResponseSchema, invalidate: [["station-inventory"], ["station-runtime"], ["stations"], ["jobs", "station"]] });
  const submit = async () => {
    if (reason.trim().length < 5) return onResult("Explain what prevented the refill from proceeding.", false);
    try {
      await mutation.mutateAsync({ stationBranchId, orderReference: orderReference.trim() || undefined, reason: reason.trim(), idempotencyKey: idempotencyKey("inventory-unexpected-stockout", stationBranchId) });
      onResult("Unexpected stockout was reported. Dispatch is paused for reconciliation.", true);
    } catch (cause) { onResult(friendlyError(cause, "Unexpected stockout could not be reported."), false); }
  };
  return <EditorCard title="Report unexpected stockout" icon={<AlertTriangle color={palette.warning} size={20} />} onClose={onClose}>
    <Text style={[styles.body, { color: palette.muted }]}>This does not erase recorded stock. It pauses dispatch and opens an investigation.</Text>
    <Field label="Order reference (optional)" value={orderReference} onChangeText={setOrderReference} keyboardType="default" />
    <Field label="What happened?" value={reason} onChangeText={setReason} keyboardType="default" />
    <AppButton label="Report and pause dispatch" fullWidth loading={mutation.isPending} onPress={() => void submit()} />
  </EditorCard>;
}

function EditorCard({ title, icon, onClose, children }: { title: string; icon: ReactNode; onClose: () => void; children: ReactNode }) {
  const { palette } = useAppTheme();
  return <View style={[styles.editor, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
    <View style={styles.rowBetween}><View style={styles.iconTitle}>{icon}<Text style={[styles.cardTitle, { color: palette.ink }]}>{title}</Text></View><AppButton label="Close" variant="ghost" size="sm" onPress={onClose} /></View>
    {children}
  </View>;
}

function Field({ label, value, onChangeText, keyboardType = "decimal-pad" }: { label: string; value: string; onChangeText: (value: string) => void; keyboardType?: "decimal-pad" | "default" }) {
  const { palette } = useAppTheme();
  return <View style={styles.fieldGroup}><Text style={[styles.fieldLabel, { color: palette.ink }]}>{label}</Text><TextInput accessibilityLabel={label} style={[styles.input, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink }]} value={value} onChangeText={onChangeText} keyboardType={keyboardType} placeholderTextColor={palette.muted} /></View>;
}

function ChoiceList({ label, records, selected, onSelect }: { label: string; records: PlatformRecord[]; selected: string; onSelect: (key: string) => void }) {
  const { palette } = useAppTheme();
  return <View style={styles.fieldGroup}><Text style={[styles.fieldLabel, { color: palette.ink }]}>{label}</Text><View style={styles.choices}>{records.map((record) => { const key = firstString(record, ["key"]); if (!key) return null; const active = key === selected; return <Pressable accessibilityRole="radio" accessibilityState={{ checked: active }} key={key} onPress={() => onSelect(key)} style={[styles.choice, { backgroundColor: active ? palette.brandSoft : palette.surfaceSubtle, borderColor: active ? palette.brand : palette.border }]}><Text style={[styles.choiceText, { color: active ? palette.brand : palette.ink }]}>{firstString(record, ["name"]) ?? friendlyLabel(key)}</Text></Pressable>; })}</View></View>;
}

function Metric({ label, value }: { label: string; value: string }) { const { palette } = useAppTheme(); return <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}><Text style={[styles.caption, { color: palette.muted }]}>{label}</Text><Text style={[styles.metricValue, { color: palette.ink }]}>{value}</Text></View>; }
function SimpleRow({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) { const { palette } = useAppTheme(); return <View style={[styles.listCard, { backgroundColor: palette.surface, borderColor: palette.border }]}><View style={[styles.smallIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View><View style={styles.flexCopy}><Text style={[styles.cardTitle, { color: palette.ink }]}>{title}</Text><Text style={[styles.body, { color: palette.muted }]}>{subtitle}</Text></View></View>; }
function Notice({ tone, text }: { tone: "success" | "warning" | "danger"; text: string }) { const { palette } = useAppTheme(); const background = tone === "success" ? palette.successSoft : tone === "warning" ? palette.warningSoft : palette.dangerSoft; const color = tone === "success" ? palette.success : tone === "warning" ? palette.warning : palette.danger; return <View accessibilityRole="alert" accessibilityLiveRegion={tone === "danger" ? "assertive" : "polite"} style={[styles.notice, { backgroundColor: background }]}>{tone === "success" ? <CheckCircle2 color={color} size={18} /> : <AlertTriangle color={color} size={18} />}<Text style={[styles.noticeText, { color }]}>{text}</Text></View>; }
function kg(value: number | null) { return value === null ? "Not reported" : `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`; }
function signedKg(value: number | null) { if (value === null || value === 0) return "No stock change"; return `${value > 0 ? "+" : ""}${value.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg`; }
function friendlyLabel(value: string) { return value.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function friendlyTime(value: string | null) { if (!value) return "Not yet"; const date = new Date(value); return Number.isNaN(date.getTime()) ? "Not yet" : date.toLocaleString(); }
function statusTone(status: string): "success" | "warning" | "danger" | "brand" { if (status === "NORMAL") return "success"; if (status === "LOW" || status === "UNKNOWN") return "warning"; if (status === "CRITICAL" || status === "OUT_OF_STOCK" || status === "STALE") return "danger"; return "brand"; }

const styles = StyleSheet.create({
  flexCopy: { flex: 1 }, rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md }, iconTitle: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  hero: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl }, heroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md }, heroCopy: { flex: 1 }, heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 }, heroValue: { color: "#FFFFFF", fontSize: 35, lineHeight: 43, fontWeight: "900", letterSpacing: -1, marginTop: 4 }, heroBody: { color: "rgba(255,255,255,.84)", ...typography.caption }, heroIcon: { width: 50, height: 50, borderRadius: 17, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" }, heroFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm }, heroFooterText: { flex: 1, textAlign: "right", color: "rgba(255,255,255,.82)", ...typography.caption },
  attention: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md }, metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, metric: { width: "48%", flexGrow: 1, gap: 4, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md }, metricValue: { ...typography.subheading, fontSize: 18 },
  sourceCard: { gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md }, smallIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" }, cardTitle: { ...typography.bodyStrong, fontSize: 14 }, body: { ...typography.caption, lineHeight: 18 }, caption: { ...typography.caption }, actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  editor: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg }, fieldGroup: { gap: spacing.sm }, fieldLabel: { ...typography.caption, fontSize: 13, fontWeight: "900" }, input: { minHeight: 52, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, fontSize: 16 }, choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }, choice: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: spacing.md, paddingVertical: spacing.sm }, choiceText: { ...typography.caption, fontWeight: "800" },
  list: { gap: spacing.sm }, listCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md }, notice: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderRadius: radii.md }, noticeText: { flex: 1, ...typography.caption, fontWeight: "800", lineHeight: 18 }, readOnly: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
});
