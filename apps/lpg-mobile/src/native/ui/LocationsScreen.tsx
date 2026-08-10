import { LocateFixed, MapPin, RefreshCw } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { domainQueries } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, displaySubtitle, displayTitle, firstNumber, recordId, type PlatformRecord } from "../api/records";
import { readOperationalLocation, type OperationalLocation } from "../device/location";
import { OperationalMap, type MapPoint } from "../maps/OperationalMap";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";
import { Card } from "./Card";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";

export function LocationsScreen() {
  const { palette } = useAppTheme();
  const locations = domainQueries.locations();
  const [label, setLabel] = useState("");
  const [detected, setDetected] = useState<OperationalLocation | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [manual, setManual] = useState(false);
  const [address, setAddress] = useState("");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useGatewayMutation({ path: "/lpg/locations", schema: ActionResponseSchema, invalidate: [["locations"]] });

  const detect = async () => {
    setDetecting(true);
    setNotice(null);
    try {
      const point = await readOperationalLocation();
      setDetected(point);
      setAddress(point.formattedAddress);
      setLatitude(String(point.latitude));
      setLongitude(String(point.longitude));
      setManual(false);
    } catch (cause) {
      setDetected(null);
      setManual(true);
      setNotice(cause instanceof Error ? cause.message : "Device location could not be detected.");
    } finally {
      setDetecting(false);
    }
  };

  useEffect(() => { void detect(); }, []);

  const save = async () => {
    const lat = detected?.latitude ?? Number(latitude);
    const lng = detected?.longitude ?? Number(longitude);
    const formattedAddress = detected?.formattedAddress ?? address.trim();
    if (!label.trim()) { setNotice("Give this place a useful label, such as Home or Office."); return; }
    if (!formattedAddress || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      setNotice("Enter a valid address and coordinates because device detection is unavailable.");
      setManual(true);
      return;
    }
    try {
      await mutation.mutateAsync({
        label: label.trim(),
        formattedAddress,
        latitude: lat,
        longitude: lng,
        accuracyMeters: detected?.accuracyMeters ?? undefined,
        providerSource: detected?.providerSource ?? "manual_fallback",
        source: "skima.lpg.location_api",
        idempotencyKey: idempotencyKey("create-location", label.trim()),
      });
      setLabel("");
      setNotice("Delivery location saved from verified coordinates.");
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Location could not be saved.");
    }
  };

  const mapPoints = [
    ...(locations.data ?? []).map(toMapPoint).filter((point): point is MapPoint => Boolean(point)),
    ...(detected ? [{ latitude: detected.latitude, longitude: detected.longitude, label: "Your live device location" }] : []),
  ];

  return (
    <Screen eyebrow="Automatic location" title="Delivery places">
      {locations.isPending ? <ScreenSkeleton cards={2} /> : (
        <>
          <OperationalMap points={mapPoints} />
          <View style={styles.list}>
            {(locations.data ?? []).map((item, index) => (
              <Card key={recordId(item) ?? String(index)}>
                <View style={styles.savedRow}><View style={[styles.pin, { backgroundColor: palette.brandSoft }]}><MapPin color={colors.brand} size={20} /></View><View style={{ flex: 1 }}><Text style={[styles.itemTitle, { color: palette.ink }]}>{displayTitle(item)}</Text><Text style={[styles.itemAddress, { color: palette.muted }]}>{displaySubtitle(item) ?? "Coordinate-backed location"}</Text></View></View>
              </Card>
            ))}
          </View>

          <View style={[styles.form, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.formHead}><View style={[styles.locate, { backgroundColor: palette.brandSoft }]}><LocateFixed color={colors.brand} size={23} /></View><View style={{ flex: 1 }}><Text style={[styles.formTitle, { color: palette.ink }]}>Add where you are now</Text><Text style={[styles.formCopy, { color: palette.muted }]}>The app detects coordinates automatically on web and mobile.</Text></View><Pressable accessibilityLabel="Detect location again" onPress={() => void detect()} style={[styles.refresh, { borderColor: palette.border }]}><RefreshCw color={colors.brand} size={19} /></Pressable></View>
            {detecting ? <View style={[styles.detecting, { backgroundColor: palette.soft }]}><ActivityIndicator color={colors.brand} /><Text style={[styles.detectingText, { color: palette.ink }]}>Detecting precise device location…</Text></View> : detected ? <View style={[styles.detected, { backgroundColor: palette.soft }]}><Text style={styles.detectedLabel}>LOCATION DETECTED</Text><Text style={[styles.detectedAddress, { color: palette.ink }]}>{detected.formattedAddress}</Text><Text style={[styles.coords, { color: palette.muted }]}>{detected.latitude.toFixed(6)}, {detected.longitude.toFixed(6)}{detected.accuracyMeters ? ` · ±${Math.round(detected.accuracyMeters)} m` : ""}</Text></View> : null}

            <TextInput value={label} onChangeText={setLabel} placeholder="Place label, e.g. Home" placeholderTextColor={palette.muted} style={[styles.input, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }]} />
            {manual ? (
              <View style={styles.manual}>
                <Text style={[styles.manualTitle, { color: palette.ink }]}>Manual fallback</Text>
                <Text style={[styles.formCopy, { color: palette.muted }]}>Shown because the browser or device did not return a usable location.</Text>
                <TextInput value={address} onChangeText={setAddress} placeholder="Full address" placeholderTextColor={palette.muted} style={[styles.input, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }]} />
                <View style={styles.coordinateRow}><TextInput value={latitude} onChangeText={setLatitude} keyboardType="decimal-pad" placeholder="Latitude" placeholderTextColor={palette.muted} style={[styles.input, styles.coordinate, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }]} /><TextInput value={longitude} onChangeText={setLongitude} keyboardType="decimal-pad" placeholder="Longitude" placeholderTextColor={palette.muted} style={[styles.input, styles.coordinate, { backgroundColor: palette.input, borderColor: palette.border, color: palette.ink }]} /></View>
              </View>
            ) : null}
            <Pressable disabled={mutation.isPending || detecting} onPress={() => void save()} style={styles.primary}>{mutation.isPending ? <ActivityIndicator color="white" /> : <Text style={styles.primaryText}>Save detected location</Text>}</Pressable>
            {notice ? <Text accessibilityRole="alert" style={[styles.notice, { color: notice.includes("saved") ? colors.success : colors.danger }]}>{notice}</Text> : null}
          </View>
        </>
      )}
    </Screen>
  );
}

function toMapPoint(item: PlatformRecord): MapPoint | null {
  const latitude = firstNumber(item, ["latitude", "lat"]);
  const longitude = firstNumber(item, ["longitude", "lng"]);
  return latitude !== null && longitude !== null ? { latitude, longitude, label: displayTitle(item) } : null;
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  savedRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  pin: { width: 42, height: 42, borderRadius: 21, alignItems: "center", justifyContent: "center" },
  itemTitle: { fontSize: 16, fontWeight: "900" },
  itemAddress: { lineHeight: 19, marginTop: 3 },
  form: { maxWidth: 720, gap: spacing.md, padding: spacing.lg, borderRadius: radii.lg, borderWidth: 1 },
  formHead: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  locate: { width: 48, height: 48, borderRadius: 24, alignItems: "center", justifyContent: "center" },
  formTitle: { fontSize: 19, fontWeight: "900" },
  formCopy: { lineHeight: 19, marginTop: 2 },
  refresh: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  detecting: { minHeight: 76, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderRadius: radii.md },
  detectingText: { fontWeight: "800" },
  detected: { gap: 4, padding: spacing.md, borderRadius: radii.md },
  detectedLabel: { color: colors.success, fontSize: 11, fontWeight: "900", letterSpacing: .8 },
  detectedAddress: { fontSize: 16, fontWeight: "800" },
  coords: { fontSize: 12 },
  input: { minHeight: 54, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.md, fontSize: 16 },
  manual: { gap: spacing.sm },
  manualTitle: { fontWeight: "900" },
  coordinateRow: { flexDirection: "row", gap: spacing.sm },
  coordinate: { flex: 1 },
  primary: { minHeight: 54, alignItems: "center", justifyContent: "center", borderRadius: radii.md, backgroundColor: colors.brand },
  primaryText: { color: "white", fontWeight: "900" },
  notice: { fontWeight: "700", lineHeight: 20 },
});
