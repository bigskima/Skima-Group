import { router, useLocalSearchParams } from "expo-router";
import {
  Building2,
  Check,
  ChevronRight,
  Crosshair,
  LocateFixed,
  MapPin,
  Plus,
  Search,
  ShieldCheck,
} from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from "react-native";

import { useStationLocations, useStationRuntime } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  firstNumber,
  firstString,
  nestedRecord,
  nestedRecords,
  recordId,
} from "../api/records";
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
import { colors, radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";

type RequestKind = "PRIMARY_UPDATE" | "ADDITIONAL_LOCATION";

export function StationLocationsScreen() {
  const { palette } = useAppTheme();
  const runtime = useStationRuntime();
  const branch = nestedRecord(runtime.data, "branch");
  const stationBranchId = branch ? recordId(branch) : null;
  const locations = useStationLocations(stationBranchId);
  const current = nestedRecord(locations.data, "currentLocation");
  const additional = nestedRecords(locations.data, "additionalLocations");
  const requests = nestedRecords(locations.data, "requests");
  const pending = requests.filter((item) => firstString(item, ["status"]) === "pending");

  return (
    <Screen
      eyebrow="Station setup"
      title="Station locations"
      subtitle="Keep your station's real physical location and address details accurate."
      action={<AppButton label="Back" size="sm" variant="ghost" onPress={() => router.back()} />}
    >
      {runtime.isPending || locations.isPending ? (
        <ScreenSkeleton cards={3} />
      ) : runtime.error || locations.error ? (
        <EmptyState
          icon={<MapPin color={palette.brand} size={28} />}
          title="Station locations could not be loaded"
          description="Check your connection and try again."
          action={<AppButton label="Retry" onPress={() => void Promise.all([runtime.refetch(), locations.refetch()])} />}
        />
      ) : !branch || !stationBranchId ? (
        <EmptyState
          icon={<Building2 color={palette.brand} size={28} />}
          title="Station branch unavailable"
          description="Your approved station branch must be active before its physical location can be managed."
        />
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.heroIcon}><MapPin color="#FFFFFF" size={27} /></View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>MAIN STATION LOCATION</Text>
              <Text numberOfLines={2} style={styles.heroTitle}>
                {current ? firstString(current, ["formattedAddress"]) ?? firstString(branch, ["formattedAddress"]) ?? "Address needs confirmation" : firstString(branch, ["formattedAddress"]) ?? "Address needs confirmation"}
              </Text>
              <Text style={styles.heroMeta}>
                {current ? locationSummary(current) : "The station has coordinates, but its structured address has not been fully confirmed."}
              </Text>
            </View>
            <StatusPill label={pending.some((item) => firstString(item, ["requestKind"]) === "PRIMARY_UPDATE") ? "Update pending" : "Current"} tone={pending.length ? "warning" : "success"} />
          </View>

          <View style={styles.actionGrid}>
            <ActionCard
              icon={<LocateFixed color={palette.brand} size={21} />}
              title="Update main location"
              description="Move or correct the station point, country, state, LGA, city or street."
              onPress={() => router.push("/(station)/location-editor?kind=PRIMARY_UPDATE" as never)}
            />
            <ActionCard
              icon={<Plus color={palette.brand} size={21} />}
              title="Add another location"
              description="Submit another station location for SKIMA review. It will not receive jobs automatically."
              onPress={() => router.push("/(station)/location-editor?kind=ADDITIONAL_LOCATION" as never)}
            />
          </View>

          <View style={[styles.noticeCard, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <ShieldCheck color={palette.mutedStrong} size={20} />
            <Text style={[styles.noticeText, { color: palette.muted }]}>
              Location changes are reviewed by SKIMA before they affect dispatch, public station discovery or the main branch address. This prevents accidental or fraudulent station moves.
            </Text>
          </View>

          <SectionHeader
            title="Current address details"
            description="These are the structured location details SKIMA uses for review and display."
          />
          {current ? (
            <View style={[styles.detailCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <Detail label="Country" value={firstString(current, ["country"]) ?? "Not recorded"} />
              <Detail label="State" value={firstString(current, ["state"]) ?? "Not recorded"} />
              <Detail label="LGA" value={firstString(current, ["lga"]) ?? "Not recorded"} />
              <Detail label="City / town" value={firstString(current, ["city"]) ?? "Not recorded"} />
              <Detail label="Area / locality" value={firstString(current, ["locality"]) ?? "Not recorded"} />
              <Detail label="Street / road" value={firstString(current, ["street"]) ?? "Not recorded"} />
              <Detail label="GPS point" value={coordinateSummary(current)} />
            </View>
          ) : (
            <EmptyState
              icon={<MapPin color={palette.brand} size={26} />}
              title="Structured station address is missing"
              description="Use Update main location to confirm the exact map point and address details."
            />
          )}

          <SectionHeader
            title="Waiting for SKIMA review"
            description="Submitted changes stay here until an administrator reviews them."
          />
          {pending.length ? (
            <View style={styles.list}>
              {pending.map((item, index) => (
                <LocationCard
                  key={recordId(item) ?? String(index)}
                  item={item}
                  label={requestKindLabel(firstString(item, ["requestKind"]))}
                  status="Pending review"
                />
              ))}
            </View>
          ) : (
            <View style={[styles.emptyInline, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
              <Check color={palette.success} size={18} />
              <Text style={[styles.emptyInlineText, { color: palette.muted }]}>No location changes are waiting for review.</Text>
            </View>
          )}

          {additional.length ? (
            <>
              <SectionHeader
                title="Other verified locations"
                description="These are reviewed station locations. They are references only until SKIMA sets up a separate operating branch."
              />
              <View style={styles.list}>
                {additional.map((item, index) => (
                  <LocationCard
                    key={recordId(item) ?? String(index)}
                    item={item}
                    label={firstString(item, ["label"]) ?? "Additional station location"}
                    status="Verified"
                  />
                ))}
              </View>
            </>
          ) : null}
        </>
      )}
    </Screen>
  );
}

export function StationLocationEditorScreen() {
  const { palette } = useAppTheme();
  const { width } = useWindowDimensions();
  const params = useLocalSearchParams<{ kind?: string }>();
  const kind: RequestKind = params.kind === "ADDITIONAL_LOCATION" ? "ADDITIONAL_LOCATION" : "PRIMARY_UPDATE";
  const runtime = useStationRuntime();
  const branch = nestedRecord(runtime.data, "branch");
  const stationBranchId = branch ? recordId(branch) : null;
  const maps = useMapsGatewayAdapter();

  const [selected, setSelected] = useState<OperationalLocation | null>(null);
  const [search, setSearch] = useState("");
  const [predictions, setPredictions] = useState<Record<string, unknown>[]>([]);
  const [label, setLabel] = useState(kind === "PRIMARY_UPDATE" ? "Main station" : "");
  const [formattedAddress, setFormattedAddress] = useState("");
  const [country, setCountry] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [state, setState] = useState("");
  const [lga, setLga] = useState("");
  const [city, setCity] = useState("");
  const [street, setStreet] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [permissionContext, setPermissionContext] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const mutation = useGatewayMutation({
    path: "/lpg/stations/locations",
    schema: ActionResponseSchema,
    invalidate: [["station-locations"], ["station-runtime"]],
  });

  useEffect(() => {
    const query = search.trim();
    if (query.length < 3) {
      setPredictions([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      void maps.autocomplete.mutateAsync({
        input: query,
        idempotencyKey: idempotencyKey("station-location-search", query.toLowerCase()),
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

  const applyLocation = (point: OperationalLocation) => {
    setSelected(point);
    setFormattedAddress(point.formattedAddress || "");
    setCountry(point.address.country ?? "");
    setCountryCode((point.address.countryCode ?? "").toUpperCase());
    setState(point.address.state ?? point.address.region ?? "");
    setLga(point.address.lga ?? point.address.district ?? "");
    setCity(point.address.city ?? point.address.town ?? point.address.village ?? "");
    setStreet(point.address.street ?? "");
  };

  const detect = async () => {
    setPermissionContext(false);
    setDetecting(true);
    setNotice(null);
    try {
      applyLocation(await maps.resolveOperationalLocation(await readOperationalLocation()));
    } catch (cause) {
      setNotice(friendlyError(cause, "We couldn't find the station's current location. Search for the address instead."));
    } finally {
      setDetecting(false);
    }
  };

  const choosePrediction = async (prediction: Record<string, unknown>) => {
    const description = readString(prediction.description);
    if (!description) return;
    setResolving(true);
    setNotice(null);
    try {
      const embedded = mapLookupFromPrediction(prediction);
      const lookup = embedded ?? await maps.geocode.mutateAsync({
        address: description,
        idempotencyKey: idempotencyKey("station-location-geocode", description.toLowerCase()),
      });
      applyLocation(locationFromLookup(lookup, description));
      setSearch("");
      setPredictions([]);
    } catch (cause) {
      setNotice(friendlyError(cause, "We couldn't open that location. Try a more specific address."));
    } finally {
      setResolving(false);
    }
  };

  const selectMapPoint = async (coordinate: { latitude: number; longitude: number }) => {
    setResolving(true);
    setNotice(null);
    try {
      const local = await resolveOperationalAddress(coordinate.latitude, coordinate.longitude);
      const base: OperationalLocation = {
        ...coordinate,
        accuracyMeters: null,
        recordedAt: new Date().toISOString(),
        formattedAddress: local.formattedAddress ?? "Pinned station location",
        providerPlaceId: null,
        providerSource: "manual_pin",
        address: local.address,
      };
      applyLocation(await maps.resolveOperationalLocation(base));
    } catch (cause) {
      setNotice(friendlyError(cause, "We couldn't identify that map point. Try another point or search for the address."));
    } finally {
      setResolving(false);
    }
  };

  const submit = async () => {
    if (!stationBranchId) {
      setNotice("Your active station branch could not be found.");
      return;
    }
    if (!selected) {
      setNotice("Choose the exact station point on the map first.");
      return;
    }
    if (!formattedAddress.trim()) {
      setNotice("Enter the station's readable address.");
      return;
    }
    if (!country.trim() || !countryCode.trim() || !state.trim() || !city.trim()) {
      setNotice("Country, country code, state, and city or town are required before this location can be reviewed.");
      return;
    }
    if (kind === "ADDITIONAL_LOCATION" && label.trim().length < 2) {
      setNotice("Give this additional location a short name.");
      return;
    }

    setNotice(null);
    try {
      await mutation.mutateAsync({
        stationBranchId,
        requestKind: kind,
        label: label.trim() || "Main station",
        formattedAddress: formattedAddress.trim(),
        latitude: selected.latitude,
        longitude: selected.longitude,
        accuracyMeters: selected.accuracyMeters,
        providerSource: selected.providerSource,
        providerPlaceId: selected.providerPlaceId ?? null,
        capturedAt: selected.recordedAt,
        address: {
          ...selected.address,
          country: country.trim(),
          countryCode: countryCode.trim().toUpperCase(),
          state: state.trim(),
          region: state.trim(),
          lga: lga.trim() || null,
          city: city.trim(),
          street: street.trim() || null,
        },
        source: "skima.lpg.station_location",
        metadata: {
          sourceSurface: "station_location_editor",
          requestedOperationalChange: kind === "PRIMARY_UPDATE",
        },
        idempotencyKey: idempotencyKey(
          "station-location-request",
          `${stationBranchId}:${kind}:${selected.latitude.toFixed(5)}:${selected.longitude.toFixed(5)}`,
        ),
      });
      router.replace("/(station)/locations" as never);
    } catch (cause) {
      setNotice(friendlyError(cause, "We couldn't submit this station location. Check the details and try again."));
    }
  };

  const mapPoints = selected ? [{
    latitude: selected.latitude,
    longitude: selected.longitude,
    label: kind === "PRIMARY_UPDATE" ? "Main station" : label.trim() || "Additional station location",
    kind: "destination" as const,
  }] : [];

  return (
    <Screen
      eyebrow="Station location"
      title={kind === "PRIMARY_UPDATE" ? "Update main location" : "Add station location"}
      subtitle={kind === "PRIMARY_UPDATE"
        ? "Confirm the exact station point and complete its address details."
        : "Add another physical station location for SKIMA review."}
      action={<AppButton label="Back" size="sm" variant="ghost" onPress={() => router.back()} />}
    >
      <View style={[styles.reviewBanner, { backgroundColor: palette.brandSoft, borderColor: palette.brand }]}>
        <ShieldCheck color={palette.brand} size={20} />
        <View style={styles.reviewBannerCopy}>
          <Text style={[styles.reviewBannerTitle, { color: palette.ink }]}>Admin review protects your live station location</Text>
          <Text style={[styles.reviewBannerText, { color: palette.muted }]}>
            Submitting this form does not move the live station immediately. SKIMA reviews the map point and address before it can affect dispatch or station discovery.
          </Text>
        </View>
      </View>

      <View style={[styles.currentRow, { borderBottomColor: palette.border }]}>
        <View style={[styles.currentIcon, { backgroundColor: palette.brandSoft }]}>
          <LocateFixed color={palette.brand} size={20} />
        </View>
        <View style={styles.currentCopy}>
          <Text style={[styles.microLabel, { color: palette.muted }]}>EXACT STATION POINT</Text>
          <Text numberOfLines={2} style={[styles.currentAddress, { color: palette.ink }]}>
            {selected ? compactAddress(selected) : "Use station GPS or search for the address"}
          </Text>
        </View>
        <Pressable
          onPress={() => setPermissionContext(true)}
          disabled={detecting}
          style={[styles.compactAction, { backgroundColor: palette.brandSoft }]}
        >
          {detecting ? <ActivityIndicator color={palette.brand} size="small" /> : <Text style={[styles.compactActionText, { color: palette.brand }]}>{selected ? "Update" : "Use GPS"}</Text>}
        </Pressable>
      </View>

      {permissionContext ? (
        <View style={[styles.permissionPanel, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.permissionHeading}>
            <Crosshair color={palette.brand} size={22} />
            <View style={styles.permissionCopy}>
              <Text style={[styles.permissionTitle, { color: palette.ink }]}>Use this device at the station</Text>
              <Text style={[styles.supporting, { color: palette.muted }]}>For the best verification, stand at the station and allow location access. You can adjust the pin before submitting.</Text>
            </View>
          </View>
          <View style={styles.permissionActions}>
            <Pressable onPress={() => setPermissionContext(false)} style={styles.textButton}><Text style={[styles.textButtonText, { color: palette.muted }]}>Not now</Text></Pressable>
            <Pressable onPress={() => void detect()} style={[styles.allowButton, { backgroundColor: palette.brand }]}><LocateFixed color="#FFFFFF" size={17} /><Text style={styles.allowButtonText}>Use current location</Text></Pressable>
          </View>
        </View>
      ) : null}

      <View style={[styles.searchBox, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <Search color={palette.muted} size={19} />
        <TextInput
          accessibilityLabel="Search for station address"
          value={search}
          onChangeText={setSearch}
          placeholder="Search station, street, town or landmark"
          placeholderTextColor={palette.muted}
          style={[styles.searchInput, { color: palette.ink }]}
        />
        {maps.autocomplete.isPending ? <ActivityIndicator color={palette.brand} size="small" /> : null}
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
                <MapPin color={palette.brand} size={17} />
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
            height={width < 600 ? 330 : 460}
            initialZoom={18}
            maxZoom={21}
            onSelectPoint={(point) => void selectMapPoint(point)}
          />
          {resolving ? (
            <View style={styles.mapBusy}><ActivityIndicator color="#FFFFFF" /><Text style={styles.mapBusyText}>Checking address…</Text></View>
          ) : null}
        </View>

        <View style={[styles.formCard, width >= 900 && styles.formCardWide, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.formTitle, { color: palette.ink }]}>Confirm address details</Text>
          <Text style={[styles.supporting, { color: palette.muted }]}>
            These details are shown to SKIMA reviewers. They do not control service availability by name; the verified map point does.
          </Text>

          {kind === "ADDITIONAL_LOCATION" ? (
            <Field label="Location name" value={label} onChangeText={setLabel} placeholder="Example: Awka branch" palette={palette} />
          ) : null}
          <Field label="Full address" value={formattedAddress} onChangeText={setFormattedAddress} placeholder="Station address" palette={palette} multiline />
          <View style={styles.twoCol}>
            <Field label="Country" value={country} onChangeText={(value) => {
              setCountry(value);
              if (value.trim().toLowerCase() === "nigeria" && !countryCode) setCountryCode("NG");
            }} placeholder="Nigeria" palette={palette} compact />
            <Field label="Country code" value={countryCode} onChangeText={setCountryCode} placeholder="NG" palette={palette} compact />
          </View>
          <Field label="State" value={state} onChangeText={setState} placeholder="Anambra" palette={palette} />
          <Field label="LGA" value={lga} onChangeText={setLga} placeholder="Example: Awka South" palette={palette} optional />
          <Field label="City / town" value={city} onChangeText={setCity} placeholder="Example: Awka or Nsugbe" palette={palette} />
          <Field label="Street / road" value={street} onChangeText={setStreet} placeholder="Street, road or station entrance" palette={palette} optional />

          {selected ? (
            <View style={[styles.gpsBox, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
              <MapPin color={palette.success} size={18} />
              <View style={styles.gpsCopy}>
                <Text style={[styles.gpsTitle, { color: palette.ink }]}>Map point selected</Text>
                <Text style={[styles.gpsText, { color: palette.muted }]}>{selected.latitude.toFixed(6)}, {selected.longitude.toFixed(6)}{selected.accuracyMeters !== null ? ` · about ${Math.round(selected.accuracyMeters)} m accuracy` : " · map pin"}</Text>
              </View>
            </View>
          ) : null}

          {notice ? <Text accessibilityRole="alert" style={styles.errorText}>{notice}</Text> : null}

          <Pressable
            onPress={() => void submit()}
            disabled={mutation.isPending || !selected}
            style={[styles.primary, { backgroundColor: palette.brand }, (mutation.isPending || !selected) && styles.disabled]}
          >
            {mutation.isPending ? <ActivityIndicator color="#FFFFFF" /> : <><ShieldCheck color="#FFFFFF" size={18} /><Text style={styles.primaryText}>Submit for SKIMA review</Text></>}
          </Pressable>
        </View>
      </View>
    </Screen>
  );
}

function ActionCard(props: { icon: React.ReactNode; title: string; description: string; onPress: () => void }) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.actionCard,
        shadows.soft,
        { backgroundColor: palette.surface, borderColor: palette.border, opacity: pressed ? 0.75 : 1 },
      ]}
    >
      <View style={[styles.actionIcon, { backgroundColor: palette.brandSoft }]}>{props.icon}</View>
      <View style={styles.actionCopy}>
        <Text style={[styles.actionTitle, { color: palette.ink }]}>{props.title}</Text>
        <Text style={[styles.actionDescription, { color: palette.muted }]}>{props.description}</Text>
      </View>
      <ChevronRight color={palette.muted} size={18} />
    </Pressable>
  );
}

function LocationCard({ item, label, status }: { item: Record<string, unknown>; label: string; status: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.locationCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={[styles.locationIcon, { backgroundColor: palette.brandSoft }]}><MapPin color={palette.brand} size={20} /></View>
      <View style={styles.locationCopy}>
        <Text style={[styles.locationTitle, { color: palette.ink }]}>{label}</Text>
        <Text numberOfLines={2} style={[styles.locationAddress, { color: palette.muted }]}>{firstString(item, ["formattedAddress"]) ?? "Address unavailable"}</Text>
        <Text style={[styles.locationMeta, { color: palette.muted }]}>{locationSummary(item)}</Text>
      </View>
      <StatusPill label={status} tone={status === "Verified" ? "success" : "warning"} />
    </View>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.detailRow}>
      <Text style={[styles.detailLabel, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.detailValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function Field(props: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  palette: ReturnType<typeof useAppTheme>["palette"];
  multiline?: boolean;
  optional?: boolean;
  compact?: boolean;
}) {
  return (
    <View style={[styles.field, props.compact && styles.fieldCompact]}>
      <Text style={[styles.fieldLabel, { color: props.palette.ink }]}>
        {props.label}{props.optional ? <Text style={{ color: props.palette.muted, fontWeight: "600" }}> (optional)</Text> : null}
      </Text>
      <TextInput
        value={props.value}
        onChangeText={props.onChangeText}
        placeholder={props.placeholder}
        placeholderTextColor={props.palette.muted}
        multiline={props.multiline}
        style={[
          styles.input,
          props.multiline && styles.multiline,
          { backgroundColor: props.palette.input, borderColor: props.palette.border, color: props.palette.ink },
        ]}
      />
    </View>
  );
}

function requestKindLabel(value: string | null) {
  return value === "ADDITIONAL_LOCATION" ? "Additional station location" : "Main station location update";
}

function locationSummary(item: Record<string, unknown>) {
  return uniqueParts([
    firstString(item, ["city"]),
    firstString(item, ["lga"]),
    firstString(item, ["state"]),
    firstString(item, ["country"]),
  ]).join(", ") || "Structured address needs completion";
}

function coordinateSummary(item: Record<string, unknown>) {
  const latitude = firstNumber(item, ["latitude"]);
  const longitude = firstNumber(item, ["longitude"]);
  return latitude !== null && longitude !== null ? `${latitude.toFixed(6)}, ${longitude.toFixed(6)}` : "Not recorded";
}

function compactAddress(location: OperationalLocation) {
  return uniqueParts([
    location.address.city ?? location.address.town ?? location.address.village,
    location.address.lga ?? location.address.district,
    location.address.state ?? location.address.region,
    location.address.country,
  ]).join(", ") || location.formattedAddress;
}

function uniqueParts(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
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
  const street = clean(value?.street) ?? clean(value?.route);
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
  hero: {
    minHeight: 138,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
  },
  heroIcon: { width: 52, height: 52, borderRadius: 18, backgroundColor: "rgba(255,255,255,.16)", alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, minWidth: 0, gap: 4 },
  heroEyebrow: { color: "rgba(255,255,255,.74)", ...typography.caption, fontSize: 9, fontWeight: "900", letterSpacing: 1 },
  heroTitle: { color: "#FFFFFF", ...typography.heading, fontSize: 19, lineHeight: 24 },
  heroMeta: { color: "rgba(255,255,255,.82)", ...typography.caption, lineHeight: 17 },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  actionCard: { minWidth: 250, flex: 1, minHeight: 110, flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  actionIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  actionCopy: { flex: 1, minWidth: 0, gap: 4 },
  actionTitle: { ...typography.bodyStrong, fontSize: 14 },
  actionDescription: { ...typography.caption, lineHeight: 16 },
  noticeCard: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderRadius: radii.lg },
  noticeText: { flex: 1, ...typography.caption, lineHeight: 18 },
  detailCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, overflow: "hidden" },
  detailRow: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md, paddingHorizontal: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(127,127,127,.16)" },
  detailLabel: { ...typography.caption, fontSize: 11 },
  detailValue: { flex: 1, ...typography.bodyStrong, fontSize: 12, textAlign: "right" },
  list: { gap: spacing.sm },
  locationCard: { minHeight: 94, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  locationIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  locationCopy: { flex: 1, minWidth: 0, gap: 2 },
  locationTitle: { ...typography.bodyStrong, fontSize: 13 },
  locationAddress: { ...typography.caption, fontSize: 11, lineHeight: 15 },
  locationMeta: { ...typography.caption, fontSize: 9 },
  emptyInline: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderRadius: radii.lg },
  emptyInlineText: { flex: 1, ...typography.caption },
  reviewBanner: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderRadius: radii.lg },
  reviewBannerCopy: { flex: 1, gap: 3 },
  reviewBannerTitle: { ...typography.bodyStrong, fontSize: 13 },
  reviewBannerText: { ...typography.caption, lineHeight: 17 },
  currentRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: 11, paddingVertical: spacing.sm, borderBottomWidth: 1 },
  currentIcon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  currentCopy: { flex: 1, gap: 2 },
  microLabel: { ...typography.caption, fontSize: 9, fontWeight: "900", letterSpacing: .8 },
  currentAddress: { ...typography.bodyStrong, fontSize: 13, lineHeight: 18 },
  compactAction: { minWidth: 66, minHeight: 38, alignItems: "center", justifyContent: "center", paddingHorizontal: 12, borderRadius: radii.pill },
  compactActionText: { fontSize: 11, fontWeight: "900" },
  permissionPanel: { gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1 },
  permissionHeading: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  permissionCopy: { flex: 1, gap: 4 },
  permissionTitle: { ...typography.bodyStrong, fontSize: 15 },
  supporting: { ...typography.caption, fontSize: 12, lineHeight: 18 },
  permissionActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: spacing.sm },
  textButton: { minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md },
  textButtonText: { fontWeight: "800" },
  allowButton: { minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, paddingHorizontal: spacing.md, borderRadius: radii.pill },
  allowButtonText: { color: "#FFFFFF", fontWeight: "900" },
  searchBox: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 14, borderRadius: radii.md, borderWidth: 1 },
  searchInput: { flex: 1, minHeight: 50, fontSize: 14 },
  predictions: { marginTop: -12, overflow: "hidden", borderRadius: radii.md, borderWidth: 1 },
  prediction: { minHeight: 54, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: 14 },
  predictionText: { flex: 1, fontSize: 12, lineHeight: 18 },
  workspace: { width: "100%", gap: spacing.md },
  workspaceWide: { flexDirection: "row", alignItems: "flex-start" },
  mapColumn: { width: "100%", minWidth: 0 },
  mapColumnWide: { flex: 1.2 },
  mapBusy: { position: "absolute", left: "50%", top: "50%", transform: [{ translateX: -78 }, { translateY: -21 }], minWidth: 156, minHeight: 42, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.md, borderRadius: radii.pill, backgroundColor: "rgba(23,33,27,.88)" },
  mapBusyText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" },
  formCard: { width: "100%", gap: 12, padding: spacing.md, borderRadius: radii.lg, borderWidth: 1 },
  formCardWide: { flex: 1 },
  formTitle: { ...typography.heading, fontSize: 18 },
  field: { width: "100%", gap: 6 },
  fieldCompact: { flex: 1, minWidth: 120 },
  fieldLabel: { ...typography.caption, fontSize: 11, fontWeight: "900" },
  input: { minHeight: 48, borderRadius: 13, borderWidth: 1, paddingHorizontal: 13, fontSize: 13 },
  multiline: { minHeight: 78, paddingTop: 12, textAlignVertical: "top" },
  twoCol: { flexDirection: "row", gap: spacing.sm },
  gpsBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: 12, borderWidth: 1, borderRadius: radii.md },
  gpsCopy: { flex: 1, gap: 2 },
  gpsTitle: { ...typography.bodyStrong, fontSize: 12 },
  gpsText: { ...typography.caption, fontSize: 10 },
  errorText: { color: colors.danger, ...typography.caption, lineHeight: 17, textAlign: "center" },
  primary: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: 14 },
  disabled: { opacity: .45 },
  primaryText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
});
