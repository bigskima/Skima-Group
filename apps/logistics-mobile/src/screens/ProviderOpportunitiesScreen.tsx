import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, ChevronDown, ChevronUp, Mail, MapPin, Phone, Send, ShieldCheck, Truck, Weight } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Linking, Modal, Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
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
import { SectionHeader } from "../ui/SectionHeader";
import { StatePanel } from "../ui/StatePanel";
import { StatusPill } from "../ui/StatusPill";

type OfferDraft = {
  opportunityId: string;
  jobTitle: string;
  currency: string;
  decimals: number;
  action: "quote" | "counter";
  parentOfferId: string | null;
  idempotencyKey: string;
};
function nested(record: Record<string, unknown> | null | undefined, key: string) {
  const value = record?.[key];
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function locationName(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "Location not supplied";
  const record = value as Record<string, unknown>;
  return asString(record, "display_name", "canonical_name", "formatted_address", "address") ?? "Location not supplied";
}
function cargoTypes(value: unknown) {
  if (!Array.isArray(value)) return "General cargo";
  return value.map((item) => String(item).replace(/[._]/g, " ")).join(", ") || "General cargo";
}
function dateLabel(value: string | null) {
  if (!value) return "Recently matched";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Recently matched" : new Intl.DateTimeFormat("en-NG", { day: "numeric", month: "short" }).format(parsed);
}

export function ProviderOpportunitiesScreen() {
  const { palette } = useAppTheme();
  const { api } = useSession();
  const client = useQueryClient();
  const companies = useLogisticsQuery(["company"], "/runtime/logistics/company");
  const company = companies.data?.[0] ?? null;
  const organizationId = asString(company, "organization_id");
  const verified = asString(company, "verification_status") === "verified" && asString(company, "operational_status") === "active";
  const opportunitiesQuery = useLogisticsQuery(
    ["opportunities", organizationId ?? "none"],
    `/runtime/logistics/opportunities?organizationId=${encodeURIComponent(organizationId ?? "")}`,
    Boolean(organizationId), 20_000,
  );
  const offersQuery = useLogisticsQuery(["provider-offers", organizationId ?? "none"], "/runtime/logistics/offers", Boolean(organizationId), 25_000);
  const currencies = useLogisticsQuery(["currencies"], "/engines/currencies");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selected, setSelected] = useState<OfferDraft | null>(null);
  const [price, setPrice] = useState("");
  const [duration, setDuration] = useState("");
  const [terms, setTerms] = useState("");
  const [error, setError] = useState<string | null>(null);

  const enabledCurrencies = (currencies.data ?? []).filter((item) => asString(item, "status") === "enabled");
  const offers = offersQuery.data ?? [];
  const opportunities = useMemo(() => (opportunitiesQuery.data ?? []).filter((item) => {
    const status = (asString(item, "status") ?? "").toLowerCase();
    if (!["matched", "viewed", "offered"].includes(status)) return false;
    if (filter !== "all" && status !== filter) return false;
    const snapshot = nested(item, "job_snapshot");
    const query = search.trim().toLowerCase();
    return !query || [
      asString(snapshot, "title"),
      asString(snapshot, "category_key"),
      locationName(snapshot?.pickup),
      locationName(snapshot?.destination),
    ].some((part) => part.toLowerCase().includes(query));
  }), [opportunitiesQuery.data, filter, search]);
  const pending = companies.isPending || (Boolean(organizationId) && (opportunitiesQuery.isPending || offersQuery.isPending || currencies.isPending));
  const refresh = () => Promise.all([companies.refetch(), opportunitiesQuery.refetch(), offersQuery.refetch(), currencies.refetch()]);

  const submitOffer = useMutation({
    mutationFn: async () => {
      if (!selected) throw new Error("Choose a customer opportunity first.");
      const amount = Number(price);
      if (!Number.isFinite(amount) || amount <= 0) throw new Error("Enter a positive offer amount.");
      const minor = amount * (10 ** selected.decimals);
      if (!Number.isSafeInteger(Math.round(minor)) || Math.abs(minor - Math.round(minor)) > 1e-7) {
        throw new Error(\`Enter an amount with no more than \${selected.decimals} decimal places.\`);
      }
      const durationMinutes = duration.trim() ? Number(duration) : null;
      if (durationMinutes !== null && (!Number.isSafeInteger(durationMinutes) || durationMinutes <= 0)) {
        throw new Error("Estimated delivery time must be a positive whole number of minutes.");
      }
      const common = {
        currencyCode: selected.currency,
        deliveryPriceMinor: Math.round(minor),
        estimatedDurationMinutes: durationMinutes,
        terms: terms.trim() ? { message: terms.trim() } : {},
        idempotencyKey: selected.idempotencyKey,
      };
      if (selected.action === "counter" && selected.parentOfferId) {
        return api.post("/runtime/logistics/offers/counter", {
          ...common,
          parentOfferId: selected.parentOfferId,
        }, z.string().uuid());
      }
      return api.post("/runtime/logistics/offers", {
        ...common,
        opportunityId: selected.opportunityId,
      }, z.string().uuid());
    },
    onSuccess: async () => {
      setSelected(null); setPrice(""); setDuration(""); setTerms(""); setError(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["skima-logistics", "offers"] }),
        client.invalidateQueries({ queryKey: ["skima-logistics", "opportunities"] }),
      ]);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Your offer could not be submitted."),
  });

  const openOffer = (opportunityId: string, title: string, action: "quote" | "counter", parentOfferId: string | null) => {
    const preferred = enabledCurrencies.find((item) => asString(item, "code") === "NGN") ?? enabledCurrencies[0];
    if (!preferred) { setError("There is no enabled currency available for provider offers."); return; }
    setError(null);
    setSelected({
      opportunityId, jobTitle: title, action, parentOfferId,
      currency: asString(preferred, "code") ?? "NGN",
      decimals: asNumber(preferred, "decimal_places") ?? 2,
      idempotencyKey: createClientIdempotencyKey(
        action === "counter" ? "logistics.provider.counter" : "logistics.provider.offer",
        `${opportunityId}:${parentOfferId ?? "root"}`,
      ),
    });
    setPrice(""); setDuration(""); setTerms("");
  };

  return (
    <>
      <Screen eyebrow="MATCHED REQUESTS" title="Opportunities" subtitle="Qualified customer requests matched to your company’s services and operating areas."
        refreshControl={<RefreshControl refreshing={opportunitiesQuery.isRefetching || companies.isRefetching || offersQuery.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}>
        {pending ? <ScreenSkeleton cards={3} /> : companies.error || opportunitiesQuery.error ? (
          <StatePanel title="Opportunities unavailable" description="We could not load your company’s matched requests." retry={() => void refresh()} />
        ) : !company ? (
          <StatePanel title="Register your company first" description="Complete company registration, service configuration and geographic coverage before viewing the provider inbox." />
        ) : offersQuery.error || currencies.error ? (
          <StatePanel title="Quote tools unavailable" description="The company quote and currency data could not be loaded. Refresh before responding to a customer." retry={() => void refresh()} />
        ) : !verified ? (
          <Card variant="warning" padding="lg">
            <View style={[styles.iconBadge, { backgroundColor: palette.warningSoft }]}><ShieldCheck color={palette.warning} size={23} /></View>
            <Text style={[styles.blockTitle, { color: palette.ink }]}>Company verification is in progress</Text>
            <Text style={[styles.blockBody, { color: palette.muted }]}>You can configure your company while SKIMA reviews it. Live matching becomes available after verification and activation.</Text>
          </Card>
        ) : opportunities.length === 0 ? (
          <Card variant="subtle" padding="lg">
            <View style={styles.empty}>
              <View style={[styles.iconBadge, { backgroundColor: palette.brandSoft }]}><BriefcaseBusiness color={palette.brand} size={23} /></View>
              <Text style={[styles.blockTitle, { color: palette.ink }]}>No matched requests yet</Text>
              <Text style={[styles.blockBody, { color: palette.muted }]}>New customer requests appear here when your service capabilities, cargo capacity and geographic coverage match. Viewing opportunities is free.</Text>
            </View>
          </Card>
        ) : (
          <View style={styles.content}>
            <AppField label="Search requests" value={search} onChangeText={setSearch} placeholder="Search service, pickup or destination" leading={<MapPin color={palette.muted} size={16} />} />
            <View style={styles.filters}>
              {["all", "matched", "viewed", "offered"].map((key) => {
                const chosen = filter === key;
                return <Pressable key={key} onPress={() => setFilter(key)} style={[styles.filter, { backgroundColor: chosen ? palette.brand : palette.surface, borderColor: chosen ? palette.brand : palette.border }]}><Text style={[styles.filterText, { color: chosen ? "#FFFFFF" : palette.muted }]}>{key === "all" ? "All" : key[0].toUpperCase()+key.slice(1)}</Text></Pressable>;
              })}
            </View>
            <SectionHeader title="Matched to your company" description={\`\${opportunities.length} \${opportunities.length === 1 ? "opportunity" : "opportunities"}\`} />
            <View style={styles.list}>
              {opportunities.map((item) => {
                const opportunityId = asString(item, "id") ?? "";
                const snapshot = nested(item, "job_snapshot");
                const contact = nested(item, "customer_contact_snapshot");
                const title = asString(snapshot, "title") ?? "Customer logistics request";
                const cargo = nested(snapshot, "cargo");
                const chain = offers.filter((offer) => asString(offer, "opportunity_id") === opportunityId && asString(offer, "organization_id") === organizationId);
                const latest = [...chain].sort((a, b) => new Date(asString(b, "created_at") ?? 0).getTime() - new Date(asString(a, "created_at") ?? 0).getTime())[0] ?? null;
                const latestType = asString(latest, "offer_type");
                const latestStatus = asString(latest, "status");
                const isCustomerCounter = latestType === "customer_counter" && latestStatus === "submitted";
                const isProviderOffer = (latestType === "provider_quote" || latestType === "provider_counter") && latestStatus === "submitted";
                const isExpired = Boolean(asString(latest, "expires_at") && new Date(String(latest?.expires_at)).getTime() <= Date.now());
                const expanded = expandedId === opportunityId;
                const durationKg = asNumber(cargo, "weight_kg");
                return (
                  <Card key={opportunityId} padding="md">
                    <Pressable accessibilityRole="button" onPress={() => setExpandedId(expanded ? null : opportunityId)} style={styles.cardHead}>
                      <View style={[styles.opportunityIcon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={19} /></View>
                      <View style={styles.opportunityCopy}>
                        <Text style={[styles.opportunityTitle, { color: palette.ink }]} numberOfLines={2}>{title}</Text>
                        <Text style={[styles.opportunityMeta, { color: palette.muted }]}>{asString(snapshot, "category_key")?.replace(/[._]/g, " ") ?? "Matched service"} · {dateLabel(asString(item, "created_at"))}</Text>
                      </View>
                      <StatusPill status={asString(item, "status") ?? "matched"} />
                      {expanded ? <ChevronUp color={palette.muted} size={16} /> : <ChevronDown color={palette.muted} size={16} />}
                    </Pressable>
                    <View style={[styles.routeBox, { backgroundColor: palette.surfaceSubtle }]}>
                      <RouteLine color={palette.brand} label={locationName(snapshot?.pickup)} />
                      <View style={[styles.routeStem, { borderColor: palette.borderStrong }]} />
                      <RouteLine color={palette.success} label={locationName(snapshot?.destination)} />
                    </View>
                    <View style={styles.summaryRow}>
                      <View style={styles.summaryItem}><Weight color={palette.muted} size={13} /><Text style={[styles.summaryText, { color: palette.muted }]}>{durationKg ? \`\${durationKg} kg\` : "Weight not set"}</Text></View>
                      <Text style={[styles.summaryText, { color: palette.muted }]} numberOfLines={1}>{cargoTypes(cargo?.cargo_type_keys)}</Text>
                    </View>
                    {expanded ? (
                      <View style={styles.expanded}>
                        {asString(snapshot, "description") ? <Text style={[styles.description, { color: palette.muted }]}>{asString(snapshot, "description")}</Text> : null}
                        {asString(snapshot, "instructions") ? <View style={[styles.instructions, { backgroundColor: palette.warningSoft }]}><Text style={[styles.instructionsText, { color: palette.ink }]}>{asString(snapshot, "instructions")}</Text></View> : null}
                        <View style={[styles.contact, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
                          <View style={styles.contactHead}><ShieldCheck color={palette.success} size={15} /><Text style={[styles.contactTitle, { color: palette.ink }]}>Customer contact</Text><Text style={[styles.contactTag, { color: palette.success }]}>Matched provider only</Text></View>
                          <Text style={[styles.contactName, { color: palette.ink }]}>{asString(contact, "name") ?? "Customer"}</Text>
                          {asString(contact, "phone") ? <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(\`tel:\${asString(contact, "phone")}\`)} style={styles.contactLine}><Phone color={palette.brand} size={14} /><Text style={[styles.contactValue, { color: palette.brand }]}>{asString(contact, "phone")}</Text></Pressable> : null}
                          {asString(contact, "email") ? <Pressable accessibilityRole="button" onPress={() => void Linking.openURL(\`mailto:\${asString(contact, "email")}\`)} style={styles.contactLine}><Mail color={palette.brand} size={14} /><Text style={[styles.contactValue, { color: palette.brand }]}>{asString(contact, "email")}</Text></Pressable> : null}
                        </View>
                        {isCustomerCounter ? (
                          <Card variant="warning" padding="sm">
                            <Text style={[styles.counterTitle, { color: palette.ink }]}>Customer sent a counteroffer</Text>
                            <Text style={[styles.counterBody, { color: palette.muted }]}>Review the latest counter and respond with your revised price.</Text>
                            <AppButton label="Respond to counteroffer" fullWidth onPress={() => openOffer(opportunityId, title, "counter", asString(latest, "id"))} />
                          </Card>
                        ) : isProviderOffer && !isExpired ? (
                          <Card variant="success" padding="sm"><Text style={[styles.sentLabel, { color: palette.success }]}>Your latest offer is with the customer. You can reply when they counter.</Text></Card>
                        ) : (
                          <AppButton label={isExpired ? "Send an updated offer" : "Send your offer"} fullWidth onPress={() => openOffer(opportunityId, title, "quote", null)} trailingIcon={<Send color="#FFFFFF" size={15} />} />
                        )}
                      </View>
                    ) : (
                      <Pressable onPress={() => setExpandedId(opportunityId)} style={styles.expandHint}><Text style={[styles.expandText, { color: palette.brand }]}>View job details and customer contact</Text></Pressable>
                    )}
                  </Card>
                );
              })}
            </View>
          </View>
        )}
        {error ? <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}><Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text></View> : null}
      </Screen>

      <Modal visible={Boolean(selected)} transparent animationType="slide" statusBarTranslucent onRequestClose={() => setSelected(null)}>
        <View style={[styles.modalRoot, { backgroundColor: palette.overlay }]}>
          <Pressable style={StyleSheet.absoluteFill} accessibilityRole="button" accessibilityLabel="Close quote form" onPress={() => setSelected(null)} />
          <View style={[styles.sheet, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.handleRow}><View style={[styles.handle, { backgroundColor: palette.borderStrong }]} /></View>
            <Text style={[styles.sheetEyebrow, { color: palette.brand }]}>{selected?.action === "counter" ? "PROVIDER COUNTEROFFER" : "PROVIDER QUOTE"}</Text>
            <Text style={[styles.sheetTitle, { color: palette.ink }]}>{selected?.action === "counter" ? "Respond to customer" : "Send your offer"}</Text>
            <Text style={[styles.description, { color: palette.muted }]} numberOfLines={2}>{selected?.jobTitle}</Text>
            <AppField label={\`Your price (\${selected?.currency ?? ""})\`} value={price} onChangeText={setPrice} keyboardType="decimal-pad" placeholder="Enter total delivery price" />
            <AppField label="Estimated time (minutes)" value={duration} onChangeText={setDuration} keyboardType="number-pad" placeholder="e.g. 120" optional />
            <AppField label="Offer notes" value={terms} onChangeText={setTerms} multiline placeholder="Included services, conditions or exclusions…" optional />
            <View style={[styles.feeNote, { backgroundColor: palette.successSoft }]}><ShieldCheck color={palette.success} size={15} /><Text style={[styles.feeNoteText, { color: palette.ink }]}>There is no lead unlock fee. Provider fees follow the confirmed booking’s selected payment mode.</Text></View>
            {error ? <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text> : null}
            <AppButton label={selected?.action === "counter" ? "Send counteroffer" : "Submit offer"} fullWidth loading={submitOffer.isPending} onPress={() => { setError(null); submitOffer.mutate(); }} trailingIcon={<Send color="#FFFFFF" size={15} />} />
            <AppButton label="Cancel" fullWidth variant="ghost" onPress={() => setSelected(null)} />
          </View>
        </View>
      </Modal>
    </>
  );
}

function RouteLine({ color, label }: { color: string; label: string }) {
  const { palette } = useAppTheme();
  return <View style={styles.routeLine}><View style={[styles.routeDot, { backgroundColor: color }]} /><Text style={[styles.routeLabel, { color: palette.ink }]} numberOfLines={1}>{label}</Text></View>;
}
const styles = StyleSheet.create({
  content: { gap: spacing.md },
  list: { gap: 10 },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 9 },
  opportunityIcon: { width: 39, height: 39, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  opportunityCopy: { flex: 1, minWidth: 0, gap: 2 },
  opportunityTitle: { ...typography.bodyStrong, fontSize: 12 },
  opportunityMeta: { ...typography.caption, fontSize: 9 },
  routeBox: { borderRadius: radii.lg, padding: 11, gap: 4 },
  routeLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeDot: { width: 7, height: 7, borderRadius: 4 },
  routeLabel: { ...typography.caption, fontSize: 10, flex: 1 },
  routeStem: { height: 10, borderLeftWidth: 1, marginLeft: 3 },
  summaryRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  summaryItem: { flexDirection: "row", alignItems: "center", gap: 5 },
  summaryText: { ...typography.caption, fontSize: 9 },
  expanded: { gap: 10 },
  description: { ...typography.caption, fontSize: 10, lineHeight: 17 },
  instructions: { padding: 10, borderRadius: radii.md },
  instructionsText: { ...typography.caption, fontSize: 10, lineHeight: 16 },
  contact: { gap: 7, padding: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  contactHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  contactTitle: { ...typography.bodyStrong, flex: 1, fontSize: 11 },
  contactTag: { ...typography.caption, fontSize: 8, fontWeight: "900" },
  contactName: { ...typography.bodyStrong, fontSize: 12 },
  contactLine: { flexDirection: "row", alignItems: "center", gap: 7, minHeight: 24 },
  contactValue: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  counterTitle: { ...typography.bodyStrong, fontSize: 11 },
  counterBody: { ...typography.caption, fontSize: 9, lineHeight: 15 },
  sentLabel: { ...typography.caption, fontSize: 10, lineHeight: 16 },
  expandHint: { paddingTop: 2 },
  expandText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  filter: { minHeight: 35, justifyContent: "center", borderRadius: radii.pill, borderWidth: 1, paddingHorizontal: 13 },
  filterText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  iconBadge: { width: 50, height: 50, borderRadius: 17, alignItems: "center", justifyContent: "center" },
  blockTitle: { ...typography.bodyStrong, fontSize: 14 },
  blockBody: { ...typography.caption, lineHeight: 18, fontSize: 10 },
  empty: { alignItems: "flex-start", gap: 9 },
  modalRoot: { flex: 1, justifyContent: "flex-end", padding: 10 },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, borderRadius: 28, borderWidth: 1, padding: 19, paddingBottom: 28, gap: 13 },
  handleRow: { alignItems: "center", paddingBottom: 2 },
  handle: { width: 44, height: 4, borderRadius: 3 },
  sheetEyebrow: { ...typography.eyebrow, fontSize: 9 },
  sheetTitle: { ...typography.heading, fontSize: 22 },
  feeNote: { flexDirection: "row", gap: 8, alignItems: "flex-start", padding: 11, borderRadius: radii.md },
  feeNoteText: { ...typography.caption, flex: 1, fontSize: 9, lineHeight: 15 },
  error: { padding: 12, borderRadius: radii.md },
  errorText: { ...typography.caption, fontSize: 10, lineHeight: 17 },
});
