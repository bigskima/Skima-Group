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
  type PlatformRecord,
} from "../api/records";
import {
  readOperationalLocation,
  type OperationalLocation,
} from "../device/location";
import { useMapsGatewayAdapter } from "../domains/maps/gateway";
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
  candidate?: boolean;
};

type CandidateCoverageRequest = {
  type: "RADIUS";
  latitude: number;
  longitude: number;
  radiusMeters: number;
  source?: string;
};

const EDITABLE_APPLICATION_STATUSES = new Set([
  "draft",
  "incomplete",
  "additional_info_required",
  "resubmitted",
]);

export function DriverApplicationEntryScreen() {
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
  const applicationStatus = firstString(current, ["status"]) ?? "draft";
  const canEditGeography = !currentId || EDITABLE_APPLICATION_STATUSES.has(applicationStatus);
  const payloadQuery = useApplicationPayload(currentId);
  const latestVersion = payloadQuery.data?.[0] ?? null;
  const latestPayload = nestedRecord(latestVersion, "payload") ?? latestVersion;
  const storedService = nestedRecord(latestPayload, "service");
  const storedLocation = nestedRecord(latestPayload, "location");
  const storedAreaIds = readCoverageGeographyIds(storedService);
  const storedCoverageCount = countCoverageRequests(storedService);
  const storedCandidateCoverage = readRadiusCoverageRequest(storedService);
  const storedLatitude = firstNumber(storedLocation, ["latitude"]);
  const storedLongitude = firstNumber(storedLocation, ["longitude"]);
  const geographyComplete =
    storedCoverageCount > 0 &&
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
                {storedAreaIds.length > 0
                  ? (storedAreaIds.length === 1 ? "1 operating area" : `${storedAreaIds.length} operating areas`)
                  : storedCandidateCoverage
                    ? `Candidate radius · ${Math.round(storedCandidateCoverage.radiusMeters / 1000 * 10) / 10} km`
                    : `${storedCoverageCount} coverage request(s)`} · location captured
              </Text>
            </View>
          </View>
          {canEditGeography ? (
            <AppButton label="Edit" size="sm" variant="ghost" onPress={() => setEditing(true)} />
          ) : null}
        </View>
        <View style={styles.applicationBody}>
          <ApplicationOverviewScreen workspace="driver" />
        </View>
      </View>
    );
  }

  if (!geographyComplete && !canEditGeography) {
    return (
      <View style={styles.applicationShell}>
        <View style={[styles.warningBar, { backgroundColor: palette.warningSoft, borderColor: palette.warning }]}> 
          <MapPin size={18} color={palette.warning} />
          <View style={styles.editBarText}>
            <Text style={[styles.editBarTitle, { color: palette.ink }]}>Location update needed</Text>
            <Text style={[styles.editBarSubtitle, { color: palette.muted }]}>
              Your service location and operating areas still need to be confirmed. If SKIMA asks you to update the application, this step will become available again.
            </Text>
          </View>
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
      initialCandidateCoverage={storedCandidateCoverage}
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
  existingPayload: PlatformRecord | null;
  initialAreaIds: readonly string[];
  initialCandidateCoverage: CandidateCoverageRequest | null;
  initialLocation: OperationalLocation | null;
  onSaved: () => Promise<void>;
  onCancel?: () => void;
}) {
  const session = useSession();
  const { palette } = useAppTheme();
  const maps = useMapsGatewayAdapter();
  const [areas, setAreas] = useState<ServiceArea[]>([]);
  const [loadingAreas, setLoadingAreas] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([...props.initialAreaIds]);
  const [candidateCoverage, setCandidateCoverage] = useState<CandidateCoverageRequest | null>(
    props.initialCandidateCoverage,
  );
  const [location, setLocation] = useState<OperationalLocation | null>(props.initialLocation);
  const [detectingLocation, setDetectingLocation] = useState(false);
  const [resolvingCandidate, setResolvingCandidate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hydratedKey = useRef<string | null>(null);

  useEffect(() => {
    const key = `${props.applicationId ?? "new"}:${props.initialAreaIds.join(",")}`;
    if (hydratedKey.current === key) return;
    hydratedKey.current = key;
    setSelectedIds([...props.initialAreaIds]);
    setCandidateCoverage(props.initialCandidateCoverage);
    setLocation(props.initialLocation);
  }, [
    props.applicationId,
    props.initialAreaIds,
    props.initialCandidateCoverage,
    props.initialLocation,
  ]);

  useEffect(() => {
    let active = true;
    setLoadingAreas(true);
    setError(null);

    void (async () => {
      try {
        const { data, error: queryError } = await session.supabase.rpc("read_selectable_operational_geographies");
        if (!active) return;
        if (queryError) throw queryError;
        setAreas(Array.isArray(data) ? data.flatMap(readServiceArea) : []);
      } catch (cause) {
        if (!active) return;
        setAreas([]);
        setError(friendlyError(cause, "Service areas could not be loaded. Please try again."));
      } finally {
        if (active) setLoadingAreas(false);
      }
    })();

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

  const resolveCandidateCoverage = async (
    point: OperationalLocation,
  ): Promise<CandidateCoverageRequest | null> => {
    setResolvingCandidate(true);
    try {
      const { data, error: candidateError } = await session.supabase.rpc(
        "resolve_lpg_partner_candidate_coverage",
        {
          p_partner_type: "DRIVER",
          p_latitude: point.latitude,
          p_longitude: point.longitude,
        },
      );
      if (candidateError) throw candidateError;
      const request = readCandidateCoverageResponse(data);
      setCandidateCoverage(request);
      return request;
    } finally {
      setResolvingCandidate(false);
    }
  };

  const detect = async () => {
    setDetectingLocation(true);
    setError(null);
    try {
      const nextLocation = await maps.resolveOperationalLocation(await readOperationalLocation());
      setLocation(nextLocation);
      try {
        await resolveCandidateCoverage(nextLocation);
      } catch {
        setCandidateCoverage(null);
      }
    } catch (cause) {
      setError(friendlyError(cause, "We could not prepare your operating area. Please try again."));
    } finally {
      setDetectingLocation(false);
    }
  };

  const toggleArea = (areaId: string) => {
    setSelectedIds((current) => {
      if (current.includes(areaId)) {
        const next = current.filter((id) => id !== areaId);
        return next;
      }
      const next = [...current, areaId];
      return next;
    });
  };

  const save = async () => {
    setError(null);
    if (!location) {
      setError("Detect your current operating location before continuing.");
      return;
    }
    let coverageRequests: Record<string, unknown>[];
    if (selectedIds.length > 0) {
      coverageRequests = selectedIds.map((geographyId) => ({
        type: "ADMIN_GEOGRAPHY",
        geographyId,
      }));
    } else {
      let fallback = candidateCoverage;
      if (!fallback) {
        try {
          fallback = await resolveCandidateCoverage(location);
        } catch (cause) {
          setError(friendlyError(cause, "SKIMA could not prepare an operating-area request for this location. Try again."));
          return;
        }
      }
      if (!fallback) {
        setError("This location is not open for a driver application. Choose an approved service area or another operating location.");
        return;
      }
      coverageRequests = [fallback];
    }

    const existingPayload = props.existingPayload ?? {};
    const existingService = nestedRecord(existingPayload, "service") ?? {};
    const mergedPayload: PlatformRecord = {
      ...existingPayload,
      location,
      service: {
        ...existingService,
        coverageRequests,
      },
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
            <Text style={[styles.helper, { color: palette.muted }]}>SKIMA uses this only to review your application and requested service areas. It is never shown as your live public location.</Text>
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
            <Text style={[styles.helper, { color: palette.muted }]}>Choose all the areas you can reliably serve. SKIMA will review these areas before you can receive jobs there.</Text>
          </View>
        </View>

        {loadingAreas ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator color={palette.brand} />
            <Text style={[styles.helper, { color: palette.muted }]}>Loading available areas…</Text>
          </View>
        ) : areas.length === 0 ? (
          candidateCoverage ? (
            <View style={[styles.locationBox, { borderColor: palette.border, backgroundColor: palette.surface }]}>
              <Star size={18} color={palette.brand} />
              <View style={styles.locationCopy}>
                <Text style={[styles.locationTitle, { color: palette.ink }]}>Candidate operating area</Text>
                <Text style={[styles.helper, { color: palette.muted }]}>
                  No mapped SKIMA area covers this application yet. SKIMA will submit a {Math.round(candidateCoverage.radiusMeters / 1000 * 10) / 10} km radius around your captured operating location for Admin review. This does not turn on customer service in the area.
                </Text>
              </View>
            </View>
          ) : (
            <Text style={[styles.helper, { color: palette.muted }]}>
              No approved service geography is available here. Detect your operating location again so SKIMA can check whether a candidate-area application is allowed.
            </Text>
          )
        ) : (
          <View style={styles.areaList}>
            {areas.map((area) => {
              const selected = selectedIds.includes(area.area_id);
              return (
                <View key={area.area_id} style={[styles.areaRow, { borderColor: selected ? palette.brand : palette.border, backgroundColor: selected ? palette.brandSofter : palette.surface }]}> 
                  <Pressable style={styles.areaSelect} onPress={() => toggleArea(area.area_id)} accessibilityRole="checkbox" accessibilityState={{ checked: selected }}>
                    <View style={[styles.checkBox, { borderColor: selected ? palette.brand : palette.borderStrong, backgroundColor: selected ? palette.brand : "transparent" }]}> 
                      {selected ? <CheckCircle2 size={16} color="#FFFFFF" /> : null}
                    </View>
                    <View style={styles.areaCopy}>
                      <Text style={[styles.areaTitle, { color: palette.ink }]}>{area.display_name}</Text>
                      <Text style={[styles.helper, { color: palette.muted }]}>
                        {area.candidate ? "Requested operating area · customer service remains off until SKIMA enables it" : serviceAreaSummary(area)}
                      </Text>
                    </View>
                  </Pressable>

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
        disabled={
          loadingAreas ||
          resolvingCandidate ||
          !location ||
          (selectedIds.length === 0 && !candidateCoverage)
        }
        onPress={() => void save()}
      />
    </Screen>
  );
}

function operationalLocationFromRecord(record: PlatformRecord | null): OperationalLocation | null {
  if (!record) return null;
  const latitude = firstNumber(record, ["latitude"]);
  const longitude = firstNumber(record, ["longitude"]);
  if (latitude === null || longitude === null) return null;
  const address = nestedRecord(record, "address");
  const storedSource = firstString(record, ["providerSource"]);
  const providerSource: OperationalLocation["providerSource"] =
    storedSource === "device_geocoder" ||
    storedSource === "device_coordinates" ||
    storedSource === "maps_adapter" ||
    storedSource === "manual_pin"
      ? storedSource
      : "device_coordinates";

  return {
    latitude,
    longitude,
    accuracyMeters: firstNumber(record, ["accuracyMeters"]),
    recordedAt: firstString(record, ["recordedAt"]) ?? new Date().toISOString(),
    formattedAddress: firstString(record, ["formattedAddress"]) ?? "Saved operating location",
    providerPlaceId: firstString(record, ["providerPlaceId"]),
    providerSource,
    address: {
      name: firstString(address, ["name"]),
      street: firstString(address, ["street"]),
      district: firstString(address, ["district"]),
      city: firstString(address, ["city"]),
      region: firstString(address, ["region"]),
      postalCode: firstString(address, ["postalCode"]),
      country: firstString(address, ["country"]),
      countryCode: firstString(address, ["countryCode"]),
    },
  };
}

function readResolvedArea(value: unknown): ServiceArea | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.areaId === "string" ? row.areaId : null;
  const name = typeof row.displayName === "string" ? row.displayName : null;
  const type = typeof row.areaType === "string" ? row.areaType : null;
  if (!id || !name || !type) return null;
  return {
    area_id: id,
    display_name: name,
    area_type: type,
    state_name: null,
    lga_name: null,
    city_name: null,
    town_name: null,
    locality_name: null,
    candidate: row.candidate === true,
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
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
    : [];
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

function dateValue(record: PlatformRecord) {
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
  warningBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    flexDirection: "row",
    alignItems: "flex-start",
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

function countCoverageRequests(service: Record<string, unknown> | null): number {
  const requests = service?.coverageRequests;
  if (Array.isArray(requests)) return requests.length;
  const legacyIds = service?.serviceAreaIds;
  return Array.isArray(legacyIds) ? legacyIds.length : 0;
}

function readRadiusCoverageRequest(
  service: Record<string, unknown> | null,
): CandidateCoverageRequest | null {
  const requests = service?.coverageRequests;
  if (!Array.isArray(requests)) return null;
  for (const request of requests) {
    const parsed = readCandidateCoverageRequest(request);
    if (parsed) return parsed;
  }
  return null;
}

function readCandidateCoverageResponse(value: unknown): CandidateCoverageRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const result = value as Record<string, unknown>;
  return readCandidateCoverageRequest(result.request);
}

function readCandidateCoverageRequest(value: unknown): CandidateCoverageRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const request = value as Record<string, unknown>;
  if (request.type !== "RADIUS") return null;
  const latitude = Number(request.latitude);
  const longitude = Number(request.longitude);
  const radiusMeters = Number(request.radiusMeters);
  if (
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(radiusMeters) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180 ||
    radiusMeters <= 0
  ) {
    return null;
  }
  return {
    type: "RADIUS",
    latitude,
    longitude,
    radiusMeters,
    source: typeof request.source === "string" ? request.source : undefined,
  };
}

function readCoverageGeographyIds(service: Record<string, unknown> | null): string[] {
  const requests = service?.coverageRequests;
  if (Array.isArray(requests)) {
    return requests.flatMap((request) => request && typeof request === "object" && !Array.isArray(request) && typeof (request as Record<string, unknown>).geographyId === "string" ? [(request as Record<string, unknown>).geographyId as string] : []);
  }
  const legacyIds = service?.serviceAreaIds;
  return Array.isArray(legacyIds) ? legacyIds.filter((id): id is string => typeof id === "string") : [];
}
