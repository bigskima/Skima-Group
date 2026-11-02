import { createClientIdempotencyKey } from "@skima/frontend-core";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock3, MapPin, PackageCheck, Phone, Truck, UserRound } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { Alert, Linking, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { asNumber, asString, useLogisticsQuery } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { AppField } from "../ui/AppField";
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
export function DriverJobDetailScreen() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const bookingId = Array.isArray(routeId) ? routeId[0] : routeId;
  const { palette } = useAppTheme();
  const { api } = useSession();
  const client = useQueryClient();
  const jobs = useLogisticsQuery(["driver-bookings"], "/runtime/logistics/driver/bookings", true, 15_000);
  const booking = useMemo(() => (jobs.data ?? []).find((item) => asString(item, "booking_id") === bookingId) ?? null, [jobs.data, bookingId]);
  const assignment = nested(booking, "assignment");
  const vehicle = nested(assignment, "vehicle");
  const assignmentId = asString(assignment, "id");
  const assignmentStatus = asString(assignment, "status") ?? "unknown";
  const [recipientName, setRecipientName] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const keys = useRef(new Map<string, string>());

  const action = useMutation({
    mutationFn: async (kind: "accept" | "reject" | "start" | "pickup" | "transit" | "deliver") => {
      if (!bookingId) throw new Error("The booking identifier is missing.");
      if (!assignmentId && (kind === "accept" || kind === "reject")) throw new Error("The assignment identifier is missing.");
      if (kind === "deliver" && recipientName.trim().length < 2) throw new Error("Enter the name of the person receiving the delivery.");
      const detailFingerprint = kind === "deliver" ? ":" + recipientName.trim() + ":" + deliveryNote.trim() : "";
      const fingerprint = kind + ":" + bookingId + ":" + (assignmentId ?? "") + detailFingerprint;
      let key = keys.current.get(fingerprint);
      if (!key) {
        key = createClientIdempotencyKey("logistics.driver." + kind, fingerprint);
        keys.current.set(fingerprint, key);
      }
      if (kind === "accept" || kind === "reject") {
        return api.post("/runtime/logistics/driver/assignment/respond", {
          assignmentId,
          decision: kind,
          reason: kind === "reject" ? "Driver declined this assignment." : null,
          idempotencyKey: key,
        }, z.string().uuid());
      }
      if (kind === "start") {
        return api.post("/runtime/logistics/bookings/start", { bookingId, idempotencyKey: key }, z.string().uuid());
      }
      if (kind === "pickup" || kind === "transit") {
        return api.post("/runtime/logistics/driver/milestone", {
          bookingId,
          milestone: kind === "pickup" ? "picked_up" : "in_transit",
          idempotencyKey: key,
          metadata: { captured_from: "skima-logistics.driver-workspace" },
        }, z.string().uuid());
      }
      return api.post("/runtime/logistics/bookings/delivery/submit", {
        bookingId,
        idempotencyKey: key,
        deliverySubmission: { recipientName: recipientName.trim(), deliveryNote: deliveryNote.trim() || null },
      }, z.string().uuid());
    },
    onSuccess: async (_result, kind) => {
      setError(null);
      await client.invalidateQueries({ queryKey: ["skima-logistics", "driver-bookings"] });
      await client.invalidateQueries({ queryKey: ["skima-logistics", "bookings"] });
      await jobs.refetch();
      if (kind === "deliver") Alert.alert("Delivery submitted", "The customer can now confirm receipt. Online escrow remains protected until confirmation.");
      if (kind === "reject") Alert.alert("Assignment declined", "The company can now assign this booking to another eligible driver.");
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The job action could not be completed."),
  });

  const refresh = () => jobs.refetch();
  return (
    <Screen eyebrow="ASSIGNED DELIVERY" title={asString(booking, "title") ?? "Delivery details"} subtitle="Follow each required milestone and keep the customer informed."
      action={<AppButton label="Back" size="sm" variant="secondary" icon={<ArrowLeft color={palette.ink} size={15} />} onPress={() => router.back()} />}
      refreshControl={<RefreshControl refreshing={jobs.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}>
      {jobs.isPending ? <ScreenSkeleton cards={3} /> : jobs.error ? (
        <StatePanel title="Assigned job unavailable" description="We could not load your assigned Logistics jobs." retry={() => void refresh()} />
      ) : !booking || !assignment ? (
        <StatePanel title="This job is not assigned to you" description="Only the driver assigned by the provider company can open this job." retry={() => void refresh()} />
      ) : (
        <View style={styles.content}>
          <Card padding="lg">
            <View style={styles.header}>
              <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={21} /></View>
              <View style={styles.copy}>
                <Text style={[styles.title, { color: palette.ink }]}>{asString(booking, "title") ?? "Logistics delivery"}</Text>
                <Text style={[styles.meta, { color: palette.muted }]}>{bookingId?.slice(0, 8).toUpperCase()} · {asString(booking, "payment_mode") === "offline" ? "Offline booking" : "Online escrow"}</Text>
              </View>
              <StatusPill status={assignmentStatus} />
            </View>
            <View style={[styles.route, { backgroundColor: palette.surfaceSubtle }]}>
              <RouteLine color={palette.brand} label={place(booking.pickup_location)} />
              <View style={[styles.stem, { borderColor: palette.borderStrong }]} />
              <RouteLine color={palette.success} label={place(booking.destination_location)} />
            </View>
            <View style={styles.vehicle}>
              <Truck color={palette.muted} size={15} />
              <Text style={[styles.meta, { color: palette.muted }]}>{[asString(vehicle, "vehicle_type"), asString(vehicle, "manufacturer"), asString(vehicle, "model"), asString(vehicle, "registration_number")].filter(Boolean).join(" · ") || "Assigned company vehicle"}</Text>
            </View>
            {asString(booking, "instructions") ? (
              <View style={[styles.instructions, { backgroundColor: palette.warningSoft }]}>
                <Text style={[styles.sectionTitle, { color: palette.ink }]}>Customer instructions</Text>
                <Text style={[styles.meta, { color: palette.ink }]}>{asString(booking, "instructions")}</Text>
              </View>
            ) : null}
            {asString(nested(booking, "cargo_snapshot"), "weight_kg") ? <Text style={[styles.meta, { color: palette.muted }]}>Cargo weight: {asString(nested(booking, "cargo_snapshot"), "weight_kg")} kg</Text> : null}
          </Card>

          <Card padding="lg">
            <View style={styles.actionHeading}><UserRound color={palette.brand} size={18} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Customer contact</Text></View>
            <Text style={[styles.contactName, { color: palette.ink }]}>{asString(booking, "customer_name") ?? "Customer"}</Text>
            {asString(booking, "customer_phone") ? (
              <Pressable style={styles.contactLine} onPress={() => void Linking.openURL("tel:" + asString(booking, "customer_phone"))}>
                <Phone color={palette.brand} size={14} /><Text style={[styles.phone, { color: palette.brand }]}>{asString(booking, "customer_phone")}</Text>
              </Pressable>
            ) : <Text style={[styles.meta, { color: palette.muted }]}>No phone number was shared for this booking.</Text>}
          </Card>

          {assignmentStatus === "offered" ? (
            <Card variant="warning" padding="lg">
              <Text style={[styles.sectionTitle, { color: palette.ink }]}>New job assignment</Text>
              <Text style={[styles.meta, { color: palette.muted }]}>Review the route, cargo and instructions. Accept only when you can fulfil the job with the assigned vehicle.</Text>
              <AppButton label="Accept job" fullWidth loading={action.isPending} onPress={() => action.mutate("accept")} />
              <AppButton label="Decline assignment" fullWidth variant="secondary" disabled={action.isPending} onPress={() => action.mutate("reject")} />
            </Card>
          ) : assignmentStatus === "accepted" ? (
            <Card padding="lg">
              <View style={styles.actionHeading}><CheckCircle2 color={palette.success} size={18} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Assignment accepted</Text></View>
              <Text style={[styles.meta, { color: palette.muted }]}>Start the job when you are ready to travel to the pickup location.</Text>
              <AppButton label="Start job" fullWidth loading={action.isPending} onPress={() => action.mutate("start")} />
            </Card>
          ) : assignmentStatus === "in_progress" ? (
            <Card padding="lg">
              <Text style={[styles.sectionTitle, { color: palette.ink }]}>Pickup required</Text>
              <Text style={[styles.meta, { color: palette.muted }]}>Confirm that you have collected the cargo from the pickup location.</Text>
              <AppButton label="Confirm pickup" fullWidth loading={action.isPending} onPress={() => action.mutate("pickup")} />
            </Card>
          ) : assignmentStatus === "picked_up" ? (
            <Card padding="lg">
              <Text style={[styles.sectionTitle, { color: palette.ink }]}>Cargo picked up</Text>
              <Text style={[styles.meta, { color: palette.muted }]}>Mark the cargo in transit when you depart for the delivery location.</Text>
              <AppButton label="Mark in transit" fullWidth loading={action.isPending} onPress={() => action.mutate("transit")} />
            </Card>
          ) : assignmentStatus === "in_transit" ? (
            <Card padding="lg">
              <Text style={[styles.sectionTitle, { color: palette.ink }]}>Complete customer hand-off</Text>
              <Text style={[styles.meta, { color: palette.muted }]}>Enter the name of the person receiving the cargo. The customer must confirm delivery before online escrow is released.</Text>
              <AppField label="Received by" value={recipientName} onChangeText={setRecipientName} placeholder="Name of recipient" />
              <AppField label="Delivery note" value={deliveryNote} onChangeText={setDeliveryNote} placeholder="Condition, hand-off notes or reference…" multiline optional />
              <AppButton label="Submit delivery" fullWidth loading={action.isPending} disabled={recipientName.trim().length < 2} onPress={() => action.mutate("deliver")} trailingIcon={<PackageCheck color="#FFFFFF" size={16} />} />
            </Card>
          ) : assignmentStatus === "delivery_submitted" ? (
            <Card variant="warning" padding="lg">
              <View style={styles.actionHeading}><Clock3 color={palette.warning} size={18} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Awaiting customer confirmation</Text></View>
              <Text style={[styles.meta, { color: palette.muted }]}>You have submitted delivery details. The customer must confirm receipt before the booking can settle.</Text>
            </Card>
          ) : assignmentStatus === "completed" ? (
            <Card variant="success" padding="lg">
              <View style={styles.actionHeading}><CheckCircle2 color={palette.success} size={18} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Delivery completed</Text></View>
              <Text style={[styles.meta, { color: palette.muted }]}>Customer confirmation and the final booking settlement have been recorded.</Text>
            </Card>
          ) : null}
          {error || action.error ? <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}><Text style={[styles.errorText, { color: palette.danger }]}>{error ?? (action.error instanceof Error ? action.error.message : "Job action failed.")}</Text></View> : null}
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
  copy: { flex: 1, minWidth: 0, gap: 2 },
  title: { ...typography.bodyStrong, fontSize: 13 },
  meta: { ...typography.caption, fontSize: 10, lineHeight: 17 },
  route: { borderRadius: radii.lg, padding: 12, gap: 4 },
  routeLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeText: { ...typography.caption, color: "#6D6D74", fontSize: 10, flex: 1 },
  stem: { height: 10, borderLeftWidth: 1, marginLeft: 3 },
  vehicle: { flexDirection: "row", alignItems: "center", gap: 8 },
  instructions: { borderRadius: radii.md, padding: 11, gap: 5 },
  sectionTitle: { ...typography.bodyStrong, fontSize: 13 },
  contactName: { ...typography.bodyStrong, fontSize: 13 },
  contactLine: { minHeight: 26, flexDirection: "row", alignItems: "center", gap: 7 },
  phone: { ...typography.caption, fontWeight: "900", fontSize: 11 },
  actionHeading: { flexDirection: "row", alignItems: "center", gap: 8 },
  error: { padding: 12, borderRadius: radii.md },
  errorText: { ...typography.caption, fontSize: 10, lineHeight: 17 },
});
