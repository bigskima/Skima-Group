import { createClientIdempotencyKey } from "@skima/frontend-core";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCircle2, Clock3, MapPin, PackageCheck, Phone, ShieldCheck, Truck, UserRound } from "lucide-react-native";
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
  const [recipientName, setRecipientName] = useState("");
  const [deliveryNote, setDeliveryNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const actionKeysRef = useRef(new Map<string, string>());

  const mutateAction = useMutation({
    mutationFn: async (action: "accept" | "start" | "deliver") => {
      if (!bookingId) throw new Error("Booking id is missing.");
      if (action === "deliver" && recipientName.trim().length < 2) {
        throw new Error("Enter the name of the person receiving the delivery.");
      }
      const fingerprint = action === "deliver"
        ? `deliver:${recipientName.trim()}:${deliveryNote.trim()}`
        : action;
      let key = actionKeysRef.current.get(fingerprint);
      if (!key) {
        key = createClientIdempotencyKey(`logistics.provider.booking.${action}`, `${bookingId}:${fingerprint}`);
        actionKeysRef.current.set(fingerprint, key);
      }
      if (action === "accept") return api.post("/runtime/logistics/bookings/accept", { bookingId, idempotencyKey: key }, z.string().uuid());
      if (action === "start") return api.post("/runtime/logistics/bookings/start", { bookingId, idempotencyKey: key }, z.string().uuid());
      return api.post("/runtime/logistics/bookings/delivery/submit", {
        bookingId,
        idempotencyKey: key,
        deliverySubmission: { recipientName: recipientName.trim(), deliveryNote: deliveryNote.trim() || null },
      }, z.string().uuid());
    },
    onSuccess: async () => {
      setError(null);
      await client.invalidateQueries({ queryKey: ["skima-logistics", "bookings"] });
      await client.invalidateQueries({ queryKey: ["skima-logistics", "provider-bookings"] });
      await bookings.refetch();
      if (status === "in_progress") Alert.alert("Delivery submitted", "The customer can now review and confirm delivery. Online escrow remains protected until they confirm.");
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The booking action could not be completed."),
  });

  const refresh = () => Promise.all([companies.refetch(), bookings.refetch()]);
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
              <View style={styles.actionHeading}><CheckCircle2 color={palette.success} size={20} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Booking accepted</Text></View>
              <Text style={[styles.meta, { color: palette.muted }]}>Start the service when your team is ready to fulfil this booking.</Text>
              <AppButton label="Start job" fullWidth loading={mutateAction.isPending} onPress={() => { setError(null); mutateAction.mutate("start"); }} />
            </Card>
          ) : status === "in_progress" ? (
            <Card padding="lg">
              <View style={styles.actionHeading}><Truck color={palette.brand} size={20} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Record delivery hand-off</Text></View>
              <Text style={[styles.meta, { color: palette.muted }]}>Enter the name of the person receiving the delivery. The customer will confirm the hand-off before online escrow can be released.</Text>
              <AppField label="Received by" value={recipientName} onChangeText={setRecipientName} placeholder="Name of recipient" />
              <AppField label="Delivery note" value={deliveryNote} onChangeText={setDeliveryNote} placeholder="Condition, hand-off notes or reference…" optional multiline />
              <AppButton label="Submit delivery details" fullWidth loading={mutateAction.isPending} disabled={recipientName.trim().length < 2} onPress={() => { setError(null); mutateAction.mutate("deliver"); }} trailingIcon={<PackageCheck color="#FFFFFF" size={16} />} />
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
  error: { padding: 12, borderRadius: radii.md },
  errorText: { ...typography.caption, fontSize: 10, lineHeight: 17 },
});
