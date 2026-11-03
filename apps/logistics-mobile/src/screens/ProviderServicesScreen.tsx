import { useMutation } from "@tanstack/react-query";
import { Check, ChevronDown, MapPin, Plus, Settings2, ShieldCheck, Truck } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { z } from "zod";
import { asString, useLogisticsQuery } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { AppField } from "../ui/AppField";
import { Card } from "../ui/Card";
import { GeographyPicker } from "../ui/GeographyPicker";
import { Screen } from "../ui/Screen";
import { ScreenSkeleton } from "../ui/ScreenSkeleton";
import { SectionHeader } from "../ui/SectionHeader";
import { StatePanel } from "../ui/StatePanel";
import { StatusPill } from "../ui/StatusPill";

const PRICING_MODES = [
  { key: "negotiated", label: "Negotiated" },
  { key: "quote_required", label: "Quote required" },
  { key: "fixed", label: "Fixed price" },
  { key: "distance", label: "Distance based" },
  { key: "weight", label: "Weight based" },
  { key: "hybrid", label: "Hybrid" },
] as const;
const COVERAGE_MODES = [
  { key: "both", label: "Pickup + destination" },
  { key: "origin", label: "Pickup only" },
  { key: "destination", label: "Destination only" },
  { key: "route", label: "Specific route" },
] as const;

export function ProviderServicesScreen() {
  const { palette } = useAppTheme();
  const { api } = useSession();
  const companies = useLogisticsQuery(["provider-company"], "/runtime/logistics/company");
  const categoriesQuery = useLogisticsQuery(["categories"], "/runtime/logistics/categories");
  const servicesQuery = useLogisticsQuery(["provider-services"], "/runtime/logistics/company/services");
  const coverageQuery = useLogisticsQuery(["provider-coverage"], "/runtime/logistics/company/coverage");
  const company = companies.data?.[0] ?? null;
  const organizationId = asString(company, "organization_id");
  const allServices = useMemo(() => (servicesQuery.data ?? []).filter((item) => asString(item, "organization_id") === organizationId), [servicesQuery.data, organizationId]);
  const categories = (categoriesQuery.data ?? []).filter((item) => asString(item, "status") === "active");

  const [showServiceForm, setShowServiceForm] = useState(false);
  const [serviceName, setServiceName] = useState("");
  const [serviceKey, setServiceKey] = useState("");
  const [description, setDescription] = useState("");
  const [categoryKey, setCategoryKey] = useState("");
  const [pricingMode, setPricingMode] = useState<string>("negotiated");
  const [weight, setWeight] = useState("");
  const [volume, setVolume] = useState("");
  const [coverageServiceKey, setCoverageServiceKey] = useState("");
  const [coverageMode, setCoverageMode] = useState<string>("both");
  const [origin, setOrigin] = useState<Record<string, unknown> | null>(null);
  const [originSearch, setOriginSearch] = useState("");
  const [destination, setDestination] = useState<Record<string, unknown> | null>(null);
  const [destinationSearch, setDestinationSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

  const createService = useMutation({
    mutationFn: () => api.post("/runtime/logistics/company/services", {
      organizationId,
      categoryKey,
      serviceKey: serviceKey.trim().toLowerCase(),
      displayName: serviceName.trim(),
      description: description.trim() || null,
      pricingMode,
      capabilityKeys: [],
      cargoTypeKeys: [],
      vehicleTypeKeys: [],
      maximumWeightKg: weight.trim() ? Number(weight) : null,
      maximumVolumeM3: volume.trim() ? Number(volume) : null,
      availabilityEnabled: true,
      idempotencyKey: `logistics-service:${organizationId}:${serviceKey.trim().toLowerCase()}:v1`,
      metadata: { configured_from: "provider_mobile" },
    }, z.string().uuid()),
    onSuccess: async (id) => {
      setShowServiceForm(false);
      setServiceName(""); setServiceKey(""); setDescription(""); setWeight(""); setVolume("");
      setCoverageServiceKey(serviceKey.trim().toLowerCase());
      await servicesQuery.refetch();
      setError(null);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "The service could not be saved."),
  });

  const addCoverage = useMutation({
    mutationFn: () => {
      const originId = asString(origin, "id");
      const destinationId = asString(destination, "id");
      if (!originId) throw new Error("Choose a coverage location.");
      if (coverageMode === "route" && !destinationId) throw new Error("Choose the route destination.");
      return api.post("/runtime/logistics/company/coverage", {
        organizationId,
        serviceKey: coverageServiceKey,
        coverageMode,
        geographyId: originId,
        destinationGeographyId: coverageMode === "route" ? destinationId : null,
        idempotencyKey: `logistics-coverage:${organizationId}:${coverageServiceKey}:${coverageMode}:${originId}:${destinationId ?? "none"}`,
        metadata: { configured_from: "provider_mobile" },
      }, z.string().uuid());
    },
    onSuccess: async () => {
      setOrigin(null); setOriginSearch(""); setDestination(null); setDestinationSearch("");
      await coverageQuery.refetch();
      setError(null);
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : "Coverage could not be saved."),
  });

  const refresh = () => Promise.all([companies.refetch(), categoriesQuery.refetch(), servicesQuery.refetch(), coverageQuery.refetch()]);
  const isLoading = companies.isPending || categoriesQuery.isPending || servicesQuery.isPending || coverageQuery.isPending;

  return (
    <Screen eyebrow="COMPANY CONFIGURATION" title="Services & coverage" subtitle="Tell SKIMA what your company does and where you can fulfil requests."
      refreshControl={<RefreshControl refreshing={servicesQuery.isRefetching || coverageQuery.isRefetching} onRefresh={() => void refresh()} tintColor={palette.brand} />}>
      {isLoading ? <ScreenSkeleton cards={3} /> : !company ? (
        <StatePanel title="Register your company first" description="Create a company profile before adding services." retry={() => undefined} />
      ) : (
        <View style={styles.content}>
          <Card padding="lg">
            <View style={styles.cardHeading}>
              <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={20} /></View>
              <View style={{ flex: 1, gap: 3 }}><Text style={[styles.cardTitle, { color: palette.ink }]}>Your service catalogue</Text><Text style={[styles.description, { color: palette.muted }]}>Each service can have its own cargo requirements and pricing model.</Text></View>
              <AppButton size="sm" label="Add" icon={<Plus color="#FFFFFF" size={14} />} onPress={() => setShowServiceForm((current) => !current)} />
            </View>
            {allServices.length === 0 ? <Text style={[styles.description, { color: palette.muted }]}>No services configured yet. Add the services your company can fulfil.</Text> : (
              <View style={styles.rows}>
                {allServices.map((service) => {
                  const key = asString(service, "service_key") ?? "";
                  const relatedCoverage = (coverageQuery.data ?? []).filter((item) => asString(item, "provider_service_id") === asString(service, "id"));
                  return <View key={String(service.id)} style={[styles.row, { borderColor: palette.border }]}>
                    <View style={[styles.rowIcon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={17} /></View>
                    <View style={styles.rowCopy}><Text style={[styles.rowTitle, { color: palette.ink }]}>{asString(service, "display_name")}</Text><Text style={[styles.rowMeta, { color: palette.muted }]}>{key} · {asString(service, "pricing_mode")?.replace(/_/g, " ")}</Text><Text style={[styles.rowMeta, { color: palette.muted }]}>{relatedCoverage.length} coverage areas</Text></View>
                    <StatusPill status={asString(service, "status") ?? "draft"} />
                  </View>;
                })}
              </View>
            )}
          </Card>

          {showServiceForm ? (
            <Card padding="lg">
              <SectionHeader title="Create a service" description="Use a unique key within your company. It is not exposed as a global service catalogue key." />
              <AppField label="Service name" value={serviceName} onChangeText={setServiceName} placeholder="e.g. Same-day parcel delivery" />
              <AppField label="Service key" value={serviceKey} onChangeText={(value) => setServiceKey(value.toLowerCase().replace(/[^a-z0-9_.:-]/g, ""))} placeholder="e.g. courier.same_day" autoCapitalize="none" />
              <AppField label="Description" value={description} onChangeText={setDescription} placeholder="What customers should know about this service" multiline optional />
              <View style={styles.formGroup}>
                <Text style={[styles.formLabel, { color: palette.ink }]}>Service category</Text>
                <View style={styles.chips}>{categories.map((category) => {
                  const key = asString(category, "key") ?? "";
                  const selected = categoryKey === key;
                  return <Pressable key={key} onPress={() => setCategoryKey(key)} style={[styles.chip, { backgroundColor: selected ? palette.brandSoft : palette.surface, borderColor: selected ? palette.brand : palette.border }]}><Text style={[styles.chipText, { color: selected ? palette.brand : palette.muted }]}>{asString(category, "display_name")}</Text></Pressable>;
                })}</View>
              </View>
              <View style={styles.formGroup}>
                <Text style={[styles.formLabel, { color: palette.ink }]}>Pricing model</Text>
                <View style={styles.chips}>{PRICING_MODES.map((item) => {
                  const selected = pricingMode === item.key;
                  return <Pressable key={item.key} onPress={() => setPricingMode(item.key)} style={[styles.chip, { backgroundColor: selected ? palette.brandSoft : palette.surface, borderColor: selected ? palette.brand : palette.border }]}><Text style={[styles.chipText, { color: selected ? palette.brand : palette.muted }]}>{item.label}</Text></Pressable>;
                })}</View>
              </View>
              <View style={styles.twoFields}>
                <View style={{ flex: 1 }}><AppField label="Maximum weight (kg)" value={weight} onChangeText={setWeight} keyboardType="decimal-pad" optional placeholder="No limit" /></View>
                <View style={{ flex: 1 }}><AppField label="Max volume (m³)" value={volume} onChangeText={setVolume} keyboardType="decimal-pad" optional placeholder="No limit" /></View>
              </View>
              <View style={styles.actions}>
                <AppButton label="Cancel" variant="secondary" onPress={() => setShowServiceForm(false)} />
                <AppButton label="Save service" loading={createService.isPending} disabled={!organizationId || serviceName.trim().length < 2 || !/^[a-z][a-z0-9_.:-]{2,120}$/.test(serviceKey) || !categoryKey} onPress={() => { setError(null); createService.mutate(); }} />
              </View>
            </Card>
          ) : null}

          <Card padding="lg">
            <SectionHeader title="Service coverage" description="Set pickup and destination locations or a specific route for each service." />
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: palette.ink }]}>Choose a service</Text>
              <View style={styles.chips}>{allServices.map((service) => {
                const key = asString(service, "service_key") ?? "";
                const selected = coverageServiceKey === key;
                return <Pressable key={key} onPress={() => setCoverageServiceKey(key)} style={[styles.chip, { backgroundColor: selected ? palette.brandSoft : palette.surface, borderColor: selected ? palette.brand : palette.border }]}><Text style={[styles.chipText, { color: selected ? palette.brand : palette.muted }]}>{asString(service, "display_name")}</Text></Pressable>;
              })}</View>
            </View>
            <View style={styles.formGroup}>
              <Text style={[styles.formLabel, { color: palette.ink }]}>Coverage type</Text>
              <View style={styles.chips}>{COVERAGE_MODES.map((item) => {
                const selected = coverageMode === item.key;
                return <Pressable key={item.key} onPress={() => setCoverageMode(item.key)} style={[styles.chip, { backgroundColor: selected ? palette.brandSoft : palette.surface, borderColor: selected ? palette.brand : palette.border }]}><Text style={[styles.chipText, { color: selected ? palette.brand : palette.muted }]}>{item.label}</Text></Pressable>;
              })}</View>
            </View>
            <GeographyPicker label={coverageMode === "destination" ? "Destination area" : "Pickup / origin area"} value={originSearch} selected={origin} onChange={(v) => { setOriginSearch(v); setOrigin(null); }} onSelect={(place) => { setOrigin(place); setOriginSearch(asString(place, "canonical_name") ?? ""); }} />
            {coverageMode === "route" ? <GeographyPicker label="Route destination" value={destinationSearch} selected={destination} onChange={(v) => { setDestinationSearch(v); setDestination(null); }} onSelect={(place) => { setDestination(place); setDestinationSearch(asString(place, "canonical_name") ?? ""); }} /> : null}
            <AppButton label="Add coverage area" fullWidth loading={addCoverage.isPending} disabled={!organizationId || !coverageServiceKey || !origin || (coverageMode === "route" && !destination)} onPress={() => { setError(null); addCoverage.mutate(); }} />
            {(coverageQuery.data ?? []).filter((item) => asString(item, "organization_id") === organizationId).length ? (
              <View style={styles.rows}>
                {(coverageQuery.data ?? []).filter((item) => asString(item, "organization_id") === organizationId).map((item) => {
                  const originName = asString(item, "geography_name") ?? "Configured location";
                  return <View key={String(item.id)} style={[styles.coverageRow, { borderColor: palette.border }]}><MapPin color={palette.brand} size={15} /><View style={{ flex: 1 }}><Text style={[styles.rowTitle, { color: palette.ink }]}>{originName}</Text><Text style={[styles.rowMeta, { color: palette.muted }]}>{asString(item, "coverage_mode")?.replace(/_/g, " ") ?? "coverage"} · {asString(item, "status")}</Text></View><StatusPill status={asString(item, "status") ?? "active"} /></View>;
                })}
              </View>
            ) : null}
          </Card>
          {error ? <Text style={[styles.error, { color: palette.danger }]}>{error}</Text> : null}
        </View>
      )}
    </Screen>
  );
}
const styles = StyleSheet.create({
  content: { gap: spacing.md },
  cardHeading: { flexDirection: "row", alignItems: "center", gap: 10 },
  icon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  cardTitle: { ...typography.bodyStrong, fontSize: 14 },
  description: { ...typography.caption, lineHeight: 17, fontSize: 10 },
  rows: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  rowIcon: { width: 35, height: 35, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  rowCopy: { flex: 1, gap: 3 },
  rowTitle: { ...typography.bodyStrong, fontSize: 11 },
  rowMeta: { ...typography.caption, fontSize: 9, textTransform: "capitalize" },
  formGroup: { gap: 8 },
  formLabel: { ...typography.caption, fontSize: 11, fontWeight: "900" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  chip: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 8 },
  chipText: { ...typography.caption, fontSize: 9, fontWeight: "900" },
  twoFields: { flexDirection: "row", gap: 10 },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: 8 },
  coverageRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 8 },
  error: { ...typography.caption, lineHeight: 18 },
});
