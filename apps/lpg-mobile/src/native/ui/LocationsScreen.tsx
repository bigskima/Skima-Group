import { Check, ChevronRight, Crosshair, LocateFixed, MapPin, RefreshCw, Search } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, displaySubtitle, displayTitle, recordId } from "../api/records";
import {
  readOperationalLocation,
  resolveOperationalAddress,
  type OperationalAddress,
  type OperationalLocation,
} from "../device/location";
import {
  AddressSchema,
  useMapsGatewayAdapter,
  type AddressPayload,
  type MapLookup,
} from "../domains/maps/gateway";
import { OperationalMap } from "../maps/OperationalMap";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";

export function LocationsScreen() {
  const { palette } = useAppTheme();
  const { width } = useWindowDimensions();
  const locations = domainQueries.locations();
  const [label, setLabel] = useState("");
  const [selected, setSelected] = useState<OperationalLocation | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [permissionContext, setPermissionContext] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [search, setSearch] = useState("");
  const [predictions, setPredictions] = useState<Record<string, unknown>[]>([]);
  const [manualAddress, setManualAddress] = useState("");
  const [landmark, setLandmark] = useState("");
  const [showManual, setShowManual] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeSuccess, setNoticeSuccess] = useState(false);
  const mutation = useGatewayMutation({ path: "/lpg/locations", schema: ActionResponseSchema, invalidate: [["locations"]] });
  const maps = useMapsGatewayAdapter();
  const reverseLookup = maps.reverseGeocode;
  const geocode = maps.geocode;
  const autocomplete = maps.autocomplete;

  const showNotice = (message: string, success = false) => {
    setNotice(message);
    setNoticeSuccess(success);
  };

  const enrich = async (point: OperationalLocation) => {
    try {
      const result = await reverseLookup.mutateAsync({
        latitude: point.latitude,
        longitude: point.longitude,
        idempotencyKey: idempotencyKey("reverse-location", `${point.latitude.toFixed(5)}:${point.longitude.toFixed(5)}`),
      });
      const resolved = normalizeAddress(result.addressComponents);
      const formattedAddress = clean(result.formattedAddress) ?? point.formattedAddress;
      if (!formattedAddress && !hasAddress(resolved)) return point;
      return {
        ...point,
        formattedAddress: formattedAddress || "Selected map location",
        providerPlaceId: result.placeId ?? point.providerPlaceId ?? null,
        providerSource: "maps_adapter" as const,
        address: mergeAddress(resolved, point.address),
      };
    } catch {
      return point;
    }
  };

  const acceptPoint = (point: OperationalLocation) => {
    setSelected(point);
    setManualAddress(isGenericAddress(point.formattedAddress) ? "" : point.formattedAddress);
    setShowManual(isGenericAddress(point.formattedAddress));
  };

  const detect = async () => {
    setPermissionContext(false);
    setDetecting(true);
    showNotice("");
    try {
      acceptPoint(await enrich(await readOperationalLocation()));
    } catch (cause) {
      showNotice(friendlyError(cause, "We couldn't find your current location. Search for your address instead."));
    } finally {
      setDetecting(false);
    }
  };

  useEffect(() => {
    const query = search.trim();
    if (query.length < 3) {
      setPredictions([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void autocomplete.mutateAsync({
        input: query,
        idempotencyKey: idempotencyKey("location-search", query.toLowerCase()),
      }).then((result) => {
        if (active) setPredictions(result.predictions);
      }).catch(() => {
        if (active) setPredictions([]);
      });
    }, 350);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search]);

  const choosePrediction = async (prediction: Record<string, unknown>) => {
    const description = readString(prediction.description);
    if (!description) return;
    setResolving(true);
    showNotice("");
    try {
      const embeddedLookup = mapLookupFromPrediction(prediction);
      const result = embeddedLookup ?? await geocode.mutateAsync({
          address: description,
          idempotencyKey: idempotencyKey("geocode-location", description.toLowerCase()),
        });
      acceptPoint(locationFromLookup(result, description));
      setSearch("");
      setPredictions([]);
    } catch (cause) {
      showNotice(friendlyError(cause, "We couldn't open that address. Try a more specific search."));
    } finally {
      setResolving(false);
    }
  };

  const selectMapPoint = async (coordinate: { latitude: number; longitude: number }) => {
    setResolving(true);
    showNotice("");
    try {
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
      acceptPoint(await enrich(point));
    } catch (cause) {
      showNotice(friendlyError(cause, "We couldn't resolve that point. Move the pin or enter the address manually."));
    } finally {
      setResolving(false);
    }
  };

  const locateManualAddress = async () => {
    const address = manualAddress.trim();
    if (!address) {
      showNotice("Enter the street, area or landmark you want us to find.");
      return;
    }
    setResolving(true);
    showNotice("");
    try {
      const result = await geocode.mutateAsync({
        address,
        idempotencyKey: idempotencyKey("manual-geocode-location", address.toLowerCase()),
      });
      acceptPoint(locationFromLookup(result, address));
    } catch (cause) {
      showNotice(friendlyError(cause, "We couldn't find that address. Add an area or nearby landmark, or choose the place on the map."));
    } finally {
      setResolving(false);
    }
  };


  const save = async () => {
    if (!label.trim()) {
      showNotice("Name this place—for example, Home, Office or Mum's house.");
      return;
    }
    if (!selected) {
      showNotice("Choose the location on the map before saving it.");
      return;
    }
    const baseAddress = isGenericAddress(selected.formattedAddress)
      ? manualAddress.trim()
      : selected.formattedAddress;
    if (!baseAddress) {
      setShowManual(true);
      showNotice("Add a street, building or nearby landmark so your driver can find you.");
      return;
    }
    const specificLandmark = landmark.trim();
    const formattedAddress = specificLandmark
      && !baseAddress.toLocaleLowerCase().includes(specificLandmark.toLocaleLowerCase())
      ? `${specificLandmark}, ${baseAddress}`
      : baseAddress;
    try {
      await mutation.mutateAsync({
        label: label.trim(),
        formattedAddress,
        latitude: selected.latitude,
        longitude: selected.longitude,
        accuracyMeters: selected.accuracyMeters ?? undefined,
        address: selected.address,
        captureSource: canonicalCaptureSource(selected.providerSource),
        capturedAt: selected.recordedAt,
        providerSource: selected.providerSource,
        providerPlaceId: selected.providerPlaceId ?? undefined,
        metadata: {
          addressComponents: { ...selected.address, name: specificLandmark || selected.address.name },
          landmark: specificLandmark || undefined,
          recordedAt: selected.recordedAt,
        },
        source: "skima.lpg.location_api",
        idempotencyKey: idempotencyKey("create-location", label.trim()),
      });
      setLabel("");
      setLandmark("");
      showNotice("Place saved. It's ready for your next pickup or delivery.", true);
    } catch (cause) {
      showNotice(friendlyError(cause, "We couldn't save this place. Check the details and try again."));
    }
  };

  const mapPoints = selected
    ? [{
        latitude: selected.latitude,
        longitude: selected.longitude,
        label: label.trim() || "Exact pickup point",
        kind: "destination" as const,
      }]
    : [];

  return (
    <Screen eyebrow="Delivery and pickup" title="Set your location">
      <View style={[styles.currentRow, { borderBottomColor: palette.border }]}>
        <View style={[styles.currentIcon, { backgroundColor: palette.brandSoft }]}><LocateFixed color={colors.brand} size={20} /></View>
        <View style={styles.currentCopy}>
          <Text style={[styles.microLabel, { color: palette.muted }]}>CURRENT LOCATION</Text>
          <Text numberOfLines={2} style={[styles.currentAddress, { color: palette.ink }]}>
            {selected ? compactAddress(selected) : "Use your device for the quickest setup"}
          </Text>
        </View>
        <Pressable
          disabled={detecting}
          onPress={() => { showNotice(""); setPermissionContext(true); }}
          style={[styles.compactAction, { backgroundColor: palette.brandSoft }]}
        >
          {detecting ? <ActivityIndicator color={colors.brand} size="small" /> : <Text style={styles.compactActionText}>{selected ? "Update" : "Use"}</Text>}
        </Pressable>
      </View>

      {permissionContext ? (
        <View style={[styles.permissionPanel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.permissionHeading}>
            <Crosshair color={colors.brand} size={22} />
            <View style={styles.permissionCopy}>
              <Text style={[styles.permissionTitle, { color: palette.ink }]}>Find your exact pickup point</Text>
              <Text style={[styles.supporting, { color: palette.muted }]}>SKIMA uses your location to position this pin and guide the assigned driver. You can adjust it before saving.</Text>
            </View>
          </View>
          <View style={styles.permissionActions}>
            <Pressable onPress={() => setPermissionContext(false)} style={styles.textButton}><Text style={[styles.textButtonText, { color: palette.muted }]}>Not now</Text></Pressable>
            <Pressable onPress={() => void detect()} style={styles.allowButton}><LocateFixed color="white" size={17} /><Text style={styles.allowButtonText}>Continue</Text></Pressable>
          </View>
        </View>
      ) : null}

      <View style={[styles.searchBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Search color={palette.muted} size={19} />
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
            return (
              <Pressable
                key={`${description}:${index}`}
                onPress={() => void choosePrediction(prediction)}
                style={[styles.prediction, index > 0 && { borderTopColor: palette.border, borderTopWidth: 1 }]}
              >
                <MapPin color={colors.brand} size={17} />
                <Text style={[styles.predictionText, { color: palette.ink }]}>{description}</Text>
                <ChevronRight color={palette.muted} size={17} />
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <View style={[styles.workspace, width >= 900 && styles.workspaceWide]}>
        <View style={[styles.mapColumn, width >= 900 && styles.mapColumnWide]}>
          <OperationalMap
            points={mapPoints}
            height={width < 600 ? 340 : 470}
            initialZoom={20}
            maxZoom={21}
            onSelectPoint={(point) => void selectMapPoint(point)}
          />
          {resolving ? (
            <View style={styles.mapBusy}><ActivityIndicator color="white" /><Text style={styles.mapBusyText}>Resolving address…</Text></View>
          ) : null}
        </View>

        <View style={[styles.confirmPanel, width >= 900 && styles.confirmPanelWide, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.panelHeader}>
            <View style={{ flex: 1 }}>
              <Text style={[styles.panelTitle, { color: palette.ink }]}>Confirm the exact point</Text>
              <Text style={[styles.supporting, { color: palette.muted }]}>Zoom in, then tap the entrance, gate or roadside pickup point.</Text>
            </View>
            {selected ? <View style={styles.readyBadge}><Check color={colors.success} size={14} /><Text style={styles.readyText}>Located</Text></View> : null}
          </View>

          {selected
            ? <AddressDetails location={selected} landmark={landmark} />
            : <View style={[styles.emptySelection, { borderColor: palette.border }]}><MapPin color={palette.muted} size={20} /><Text style={[styles.supporting, { color: palette.muted }]}>Choose current location or search above to place the pin.</Text></View>}

          <View style={styles.fieldGroup}>
            <Text style={[styles.inputLabel, { color: palette.ink }]}>Save as</Text>
            <TextInput
              value={label}
              onChangeText={setLabel}
              placeholder="Home, Office or another name"
              placeholderTextColor={palette.muted}
              style={[styles.input, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }]}
            />
          </View>
          <View style={styles.fieldGroup}>
            <Text style={[styles.inputLabel, { color: palette.ink }]}>Building or landmark <Text style={{ color: palette.muted, fontWeight: "600" }}>(optional)</Text></Text>
            <TextInput
              value={landmark}
              onChangeText={setLandmark}
              placeholder="Gate colour, building name or nearby landmark"
              placeholderTextColor={palette.muted}
              style={[styles.input, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }]}
            />
          </View>

          {showManual ? (
            <View style={[styles.manual, { borderTopColor: palette.border }]}>
              <Text style={[styles.manualTitle, { color: palette.ink }]}>Enter the address manually</Text>
              <Text style={[styles.supporting, { color: palette.muted }]}>Use this fallback if GPS or search cannot identify the place.</Text>
              <TextInput
                multiline
                value={manualAddress}
                onChangeText={setManualAddress}
                placeholder="Street, building, locality, city and state"
                placeholderTextColor={palette.muted}
                style={[styles.input, styles.addressInput, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }]}
              />
              <Pressable disabled={resolving} onPress={() => void locateManualAddress()} style={[styles.manualButton, { borderColor: colors.brand }]}>
                {resolving ? <ActivityIndicator color={colors.brand} size="small" /> : <><Search color={colors.brand} size={16} /><Text style={styles.compactActionText}>Find this address</Text></>}
              </Pressable>
              <Pressable onPress={() => { setShowManual(false); }}><Text style={styles.manualLink}>Close manual entry</Text></Pressable>
            </View>
          ) : <Pressable onPress={() => setShowManual(true)}><Text style={styles.manualLink}>Can't find it? Enter the address manually</Text></Pressable>}

          <Pressable
            disabled={mutation.isPending || detecting || !selected}
            onPress={() => void save()}
            style={[styles.primary, (!selected || detecting || mutation.isPending) && styles.disabled]}
          >
            {mutation.isPending
              ? <ActivityIndicator color="white" />
              : <><Check color="white" size={18} /><Text style={styles.primaryText}>Save this place</Text></>}
          </Pressable>
          {notice ? <Text accessibilityRole="alert" style={[styles.notice, { color: noticeSuccess ? colors.success : colors.danger }]}>{notice}</Text> : null}
        </View>
      </View>

      <View style={styles.savedSection}>
        <Text style={[styles.sectionTitle, { color: palette.ink }]}>Saved places</Text>
        {locations.isPending ? <ScreenSkeleton cards={1} /> : (locations.data ?? []).length ? (
          (locations.data ?? []).map((item, index) => (
            <View key={recordId(item) ?? String(index)} style={[styles.savedPlace, { borderBottomColor: palette.border }]}>
              <View style={[styles.savedPin, { backgroundColor: palette.brandSoft }]}><MapPin color={colors.brand} size={18} /></View>
              <View style={{ flex: 1 }}>
                <Text style={[styles.savedTitle, { color: palette.ink }]}>{displayTitle(item)}</Text>
                <Text numberOfLines={2} style={[styles.savedAddress, { color: palette.muted }]}>{displaySubtitle(item) ?? "Saved pickup and delivery point"}</Text>
              </View>
              <ChevronRight color={palette.muted} size={18} />
            </View>
          ))
        ) : <Text style={[styles.savedEmpty, { color: palette.muted }]}>Your saved places will appear here.</Text>}
      </View>
    </Screen>
  );
}

function AddressDetails({ location, landmark }: { location: OperationalLocation; landmark: string }) {
  const { palette } = useAppTheme();
  const resolvedLandmark = clean(landmark) ?? distinctName(location.address);
  const details = [
    ["Country", location.address.country],
    ["State", location.address.region],
    ["City / town", location.address.city],
    ["Locality / area", location.address.district],
    ["Street / road", location.address.street],
    ["Landmark / building", resolvedLandmark],
  ].filter((item): item is [string, string] => Boolean(item[1]));
  return (
    <View style={[styles.addressBlock, { borderTopColor: palette.border, borderBottomColor: palette.border }]}>
      <View style={styles.addressHeading}><MapPin color={colors.success} size={19} /><Text style={[styles.addressMain, { color: palette.ink }]}>{location.formattedAddress}</Text></View>
      {details.length ? (
        <View style={styles.addressGrid}>
          {details.map(([detailLabel, value]) => (
            <View key={detailLabel} style={styles.addressDetail}>
              <Text style={[styles.addressLabel, { color: palette.muted }]}>{detailLabel}</Text>
              <Text style={[styles.addressValue, { color: palette.ink }]}>{value}</Text>
            </View>
          ))}
        </View>
      ) : <Text style={[styles.supporting, { color: palette.muted }]}>Move the pin if this is not the exact pickup point.</Text>}
      <Text style={[styles.accuracy, { color: accuracyTone(location.accuracyMeters) }]}>{accuracyCopy(location.accuracyMeters)}</Text>
    </View>
  );
}

function locationFromLookup(result: MapLookup, fallback: string): OperationalLocation {
  return {
    latitude: result.location.latitude,
    longitude: result.location.longitude,
    accuracyMeters: null,
    recordedAt: new Date().toISOString(),
    formattedAddress: clean(result.formattedAddress) ?? fallback,
    providerPlaceId: result.placeId ?? null,
    providerSource: "maps_adapter",
    address: normalizeAddress(result.addressComponents),
  };
}

function mapLookupFromPrediction(prediction: Record<string, unknown>): MapLookup | null {
  const location = prediction.location;
  if (!location || typeof location !== "object" || Array.isArray(location)) return null;
  const latitude = Number((location as Record<string, unknown>).latitude);
  const longitude = Number((location as Record<string, unknown>).longitude);
  if (!validCoordinate(latitude, longitude)) return null;
  const parsedAddress = AddressSchema.safeParse(prediction.addressComponents);
  return {
    addressComponents: parsedAddress.success ? parsedAddress.data : null,
    formattedAddress: readString(prediction.formattedAddress) ?? readString(prediction.description),
    location: { latitude, longitude },
    placeId: readString(prediction.placeId),
    provider: readString(prediction.provider) ?? "skima_gateway",
  };
}

function normalizeAddress(value: AddressPayload | null | undefined): OperationalAddress {
  const street = clean(value?.street)
    ?? clean(value?.route)
    ?? null;
  const streetNumber = clean(value?.streetNumber);
  return {
    name: clean(value?.name) ?? clean(value?.landmark) ?? clean(value?.premise),
    street: streetNumber && street && !street.startsWith(streetNumber) ? `${streetNumber} ${street}` : street,
    district: clean(value?.district) ?? clean(value?.locality) ?? clean(value?.subLocality),
    city: clean(value?.city) ?? clean(value?.town) ?? clean(value?.village),
    region: clean(value?.region) ?? clean(value?.state),
    postalCode: clean(value?.postalCode),
    country: clean(value?.country),
    countryCode: clean(value?.countryCode),
    neighbourhood: clean(value?.neighbourhood) ?? clean(value?.subLocality),
    town: clean(value?.town),
    village: clean(value?.village),
    lga: clean(value?.lga),
    state: clean(value?.state) ?? clean(value?.region),
    stateCode: clean(value?.stateCode),
  };
}

function mergeAddress(primary: OperationalAddress, fallback: OperationalAddress): OperationalAddress {
  return {
    name: primary.name ?? fallback.name,
    street: primary.street ?? fallback.street,
    district: primary.district ?? fallback.district,
    city: primary.city ?? fallback.city,
    region: primary.region ?? fallback.region,
    postalCode: primary.postalCode ?? fallback.postalCode,
    country: primary.country ?? fallback.country,
    countryCode: primary.countryCode ?? fallback.countryCode,
    neighbourhood: primary.neighbourhood ?? fallback.neighbourhood,
    town: primary.town ?? fallback.town,
    village: primary.village ?? fallback.village,
    lga: primary.lga ?? fallback.lga,
    state: primary.state ?? fallback.state,
    stateCode: primary.stateCode ?? fallback.stateCode,
  };
}

function hasAddress(address: OperationalAddress) {
  return Object.values(address).some(Boolean);
}

function compactAddress(location: OperationalLocation) {
  const parts = [location.address.district, location.address.city, location.address.region]
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(parts)).join(", ") || location.formattedAddress;
}

function distinctName(address: OperationalAddress) {
  const name = clean(address.name);
  if (!name) return null;
  const duplicates = [address.street, address.district, address.city]
    .some((value) => clean(value)?.toLocaleLowerCase() === name.toLocaleLowerCase());
  return duplicates ? null : name;
}

function accuracyCopy(accuracy: number | null) {
  if (accuracy === null) return "Pin positioned manually—zoom in to confirm it.";
  const metres = Math.max(1, Math.round(accuracy));
  if (metres <= 20) return `High-accuracy GPS · within about ${metres} metres`;
  if (metres <= 60) return `GPS accuracy · within about ${metres} metres`;
  return `Approximate GPS · within about ${metres} metres. Move the pin for precision.`;
}

function accuracyTone(accuracy: number | null) {
  if (accuracy !== null && accuracy <= 20) return colors.success;
  if (accuracy !== null && accuracy > 60) return "#A96D00";
  return colors.muted;
}

function isGenericAddress(value: string) {
  return value === "Selected map location" || value === "Pinned location" || value.startsWith("Device location");
}

function validCoordinate(latitude: number, longitude: number) {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clean(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

const styles = StyleSheet.create({
  currentRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  currentIcon: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 20 },
  currentCopy: { flex: 1, gap: 2 },
  microLabel: { fontSize: 9, lineHeight: 12, fontWeight: "900", letterSpacing: 1 },
  currentAddress: { fontSize: 14, lineHeight: 18, fontWeight: "800" },
  compactAction: { minWidth: 60, minHeight: 38, alignItems: "center", justifyContent: "center", paddingHorizontal: 13, borderRadius: radii.pill },
  compactActionText: { color: colors.brand, fontWeight: "900" },
  permissionPanel: { gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1 },
  permissionHeading: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  permissionCopy: { flex: 1, gap: 4 },
  permissionTitle: { fontSize: 16, lineHeight: 21, fontWeight: "900" },
  permissionActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: spacing.sm },
  textButton: { minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md },
  textButtonText: { fontWeight: "800" },
  allowButton: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: colors.brand },
  allowButtonText: { color: "white", fontWeight: "900" },
  supporting: { fontSize: 13, lineHeight: 19 },
  searchBox: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 14, borderRadius: radii.md, borderWidth: 1 },
  searchInput: { flex: 1, minHeight: 50, fontSize: 15 },
  predictions: { marginTop: -12, overflow: "hidden", borderRadius: radii.md, borderWidth: 1 },
  prediction: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 14 },
  predictionText: { flex: 1, fontSize: 13, lineHeight: 18 },
  workspace: { width: "100%", gap: spacing.md },
  workspaceWide: { flexDirection: "row", alignItems: "flex-start" },
  mapColumn: { width: "100%", minWidth: 0 },
  mapColumnWide: { flex: 1.35 },
  mapBusy: { position: "absolute", left: "50%", top: "50%", transform: [{ translateX: -80 }, { translateY: -21 }], minWidth: 160, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: "rgba(23,33,27,.88)" },
  mapBusyText: { color: "white", fontSize: 12, fontWeight: "800" },
  confirmPanel: { width: "100%", gap: 13, padding: 18, borderRadius: radii.lg, borderWidth: 1 },
  confirmPanelWide: { flex: 1 },
  panelHeader: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  panelTitle: { fontSize: 18, lineHeight: 23, fontWeight: "900" },
  readyBadge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 9, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: "rgba(18,148,71,.10)" },
  readyText: { color: colors.success, fontSize: 10, fontWeight: "900" },
  emptySelection: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 12, borderTopWidth: 1, borderBottomWidth: 1 },
  addressBlock: { gap: 11, paddingVertical: 13, borderTopWidth: 1, borderBottomWidth: 1 },
  addressHeading: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  addressMain: { flex: 1, fontSize: 15, lineHeight: 21, fontWeight: "900" },
  addressGrid: { flexDirection: "row", flexWrap: "wrap", rowGap: 9, columnGap: spacing.sm },
  addressDetail: { width: "48%", gap: 1 },
  addressLabel: { fontSize: 9, lineHeight: 12, fontWeight: "800", textTransform: "uppercase", letterSpacing: .45 },
  addressValue: { fontSize: 12, lineHeight: 16, fontWeight: "700" },
  accuracy: { fontSize: 10, lineHeight: 14, fontWeight: "800" },
  fieldGroup: { gap: 6 },
  inputLabel: { fontSize: 12, fontWeight: "900" },
  input: { minHeight: 48, borderRadius: 13, borderWidth: 1, paddingHorizontal: 13, fontSize: 14 },
  addressInput: { minHeight: 78, paddingTop: 12, textAlignVertical: "top" },
  manual: { gap: spacing.sm, paddingTop: 13, borderTopWidth: 1 },
  manualTitle: { fontSize: 14, fontWeight: "900" },
  manualLink: { color: colors.brand, fontSize: 12, fontWeight: "800", textAlign: "center" },
  manualButton: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, borderRadius: 13, borderWidth: 1 },
  manualButtonText: { fontSize: 12, fontWeight: "900" },
  primary: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: 14, backgroundColor: colors.brand },
  disabled: { opacity: .45 },
  primaryText: { color: "white", fontSize: 14, fontWeight: "900" },
  notice: { fontSize: 12, fontWeight: "700", lineHeight: 18, textAlign: "center" },
  savedSection: { gap: 0, marginTop: spacing.md, paddingBottom: 32 },
  sectionTitle: { fontSize: 19, fontWeight: "900", marginBottom: spacing.sm },
  savedPlace: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: 12, borderBottomWidth: 1, paddingVertical: 11 },
  savedPin: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19 },
  savedTitle: { fontSize: 14, fontWeight: "900" },
  savedAddress: { marginTop: 2, fontSize: 12, lineHeight: 17 },
  savedEmpty: { paddingVertical: spacing.md, fontSize: 13 },
});

function canonicalCaptureSource(source: OperationalLocation["providerSource"]): "DEVICE_GPS" | "MAP_PIN" | "GEOCODED" {
  if (source === "manual_pin") return "MAP_PIN";
  if (source === "maps_adapter") return "GEOCODED";
  return "DEVICE_GPS";
}
