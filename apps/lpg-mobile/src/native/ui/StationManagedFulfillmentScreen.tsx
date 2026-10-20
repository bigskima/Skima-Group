import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { router } from "expo-router";
import { useStationRuntime } from "../api/domains";
import { firstString, nestedRecord } from "../api/records";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { spacing, typography, radii } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";

type DeliveryPricingMode = "separate" | "included" | "free";
type CompensationMode = "in_app_plan" | "offline";
type WorkspaceData = {
  settings?: {
    stationManagedEnabled?: boolean;
    deliveryPricingMode?: DeliveryPricingMode;
    deliveryFeeAmount?: number | string;
    driverCompensationMode?: CompensationMode;
    driverCompensationPlan?: Record<string, unknown>;
    currencyCode?: string;
  };
  drivers?: Array<{ id: string; userId: string; displayName: string; phone?: string; status: string }>;
  agreements?: Array<Record<string, unknown>>;
  payments?: Array<Record<string, unknown>>;
  assignableOrders?: Array<{ id: string; publicReference?: string; status: string; requestedKg?: number; totalAmount?: number; currencyCode?: string }>;
};

export function StationManagedFulfillmentScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const runtime = useStationRuntime();
  const branch = nestedRecord(runtime.data, "branch");
  const branchId = firstString(branch, ["id", "stationBranchId", "station_branch_id"]);
  const client = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [pricingMode, setPricingMode] = useState<DeliveryPricingMode>("separate");
  const [deliveryFee, setDeliveryFee] = useState("0");
  const [compensationMode, setCompensationMode] = useState<CompensationMode>("in_app_plan");
  const [compensationAmount, setCompensationAmount] = useState("0");
  const [driverUserId, setDriverUserId] = useState("");
  const [driverName, setDriverName] = useState("");
  const [driverPhone, setDriverPhone] = useState("");
  const [selectedDriverId, setSelectedDriverId] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [agreementMode, setAgreementMode] = useState<CompensationMode>("in_app_plan");
  const [agreementAmount, setAgreementAmount] = useState("0");
  const [agreementNotes, setAgreementNotes] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "bank_transfer" | "wallet_external" | "other">("bank_transfer");
  const [paymentReference, setPaymentReference] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const workspace = useQuery<WorkspaceData>({
    queryKey: ["station-managed-workspace", branchId],
    enabled: session.status === "authenticated" && Boolean(branchId),
    retry: false,
    queryFn: async () => {
      const result = await session.supabase.rpc("read_lpg_station_managed_workspace", {
        target_station_branch_id: branchId,
      });
      if (result.error) throw result.error;
      return (result.data ?? {}) as WorkspaceData;
    },
  });

  const currencyCode = workspace.data?.settings?.currencyCode || firstString(branch, ["currencyCode", "currency_code"]) || "NGN";

  useEffect(() => {
    const settings = workspace.data?.settings;
    if (!settings) return;
    setEnabled(settings.stationManagedEnabled === true);
    setPricingMode(settings.deliveryPricingMode ?? "separate");
    setDeliveryFee(String(settings.deliveryFeeAmount ?? 0));
    setCompensationMode(settings.driverCompensationMode ?? "in_app_plan");
    setCompensationAmount(String(settings.driverCompensationPlan?.amount ?? 0));
  }, [workspace.data?.settings]);

  const refresh = async () => {
    await Promise.allSettled([workspace.refetch(), runtime.refetch()]);
  };
  const runRpc = async (name: string, args: Record<string, unknown>) => {
    const result = await session.supabase.rpc(name as never, args as never);
    if (result.error) throw result.error;
    return result.data;
  };
  const settingsMutation = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("Your station branch is not available.");
      const fee = Number(deliveryFee);
      if (!Number.isFinite(fee) || fee < 0) throw new Error("Enter a valid delivery fee.");
      const compensation = Number(compensationAmount);
      if (!Number.isFinite(compensation) || compensation < 0) throw new Error("Enter a valid driver payment amount.");
      const plan: Record<string, unknown> = { calculation: "per_delivery", amount: compensation, currencyCode };
      return runRpc("configure_lpg_station_managed_fulfillment", {
        target_station_branch_id: branchId,
        target_enabled: enabled,
        target_delivery_pricing_mode: pricingMode,
        target_delivery_fee_amount: pricingMode === "free" ? 0 : fee,
        target_driver_compensation_mode: compensationMode,
        target_driver_compensation_plan: plan,
        target_currency_code: currencyCode,
        target_metadata: { source: "station-managed-settings-screen" },
      });
    },
    onSuccess: async () => { setErrorMessage(null); await workspace.refetch(); await client.invalidateQueries({ queryKey: ["station-managed-fulfillment-option"] }); },
    onError: (error) => setErrorMessage(friendlyError(error, "Station Managed settings could not be saved.")),
  });
  const registerMutation = useMutation({
    mutationFn: async () => {
      if (!branchId) throw new Error("Your station branch is not available.");
      if (!driverUserId.trim() || !driverName.trim()) throw new Error("Enter the driver's SKIMA user/profile ID and full name.");
      return runRpc("register_lpg_station_managed_driver", {
        target_station_branch_id: branchId,
        target_user_id: driverUserId.trim(),
        target_display_name: driverName.trim(),
        target_phone: driverPhone.trim() || null,
        target_metadata: { source: "station-managed-settings-screen" },
      });
    },
    onSuccess: async () => { setDriverUserId(""); setDriverName(""); setDriverPhone(""); setErrorMessage(null); await workspace.refetch(); },
    onError: (error) => setErrorMessage(friendlyError(error, "Station driver could not be registered.")),
  });
  const assignMutation = useMutation({
    mutationFn: async () => {
      if (!selectedOrderId || !selectedDriverId) throw new Error("Choose an order and an active station driver.");
      return runRpc("assign_lpg_station_managed_driver", {
        target_lpg_order_id: selectedOrderId,
        target_station_driver_id: selectedDriverId,
        target_idempotency_key: idempotencyKey("station-managed-assignment", selectedOrderId),
        target_metadata: { source: "station-managed-settings-screen" },
      });
    },
    onSuccess: async () => { setErrorMessage(null); setSelectedOrderId(""); await workspace.refetch(); },
    onError: (error) => setErrorMessage(friendlyError(error, "Station driver could not be assigned.")),
  });
  const agreementMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDriverId) throw new Error("Choose a station driver first.");
      const amount = Number(agreementAmount);
      if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter a valid agreement amount.");
      const terms: Record<string, unknown> = { calculation: "per_delivery", amount, currencyCode };
      return runRpc("record_lpg_station_managed_driver_agreement", {
        target_station_driver_id: selectedDriverId,
        target_agreement_mode: agreementMode,
        target_agreement_status: "active",
        target_terms: terms,
        target_notes: agreementNotes.trim() || null,
        target_metadata: { source: "station-managed-settings-screen" },
      });
    },
    onSuccess: async () => { setErrorMessage(null); setAgreementNotes(""); await workspace.refetch(); },
    onError: (error) => setErrorMessage(friendlyError(error, "Station driver agreement could not be recorded.")),
  });
  const paymentMutation = useMutation({
    mutationFn: async () => {
      if (!selectedDriverId) throw new Error("Choose a station driver first.");
      const amount = Number(paymentAmount);
      if (!Number.isFinite(amount) || amount < 0) throw new Error("Enter a valid payment amount.");
      return runRpc("record_lpg_station_managed_driver_payment", {
        target_station_driver_id: selectedDriverId,
        target_lpg_order_id: selectedOrderId || null,
        target_currency_code: currencyCode,
        target_amount: amount,
        target_payment_method: paymentMethod,
        target_payment_status: "confirmed",
        target_idempotency_key: idempotencyKey("station-driver-payment", `${selectedDriverId}-${selectedOrderId || "general"}-${paymentAmount}-${paymentReference}`),
        target_external_reference: paymentReference.trim() || null,
        target_confirmation_notes: "Recorded by station. SKIMA did not execute this payment.",
        target_metadata: { source: "station-managed-settings-screen", paymentHandledByStation: true },
      });
    },
    onSuccess: async () => { setErrorMessage(null); setPaymentAmount(""); setPaymentReference(""); await workspace.refetch(); },
    onError: (error) => setErrorMessage(friendlyError(error, "Station payment confirmation could not be recorded.")),
  });

  const data = workspace.data;
  const drivers = (data?.drivers ?? []).filter((driver) => driver.status === "active");
  const selectedDriver = drivers.find((driver) => driver.id === selectedDriverId);
  const loading = runtime.isPending || workspace.isPending;
  const failed = runtime.error || workspace.error;

  return (
    <Screen
      eyebrow="Station operations"
      title="Your delivery service"
      subtitle="Set delivery prices, add your station drivers and keep a record of agreements and payments. Your station pays its own drivers."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {loading ? <Text style={{ color: palette.muted }}>Loading branch settings…</Text> : failed ? (
        <EmptyState title="Station fulfillment could not be loaded" description="Check your connection and branch access, then try again." action={<AppButton label="Try again" variant="secondary" onPress={() => void refresh()} />} />
      ) : !branchId ? (
        <EmptyState title="Station branch unavailable" description="Complete station setup before configuring managed delivery." />
      ) : (
        <>
          <Section title="1. Customer delivery option" palette={palette}>
            <Text style={{ color: palette.muted, fontSize: 13 }}>Enable this option to let customers choose delivery by your own station driver. Existing independent-driver and SKIMA Fleet orders are unchanged.</Text>
            <View style={styles.row}>
              <Choice label={enabled ? "Enabled for customers" : "Disabled for customers"} active={enabled} onPress={() => setEnabled(!enabled)} palette={palette} />
            </View>
          </Section>

          <Section title="2. Delivery price" palette={palette}>
            <Text style={{ color: palette.muted, fontSize: 13 }}>Choose how delivery appears on the customer's SKIMA checkout. Refill and delivery remain separately tracked where a separate fee is selected.</Text>
            <View style={styles.row}>
              <Choice label="Separate fee" active={pricingMode === "separate"} onPress={() => setPricingMode("separate")} palette={palette} />
              <Choice label="Included" active={pricingMode === "included"} onPress={() => setPricingMode("included")} palette={palette} />
              <Choice label="Free" active={pricingMode === "free"} onPress={() => { setPricingMode("free"); setDeliveryFee("0"); }} palette={palette} />
            </View>
            {pricingMode !== "free" ? <Field label={pricingMode === "included" ? `Delivery amount included in refill price (${currencyCode})` : `Customer delivery fee (${currencyCode})`} value={deliveryFee} onChangeText={setDeliveryFee} keyboardType="decimal-pad" palette={palette} /> : <Text style={{ color: palette.muted }}>{`The customer delivery fee is ${currencyCode} 0.00.`}</Text>}
            <Text style={{ color: palette.muted, fontSize: 13 }}>Driver compensation is a station responsibility. These settings do not create SKIMA driver earnings or payouts.</Text>
          </Section>

          <Section title="3. Driver payment plan" palette={palette}>
            <View style={styles.row}>
              <Choice label="In-app plan" active={compensationMode === "in_app_plan"} onPress={() => { setCompensationMode("in_app_plan"); setAgreementMode("in_app_plan"); }} palette={palette} />
              <Choice label="Offline agreement" active={compensationMode === "offline"} onPress={() => { setCompensationMode("offline"); setAgreementMode("offline"); }} palette={palette} />
            </View>
            {compensationMode === "in_app_plan" ? <Field label={`Amount paid to driver per delivery (${currencyCode})`} value={compensationAmount} onChangeText={setCompensationAmount} keyboardType="decimal-pad" palette={palette} /> : <Text style={{ color: palette.muted }}>Use a separate agreement with your driver. You can record the agreed terms and confirm payments below. SKIMA does not pay station drivers.</Text>}
          </Section>

          <AppButton label="Save delivery settings" fullWidth loading={settingsMutation.isPending} onPress={() => void settingsMutation.mutateAsync()} />

          <Section title="4. Add a station driver" palette={palette}>
            <Field label="Driver account ID (ask SKIMA support if needed)" value={driverUserId} onChangeText={setDriverUserId} palette={palette} autoCapitalize="none" />
            <Field label="Driver full name" value={driverName} onChangeText={setDriverName} palette={palette} />
            <Field label="Phone (optional)" value={driverPhone} onChangeText={setDriverPhone} palette={palette} keyboardType="phone-pad" />
            <AppButton label="Register station driver" fullWidth loading={registerMutation.isPending} disabled={!driverUserId.trim() || !driverName.trim()} onPress={() => void registerMutation.mutateAsync()} />
            <Text style={{ color: palette.muted, fontSize: 12 }}>Station drivers must not already have a SKIMA Managed or independent driver profile.</Text>
          </Section>

          <Section title="5. Assign a delivery" palette={palette}>
            <Text style={{ color: palette.muted, fontSize: 13 }}>Only orders already quoted and paid as Station Managed appear here.</Text>
            {(data?.assignableOrders ?? []).length ? (data?.assignableOrders ?? []).map((order) => (
              <Choice key={order.id} label={`${order.publicReference ?? order.id.slice(0, 8)} · ${order.requestedKg ?? "—"} kg · ${order.status}`} active={selectedOrderId === order.id} onPress={() => setSelectedOrderId(order.id)} palette={palette} />
            )) : <Text style={{ color: palette.muted }}>No unassigned Station Managed orders for this branch.</Text>}
            {drivers.length ? drivers.map((driver) => (
              <Choice key={driver.id} label={driver.displayName} active={selectedDriverId === driver.id} onPress={() => setSelectedDriverId(driver.id)} palette={palette} />
            )) : <Text style={{ color: palette.muted }}>Register an active station driver first.</Text>}
            <AppButton label="Assign selected driver" fullWidth loading={assignMutation.isPending} disabled={!selectedOrderId || !selectedDriverId} onPress={() => void assignMutation.mutateAsync()} />
          </Section>

          <Section title="6. Record driver agreement" palette={palette}>
            <Text style={{ color: palette.muted, fontSize: 13 }}>{selectedDriver ? `Selected driver: ${selectedDriver.displayName}` : "Select a station driver in the assignment section above."}</Text>
            <View style={styles.row}>
              <Choice label="In-app plan" active={agreementMode === "in_app_plan"} onPress={() => setAgreementMode("in_app_plan")} palette={palette} />
              <Choice label="Offline" active={agreementMode === "offline"} onPress={() => setAgreementMode("offline")} palette={palette} />
            </View>
            <Field label={`Agreed payment per delivery (${currencyCode})`} value={agreementAmount} onChangeText={setAgreementAmount} keyboardType="decimal-pad" palette={palette} />
            <Field label="Notes (optional)" value={agreementNotes} onChangeText={setAgreementNotes} multiline palette={palette} />
            <AppButton label="Record agreement" fullWidth loading={agreementMutation.isPending} disabled={!selectedDriverId} onPress={() => void agreementMutation.mutateAsync()} />
          </Section>

          <Section title="7. Record a payment you made" palette={palette}>
            <Field label={`Amount (${currencyCode})`} value={paymentAmount} onChangeText={setPaymentAmount} keyboardType="decimal-pad" palette={palette} />
            <View style={styles.row}>
              <Choice label="Bank transfer" active={paymentMethod === "bank_transfer"} onPress={() => setPaymentMethod("bank_transfer")} palette={palette} />
              <Choice label="Cash" active={paymentMethod === "cash"} onPress={() => setPaymentMethod("cash")} palette={palette} />
              <Choice label="Other" active={paymentMethod === "other"} onPress={() => setPaymentMethod("other")} palette={palette} />
            </View>
            <Field label="Payment reference (optional)" value={paymentReference} onChangeText={setPaymentReference} palette={palette} />
            <AppButton label="Record payment confirmation" fullWidth loading={paymentMutation.isPending} disabled={!selectedDriverId || !paymentAmount.trim()} onPress={() => void paymentMutation.mutateAsync()} />
            <Text style={{ color: palette.muted, fontSize: 12 }}>This creates a station record only. It does not move money through SKIMA or create a SKIMA payout.</Text>
          </Section>

          <Section title="Recent agreements and payments" palette={palette}>
            <Text style={{ color: palette.ink, fontWeight: "700" }}>Agreements</Text>
            {(data?.agreements ?? []).slice(0, 5).map((record, index) => <Text key={String(record.id ?? index)} style={{ color: palette.muted, paddingVertical: 4 }}>{String(record.agreementMode ?? "agreement")} · {String(record.agreementStatus ?? "recorded")} · {String(record.stationDriverId ?? "")}</Text>)}
            <Text style={{ color: palette.ink, fontWeight: "700", marginTop: 8 }}>Payment confirmations</Text>
            {(data?.payments ?? []).slice(0, 5).map((record, index) => <Text key={String(record.id ?? index)} style={{ color: palette.muted, paddingVertical: 4 }}>{String(record.currencyCode ?? currencyCode)} {String(record.amount ?? "0")} · {String(record.paymentMethod ?? "other")} · {String(record.paymentStatus ?? "recorded")}</Text>)}
          </Section>
        </>
      )}
      {errorMessage ? <Text accessibilityRole="alert" style={{ color: palette.danger, marginTop: 12 }}>{errorMessage}</Text> : null}
    </Screen>
  );
}

function Section({ title, children, palette }: { title: string; children: React.ReactNode; palette: ReturnType<typeof useAppTheme>["palette"] }) {
  return <View style={[styles.section, { backgroundColor: palette.surface, borderColor: palette.border }]}><Text style={[styles.sectionTitle, { color: palette.ink }]}>{title}</Text>{children}</View>;
}

function Choice({ label, active, onPress, palette }: { label: string; active: boolean; onPress(): void; palette: ReturnType<typeof useAppTheme>["palette"] }) {
  return <Pressable accessibilityRole="button" accessibilityState={{ selected: active }} onPress={onPress} style={[styles.choice, { backgroundColor: active ? palette.brandSoft : palette.surfaceSubtle, borderColor: active ? palette.brand : palette.border }]}><Text style={{ color: palette.ink, fontSize: 13, fontWeight: active ? "700" : "500" }}>{label}</Text></Pressable>;
}

function Field({ label, value, onChangeText, palette, keyboardType, multiline = false, autoCapitalize }: { label: string; value: string; onChangeText(value: string): void; palette: ReturnType<typeof useAppTheme>["palette"]; keyboardType?: "default" | "decimal-pad" | "phone-pad"; multiline?: boolean; autoCapitalize?: "none" | "sentences" | "words" | "characters" }) {
  return <View style={styles.field}><Text style={[styles.fieldLabel, { color: palette.ink }]}>{label}</Text><TextInput value={value} onChangeText={onChangeText} keyboardType={keyboardType} multiline={multiline} autoCapitalize={autoCapitalize} autoCorrect={false} placeholder={label} placeholderTextColor={palette.muted} style={[styles.input, { color: palette.ink, backgroundColor: palette.input, borderColor: palette.borderStrong }, multiline && { minHeight: 84, textAlignVertical: "top" }]} /></View>;
}

const styles = StyleSheet.create({
  section: { borderWidth: 1, borderRadius: radii.lg, padding: spacing.sm + 2, gap: spacing.sm, marginBottom: spacing.sm },
  sectionTitle: { ...typography.heading, fontSize: 15, lineHeight: 20 },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  choice: { borderWidth: 1, borderRadius: radii.md, paddingVertical: 10, paddingHorizontal: 12, marginBottom: 4 },
  field: { gap: 6, marginBottom: 8 },
  fieldLabel: { fontSize: 13, fontWeight: "700" },
  input: { borderWidth: 1, borderRadius: radii.md, paddingHorizontal: 12, paddingVertical: 11, fontSize: 14, minHeight: 44 },
});
