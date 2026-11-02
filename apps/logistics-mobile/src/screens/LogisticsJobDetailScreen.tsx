import { createClientIdempotencyKey } from "@skima/frontend-core";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, Clock3, RefreshCw, ShieldCheck, Truck, WalletCards } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Modal, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { asNumber, asString, useLogisticsQuery } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { SectionHeader } from "../ui/SectionHeader";
import { StatePanel } from "../ui/StatePanel";
import { StatusPill } from "../ui/StatusPill";

type PaymentMode = "online_wallet" | "offline";
function nested(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function majorAmount(minor: number, currency: string, decimals: number | null) {
  if (decimals === null) return `${currency} ${minor.toLocaleString("en-NG")} minor units`;
  const value = minor / (10 ** decimals);
  try {
    return new Intl.NumberFormat("en-NG", { style: "currency", currency, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  } catch { return `${currency} ${value.toFixed(decimals)}`; }
}
function getErrorMessage(error: unknown) {
  const raw = error instanceof Error ? error.message : "The booking could not be created.";
  if (/financial policy|policy version|no active policy|missing.*policy/i.test(raw)) {
    return "This quote cannot be booked yet because SKIMA has not activated the required fee policy for this currency. Your request and offer are still saved.";
  }
  return raw;
}

export function LogisticsJobDetailScreen() {
  const { id: routeId } = useLocalSearchParams<{ id: string }>();
  const jobId = Array.isArray(routeId) ? routeId[0] : routeId;
  const { palette } = useAppTheme();
  const { api } = useSession();
  const jobs = useLogisticsQuery(["jobs"], "/runtime/logistics/jobs", Boolean(jobId));
  const opportunitiesQuery = useLogisticsQuery(["opportunities"], "/runtime/logistics/opportunities", Boolean(jobId));
  const offersQuery = useLogisticsQuery(["offers", jobId], `/runtime/logistics/offers?jobId=${encodeURIComponent(jobId ?? "")}`, Boolean(jobId));
  const currencies = useLogisticsQuery(["currencies"], "/engines/currencies");
  const bookings = useLogisticsQuery(["bookings"], "/runtime/logistics/bookings", Boolean(jobId));
  const [showBooking, setShowBooking] = useState(false);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>("online_wallet");
  const [selectedOfferId, setSelectedOfferId] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const job = (jobs.data ?? []).find((item) => asString(item, "id") === jobId) ?? null;
  const opportunities = useMemo(() => (opportunitiesQuery.data ?? []).filter((item) => asString(item, "job_id") === jobId), [opportunitiesQuery.data, jobId]);
  const offers = useMemo(() => (offersQuery.data ?? []).filter((item) => asString(item, "job_id") === jobId), [offersQuery.data, jobId]);
  const activeBookings = (bookings.data ?? []).filter((item) => asString(item, "job_id") === jobId);
  const existingBooking = activeBookings[0] ?? null;
  const refresh = async () => {
    await Promise.all([jobs.refetch(), opportunitiesQuery.refetch(), offersQuery.refetch(), bookings.refetch()]);
  };

  const createBooking = useMutation({
    mutationFn: async (offerId: string) => api.post(
      "/runtime/logistics/offers/select",
      { offerId, paymentMode, idempotencyKey: createClientIdempotencyKey("logistics.booking.create", offerId) },
      z.string().uuid(),
    ),
    onSuccess: (bookingId) => {
      setShowBooking(false);
      router.push({ pathname: "/(customer)/bookings/[id]", params: { id: bookingId } } as never);
    },
    onError: (error) => setLocalError(getErrorMessage(error)),
  });

  const refreshMatches = useMutation({
    mutationFn: async () => api.post(
      "/runtime/logistics/jobs/match",
      { jobId, idempotencyKey: createClientIdempotencyKey("logistics.job.match-refresh", jobId) },
      z.number().int(),
    ),
    onSuccess: async () => { await refresh(); },
    onError: (error) => setLocalError(error.message),
  });

  const currencyDecimals = (code: string) => {
    const currency = currencies.data?.find((item) => asString(item, "code") === code);
    return currency ? asNumber(currency, "decimal_places") : null;
  };
  const isLoading = jobs.isPending || opportunitiesQuery.isPending || offersQuery.isPending;
  const error = jobs.error ?? opportunitiesQuery.error ?? offersQuery.error;
  const title = asString(job, "title") ?? "Logistics request";
  const status = asString(job, "status") ?? "open";

  return (
    <>
      <Screen eyebrow="REQUEST DETAILS" title={title} subtitle="Review matched logistics companies and compare their offers."
        action={<AppButton size="sm" variant="secondary" label="Back" icon={<ArrowLeft color={palette.ink} size={15} />} onPress={() => router.back()} />}
        refreshControl={<RefreshControl refreshing={jobs.isRefetching || opportunitiesQuery.isRefetching || offersQuery.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}>
        {isLoading ? <ScreenSkeleton cards={3} /> : error ? (
          <StatePanel title="Request details couldn’t load" description="Try refreshing this request." retry={() => void refresh()} />
        ) : !job ? (
          <StatePanel title="Request not found" description="This request may have been completed, removed or is no longer available." />
        ) : (
          <View style={styles.content}>
            <Card padding="lg">
              <View style={styles.jobTop}>
                <View style={[styles.jobIcon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={22} /></View>
                <View style={styles.jobCopy}>
                  <Text style={[styles.jobTitle, { color: palette.ink }]}>{title}</Text>
                  <Text style={[styles.jobMeta, { color: palette.muted }]}>{asString(job, "service_key")?.replace(/[._]/g, " ") ?? "Logistics service"}</Text>
                </View>
                <StatusPill status={status} />
              </View>
              <View style={[styles.routeBox, { backgroundColor: palette.surfaceSubtle }]}>
                <RouteLine marker="pickup" label={locationName(job.pickup_location)} />
                <View style={[styles.routeStem, { borderColor: palette.borderStrong }]} />
                <RouteLine marker="destination" label={locationName(job.destination_location)} />
              </View>
              <View style={styles.jobMetaRow}>
                <Text style={[styles.jobMeta, { color: palette.muted }]}>Created {formatDate(asString(job, "created_at"))}</Text>
                <Text style={[styles.jobMeta, { color: palette.muted }]}>{opportunities.length} matched {opportunities.length === 1 ? "company" : "companies"}</Text>
              </View>
              {asString(job, "description") ? <Text style={[styles.description, { color: palette.muted }]}>{asString(job, "description")}</Text> : null}
            </Card>

            {existingBooking ? (
              <Card variant="success" padding="lg">
                <View style={styles.successHead}><ShieldCheck color={palette.success} size={21} /><Text style={[styles.successTitle, { color: palette.ink }]}>A provider has been selected</Text></View>
                <Text style={[styles.description, { color: palette.muted }]}>Your booking is ready for the next step.</Text>
                <AppButton label="Open booking" fullWidth onPress={() => router.push({ pathname: "/(customer)/bookings/[id]", params: { id: String(existingBooking.id) } } as never)} trailingIcon={<ArrowRight color="#FFFFFF" size={16} />} />
              </Card>
            ) : null}

            <View style={styles.section}>
              <SectionHeader title="Matched companies" description="Companies that qualified for your service and selected route." action={
                opportunities.length === 0 ? <AppButton size="sm" variant="secondary" label="Refresh matches" loading={refreshMatches.isPending} onPress={() => { setLocalError(null); refreshMatches.mutate(); }} /> : undefined
              } />
              {opportunities.length === 0 ? (
                <Card padding="lg">
                  <View style={styles.waiting}>
                    <View style={[styles.waitingIcon, { backgroundColor: palette.brandSoft }]}><Clock3 color={palette.brand} size={22} /></View>
                    <Text style={[styles.waitingTitle, { color: palette.ink }]}>Still looking for a match</Text>
                    <Text style={[styles.description, { color: palette.muted }]}>No active company currently covers this exact request. You can refresh matching as the network grows.</Text>
                    <AppButton label="Check for providers again" fullWidth loading={refreshMatches.isPending} variant="secondary" onPress={() => { setLocalError(null); refreshMatches.mutate(); }} />
                  </View>
                </Card>
              ) : (
                <View style={styles.companyList}>
                  {opportunities.map((opportunity) => {
                    const snapshot = nested(opportunity, "job_snapshot");
                    const organizationId = asString(opportunity, "organization_id") ?? "";
                    const companyName = asString(snapshot, "provider_name") ?? "Verified logistics company";
                    const serviceName = asString(snapshot, "provider_service_name") ?? asString(snapshot, "service_name") ?? "Qualified for this route";
                    const companyOffers = offers.filter((offer) => asString(offer, "organization_id") === organizationId);
                    const latestProviderOffer = companyOffers
                      .filter((offer) => asString(offer, "status") === "submitted" &&
                        ["provider_quote", "provider_counter"].includes(asString(offer, "offer_type") ?? ""))
                      .sort((left, right) => String(right.created_at ?? "").localeCompare(String(left.created_at ?? "")))[0] ?? null;
                    return (
                      <View key={String(opportunity.id)} style={[styles.companyCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                        <View style={styles.companyHead}>
                          <View style={[styles.companyIcon, { backgroundColor: palette.successSoft }]}><ShieldCheck color={palette.success} size={18} /></View>
                          <View style={styles.companyCopy}>
                            <Text style={[styles.companyName, { color: palette.ink }]} numberOfLines={1}>{companyName}</Text>
                            <Text style={[styles.companyService, { color: palette.muted }]} numberOfLines={1}>{serviceName}</Text>
                          </View>
                          <StatusPill status={asString(opportunity, "status") ?? "matched"} />
                        </View>
                        <Text style={[styles.companyStatus, { color: palette.muted }]}>
                          {companyOffers.length ? `${companyOffers.length} offer ${companyOffers.length === 1 ? "submitted" : "updates"}` : "Opportunity delivered · awaiting company response"}
                        </Text>
                        {latestProviderOffer ? (() => {
                          const offer = latestProviderOffer;
                          const amountMinor = asNumber(offer, "delivery_price_minor");
                          const currency = asString(offer, "currency_code") ?? "";
                          const decimals = currencyDecimals(currency);
                          const offerId = asString(offer, "id");
                          return (
                            <View key={offerId} style={[styles.offerInline, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
                              <View style={{ flex: 1, gap: 3 }}>
                                <Text style={[styles.offerPrice, { color: palette.ink }]}>{amountMinor !== null ? majorAmount(amountMinor, currency, decimals) : "Price unavailable"}</Text>
                                <Text style={[styles.offerMeta, { color: palette.muted }]}>{asNumber(offer, "estimated_duration_minutes") ? `Approx. ${asNumber(offer, "estimated_duration_minutes")} minutes` : "Delivery time to be agreed"} · {asString(offer, "offer_type")?.replace(/_/g, " ") ?? "Provider quote"}</Text>
                              </View>
                              <AppButton label="Choose" size="sm" onPress={() => { setLocalError(null); setShowBooking(true); setSelectedOfferId(offerId ?? ""); }} />
                            </View>
                          );
                        })() : (
                          <Text style={[styles.companyStatus, { color: palette.muted }]}>
                            {companyOffers.some((offer) => asString(offer, "offer_type") === "customer_counter" && asString(offer, "status") === "submitted")
                              ? "Your counteroffer is with the company."
                              : companyOffers.length ? "The company is preparing its next offer." : "Opportunity delivered · awaiting company response"}
                          </Text>
                        )}
                      </View>
                    );
                  })}
                </View>
              )}
            </View>

            {localError ? <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}><Text style={[styles.errorText, { color: palette.danger }]}>{localError}</Text></View> : null}
            {offers.length === 0 && opportunities.length > 0 ? (
              <View style={[styles.note, { backgroundColor: palette.brandSofter }]}><Clock3 color={palette.brand} size={16} /><Text style={[styles.noteText, { color: palette.ink }]}>Providers can view a matched opportunity for free. You’ll see a quote here as soon as a company responds.</Text></View>
            ) : null}
          </View>
        )}
      </Screen>

      <BookingModeSheet
        visible={showBooking}
        paymentMode={paymentMode}
        setPaymentMode={setPaymentMode}
        busy={createBooking.isPending}
        onClose={() => setShowBooking(false)}
        onConfirm={() => selectedOfferId && createBooking.mutate(selectedOfferId)}
      />
    </>
  );

}

function BookingModeSheet({ visible, paymentMode, setPaymentMode, busy, onClose, onConfirm }: {
  visible: boolean; paymentMode: PaymentMode; setPaymentMode(value: PaymentMode): void;
  busy: boolean; onClose(): void; onConfirm(): void;
}) {
  const { palette } = useAppTheme();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.modalRoot, { backgroundColor: palette.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close booking payment selection" />
        <View style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.sheetHandle}><View style={[styles.handle, { backgroundColor: palette.borderStrong }]} /></View>
          <Text style={[styles.sheetEyebrow, { color: palette.brand }]}>BOOK THIS OFFER</Text>
          <Text style={[styles.sheetTitle, { color: palette.ink }]}>Choose how you’ll pay</Text>
          <Text style={[styles.description, { color: palette.muted }]}>The delivery price and the applicable customer booking fee are locked to your booking. The exact amount appears before wallet payment.</Text>
          <Pressable onPress={() => setPaymentMode("online_wallet")} style={[styles.paymentChoice, { borderColor: paymentMode === "online_wallet" ? palette.brand : palette.border, backgroundColor: paymentMode === "online_wallet" ? palette.brandSofter : palette.surface }]}>
            <View style={[styles.choiceIcon, { backgroundColor: palette.brandSoft }]}><WalletCards color={palette.brand} size={19} /></View>
            <View style={styles.choiceCopy}><Text style={[styles.choiceTitle, { color: palette.ink }]}>Pay online with wallet</Text><Text style={[styles.choiceBody, { color: palette.muted }]}>Your delivery amount is reserved in escrow, plus the customer booking fee.</Text></View>
            <View style={[styles.radioOuter, { borderColor: paymentMode === "online_wallet" ? palette.brand : palette.borderStrong }]}>{paymentMode === "online_wallet" ? <View style={[styles.radioInner, { backgroundColor: palette.brand }]} /> : null}</View>
          </Pressable>
          <Pressable onPress={() => setPaymentMode("offline")} style={[styles.paymentChoice, { borderColor: paymentMode === "offline" ? palette.brand : palette.border, backgroundColor: paymentMode === "offline" ? palette.brandSofter : palette.surface }]}>
            <View style={[styles.choiceIcon, { backgroundColor: palette.successSoft }]}><Truck color={palette.success} size={19} /></View>
            <View style={styles.choiceCopy}><Text style={[styles.choiceTitle, { color: palette.ink }]}>Pay offline</Text><Text style={[styles.choiceBody, { color: palette.muted }]}>You pay the customer booking fee. The company’s separate receival fee is charged to its wallet.</Text></View>
            <View style={[styles.radioOuter, { borderColor: paymentMode === "offline" ? palette.brand : palette.borderStrong }]}>{paymentMode === "offline" ? <View style={[styles.radioInner, { backgroundColor: palette.brand }]} /> : null}</View>
          </Pressable>
          <AppButton label="Confirm provider" fullWidth loading={busy} onPress={onConfirm} trailingIcon={<ArrowRight color="#FFFFFF" size={16} />} />
          <AppButton label="Not now" fullWidth variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function RouteLine({ marker, label }: { marker: "pickup" | "destination"; label: string }) {
  const { palette } = useAppTheme();
  return <View style={styles.routeLine}><View style={[styles.routeDot, { backgroundColor: marker === "pickup" ? palette.brand : palette.success }]} /><Text style={[styles.routeText, { color: palette.ink }]} numberOfLines={1}>{label}</Text></View>;
}
function locationName(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Location pending";
  return asString(value as Record<string, unknown>, "display_name", "canonical_name", "formatted_address", "address") ?? "Location pending";
}
function formatDate(value: string | null) {
  if (!value) return "just now";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "recently" : new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short" }).format(parsed);
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  jobTop: { flexDirection: "row", alignItems: "center", gap: 10 },
  jobIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  jobCopy: { flex: 1, minWidth: 0, gap: 3 },
  jobTitle: { ...typography.bodyStrong, fontSize: 14 },
  jobMeta: { ...typography.caption, fontSize: 10, textTransform: "capitalize" },
  routeBox: { borderRadius: radii.lg, padding: 12, gap: 4 },
  routeLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeDot: { width: 7, height: 7, borderRadius: 4 },
  routeText: { ...typography.caption, fontSize: 10, flex: 1 },
  routeStem: { height: 10, borderLeftWidth: 1, marginLeft: 3 },
  jobMetaRow: { flexDirection: "row", justifyContent: "space-between", gap: 10 },
  description: { ...typography.caption, lineHeight: 18, fontSize: 11 },
  section: { gap: 12 },
  companyList: { gap: 10 },
  companyCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: 14, gap: 11 },
  companyHead: { flexDirection: "row", alignItems: "center", gap: 9 },
  companyIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  companyCopy: { flex: 1, minWidth: 0, gap: 2 },
  companyName: { ...typography.bodyStrong, fontSize: 13 },
  companyService: { ...typography.caption, fontSize: 9 },
  companyStatus: { ...typography.caption, fontSize: 10 },
  offerInline: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 11 },
  offerPrice: { ...typography.heading, fontSize: 17, lineHeight: 21 },
  offerMeta: { ...typography.caption, fontSize: 9, lineHeight: 14, textTransform: "capitalize" },
  waiting: { alignItems: "flex-start", gap: 10 },
  waitingIcon: { width: 48, height: 48, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  waitingTitle: { ...typography.bodyStrong, fontSize: 14 },
  successHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  successTitle: { ...typography.bodyStrong, fontSize: 14 },
  note: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 13, borderRadius: radii.lg },
  noteText: { ...typography.caption, flex: 1, fontSize: 10, lineHeight: 17 },
  error: { padding: 13, borderRadius: radii.md },
  errorText: { ...typography.caption, lineHeight: 18 },
  modalRoot: { flex: 1, justifyContent: "flex-end", padding: 10 },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderRadius: 28, borderWidth: 1, padding: 19, paddingBottom: 28, gap: 13 },
  sheetHandle: { alignItems: "center", paddingBottom: 2 },
  handle: { width: 44, height: 4, borderRadius: 3 },
  sheetEyebrow: { ...typography.eyebrow, fontSize: 9 },
  sheetTitle: { ...typography.heading, fontSize: 22 },
  paymentChoice: { flexDirection: "row", alignItems: "center", gap: 10, borderWidth: 1, borderRadius: radii.lg, padding: 12 },
  choiceIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  choiceCopy: { flex: 1, gap: 3 },
  choiceTitle: { ...typography.bodyStrong, fontSize: 12 },
  choiceBody: { ...typography.caption, fontSize: 9, lineHeight: 14 },
  radioOuter: { width: 20, height: 20, borderWidth: 1.7, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  radioInner: { width: 10, height: 10, borderRadius: 5 },
});
