import { CheckCircle2, LocateFixed, MapPin, Star } from "lucide-react-native";
import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";

import { domainQueries, useApplicationPayload } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  firstNumber,
  firstString,
  nestedRecord,
  recordId,
} from "../api/records";
import {
  readOperationalLocation,
  type OperationalLocation,
} from "../device/location";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { ApplicationOverviewScreen } from "./ApplicationOverviewScreen";
import { Card } from "./Card";
import { Screen } from "./Screen";

type ServiceArea = {
  area_id: string;
  display_name: string;
  area_type: string;
  state_name: string | null;
  lga_name: string | null;
  city_name: string | null;
  town_name: string | null;
  locality_name: string | null;
};

export function DriverApplicationEntryScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const applications = domainQueries.applications();
  const types = domainQueries.applicationTypes();

  const driverType = useMemo(
    () =>
      (types.data ?? []).find(
        (item) =>
          firstString(item, ["application_category", "applicationCategory"]) === "driver" &&
          firstString(item, ["status"]) === "active",
      ) ?? null,
    [types.data],
  );
  const driverTypeId = driverType ? recordId(driverType) : null;
  const current = useMemo(
    () =>
      (applications.data ?? [])
        .filter((item) => {
          if (firstString(item, ["application_type_id", "applicationTypeId"]) !== driverTypeId) return false;
          const status = firstString(item, ["status"]) ?? "";
          return !["rejected", "withdrawn", "expired"].includes(status);
        })
        .sort((left, right) => dateValue(right) - dateValue(left))[0] ?? null,
    [applications.data, driverTypeId],
  );
  const currentId = current ? recordId(current) : null;
  const payloadQuery = useApplicationPayload(currentId);
  const latestVersion = payloadQuery.data?.[0] ?? null;
  const latestPayload = nestedRecord(latestVersion, "payload") ?? latestVersion;
  const storedService = nestedRecord(latestPayload, "service");
  const storedLocation = nestedRecord(latestPayload, "location");

  const storedAreaIds = readStringArray(storedService?.serviceAreaIds);
  const storedPrimaryId = firstString(storedService, ["primaryServiceAreaId"]);
  const storedLatitude = firstNumber(storedLocation, ["latitude"]);
  const storedLongitude = firstNumber(storedLocation, ["longitude"]);
  const geographyComplete =
    storedAreaIds.length > 0 &&
    Boolean(storedPrimaryId && storedAreaIds.includes(storedPrimaryId)) &&
    storedLatitude !== null &&
    storedLongitude !== null;

  const [editing, setEditing] = useState(false);

  if (geographyComplete && !editing) {
    return (
      <View style={styles.applicationShell}>
        <View style={[styles.editBar, { backgroundColor: palette.surface, borderColor: palette.border }]}> 
          <View style={styles.editBarCopy}>
            <MapPin size={18} color={palette.brand} />
            <View style={styles.editBarText}>
              <Text style={[styles.editBarTitle, { color: palette.ink }]}>Service areas saved</Text>
              <Text style={[styles.editBarSubtitle, { color: palette.muted }]} numberOfLines={1}>
                {storedAreaIds.length === 1 ? "1 operating area" : `${storedAreaIds.length} operating areas`} · location captured
              </Text>
            </View>
          </View>
          <AppButton label="Edit" size="sm" variant="ghost" onPress={() => setEditing(true)} />
        </View>
        <View style={styles.applicationBody}>
          <ApplicationOverviewScreen workspace="driver" />
        </View>
      </View>
    );
  }

  return (
    <DriverGeographyStep
      applicationId={currentId}
      applicationTypeKey={firstString(driverType, ["key"]) ?? "application.lpg.driver.phase-one"}
      existingPayload={latestPayload ?? null}
      initialAreaIds={storedAreaIds}
      initialPrimaryAreaId={storedPrimaryId}
      initialLocation={operationalLocationFromRecord(storedLocation)}
      onSaved={async () => {
        await applications.refetch();
        if (currentId) await payloadQuery.refetch();
        setEditing(false);
      }}
      onCancel={geographyComplete ? () => setEditing(false) : undefined}
    />
  );
}

function DriverGeographyStep(props: {
  applicationId: string | null;
  applicationTypeKey: string;
  existingPayload: Record<string, unknown> | null;
  initialAreaIds: readonly string[];
  initialPrimaryAreaId: string | null;
  initialLocation: OperationalLocation | null;
  onSaved: () => Promise<void>;
  onCancel?: () => void;
}) {
  const session = useSession();
  const { palette } = useAppTheme();
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [loadingAreas, setLoadingAreas] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([...props.initialAreaIds]);
  const [primaryId, setPrimaryId] = useState<string | null>(props.initialPrimaryAreaId);
  const [location, setLocation] = useState<OperationalLocation | null>(props.initialLocation);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydratedKey = useRef<string | null>(null);

  useEffect(() => {
    const key = `${props.applicationId ?? "new"}:${props.initialAreaIds.join(",")}:${props.initialPrimaryAreaId ?? ""}`;
    if (hydratedKey.current === key) return;
    hydratedKey.current = key;
    setSelectedIds([...props.initialAreaIds]);
    setPrimaryId(props.initialPrimaryAreaId);
    setLocation(props.initialLocation);
  }, [props.applicationId, props.initialAreaIds, props.initialPrimaryAreaId, props.initialLocation]);

  useEffect(() => {
    let active = true;
    setLoadingAreas(true);
    void session.supabase
      .rpc("read_selectable_lpg_service_areas")
      .then(({ data, error: queryError }) => {
        if (!active) return;
        if (queryError) {
          setError(friendlyError(queryError, "Service areas could not be loaded. Please try again."));
          setAreas([]);
          return;
        }
        const next = Array.isArray(data) ? data.flatMap(readServiceArea) : [];
        setAreas(next);
      })
      .finally(() => {
        if (active) setLoadingAreas(false);
      });
    return () => {
      active = false;
    };
  }, [session.supabase]);

  const createDraft = useGatewayMutation({
    path: "/runtime/applications",
    schema: ActionResponseSchema,
    invalidate: [["applications"]],
  });
  const savePayload = useGatewayMutation({
    path: "/runtime/applications/payload",
    schema: ActionResponseSchema,
    invalidate: [["applications"], ["application-payload", props.applicationId ?? ""]],
  });

  const detect = async () => {
    setDetectingLocation(true);
    setError(null);
    try {
      const next = await readOperationalLocation();
      setLocation(next);
    } catch (cause) {
      setError(friendlyError(cause, "We could not detect your location. Please try again."));
    } finally {
      setDetectingLocation(false);
    }
  };

  const toggleArea = (areaId: string) => {
    setSelectedIds((current) => {
      if (current.includes(areaId)) {
        const next = current.filter((id) => id !== areaId);
        if (primaryId === areaId) setPrimaryId(next[0] ?? null);
        return next;
      }
      const next = [...current, areaId];
      if (!primaryId) setPrimaryId(areaId);
      return next;
    });
  };

  const save = async () => {
    setError(null);
    if (!location) {
      setError("Detect your current operating location before continuing.");
      return;
    }
    if (selectedIds.length === 0) {
      setError("Choose at least one area where you can provide SKIMA service.");
      return;
    }
    if (!primaryId || !selectedIds.includes(primaryId)) {
      setError("Choose one of your selected service areas as your primary area.");
      return;
    }

    const service = {
      serviceAreaIds: selectedIds,
      primaryServiceAreaId: primaryId,
    };
    const mergedPayload = {
      ...(props.existingPayload ?? {}),
      location,
      service,
    };

    setSaving(true);
    try {
      if (props.applicationId) {
        await savePayload.mutateAsync({
          applicationId: props.applicationId,
          payload: mergedPayload,
          metadata: { source: "driver_service_area_step" },
          idempotencyKey: idempotencyKey("driver-service-areas", `${props.applicationId}:${Date.now()}`),
        });
      } else {
        const userId = session.context?.user.id ?? session.session?.user.id;
        if (!userId) throw new Error("Please sign in again before continuing.");
        await createDraft.mutateAsync({
          applicationTypeKey: props.applicationTypeKey,
          applicantUserId: userId,
          payload: mergedPayload,
          source: "skima.lpg.mobile",
          metadata: { source: "driver_service_area_step" },
          idempotencyKey: idempotencyKey("driver-service-area-draft", `${userId}:${Date.now()}`),
        });
      }
      await props.onSaved();
    } catch (cause) {
      setError(friendlyError(cause, "Your service areas could not be saved. Please try again."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen
      eyebrow="Driver application"
      title="Where can you provide service?"
      subtitle="Confirm your operating location and choose every nearby area you can reliably cover. You can select more than one area."
      action={props.onCancel ? <AppButton label="Cancel" size="sm" variant="ghost" onPress={props.onCancel} /> : undefined}
    >
      <Card variant="brandSoft">
        <View style={styles.cardHeading}>
          <View style={[styles.iconBubble, { backgroundColor: palette.brandSoft }]}> 
            <LocateFixed size={20} color={palette.brand} />
          </View>
          <View style={styles.cardHeadingCopy}>
            <Text style={[styles.sectionTitle, { color: palette.ink }]}>Operating location</Text>
            <Text style={[styles.helper, { color: palette.muted }]}>SKIMA uses this only to verify your application and match service coverage. It is not shown publicly as your live location.</Text>
          </View>
        </View>

        {location ? (
          <View style={[styles.locationBox, { borderColor: palette.border, backgroundColor: palette.surface }]}> 
            <CheckCircle2 size={18} color={palette.success} />
            <View style={styles.locationCopy}>
              <Text style={[styles.locationTitle, { color: palette.ink }]}>{location.formattedAddress}</Text>
              <Text style={[styles.helper, { color: palette.muted }]}>
                {location.accuracyMeters === null ? "GPS location captured" : `GPS accuracy about ${Math.round(location.accuracyMeters)} m`}
              </Text>
            </View>
          </View>
        ) : null}

        <AppButton
          label={location ? "Detect again" : "Detect my location"}
          variant="secondary"
          fullWidth
          loading={detectingLocation}
          onPress={() => void detect()}
          icon={<LocateFixed size={18} color={palette.ink} />}
        />
      </Card>

      <Card>
        <View style={styles.cardHeading}>
          <View style={[styles.iconBubble, { backgroundColor: palette.brandSoft }]}> 
            <MapPin size={20} color={palette.brand} />
          </View>
          <View style={styles.cardHeadingCopy}>
            <Text style={[styles.sectionTitle, { color: palette.ink }]}>Service areas</Text>
            <Text style={[styles.helper, { color: palette.muted }]}>Choose all areas you can cover. Mark one as your primary area; this does not stop you from receiving eligible jobs in your other approved areas.</Text>
          </View>
        </View>

        {loadingAreas ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={palette.brand} />
            <Text style={[styles.helper, { color: palette.muted }]}>Loading available areas…</Text>
          </View>
        ) : areas.length === 0 ? (
          <Text style={[styles.helper, { color: palette.muted }]}>No driver service areas are available for selection yet.</Text>
        ) : (
          <View style={styles.areaList}>
            {areas.map((area) => {
              const selected = selectedIds.includes(area.area_id);
              const primary = primaryId === area.area_id;
              return (
                <View key={area.area_id} style={[styles.areaRow, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSofter : palette.surface }]}> 
                  <Pressable style={styles.areaSelect} onPress={() => toggleArea(area.area_id)} accessibilityRole="checkbox" accessibilityState={{ checked: selected }}>
                    <View style={[styles.checkBox, { borderColor: selected ? palette.brand : palette.borderStrong, backgroundColor: selected ? palette.brand : "transparent" }]}> 
                      {selected ? <CheckCircle2 size={16} color="#FFFFFF" /> : null}
                    </View>
                    <View style={styles.areaCopy}>
                      <Text style={[styles.areaTitle, { color: palette.ink }]}>{area.display_name}</Text>
                      <Text style={[styles.helper, { color: palette.muted }]}>{serviceAreaSummary(area)}</Text>
                    </View>
                  </Pressable>
                  {selected ? (
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityState={{ checked: primary }}
                      onPress={() => setPrimaryId(area.area_id)}
                      style={[styles.primaryButton, { borderColor: primary ? palette.brand : palette.borderStrong, backgroundColor: primary ? palette.brand : palette.surface }]}
                    >
                      <Star size={14} color={primary ? "#FFFFFF" : palette.brand} fill={primary ? "#FFFFFF" : "transparent"} />
                      <Text style={[styles.primaryText, { color: primary ? "#FFFFFF" : palette.brand }]}>{primary ? "Primary" : "Make primary"}</Text>
                    </Pressable>
                  ) : null}
                </View>
              );
            })}
          </View>
        )}
      </Card>

      {error ? (
        <View style={[styles.errorBox, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}> 
          <Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text>
        </View>
      ) : null}

      <AppButton
        label="Save and continue"
        fullWidth
        loading={saving}
        disabled={loadingAreas || areas.length === 0}
        onPress={() => void save()}
      />
    </Screen>
  );
}

function operationalLocationFromRecord(record: Record<string, unknown> | null): OperationalLocation | null {
  if (!record) return null;
  const latitude = firstNumber(record, ["latitude"]);
  const longitude = firstNumber(record, ["longitude"]);
  if (latitude === null || longitude === null) return null;
  return {
    latitude,
    longitude,
    accuracyMeters: firstNumber(record, ["accuracyMeters"]),
    recordedAt: firstString(record, ["recordedAt"]) ?? new Date().toISOString(),
    formattedAddress: firstString(record, ["formattedAddress"]) ?? "Saved operating location",
    providerPlaceId: firstString(record, ["providerPlaceId"]),
    providerSource: (firstString(record, ["providerSource"]) as OperationalLocation["providerSource"]) ?? "device_coordinates",
    address: {
      name: firstString(nestedRecord(record, "address"), ["name"]),
      street: firstString(nestedRecord(record, "address"), ["street"]),
      district: firstString(nestedRecord(record, "address"), ["district"]),
      city: firstString(nestedRecord(record, "address"), ["city"]),
      region: firstString(nestedRecord(record, "address"), ["region"]),
      postalCode: firstString(nestedRecord(record, "address"), ["postalCode"]),
      country: firstString(nestedRecord(record, "address"), ["country"]),
      countryCode: firstString(nestedRecord(record, "address"), ["countryCode"]),
    },
  };
}

function readServiceArea(value: unknown): ServiceArea[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const row = value as Record<string, unknown>;
  const id = typeof row.area_id === "string" ? row.area_id : null;
  const name = typeof row.display_name === "string" ? row.display_name : null;
  const type = typeof row.area_type === "string" ? row.area_type : null;
  if (!id || !name || !type) return [];
  return [{
    area_id: id,
    display_name: name,
    area_type: type,
    state_name: stringOrNull(row.state_name),
    lga_name: stringOrNull(row.lga_name),
    city_name: stringOrNull(row.city_name),
    town_name: stringOrNull(row.town_name),
    locality_name: stringOrNull(row.locality_name),
  }];
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0) : [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function serviceAreaSummary(area: ServiceArea) {
  const parts = [area.locality_name, area.town_name, area.city_name, area.lga_name, area.state_name]
    .filter((part, index, all): part is string => Boolean(part) && all.indexOf(part) === index);
  const location = parts.join(", ");
  const type = area.area_type === "lga" ? "LGA" : area.area_type.charAt(0).toUpperCase() + area.area_type.slice(1);
  return location ? `${type} · ${location}` : type;
}

function dateValue(record: Record<string, unknown>) {
  const value = firstString(record, ["updated_at", "updatedAt", "created_at", "createdAt"]);
  const parsed = value ? Date.parse(value) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

const styles = StyleSheet.create({
  applicationShell: { flex: 1 },
  applicationBody: { flex: 1 },
  editBar: {
    minHeight: 58,
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  editBarCopy: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  editBarText: { flex: 1 },
  editBarTitle: { ...typography.bodyStrong },
  editBarSubtitle: { ...typography.caption },
  cardHeading: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  cardHeadingCopy: { flex: 1, gap: 4 },
  iconBubble: { width: 38, height: 38, borderRadius: radii.md, alignItems: "center", justifyContent: "center" },
  sectionTitle: { ...typography.sectionTitle },
  helper: { ...typography.caption, lineHeight: 18 },
  locationBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md, flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
  locationCopy: { flex: 1, gap: 3 },
  locationTitle: { ...typography.bodyStrong },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  areaList: { gap: spacing.sm },
  areaRow: { borderWidth: 1, borderRadius: radii.md, padding: spacing.sm, gap: spacing.sm },
  areaSelect: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  checkBox: { width: 24, height: 24, borderRadius: 7, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  areaCopy: { flex: 1, gap: 2 },
  areaTitle: { ...typography.bodyStrong },
  primaryButton: { alignSelf: "flex-start", minHeight: 34, borderWidth: 1, borderRadius: radii.pill, paddingHorizontal: 11, flexDirection: "row", alignItems: "center", gap: 6 },
  primaryText: { fontSize: 12, fontWeight: "800" },
  errorBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md },
  errorText: { ...typography.bodyStrong },
});
