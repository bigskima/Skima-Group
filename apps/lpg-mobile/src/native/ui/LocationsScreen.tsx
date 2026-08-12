import { Check, ChevronRight, Crosshair, LocateFixed, MapPin, RefreshCw, Search } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { z } from "zod";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, displaySubtitle, displayTitle, recordId } from "../api/records";
import {
  emptyOperationalAddress,
  readOperationalLocation,
  resolveOperationalAddress,
  type OperationalAddress,
  type OperationalLocation,
} from "../device/location";
import { OperationalMap } from "../maps/OperationalMap";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";

const AddressSchema = z.object({
  name: z.string().nullable().optional(),
  street: z.string().nullable().optional(),
  district: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  postalCode: z.string().nullable().optional(),
  country: z.string().nullable().optional(),
  countryCode: z.string().nullable().optional(),
}).passthrough();

const MapLookupSchema = z.object({
  addressComponents: AddressSchema.nullable().optional(),
  formattedAddress: z.string().nullable().optional(),
  location: z.object({ latitude: z.number(), longitude: z.number() }),
  placeId: z.string().nullable().optional(),
  provider: z.string(),
}).passthrough();

const AutocompleteSchema = z.object({
  predictions: z.array(z.record(z.unknown())),
  provider: z.string(),
}).passthrough();

export function LocationsScreen() {
  const { palette } = useAppTheme();
  const { width } = useWindowDimensions();
  const locations = domainQueries.locations();
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState<OperationalLocation | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [search, setSearch] = useState("");
  const [predictions, setPredictions] = useState<Record<string, unknown>[]>([]);
  const [manualAddress, setManualAddress] = useState("");
  const [manualLatitude, setManualLatitude] = useState("");
  const [manualLongitude, setManualLongitude] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useGatewayMutation({ path: "/lpg/locations", schema: ActionResponseSchema, invalidate: [["locations"]] });
  const reverseLookup = useGatewayMutation({ path: "/lpg/maps/reverse-geocode", schema: MapLookupSchema });
  const geocode = useGatewayMutation({ path: "/lpg/maps/geocode", schema: MapLookupSchema });
  const autocomplete = useGatewayMutation({ path: "/lpg/maps/autocomplete", schema: AutocompleteSchema });

  const enrich = async (point: OperationalLocation) => {
    try {
      const result = await reverseLookup.mutateAsync({
        latitude: point.latitude,
        longitude: point.longitude,
        idempotencyKey: idempotencyKey("reverse-location", `${point.latitude.toFixed(5)}:${point.longitude.toFixed(5)}`),
      });
      if (result.provider !== "google_maps" || !result.formattedAddress) return point;
      return {
        ...point,
        formattedAddress: result.formattedAddress,
        providerPlaceId: result.placeId ?? null,
        providerSource: "maps_adapter" as const,
        address: normalizeAddress(result.addressComponents),
      };
    } catch {
      return point;
    }
  };

  const detect = async () => {
    setDetecting(true);
    setNotice(null);
    try {
      const point = await enrich(await readOperationalLocation());
      setSelected(point);
      setManualAddress(isGenericAddress(point.formattedAddress) ? "" : point.formattedAddress);
      setManualLatitude(String(point.latitude));
      setManualLongitude(String(point.longitude));
      setShowManual(false);
    } catch (cause) {
      setSelected(null);
      setShowManual(true);
      setNotice(friendlyError(cause, "We couldn’t find your current location. Search for your address or enter it manually."));
    } finally {
      setDetecting(false);
    }
  };

  useEffect(() => { void detect(); }, []);

  useEffect(() => {
    const query = search.trim();
    if (query.length < 3) { setPredictions([]); return; }
    const timer = setTimeout(() => {
      void autocomplete.mutateAsync({
        input: query,
        countryComponent: "country:ng",
        idempotencyKey: idempotencyKey("location-search", query.toLowerCase()),
      }).then((result) => {
        if (result.provider === "google_maps") setPredictions(result.predictions);
        else setPredictions([]);
      }).catch(() => setPredictions([]));
    }, 400);
    return () => clearTimeout(timer);
  }, [search]);

  const choosePrediction = async (prediction: Record<string, unknown>) => {
    const description = readString(prediction.description);
    if (!description) return;
    setResolving(true);
    setNotice(null);
    try {
      const result = await geocode.mutateAsync({
        address: description,
        idempotencyKey: idempotencyKey("geocode-location", description.toLowerCase()),
      });
      if (result.provider !== "google_maps") throw new Error("map provider unavailable");
      const point: OperationalLocation = {
        latitude: result.location.latitude,
        longitude: result.location.longitude,
        accuracyMeters: null,
        recordedAt: new Date().toISOString(),
        formattedAddress: result.formattedAddress ?? description,
        providerPlaceId: result.placeId ?? null,
        providerSource: "maps_adapter",
        address: normalizeAddress(result.addressComponents),
      };
      setSelected(point);
      setManualAddress(point.formattedAddress);
      setManualLatitude(String(point.latitude));
      setManualLongitude(String(point.longitude));
      setSearch("");
      setPredictions([]);
      setShowManual(false);
    } catch (cause) {
      setNotice(friendlyError(cause, "We couldn’t open that address. Try a more specific search or place the pin manually."));
    } finally {
      setResolving(false);
    }
  };

  const selectMapPoint = async (coordinate: { latitude: number; longitude: number }) => {
    setResolving(true);
    setNotice(null);
    const local = await resolveOperationalAddress(coordinate.latitude, coordinate.longitude);
    const point: OperationalLocation = {
      ...coordinate,
      accuracyMeters: null,
      recordedAt: new Date().toISOString(),
      formattedAddress: local.formattedAddress ?? "Pinned location",
      providerPlaceId: null,
      providerSource: "manual_pin",
      address: local.address,
    };
    const enriched = await enrich(point);
    setSelected(enriched);
    setManualAddress(isGenericAddress(enriched.formattedAddress) ? "" : enriched.formattedAddress);
    setManualLatitude(String(enriched.latitude));
    setManualLongitude(String(enriched.longitude));
    setShowManual(isGenericAddress(enriched.formattedAddress));
    setResolving(false);
  };

  const applyManual = () => {
    const latitude = Number(manualLatitude);
    const longitude = Number(manualLongitude);
    if (!manualAddress.trim() || !validCoordinate(latitude, longitude)) {
      setNotice("Enter the address and valid map coordinates so we can save the correct place.");
      return;
    }
    setSelected({
      latitude,
      longitude,
      accuracyMeters: null,
      recordedAt: new Date().toISOString(),
      formattedAddress: manualAddress.trim(),
      providerPlaceId: null,
      providerSource: "manual_pin",
      address: emptyOperationalAddress(),
    });
    setNotice(null);
  };

  const save = async () => {
    if (!label.trim()) { setNotice("Name this place—for example, Home, Office or Mum’s house."); return; }
    if (!selected) { setNotice("Choose the location on the map before saving it."); return; }
    const formattedAddress = isGenericAddress(selected.formattedAddress) ? manualAddress.trim() : selected.formattedAddress;
    if (!formattedAddress) { setShowManual(true); setNotice("Add a nearby street, building or landmark so your driver can find you."); return; }
    try {
      await mutation.mutateAsync({
        label: label.trim(),
        formattedAddress,
        latitude: selected.latitude,
        longitude: selected.longitude,
        accuracyMeters: selected.accuracyMeters ?? undefined,
        providerSource: selected.providerSource,
        providerPlaceId: selected.providerPlaceId ?? undefined,
        metadata: { addressComponents: selected.address, recordedAt: selected.recordedAt },
        source: "skima.lpg.location_api",
        idempotencyKey: idempotencyKey("create-location", label.trim()),
      });
      setLabel("");
      setNotice("Place saved. You can use it for your next pickup or delivery.");
    } catch (cause) {
      setNotice(friendlyError(cause, "We couldn’t save this place. Check the details and try again."));
    }
  };

  const mapPoints = selected ? [{ latitude: selected.latitude, longitude: selected.longitude, label: label.trim() || "Selected location", kind: "destination" as const }] : [];

  return (
    <Screen eyebrow="Saved places" title="Where should we meet you?">
      {locations.isPending ? <ScreenSkeleton cards={2} /> : (
        <>
          <View style={[styles.searchBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Search color={palette.muted} size={20} />
            <TextInput
              accessibilityLabel="Search for an address"
              autoComplete="street-address"
              onChangeText={setSearch}
              placeholder="Search street, area or landmark"
              placeholderTextColor={palette.muted}
              style={[styles.searchInput, { color: palette.ink }]}
              value={search}
            />
            {autocomplete.isPending ? <ActivityIndicator color={colors.brand} size="small" /> : null}
          </View>
          {predictions.length ? (
            <View style={[styles.predictions, { backgroundColor: palette.elevated, borderColor: palette.border }]}>
              {predictions.slice(0, 5).map((prediction, index) => {
                const description = readString(prediction.description) ?? "Suggested address";
                return <Pressable key={`${description}:${index}`} onPress={() => void choosePrediction(prediction)} style={[styles.prediction, index > 0 && { borderTopColor: palette.border, borderTopWidth: 1 }]}><MapPin color={colors.brand} size={18} /><Text style={[styles.predictionText, { color: palette.ink }]}>{description}</Text><ChevronRight color={palette.muted} size={18} /></Pressable>;
              })}
            </View>
          ) : null}

          <View style={[styles.locationWorkspace, width >= 900 && styles.locationWorkspaceWide]}>
            <View style={styles.mapColumn}>
              <OperationalMap points={mapPoints} height={width < 600 ? 410 : 500} initialZoom={18} maxZoom={19} onSelectPoint={(point) => void selectMapPoint(point)} />
              {resolving ? <View style={styles.mapBusy}><ActivityIndicator color="white" /><Text style={styles.mapBusyText}>Finding this address…</Text></View> : null}
            </View>
            <View style={[styles.locationPanel, { backgroundColor: palette.surface }]}>
              <View style={styles.panelHeader}>
                <View style={[styles.locateIcon, { backgroundColor: palette.brandSoft }]}><Crosshair color={colors.brand} size={22} /></View>
                <View style={{ flex: 1 }}><Text style={[styles.panelTitle, { color: palette.ink }]}>Confirm your pickup point</Text><Text style={[styles.panelCopy, { color: palette.muted }]}>Zoom in and tap the exact building, gate or roadside pickup point.</Text></View>
              </View>
              {detecting ? <View style={[styles.detecting, { backgroundColor: palette.soft }]}><ActivityIndicator color={colors.brand} /><Text style={[styles.detectingText, { color: palette.ink }]}>Finding your current location…</Text></View> : selected ? <AddressDetails location={selected} /> : <View style={[styles.emptySelection, { backgroundColor: palette.soft }]}><Text style={[styles.panelCopy, { color: palette.muted }]}>Search for an address or use your current location.</Text></View>}
              <Pressable onPress={() => void detect()} style={[styles.currentButton, { borderColor: palette.border }]}><LocateFixed color={colors.brand} size={19} /><Text style={styles.currentText}>Use my current location</Text><RefreshCw color={palette.muted} size={17} /></Pressable>
              <TextInput value={label} onChangeText={setLabel} placeholder="Name this place, e.g. Home" placeholderTextColor={palette.muted} style={[styles.input, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }]} />
              {showManual ? (
                <View style={styles.manual}>
                  <Text style={[styles.manualTitle, { color: palette.ink }]}>Add address details</Text>
                  <Text style={[styles.panelCopy, { color: palette.muted }]}>Use this only when the map cannot identify the street or building.</Text>
                  <TextInput multiline value={manualAddress} onChangeText={setManualAddress} placeholder="Street, building, area and nearby landmark" placeholderTextColor={palette.muted} style={[styles.input, styles.addressInput, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }]} />
                  {!selected ? <View style={styles.coordinateRow}><TextInput value={manualLatitude} onChangeText={setManualLatitude} keyboardType="decimal-pad" placeholder="Latitude" placeholderTextColor={palette.muted} style={[styles.input, styles.coordinate, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }]} /><TextInput value={manualLongitude} onChangeText={setManualLongitude} keyboardType="decimal-pad" placeholder="Longitude" placeholderTextColor={palette.muted} style={[styles.input, styles.coordinate, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }]} /></View> : null}
                  {!selected ? <Pressable onPress={applyManual} style={[styles.manualButton, { borderColor: colors.brand }]}><Text style={styles.currentText}>Place address on map</Text></Pressable> : null}
                </View>
              ) : <Pressable onPress={() => setShowManual(true)}><Text style={styles.manualLink}>Can’t see the right address? Add details</Text></Pressable>}
              <Pressable disabled={mutation.isPending || detecting || !selected} onPress={() => void save()} style={[styles.primary, (!selected || detecting) && styles.disabled]}>{mutation.isPending ? <ActivityIndicator color="white" /> : <><Check color="white" size={19} /><Text style={styles.primaryText}>Save this place</Text></>}</Pressable>
              {notice ? <Text accessibilityRole="alert" style={[styles.notice, { color: notice.startsWith("Place saved") ? colors.success : colors.danger }]}>{notice}</Text> : null}
            </View>
          </View>

          {(locations.data ?? []).length ? <View style={styles.savedSection}><Text style={[styles.sectionTitle, { color: palette.ink }]}>Your saved places</Text>{(locations.data ?? []).map((item, index) => <View key={recordId(item) ?? String(index)} style={[styles.savedPlace, { borderBottomColor: palette.border }]}><View style={[styles.savedPin, { backgroundColor: palette.brandSoft }]}><MapPin color={colors.brand} size={19} /></View><View style={{ flex: 1 }}><Text style={[styles.savedTitle, { color: palette.ink }]}>{displayTitle(item)}</Text><Text numberOfLines={2} style={[styles.savedAddress, { color: palette.muted }]}>{displaySubtitle(item) ?? "Saved pickup and delivery point"}</Text></View><ChevronRight color={palette.muted} size={19} /></View>)}</View> : null}
        </>
      )}
    </Screen>
  );
}

function AddressDetails({ location }: { location: OperationalLocation }) {
  const { palette } = useAppTheme();
  const details = [
    ["Country", location.address.country],
    ["State", location.address.region],
    ["City / town", location.address.city],
    ["Area", location.address.district],
    ["Street / road", location.address.street],
  ].filter((item): item is [string, string] => Boolean(item[1]));
  return (
    <View style={[styles.addressCard, { backgroundColor: palette.soft }]}>
      <View style={styles.addressHeading}><MapPin color={colors.success} size={20} /><Text style={[styles.addressMain, { color: palette.ink }]}>{location.formattedAddress}</Text></View>
      {details.length ? <View style={styles.addressGrid}>{details.map(([label, value]) => <View key={label} style={styles.addressDetail}><Text style={[styles.addressLabel, { color: palette.muted }]}>{label}</Text><Text style={[styles.addressValue, { color: palette.ink }]}>{value}</Text></View>)}</View> : <Text style={[styles.panelCopy, { color: palette.muted }]}>Move the pin if this is not the exact pickup point.</Text>}
      <Text style={[styles.accuracy, { color: palette.muted }]}>{location.accuracyMeters ? `GPS accuracy: about ${Math.round(location.accuracyMeters)} metres` : "Pin selected manually"}</Text>
    </View>
  );
}

function normalizeAddress(value: z.infer<typeof AddressSchema> | null | undefined): OperationalAddress {
  return {
    name: value?.name ?? null,
    street: value?.street ?? null,
    district: value?.district ?? null,
    city: value?.city ?? null,
    region: value?.region ?? null,
    postalCode: value?.postalCode ?? null,
    country: value?.country ?? null,
    countryCode: value?.countryCode ?? null,
  };
}

function isGenericAddress(value: string) {
  return value === "Selected map location" || value === "Pinned location" || value.startsWith("Device location");
}

function validCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

const styles = StyleSheet.create({
  searchBox: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.lg, borderWidth: 1 },
  searchInput: { flex: 1, minHeight: 56, fontSize: 16 },
  predictions: { marginTop: -18, overflow: "hidden", borderRadius: radii.lg, borderWidth: 1 },
  prediction: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md },
  predictionText: { flex: 1, lineHeight: 20 },
  locationWorkspace: { gap: spacing.md },
  locationWorkspaceWide: { flexDirection: "row", alignItems: "stretch" },
  mapColumn: { flex: 1.35, minWidth: 0 },
  mapBusy: { position: "absolute", left: "50%", top: "50%", transform: [{ translateX: -85 }, { translateY: -23 }], minWidth: 170, minHeight: 46, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: "rgba(23,33,27,.88)" },
  mapBusyText: { color: "white", fontWeight: "800" },
  locationPanel: { flex: 1, gap: spacing.md, padding: spacing.lg, borderRadius: 28 },
  panelHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  locateIcon: { width: 46, height: 46, alignItems: "center", justifyContent: "center", borderRadius: 23 },
  panelTitle: { fontSize: 20, lineHeight: 25, fontWeight: "900" },
  panelCopy: { lineHeight: 20, marginTop: 3 },
  detecting: { minHeight: 82, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radii.md },
  detectingText: { fontWeight: "800" },
  emptySelection: { minHeight: 88, alignItems: "center", justifyContent: "center", padding: spacing.md, borderRadius: radii.md },
  addressCard: { gap: spacing.md, padding: spacing.md, borderRadius: radii.lg },
  addressHeading: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  addressMain: { flex: 1, fontSize: 16, lineHeight: 22, fontWeight: "900" },
  addressGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  addressDetail: { width: "47%", gap: 2 },
  addressLabel: { fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: .5 },
  addressValue: { fontSize: 13, lineHeight: 17, fontWeight: "700" },
  accuracy: { fontSize: 11, fontWeight: "700" },
  currentButton: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radii.md, borderWidth: 1 },
  currentText: { color: colors.brand, fontWeight: "900" },
  input: { minHeight: 54, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.md, fontSize: 16 },
  addressInput: { minHeight: 90, paddingTop: spacing.md, textAlignVertical: "top" },
  manual: { gap: spacing.sm },
  manualTitle: { fontWeight: "900" },
  manualLink: { color: colors.brand, fontWeight: "800", textAlign: "center" },
  manualButton: { minHeight: 48, alignItems: "center", justifyContent: "center", borderRadius: radii.md, borderWidth: 1 },
  coordinateRow: { flexDirection: "row", gap: spacing.sm },
  coordinate: { flex: 1 },
  primary: { minHeight: 56, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radii.md, backgroundColor: colors.brand },
  disabled: { opacity: .45 },
  primaryText: { color: "white", fontSize: 16, fontWeight: "900" },
  notice: { fontWeight: "700", lineHeight: 20 },
  savedSection: { gap: 0, marginTop: spacing.md },
  sectionTitle: { fontSize: 21, fontWeight: "900", marginBottom: spacing.sm },
  savedPlace: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: spacing.md, borderBottomWidth: 1, paddingVertical: spacing.md },
  savedPin: { width: 42, height: 42, alignItems: "center", justifyContent: "center", borderRadius: 21 },
  savedTitle: { fontSize: 16, fontWeight: "900" },
  savedAddress: { marginTop: 3, lineHeight: 19 },
});
