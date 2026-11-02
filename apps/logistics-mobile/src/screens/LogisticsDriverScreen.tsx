import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Clock3, MapPin, Navigation, PackageCheck, Phone, ShieldCheck, Truck, UserRound } from "lucide-react-native";
import { useMemo, useRef, useState } from "react";
import { Linking, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { asNumber, asString, useLogisticsQuery, useLogisticsRecordQuery } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { AppField } from "../ui/AppField";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { SectionHeader } from "../ui/SectionHeader";
import { StatePanel } from "../ui/StatePanel";
import { StatusPill } from "../ui/StatusPill";

type DriverAction =
  | { action: "accept" | "reject"; bookingId: string; assignmentId: string }
  | { action: "start" | "picked_up" | "in_transit"; bookingId: string; assignmentId: string }
  | { action: "deliver"; bookingId: string; assignmentId: string; recipientName: string; deliveryNote: string };

function nested(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function place(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Location not supplied";
  const record = value as Record<string, unknown>;
  return asString(record, "display_name", "canonical_name", "formatted_address", "address") ?? "Location not supplied";
}

function money(value: number, currency: string) {
  try { return new Intl.NumberFormat("en-NG", { style: "currency", currency }).format(value); }
  catch { return currency + " " + value.toLocaleString("en-NG"); }
}

function timestamp(value: unknown) {
  if (typeof value !== "string") return "Time not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Time not available"
    : new Intl.DateTimeFormat("en-NG", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function LogisticsDriverScreen() {
  const { palette } = useAppTheme();
  const { api } = useSession();
  const client = useQueryClient();
  const profile = useLogisticsRecordQuery(["driver-profile"], "/runtime/logistics/driver/profile", true);
  const bookings = useLogisticsQuery(["driver-bookings"], "/runtime/logistics/driver/bookings", true, 15_000);
  const [recipientByBooking, setRecipientByBooking] = useState<Record<string, string>>({});
  const [noteByBooking, setNoteByBooking] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const actionKeys = useRef(new Map<string, string>());

  const driverName = asString(profile.data, "driver_display_name") ?? "Driver";
  const verification = asString(profile.data, "verification_status") ?? "unverified";
  const operationalStatus = asString(profile.data, "operational_status") ?? "offline";
  const registered = profile.data?.registered === true;
  const eligible = profile.data?.eligible === true;

  const rows = useMemo(() => bookings.data ?? [], [bookings.data]);
  const pending = rows.filter((row) => asString(nested(row, "assignment"), "status") === "offered");
  const active = rows.filter((row) => {
    const status = asString(nested(row, "assignment"), "status");
    return ["accepted", "in_progress", "picked_up", "in_transit", "delivery_submitted"].includes(status ?? "");
  });
  const completed = rows.filter((row) => ["completed", "settled", "completed_offline"].includes(asString(nested(row, "assignment"), "status") ?? "") ||
    ["settled", "completed_offline"].includes(asString(row, "booking_status") ?? ""));

  const refresh = () => Promise.all([profile.refetch(), bookings.refetch()]);

  const actionMutation = useMutation({
    mutationFn: async (input: DriverAction) => {
      const detail = input.action === "deliver"
        ? ":" + input.recipientName.trim() + ":" + input.deliveryNote.trim()
        : "";
      const fingerprint = [input.action, input.bookingId, input.assignmentId, detail].join(":");
      let idempotencyKey = actionKeys.current.get(fingerprint);
      if (!idempotencyKey) {
        idempotencyKey = createClientIdempotencyKey("logistics.driver." + input.action, fingerprint);
        actionKeys.current.set(fingerprint, idempotencyKey);
      }

      if (input.action === "accept" || input.action === "reject") {
        return api.post("/runtime/logistics/driver/assignment/respond", {
          assignmentId: input.assignmentId,
          decision: input.action,
          reason: input.action === "reject" ? "Driver declined this assignment." : null,
          idempotencyKey,
        }, z.string().uuid());
      }
      if (input.action === "start") {
        return api.post("/runtime/logistics/bookings/start", {
          bookingId: input.bookingId,
          idempotencyKey,
        }, z.string().uuid());
      }
      if (input.action === "picked_up" || input.action === "in_transit") {
        return api.post("/runtime/logistics/driver/milestone", {
          bookingId: input.bookingId,
          milestone: input.action,
          idempotencyKey,
          metadata: { source: "skima.logistics.driver.workspace" },
        }, z.string().uuid());
      }
      if (input.recipientName.trim().length < 2) {
        throw new Error("Enter the name of the person receiving the delivery.");
      }
      return api.post("/runtime/logistics/bookings/delivery/submit", {
        bookingId: input.bookingId,
        idempotencyKey,
        deliverySubmission: {
          recipientName: input.recipientName.trim(),
          deliveryNote: input.deliveryNote.trim() || null,
        },
      }, z.string().uuid());
    },
    onSuccess: async (_result, input) => {
      setError(null);
      if (input.action === "accept") Alert.alert("Assignment accepted", "This delivery is now assigned to you. Start when you are ready.");
      if (input.action === "reject") Alert.alert("Assignment declined", "The company can now assign another eligible driver.");
      if (input.action === "deliver") Alert.alert("Delivery submitted", "The customer has been asked to confirm receipt. Your assignment will complete after booking settlement.");
      await Promise.all([
        client.invalidateQueries({ queryKey: ["skima-logistics", "driver-bookings"] }),
        client.invalidateQueries({ queryKey: ["skima-logistics", "driver-profile"] }),
        client.invalidateQueries({ queryKey: ["skima-logistics", "provider-bookings"] }),
      ]);
      await Promise.all([profile.refetch(), bookings.refetch()]);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The driver action could not be completed."),
  });

  const isLoading = profile.isPending || bookings.isPending;
  const isRefreshing = profile.isRefetching || bookings.isRefetching;

  return (
    <Screen
      eyebrow="DRIVER WORKSPACE"
      title={"Hello, " + driverName.split(/\s+/)[0]}
      subtitle="Accept company assignments, update each delivery milestone and submit a clear hand-off record."
      refreshControl={<RefreshControl refreshing={isRefreshing} onRefresh={() => void refresh()} tintColor={palette.brand} />}
    >
      {isLoading ? <ScreenSkeleton cards={3} /> : profile.error || bookings.error ? (
        <StatePanel title="Driver workspace unavailable" description="We could not load your driver profile or assigned bookings." retry={() => void refresh()} />
      ) : !registered ? (
        <Card padding="lg">
          <View style={[styles.statusIcon, { backgroundColor: palette.warningSoft }]}><Truck color={palette.warning} size={23} /></View>
          <Text style={[styles.cardTitle, { color: palette.ink }]}>No driver profile linked to this account</Text>
          <Text style={[styles.body, { color: palette.muted }]}>Ask your Logistics company owner to complete your driver onboarding and add you as an active company team member. Only verified drivers with an approved vehicle can receive assignments.</Text>
        </Card>
      ) : !eligible ? (
        <Card variant="warning" padding="lg">
          <View style={styles.headingRow}>
            <ShieldCheck color={palette.warning} size={20} />
            <Text style={[styles.cardTitle, { color: palette.ink }]}>Driver verification is not complete</Text>
          </View>
          <Text style={[styles.body, { color: palette.muted }]}>Your verification status is {verification.replace(/_/g, " ")}. You can return here after SKIMA approves your driver profile.</Text>
          <StatusPill status={verification} />
        </Card>
      ) : (
        <View style={styles.content}>
          <Card variant="brandSoft" padding="lg">
            <View style={styles.profileRow}>
              <View style={[styles.statusIcon, { backgroundColor: palette.surface }]}><Truck color={palette.brand} size={22} /></View>
              <View style={styles.profileCopy}>
                <Text style={[styles.eyebrow, { color: palette.brand }]}>VERIFIED DRIVER</Text>
                <Text style={[styles.cardTitle, { color: palette.ink }]}>{driverName}</Text>
                <Text style={[styles.body, { color: palette.muted }]}>{asString(profile.data, "public_driver_id") ?? "Approved SKIMA driver"}</Text>
              </View>
              <StatusPill status={operationalStatus} />
            </View>
          </Card>

          <View style={styles.stats}>
            <Stat value={String(pending.length)} label="New assignments" icon={<AlertCircle color={palette.warning} size={16} />} />
            <Stat value={String(active.length)} label="Active deliveries" icon={<Truck color={palette.brand} size={16} />} />
            <Stat value={String(completed.length)} label="Completed" icon={<CheckCircle2 color={palette.success} size={16} />} />
          </View>

          {error ? <Text accessibilityRole="alert" style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}

          <View style={styles.section}>
            <SectionHeader title="New assignments" description="Review the route and job instructions before accepting." />
            {pending.length === 0 ? (
              <Card variant="subtle" padding="lg"><Text style={[styles.body, { color: palette.muted }]}>No new driver assignments right now.</Text></Card>
            ) : pending.map((row) => (
              <DriverBookingCard
                key={asString(row, "booking_id") ?? String(row.id)}
                row={row}
                palette={palette}
                busy={actionMutation.isPending}
                onAction={(action, assignmentId) => actionMutation.mutate({
                  action,
                  bookingId: asString(row, "booking_id") ?? "",
                  assignmentId,
                })}
              />
            ))}
          </View>

          <View style={styles.section}>
            <SectionHeader title="My deliveries" description="Keep the pickup, transit and delivery milestones up to date." />
            {active.length === 0 ? (
              <Card variant="subtle" padding="lg"><Text style={[styles.body, { color: palette.muted }]}>Accepted and active jobs will appear here.</Text></Card>
            ) : active.map((row) => {
              const bookingId = asString(row, "booking_id") ?? "";
              const assignment = nested(row, "assignment");
              const assignmentId = asString(assignment, "id") ?? "";
              const status = asString(assignment, "status") ?? "accepted";
              const recipientName = recipientByBooking[bookingId] ?? "";
              const deliveryNote = noteByBooking[bookingId] ?? "";
              return (
                <Card key={bookingId} padding="lg">
                  <BookingHeader row={row} palette={palette} />
                  <RouteSummary row={row} palette={palette} />
                  <VehicleSummary assignment={assignment} palette={palette} />
                  <StatusPill status={status} />
                  {asString(row, "instructions") ? (
                    <View style={[styles.instructions, { backgroundColor: palette.warningSoft }]}>
                      <Text style={[styles.body, { color: palette.ink }]}>{asString(row, "instructions")}</Text>
                    </View>
                  ) : null}
                  {status === "accepted" ? (
                    <AppButton label="Start this delivery" fullWidth loading={actionMutation.isPending}
                      disabled={actionMutation.isPending}
                      onPress={() => actionMutation.mutate({ action: "start", bookingId, assignmentId })} />
                  ) : status === "in_progress" ? (
                    <AppButton label="Confirm pickup" fullWidth loading={actionMutation.isPending}
                      disabled={actionMutation.isPending}
                      icon={<PackageCheck color="#FFFFFF" size={16} />}
                      onPress={() => actionMutation.mutate({ action: "picked_up", bookingId, assignmentId })} />
                  ) : status === "picked_up" ? (
                    <AppButton label="Depart · mark in transit" fullWidth loading={actionMutation.isPending}
                      disabled={actionMutation.isPending}
                      icon={<Navigation color="#FFFFFF" size={16} />}
                      onPress={() => actionMutation.mutate({ action: "in_transit", bookingId, assignmentId })} />
                  ) : status === "in_transit" ? (
                    <View style={styles.deliveryFields}>
                      <Text style={[styles.cardTitle, { color: palette.ink }]}>Record customer hand-off</Text>
                      <Text style={[styles.body, { color: palette.muted }]}>Enter the name of the person who receives the goods. The customer will confirm receipt before escrow is released.</Text>
                      <AppField label="Received by" value={recipientName}
                        onChangeText={(value) => setRecipientByBooking((current) => ({ ...current, [bookingId]: value }))}
                        placeholder="Recipient name" />
                      <AppField label="Delivery note" value={deliveryNote}
                        onChangeText={(value) => setNoteByBooking((current) => ({ ...current, [bookingId]: value }))}
                        placeholder="Condition, reference or hand-off notes" multiline optional />
                      <AppButton label="Submit delivery hand-off" fullWidth loading={actionMutation.isPending}
                        disabled={actionMutation.isPending || recipientName.trim().length < 2}
                        icon={<CheckCircle2 color="#FFFFFF" size={16} />}
                        onPress={() => actionMutation.mutate({ action: "deliver", bookingId, assignmentId, recipientName, deliveryNote })} />
                    </View>
                  ) : status === "delivery_submitted" ? (
                    <View style={[styles.waiting, { backgroundColor: palette.successSoft }]}>
                      <Clock3 color={palette.success} size={17} />
                      <Text style={[styles.body, { color: palette.ink }]}>Delivery hand-off submitted. Waiting for the customer to confirm receipt.</Text>
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </View>

          <View style={styles.section}>
            <SectionHeader title="Completed deliveries" description="Bookings close after customer confirmation and settlement." />
            {completed.length === 0 ? (
              <Card variant="subtle" padding="lg"><Text style={[styles.body, { color: palette.muted }]}>Your completed deliveries will be kept here.</Text></Card>
            ) : completed.map((row) => (
              <Card key={asString(row, "booking_id") ?? String(row.id)} padding="md">
                <BookingHeader row={row} palette={palette} />
                <StatusPill status={asString(row, "booking_status") ?? "completed"} />
              </Card>
            ))}
          </View>
        </View>
      )}
    </Screen>
  );
}

type Palette = ReturnType<typeof useAppTheme>["palette"];

function DriverBookingCard({ row, palette, busy, onAction }: {
  row: Record<string, unknown>;
  palette: Palette;
  busy: boolean;
  onAction: (action: "accept" | "reject", assignmentId: string) => void;
}) {
  const assignment = nested(row, "assignment");
  const assignmentId = asString(assignment, "id") ?? "";
  return (
    <Card padding="lg">
      <BookingHeader row={row} palette={palette} />
      <RouteSummary row={row} palette={palette} />
      <VehicleSummary assignment={assignment} palette={palette} />
      {asString(row, "instructions") ? (
        <View style={[styles.instructions, { backgroundColor: palette.warningSoft }]}>
          <Text style={[styles.body, { color: palette.ink }]}>{asString(row, "instructions")}</Text>
        </View>
      ) : null}
      <View style={styles.actions}>
        <View style={styles.actionCell}>
          <AppButton label="Decline" fullWidth variant="secondary" disabled={busy} onPress={() =>
            Alert.alert("Decline assignment?", "The company will be able to assign another eligible driver.", [
              { text: "Keep assignment", style: "cancel" },
              { text: "Decline", style: "destructive", onPress: () => onAction("reject", assignmentId) },
            ])
          } />
        </View>
        <View style={styles.actionCell}>
          <AppButton label="Accept job" fullWidth disabled={busy} loading={busy} onPress={() => onAction("accept", assignmentId)} />
        </View>
      </View>
    </Card>
  );
}

function BookingHeader({ row, palette }: { row: Record<string, unknown>; palette: Palette }) {
  const title = asString(row, "title") ?? "Logistics delivery";
  const customer = asString(row, "customer_name") ?? "Customer";
  const currency = asString(row, "currency_code") ?? "NGN";
  const amount = asNumber(row, "delivery_amount") ?? 0;
  return (
    <View style={styles.bookingHead}>
      <View style={[styles.bookingIcon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={18} /></View>
      <View style={styles.bookingCopy}>
        <Text style={[styles.bookingTitle, { color: palette.ink }]} numberOfLines={2}>{title}</Text>
        <Text style={[styles.meta, { color: palette.muted }]}>{customer} · {money(amount, currency)}</Text>
      </View>
    </View>
  );
}

function RouteSummary({ row, palette }: { row: Record<string, unknown>; palette: Palette }) {
  const pickup = place(row.pickup_location);
  const destination = place(row.destination_location);
  const phone = asString(row, "customer_phone");
  return (
    <View style={[styles.route, { backgroundColor: palette.surfaceSubtle }]}>
      <RouteLine color={palette.brand} label={pickup} palette={palette} />
      <View style={[styles.routeStem, { borderColor: palette.borderStrong }]} />
      <RouteLine color={palette.success} label={destination} palette={palette} />
      {phone ? (
        <Pressable onPress={() => void Linking.openURL("tel:" + phone)} style={styles.phoneLine}>
          <Phone color={palette.brand} size={14} />
          <Text style={[styles.phone, { color: palette.brand }]}>{phone}</Text>
        </Pressable>
      ) : null}
      <Pressable onPress={() => void Linking.openURL("https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(destination))}
        style={styles.directions}>
        <Navigation color={palette.brand} size={14} />
        <Text style={[styles.directionsText, { color: palette.brand }]}>Open destination directions</Text>
      </Pressable>
    </View>
  );
}

function RouteLine({ color, label, palette }: { color: string; label: string; palette: Palette }) {
  return <View style={styles.routeLine}>
    <View style={[styles.routeDot, { backgroundColor: color }]} />
    <Text style={[styles.routeText, { color: palette.ink }]}>{label}</Text>
  </View>;
}

function VehicleSummary({ assignment, palette }: { assignment: Record<string, unknown> | null; palette: Palette }) {
  const vehicle = nested(assignment, "vehicle");
  const label = [
    asString(vehicle, "vehicle_type"),
    asString(vehicle, "manufacturer"),
    asString(vehicle, "model"),
  ].filter(Boolean).join(" ");
  const registration = asString(vehicle, "registration_number");
  return (
    <View style={[styles.vehicle, { backgroundColor: palette.surfaceSubtle }]}>
      <Truck color={palette.muted} size={15} />
      <Text style={[styles.vehicleText, { color: palette.muted }]}>
        {label || "Assigned vehicle"}{registration ? " · " + registration : ""}
      </Text>
    </View>
  );
}

function Stat({ value, label, icon }: { value: string; label: string; icon: React.ReactNode }) {
  const { palette } = useAppTheme();
  return <View style={[styles.stat, { borderColor: palette.border, backgroundColor: palette.surface }]}>
    <View style={[styles.statIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
    <Text style={[styles.statValue, { color: palette.ink }]}>{value}</Text>
    <Text style={[styles.statLabel, { color: palette.muted }]}>{label}</Text>
  </View>;
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  section: { gap: 10 },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  profileCopy: { flex: 1, gap: 3, minWidth: 0 },
  eyebrow: { ...typography.eyebrow, fontSize: 8 },
  statusIcon: { width: 45, height: 45, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  cardTitle: { ...typography.bodyStrong, fontSize: 13 },
  body: { ...typography.caption, fontSize: 10, lineHeight: 17 },
  stats: { flexDirection: "row", gap: 8 },
  stat: { flex: 1, minWidth: 0, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 10, gap: 2 },
  statIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  statValue: { ...typography.heading, fontSize: 20 },
  statLabel: { ...typography.caption, fontSize: 8 },
  bookingHead: { flexDirection: "row", alignItems: "center", gap: 9 },
  bookingIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  bookingCopy: { flex: 1, minWidth: 0, gap: 2 },
  bookingTitle: { ...typography.bodyStrong, fontSize: 12 },
  meta: { ...typography.caption, fontSize: 9, lineHeight: 16 },
  route: { borderRadius: radii.lg, padding: 12, gap: 5 },
  routeLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeDot: { width: 7, height: 7, borderRadius: 4 },
  routeText: { ...typography.caption, fontSize: 10, flex: 1, lineHeight: 16 },
  routeStem: { height: 9, borderLeftWidth: 1, marginLeft: 3 },
  phoneLine: { flexDirection: "row", alignItems: "center", gap: 7, paddingTop: 5 },
  phone: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  directions: { flexDirection: "row", alignItems: "center", gap: 7, paddingTop: 5 },
  directionsText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  vehicle: { flexDirection: "row", alignItems: "center", gap: 8, padding: 10, borderRadius: radii.md },
  vehicleText: { ...typography.caption, fontSize: 9, flex: 1 },
  instructions: { borderRadius: radii.md, padding: 11 },
  deliveryFields: { gap: 9 },
  actions: { flexDirection: "row", gap: 8 },
  actionCell: { flex: 1 },
  waiting: { flexDirection: "row", alignItems: "flex-start", gap: 8, borderRadius: radii.md, padding: 12 },
  error: { ...typography.caption, fontSize: 10 },
});
