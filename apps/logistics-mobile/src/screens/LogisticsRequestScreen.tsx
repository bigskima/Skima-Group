import { router, useLocalSearchParams } from "expo-router";
import { createClientIdempotencyKey } from "@skima/frontend-core";
import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, ArrowRight, Box, Check, ChevronRight, FileText, MapPin, Package, ShieldCheck, Truck, Weight } from "lucide-react-native";
import { Pressable, RefreshControl, StyleSheet, Text, View } from "react-native";
import { asString, useCreateLogisticsJob, useLogisticsQuery } from "../api/logistics";
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

type Place = Record<string, unknown>;
type Category = Record<string, unknown>;
function locationSnapshot(place: Place | null): Record<string, unknown> {
  if (!place) return {};
  return {
    formatted_address: asString(place, "formatted_address", "display_name", "canonical_name"),
    address_components: place.address_components && typeof place.address_components === "object"
      ? place.address_components
      : {},
    coordinates: place.location && typeof place.location === "object" ? place.location : null,
    place_id: asString(place, "place_id"),
    source: asString(place, "location_source") ?? "geography_catalogue",
  };
}
const CARGO_TYPES = [
  { key: "", label: "Not specified" },
  { key: "general", label: "General goods" },
  { key: "documents", label: "Documents" },
  { key: "fragile", label: "Fragile items" },
  { key: "furniture", label: "Furniture" },
  { key: "perishable", label: "Perishable" },
] as const;

export function LogisticsRequestScreen() {
  const { palette } = useAppTheme();
  const { context } = useSession();
  const params = useLocalSearchParams<{ category?: string }>();
  const categoriesQuery = useLogisticsQuery(["categories"], "/runtime/logistics/categories");
  const createJob = useCreateLogisticsJob();
  const [jobIdempotencyKey, setJobIdempotencyKey] = useState(() => createClientIdempotencyKey("logistics.job.create"));
  const [step, setStep] = useState(1);
  const [categoryKey, setCategoryKey] = useState("");
  const [pickupSearch, setPickupSearch] = useState("");
  const [destinationSearch, setDestinationSearch] = useState("");
  const [pickup, setPickup] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [weight, setWeight] = useState("");
  const [cargoType, setCargoType] = useState<string>("");
  const [customerName, setCustomerName] = useState(context?.profile?.display_name ?? "");
  const [customerPhone, setCustomerPhone] = useState("");
  const [instructions, setInstructions] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);

  const categories = useMemo(() => (categoriesQuery.data ?? []).filter((item) => asString(item, "status") === "active"), [categoriesQuery.data]);
  const selectedCategory = categories.find((item) => asString(item, "key") === categoryKey) ?? null;

  useEffect(() => {
    const requestedKey = typeof params.category === "string" ? params.category : "";
    if (requestedKey && categories.some((item) => asString(item, "key") === requestedKey)) setCategoryKey(requestedKey);
  }, [params.category, categories]);

  useEffect(() => {
    if (!customerName.trim() && context?.profile?.display_name) setCustomerName(context.profile.display_name);
  }, [context?.profile?.display_name, customerName]);

  const pickupName = pickup ? asString(pickup, "canonical_name") : null;
  const destinationName = destination ? asString(destination, "canonical_name") : null;
  const validWeight = !weight.trim() || (Number.isFinite(Number(weight)) && Number(weight) > 0);
  const phoneValid = /^\+?[0-9][0-9 ()-]{6,22}$/.test(customerPhone.trim());
  const canContinueFromRoute = Boolean(categoryKey && pickup && destination);
  const canSubmit = Boolean(
    selectedCategory && pickup && destination && title.trim().length >= 3 &&
    customerName.trim().length >= 2 && phoneValid && validWeight && !createJob.isPending
  );

  const submit = async () => {
    setFieldError(null);
    if (!selectedCategory) { setStep(1); setFieldError("Choose a logistics service to continue."); return; }
    if (!pickup || !destination) { setStep(1); setFieldError("Choose both a pickup and a destination."); return; }
    if (title.trim().length < 3) { setStep(2); setFieldError("Add a short title for what you are moving."); return; }
    if (!validWeight) { setStep(2); setFieldError("Weight must be a positive number."); return; }
    if (customerName.trim().length < 2) { setStep(3); setFieldError("Enter the name the provider should contact."); return; }
    if (!phoneValid) { setStep(3); setFieldError("Enter a valid phone number for provider coordination."); return; }

    const pickupId = asString(pickup, "id");
    const destinationId = asString(destination, "id");
    const category = asString(selectedCategory, "key");
    if (!pickupId || !destinationId || !category) { setFieldError("The selected location or service is missing an identifier. Please choose it again."); return; }

    const cargo: Record<string, unknown> = { cargo_type_keys: cargoType ? [cargoType] : [] };
    if (weight.trim()) cargo.weight_kg = Number(weight);

    try {
      const jobId = await createJob.mutateAsync({
        idempotencyKey: jobIdempotencyKey,
        payload: {
          category_key: category,
          service_key: category,
          title: title.trim(),
          description: description.trim() || null,
          pickup: { geography_id: pickupId, display_name: pickupName, address_snapshot: locationSnapshot(pickup) },
          destination: { geography_id: destinationId, display_name: destinationName, address_snapshot: locationSnapshot(destination) },
          cargo,
          customer_contact: { name: customerName.trim(), phone: customerPhone.trim() },
          instructions: instructions.trim() || null,
          metadata: { source: "skima.logistics.mobile", requested_via: "customer_app" },
        },
      });
      setJobIdempotencyKey(createClientIdempotencyKey("logistics.job.create"));
      router.replace({ pathname: "/(customer)/jobs/[id]", params: { id: jobId } } as never);
    } catch (cause) {
      setFieldError(cause instanceof Error ? cause.message : "Your request could not be published. Please try again.");
    }
  };

  const next = () => {
    setFieldError(null);
    if (step === 1 && !canContinueFromRoute) {
      if (!categoryKey) setFieldError("Select the type of logistics service.");
      else if (!pickup) setFieldError("Select your pickup location.");
      else setFieldError("Select your destination.");
      return;
    }
    if (step === 2) {
      if (title.trim().length < 3) { setFieldError("Add a short title for what you are moving."); return; }
      if (!validWeight) { setFieldError("Weight must be a positive number."); return; }
    }
    if (step === 3) {
      if (customerName.trim().length < 2) { setFieldError("Enter a contact name."); return; }
      if (!phoneValid) { setFieldError("Enter a valid phone number."); return; }
    }
    setStep((current) => Math.min(4, current + 1));
  };

  return (
    <Screen eyebrow="NEW REQUEST" title="Tell us what’s moving" subtitle="Share the route and a few details. Eligible companies in your area can respond with offers."
      refreshControl={<RefreshControl refreshing={categoriesQuery.isRefetching} onRefresh={() => void categoriesQuery.refetch()} tintColor={palette.brand} />}>
      <View style={styles.progress}>
        {[1, 2, 3, 4].map((part) => <View key={part} style={[styles.progressSegment, { backgroundColor: part <= step ? palette.brand : palette.border }]} />)}
        <Text style={[styles.progressText, { color: palette.muted }]}>STEP {step} OF 4</Text>
      </View>

      {categoriesQuery.isPending ? <ScreenSkeleton cards={2} /> : categoriesQuery.error ? (
        <StatePanel title="Services could not load" description="The live Logistics service list is temporarily unavailable." retry={() => void categoriesQuery.refetch()} />
      ) : (
        <View style={styles.content}>
          {step === 1 ? (
            <>
              <SectionHeader title="Choose a service" description="Pick the closest match. You can explain the details next." />
              <View style={styles.categoryGrid}>
                {categories.map((item) => {
                  const key = asString(item, "key") ?? "";
                  const chosen = key === categoryKey;
                  return (
                    <Pressable key={key} onPress={() => setCategoryKey(key)} style={[styles.category, {
                      backgroundColor: chosen ? palette.brandSofter : palette.surface,
                      borderColor: chosen ? palette.brand : palette.border,
                    }]}>
                      <View style={[styles.categoryIcon, { backgroundColor: chosen ? palette.brandSoft : palette.surfaceSubtle }]}><Package color={chosen ? palette.brand : palette.muted} size={20} /></View>
                      <Text style={[styles.categoryName, { color: palette.ink }]}>{asString(item, "display_name") ?? "Service"}</Text>
                      <Text style={[styles.categoryDescription, { color: palette.muted }]} numberOfLines={2}>{asString(item, "description") ?? "Logistics service"}</Text>
                      {chosen ? <View style={[styles.categoryCheck, { backgroundColor: palette.brand }]}><Check color="#FFFFFF" size={13} /></View> : null}
                    </Pressable>
                  );
                })}
              </View>
              <SectionHeader title="Where should it go?" description="Choose an active pickup and destination from SKIMA’s location catalogue." />
              <Card padding="md">
                <GeographyPicker label="Pickup location" mode="address" value={pickupSearch} selected={pickup} onChange={(value) => { setPickupSearch(value); setPickup(null); }} onSelect={(place) => { setPickup(place); setPickupSearch(asString(place, "canonical_name") ?? ""); }} error={fieldError && !pickup ? fieldError : null} />
                <View style={[styles.routeDivider, { borderColor: palette.border }]} />
                <GeographyPicker label="Destination" mode="address" value={destinationSearch} selected={destination} onChange={(value) => { setDestinationSearch(value); setDestination(null); }} onSelect={(place) => { setDestination(place); setDestinationSearch(asString(place, "canonical_name") ?? ""); }} error={fieldError && pickup && !destination ? fieldError : null} />
              </Card>
            </>
          ) : step === 2 ? (
            <>
              <SectionHeader title="A little more detail" description="Help providers understand the item and prepare a suitable offer." />
              <Card padding="lg">
                <View style={styles.sectionLead}>
                  <View style={[styles.sectionIcon, { backgroundColor: palette.brandSoft }]}><FileText color={palette.brand} size={20} /></View>
                  <View style={styles.sectionCopy}>
                    <Text style={[styles.sectionTitle, { color: palette.ink }]}>Describe your request</Text>
                    <Text style={[styles.sectionDescription, { color: palette.muted }]}>A clear title helps companies respond faster.</Text>
                  </View>
                </View>
                <AppField label="What are you moving?" value={title} onChangeText={setTitle} placeholder="e.g. Deliver a sofa and two chairs" maxLength={180} error={fieldError?.includes("title") ? fieldError : null} />
                <AppField label="Additional details" value={description} onChangeText={setDescription} placeholder="Size, quantity, handling needs…" multiline optional />
                <View style={styles.fieldGroup}>
                  <Text style={[styles.fieldLabel, { color: palette.ink }]}>Cargo type</Text>
                  <View style={styles.typeChoices}>
                    {CARGO_TYPES.map((choice) => {
                      const chosen = cargoType === choice.key;
                      return <Pressable key={choice.key} onPress={() => setCargoType(choice.key)} style={[styles.typeChip, { borderColor: chosen ? palette.brand : palette.border, backgroundColor: chosen ? palette.brandSoft : palette.surface }]}>
                        <Text style={[styles.typeText, { color: chosen ? palette.brand : palette.muted }]}>{choice.label}</Text>
                      </Pressable>;
                    })}
                  </View>
                </View>
                <AppField label="Estimated weight (kg)" value={weight} onChangeText={setWeight} placeholder="e.g. 25" keyboardType="decimal-pad" optional leading={<Weight color={palette.muted} size={16} />} error={fieldError?.includes("Weight") ? fieldError : null} hint="Leave blank if you do not know the weight." />
              </Card>
            </>
          ) : step === 3 ? (
            <>
              <SectionHeader title="Contact details" description="Tell the selected companies how to reach you about the request." />
              <Card padding="lg">
                <View style={styles.sectionLead}>
                  <View style={[styles.sectionIcon, { backgroundColor: palette.successSoft }]}><ShieldCheck color={palette.success} size={20} /></View>
                  <View style={styles.sectionCopy}>
                    <Text style={[styles.sectionTitle, { color: palette.ink }]}>Contact details</Text>
                    <Text style={[styles.sectionDescription, { color: palette.muted }]}>Matched providers can use these details to coordinate the job.</Text>
                  </View>
                </View>
                <AppField label="Contact name" value={customerName} onChangeText={setCustomerName} placeholder="Your name" error={fieldError?.includes("contact") ? fieldError : null} />
                <AppField label="Phone number" value={customerPhone} onChangeText={setCustomerPhone} placeholder="+234 800 000 0000" keyboardType="phone-pad" error={fieldError?.includes("phone") ? fieldError : null} hint="Use a number the provider can reach." />
                <AppField label="Handling instructions" value={instructions} onChangeText={setInstructions} placeholder="Gate access, fragile items, preferred contact time…" multiline optional />
              </Card>
            </>
            </>
          ) : (
            <>
              <SectionHeader title="Review your request" description="Check the details before sharing it with eligible providers." />
              <Card variant="brandSoft" padding="lg">
                <View style={styles.reviewTop}>
                  <View style={[styles.sectionIcon, { backgroundColor: palette.surface }]}><Truck color={palette.brand} size={21} /></View>
                  <View style={styles.sectionCopy}>
                    <Text style={[styles.reviewEyebrow, { color: palette.brand }]}>SERVICE</Text>
                    <Text style={[styles.reviewTitle, { color: palette.ink }]}>{asString(selectedCategory, "display_name") ?? "Logistics service"}</Text>
                  </View>
                </View>
                <View style={styles.reviewRoute}>
                  <View style={styles.reviewLine}><View style={[styles.routeDot, { backgroundColor: palette.brand }]} /><Text style={[styles.reviewText, { color: palette.ink }]}>{pickupName}</Text></View>
                  <View style={[styles.routeStem, { borderColor: palette.borderStrong }]} />
                  <View style={styles.reviewLine}><View style={[styles.routeDot, { backgroundColor: palette.success }]} /><Text style={[styles.reviewText, { color: palette.ink }]}>{destinationName}</Text></View>
                </View>
              </Card>
              <Card padding="lg">
                <Text style={[styles.summaryTitle, { color: palette.ink }]}>{title}</Text>
                {description ? <Text style={[styles.summaryBody, { color: palette.muted }]}>{description}</Text> : null}
                <View style={[styles.summaryDivider, { backgroundColor: palette.border }]} />
                <SummaryLine label="Cargo type" value={CARGO_TYPES.find((item) => item.key === cargoType)?.label ?? "Not specified"} />
                {weight.trim() ? <SummaryLine label="Estimated weight" value={`${weight} kg`} /> : null}
                <SummaryLine label="Contact" value={customerName} />
                <SummaryLine label="Phone" value={customerPhone} />
                {instructions.trim() ? <SummaryLine label="Instructions" value={instructions} /> : null}
              </Card>
              <View style={[styles.safetyNote, { backgroundColor: palette.successSoft }]}>
                <ShieldCheck color={palette.success} size={17} />
                <Text style={[styles.safetyText, { color: palette.ink }]}>Your request is shared with providers qualified for the service, route and stated cargo requirements. Viewing opportunities is free.</Text>
              </View>
            </>
          )}

          {fieldError ? <View style={[styles.errorBox, { backgroundColor: palette.dangerSoft }]}><AlertCircle color={palette.danger} size={16} /><Text style={[styles.errorText, { color: palette.danger }]}>{fieldError}</Text></View> : null}

          <View style={styles.actions}>
            {step > 1 ? <AppButton label="Back" variant="secondary" onPress={() => { setFieldError(null); setStep((current) => current - 1); }} icon={<ArrowLeft color={palette.ink} size={16} />} /> : null}
            {step < 4 ? <AppButton label="Continue" fullWidth={step === 1} onPress={next} trailingIcon={<ArrowRight color="#FFFFFF" size={16} />} /> :
              <AppButton label="Publish request" fullWidth loading={createJob.isPending} onPress={() => void submit()} trailingIcon={<ArrowRight color="#FFFFFF" size={16} />} />}
          </View>
        </View>
      )}
    </Screen>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return <View style={styles.summaryLine}><Text style={[styles.summaryLabel, { color: palette.muted }]}>{label}</Text><Text style={[styles.summaryValue, { color: palette.ink }]}>{value}</Text></View>;
}

const styles = StyleSheet.create({
  content: { gap: spacing.lg },
  progress: { flexDirection: "row", alignItems: "center", gap: 6 },
  progressSegment: { flex: 1, height: 5, borderRadius: radii.pill },
  progressText: { ...typography.eyebrow, fontSize: 8, marginLeft: 5 },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  category: { width: "48.5%", flexGrow: 1, flexBasis: "46%", minHeight: 138, borderWidth: 1, borderRadius: radii.xl, padding: 12, gap: 8 },
  categoryIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  categoryName: { ...typography.bodyStrong, fontSize: 12 },
  categoryDescription: { ...typography.caption, fontSize: 9, lineHeight: 14 },
  categoryCheck: { position: "absolute", top: 10, right: 10, width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  routeDivider: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: 4 },
  sectionLead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  sectionIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  sectionCopy: { flex: 1, minWidth: 0, gap: 2 },
  sectionTitle: { ...typography.bodyStrong, fontSize: 14 },
  sectionDescription: { ...typography.caption, lineHeight: 17 },
  fieldGroup: { gap: 8 },
  fieldLabel: { ...typography.caption, fontSize: 12, fontWeight: "900" },
  typeChoices: { flexDirection: "row", flexWrap: "wrap", gap: 7 },
  typeChip: { borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 11, paddingVertical: 8 },
  typeText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  reviewTop: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  reviewEyebrow: { ...typography.eyebrow, fontSize: 8 },
  reviewTitle: { ...typography.heading, fontSize: 17 },
  reviewRoute: { gap: 4, padding: spacing.md, borderRadius: radii.lg, backgroundColor: "rgba(255,255,255,.52)" },
  reviewLine: { flexDirection: "row", alignItems: "center", gap: 8 },
  routeDot: { width: 7, height: 7, borderRadius: 4 },
  reviewText: { ...typography.bodyStrong, fontSize: 12 },
  routeStem: { height: 10, borderLeftWidth: 1, marginLeft: 3 },
  summaryTitle: { ...typography.sectionTitle, fontSize: 15 },
  summaryBody: { ...typography.caption, lineHeight: 18 },
  summaryDivider: { height: StyleSheet.hairlineWidth, marginVertical: 5 },
  summaryLine: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: 14 },
  summaryLabel: { ...typography.caption, fontSize: 10 },
  summaryValue: { ...typography.caption, flex: 1, fontWeight: "900", textAlign: "right", fontSize: 11 },
  safetyNote: { flexDirection: "row", alignItems: "flex-start", gap: 9, borderRadius: radii.lg, padding: spacing.md },
  safetyText: { flex: 1, ...typography.caption, fontSize: 10, lineHeight: 16 },
  errorBox: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: spacing.md, borderRadius: radii.md },
  errorText: { ...typography.caption, flex: 1, lineHeight: 18 },
  actions: { flexDirection: "row", gap: spacing.sm },
});
