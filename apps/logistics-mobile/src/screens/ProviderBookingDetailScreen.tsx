import { createClientIdempotencyKey } from "@skima/frontend-core";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock3, MapPin, Phone, ShieldCheck, Truck, UserRound } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { asNumber, asString, useLogisticsQuery, useLogisticsRecordQuery } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { StatePanel } from "../ui/StatePanel";
import { StatusPill } from "../ui/StatusPill";

function nested(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function place(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Location details";
  return asString(value as Record<string, unknown>, "display_name", "canonical_name", "formatted_address", "address") ?? "Location details";
}
function money(value: number, currency: string) {
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(value); }
  catch { return `${currency} ${value.toLocaleString("en-NG")}`; }
}

export function ProviderBookingDetailScreen() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const bookingId = Array.isArray(routeId) ? routeId[0] : routeId;
  const { palette } = useAppTheme();
  const { api } = useSession();
  const client = useQueryClient();
  const companies = useLogisticsQuery(["company"], "/runtime/logistics/company");
  const organizationId = asString(companies.data?.[0], "organization_id");
  const bookings = useLogisticsQuery(
    ["provider-bookings", organizationId ?? "none"],
    `/runtime/logistics/bookings?providerOrganizationId=${encodeURIComponent(organizationId ?? "")}`,
    Boolean(organizationId), 20_000,
  );
  const booking = useMemo(() => (bookings.data ?? []).find((item) => asString(item, "id") === bookingId) ?? null, [bookings.data, bookingId]);
  const offer = nested(booking, "offer");
  const opportunity = nested(offer, "opportunity");
  const snapshot = nested(opportunity, "job_snapshot");
  const contact = nested(opportunity, "customer_contact_snapshot");
  const job = nested(booking, "job");
  const title = asString(snapshot, "title") ?? asString(job, "title") ?? "Logistics booking";
  const status = asString(booking, "status") ?? "unknown";
  const paymentMode = asString(booking, "payment_mode") ?? "online_wallet";
  const assignmentRows = Array.isArray(booking?.assignments)
    ? booking.assignments.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const activeAssignment = [...assignmentRows].reverse().find((item) =>
    ["offered", "accepted", "in_progress", "picked_up", "in_transit", "delivery_submitted"].includes(asString(item, "status") ?? "")
  ) ?? null;
  const assignedDriver = nested(activeAssignment, "driver");
  const assignedVehicle = nested(activeAssignment, "vehicle");
  const dispatchResources = useLogisticsRecordQuery(
    ["dispatch-resources", organizationId ?? "none"],
    `/runtime/logistics/company/dispatch-resources?organizationId=${encodeURIComponent(organizationId ?? "")}`,
    Boolean(organizationId && status === "provider_accepted" && !activeAssignment),
  );
  const driverResources = Array.isArray(dispatchResources.data?.drivers)
    ? dispatchResources.data.drivers.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const [selectedDriverProfileId, setSelectedDriverProfileId] = useState("");
  const selectedDriver = driverResources.find((item) => asString(item, "driver_profile_id") === selectedDriverProfileId) ?? null;
  const selectedVehicles = Array.isArray(selectedDriver?.vehicles)
    ? selectedDriver.vehicles.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
  const [selectedVehicleId, setSelectedVehicleId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const actionKeysRef = useRef(new Map<string, string>());

  const assignDriver = useMutation({
    mutationFn: async () => {
      if (!bookingId || !selectedDriverProfileId || !selectedVehicleId) {
        throw new Error("Choose an eligible driver and their assigned vehicle.");
      }
      const fingerprint = `assign:${bookingId}:${selectedDriverProfileId}:${selectedVehicleId}`;
      let key = actionKeysRef.current.get(fingerprint);
      if (!key) {
        key = createClientIdempotencyKey("logistics.company.driver.assignment", fingerprint);
        actionKeysRef.current.set(fingerprint, key);
      }
      return api.post("/runtime/logistics/bookings/assign-driver", {
        bookingId,
        driverProfileId: selectedDriverProfileId,
        vehicleId: selectedVehicleId,
        idempotencyKey: key,
      }, z.string().uuid());
    },
    onSuccess: async () => {
      setError(null);
      await client.invalidateQueries({ queryKey: ["skima-logistics", "provider-bookings"] });
      await bookings.refetch();
      Alert.alert("Driver assignment sent", "The driver has been notified in their SKIMA Logistics workspace and must accept before the job can start.");
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The driver could not be assigned."),
  });

  const mutateAction = useMutation({
    mutationFn: async (action: "accept") => {
      if (!bookingId) throw new Error("Booking id is missing.");
      const fingerprint = action;
      let key = actionKeysRef.current.get(fingerprint);
      if (!key) {
        key = createClientIdempotencyKey(`logistics.provider.booking.${action}`, `${bookingId}:${fingerprint}`);
        actionKeysRef.current.set(fingerprint, key);
      }
      return api.post("/runtime/logistics/bookings/accept", { bookingId, idempotencyKey: key }, z.string().uuid());
    },
    onSuccess: async () => {
      setError(null);
      await client.invalidateQueries({ queryKey: ["skima-logistics", "bookings"] });
      await client.invalidateQueries({ queryKey: ["skima-logistics", "provider-bookings"] });
      await bookings.refetch();
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The booking action could not be completed."),
  });

  const refresh = () => Promise.all([companies.refetch(), bookings.refetch(), dispatchResources.refetch()]);
  return (
    <Screen eyebrow="PROVIDER JOB" title={title} subtitle="Accept the booking, carry out the service and record the delivery hand-off."
      action={<AppButton label="Back" size="sm" variant="secondary" icon={<ArrowLeft color={palette.ink} size={15} />} onPress={() => router.back()} />}
      refreshControl={<RefreshControl refreshing={bookings.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}>
      {companies.isPending || bookings.isPending ? <ScreenSkeleton cards={3} /> : !booking ? (
        <StatePanel title="Booking not found" description="This booking may not belong to the signed-in provider company." retry={() => void refresh()} />
      ) : (
        <View style={styles.content}>
          <Card padding="lg">
            <View style={styles.header}>
              <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={21} /></View>
              <View style={styles.headerCopy}>
                <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
                <Text style={[styles.meta, { color: palette.muted }]}>{bookingId?.slice(0, 8).toUpperCase()} · {paymentMode === "offline" ? "Offline booking" : "Online escrow"}</Text>
              </View>
              <StatusPill status={status} />
            </View>
            <View style={[styles.route, { backgroundColor: palette.surfaceSubtle }]}>
              <RouteLine color={palette.brand} label={place(snapshot?.pickup ?? job?.pickup_location)} />
              <View style={[styles.stem, { borderColor: palette.borderStrong }]} />
              <RouteLine color={palette.success} label={place(snapshot?.destination ?? job?.destination_location)} />
            </View>
            <View style={styles.amountRow}>
              <Text style={[styles.meta, { color: palette.muted }]}>Agreed delivery price</Text>
              <Text style={[styles.amount, { color: palette.ink }]}>{money(asNumber(booking, "delivery_amount") ?? 0, asString(booking, "currency_code") ?? "NGN")}</Text>
            </View>
            <Text style={[styles.meta, { color: palette.muted }]}>The customer's booking fee and your applicable provider fee were locked when the booking was created. No lead unlock fee applies.</Text>
          </Card>

          <Card padding="lg">
            <View style={styles.contactHeading}><UserRound color={palette.brand} size={18} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Customer hand-off details</Text></View>
            <Text style={[styles.contactName, { color: palette.ink }]}>{asString(contact, "name") ?? "Customer"}</Text>
            {asString(contact, "phone") ? <Pressable style={styles.contactLine} onPress={() => void Linking.openURL(`tel:${asString(contact, "phone")}`)}><Phone color={palette.brand} size={14} /><Text style={[styles.phone, { color: palette.brand }]}>{asString(contact, "phone")}</Text></Pressable> : <Text style={[styles.meta, { color: palette.muted }]}>No phone number was provided.</Text>}
          </Card>

          {status === "payment_reserved" || status === "offline_payment_confirmed" ? (
            <Card variant="warning" padding="lg">
              <View style={styles.actionHeading}><ShieldCheck color={palette.warning} size={20} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Ready for provider acceptance</Text></View>
              <Text style={[styles.meta, { color: palette.muted }]}>{paymentMode === "offline" ? "The customer booking fee and your offline receival fee are confirmed." : "Customer funds are reserved in escrow. They will only be released after customer-confirmed delivery."}</Text>
              <AppButton label="Accept booking" fullWidth loading={mutateAction.isPending} onPress={() => { setError(null); mutateAction.mutate("accept"); }} />
            </Card>
          ) : status === "provider_accepted" ? (
            <Card padding="lg">
              <View style={styles.actionHeading}><Truck color={palette.brand} size={20} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Assign the delivery team</Text></View>
              <Text style={[styles.meta, { color: palette.muted }]}>Choose a verified company driver and a compliant vehicle. The driver must accept the assignment before starting pickup and delivery.</Text>
              {activeAssignment ? (
                <View style={[styles.assignmentSummary, { backgroundColor: palette.surfaceSubtle }]}>
                  <Text style={[styles.contactName, { color: palette.ink }]}>Driver assignment sent</Text>
                  <Text style={[styles.meta, { color: palette.muted }]}>Assignment status: {asString(activeAssignment, "status")?.replace(/_/g, " ") ?? "pending"}</Text>
                  <Text style={[styles.meta, { color: palette.muted }]}>
                    Driver: {asString(assignedDriver, "driver_display_name") ?? asString(assignedDriver, "public_driver_id") ?? "Assigned driver"}
                  </Text>
                  <Text style={[styles.meta, { color: palette.muted }]}>
                    Vehicle: {[asString(assignedVehicle, "manufacturer"), asString(assignedVehicle, "model"), asString(assignedVehicle, "registration_number")].filter(Boolean).join(" · ") || "Approved vehicle"}
                  </Text>
                  <Text style={[styles.meta, { color: palette.muted }]}>The driver must accept before the job can start.</Text>
                  <StatusPill status={asString(activeAssignment, "status") ?? "offered"} />
                </View>
              ) : dispatchResources.isPending ? (
                <ScreenSkeleton cards={1} />
              ) : dispatchResources.error ? (
                <StatePanel title="Driver availability unavailable" description="The company driver and vehicle directory could not be loaded." retry={() => void dispatchResources.refetch()} />
              ) : driverResources.length === 0 ? (
                <StatePanel title="No eligible driver and vehicle pair" description="Add an approved driver as an active company member and link an approved, available vehicle before dispatching this booking." retry={() => void dispatchResources.refetch()} />
              ) : (
                <View style={styles.dispatchSection}>
                  <Text style={[styles.meta, { color: palette.ink }]}>Available company drivers</Text>
                  {driverResources.map((driver) => {
                    const id = asString(driver, "driver_profile_id") ?? "";
                    const chosen = selectedDriverProfileId === id;
                    return (
                      <Pressable key={id} onPress={() => {
                        setSelectedDriverProfileId(id);
                        const vehicles = Array.isArray(driver.vehicles) ? driver.vehicles as Record<string, unknown>[] : [];
                        setSelectedVehicleId(asString(vehicles[0], "vehicle_id") ?? "");
                      }} style={[styles.driverChoice, { borderColor: chosen ? palette.brand : palette.border, backgroundColor: chosen ? palette.brandSoft : palette.surface }]}>
                        <View style={styles.driverChoiceCopy}>
                          <Text style={[styles.contactName, { color: palette.ink }]}>{asString(driver, "display_name") ?? "Verified driver"}</Text>
                          <Text style={[styles.meta, { color: palette.muted }]}>{asString(driver, "public_driver_id") ?? "Approved company driver"}</Text>
                        </View>
                        <StatusPill status={chosen ? "selected" : "available"} />
                      </Pressable>
                    );
                  })}
                  {selectedDriver ? (
                    <View style={styles.dispatchSection}>
                      <Text style={[styles.meta, { color: palette.ink }]}>Choose vehicle</Text>
                      {selectedVehicles.map((vehicle) => {
                        const id = asString(vehicle, "vehicle_id") ?? "";
                        const chosen = selectedVehicleId === id;
                        const vehicleName = [asString(vehicle, "vehicle_type_name"), asString(vehicle, "manufacturer"), asString(vehicle, "model")].filter(Boolean).join(" · ");
                        return (
                          <Pressable key={id} onPress={() => setSelectedVehicleId(id)} style={[styles.driverChoice, { borderColor: chosen ? palette.brand : palette.border, backgroundColor: chosen ? palette.brandSoft : palette.surface }]}>
                            <View style={styles.driverChoiceCopy}>
                              <Text style={[styles.contactName, { color: palette.ink }]}>{vehicleName || "Approved vehicle"}</Text>
                              <Text style={[styles.meta, { color: palette.muted }]}>{asString(vehicle, "registration_number") ?? "Registration not supplied"} · {asNumber(vehicle, "max_load_kg") ?? "Unspecified"} kg capacity</Text>
                            </View>
                            <StatusPill status={chosen ? "selected" : "eligible"} />
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                  <AppButton label="Send driver assignment" fullWidth loading={assignDriver.isPending} disabled={!selectedDriverProfileId || !selectedVehicleId || assignDriver.isPending}
                    onPress={() => { setError(null); assignDriver.mutate(); }} />
                </View>
              )}
            </Card>
          ) : status === "in_progress" ? (
            <Card padding="lg">
              <View style={styles.actionHeading}><Truck color={palette.brand} size={20} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Driver fulfillment in progress</Text></View>
              <Text style={[styles.meta, { color: palette.muted }]}>The assigned driver owns pickup, transit and final delivery submission. The company workspace can monitor the current milestone here.</Text>
              <StatusPill status={asString(activeAssignment, "status") ?? "in_progress"} />
            </Card>
          ) : status === "delivered" ? (
            <Card variant="warning" padding="lg">
              <View style={styles.actionHeading}><Clock3 color={palette.warning} size={20} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Awaiting customer confirmation</Text></View>
              <Text style={[styles.meta, { color: palette.muted }]}>Delivery was submitted for {asString(nested(booking, "delivery_submission_snapshot"), "recipient_name") ?? "the named recipient"}. Online escrow remains protected until the customer confirms.</Text>
            </Card>
          ) : status === "settled" || status === "completed_offline" ? (
            <Card variant="success" padding="lg">
              <View style={styles.actionHeading}><CheckCircle2 color={palette.success} size={20} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Job completed</Text></View>
              <Text style={[styles.meta, { color: palette.muted }]}>{status === "settled" ? "Customer-confirmed delivery triggered the shared escrow split and provider settlement." : "Customer-confirmed offline delivery is complete. Offline fees were already recorded; no online commission was charged."}</Text>
            </Card>
          ) : null}
          {error ? <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}><Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text></View> : null}
        </View>
      )}
    </Screen>
  );
}
function RouteLine({ color, label }: { color: string; label: string }) {
  return <View style={styles.routeLine}><View style={[styles.dot, { backgroundColor: color }]} /><Text style={styles.routeText}>{label}</Text></View>;
}
const styles = StyleSheet.create({
  content: { gap: spacing.md },
  header: { flexDirection: "row", alignItems: "center", gap: 9 },
  icon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  headerCopy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...typography.bodyStrong, fontSize: 13 },
  meta: { ...typography.caption, fontSize: 10, lineHeight: 17 },
  route: { borderRadius: radii.lg, padding: 12, gap: 4 },
  routeLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  routeText: { ...typography.caption, color: "#6D6D74", fontSize: 10, flex: 1 },
  stem: { height: 10, borderLeftWidth: 1, marginLeft: 3 },
  amountRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  amount: { ...typography.heading, fontSize: 17 },
  contactHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  sectionTitle: { ...typography.bodyStrong, fontSize: 13 },
  contactName: { ...typography.bodyStrong, fontSize: 13 },
  contactLine: { minHeight: 26, flexDirection: "row", alignItems: "center", gap: 7 },
  phone: { ...typography.caption, fontWeight: "900", fontSize: 11 },
  actionHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  dispatchSection: { gap: 9 },
  driverChoice: { flexDirection: "row", alignItems: "center", gap: 8, borderWidth: 1, borderRadius: radii.md, padding: 10 },
  driverChoiceCopy: { flex: 1, minWidth: 0, gap: 2 },
  assignmentSummary: { borderRadius: radii.md, padding: 12, gap: 6 },
  error: { padding: 12, borderRadius: radii.md },
  errorText: { ...typography.caption, fontSize: 10, lineHeight: 17 },
});
