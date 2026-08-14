import { router } from "expo-router";
import {
  BarChart3,
  Building2,
  CreditCard,
  MapPin,
  ShieldCheck,
  UserRound,
} from "lucide-react-native";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  domainQueries,
  useOrganizationRoles,
  useStationRuntime,
} from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import {
  ActionResponseSchema,
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  nestedRecord,
  nestedRecords,
  recordId,
} from "../api/records";
import {
  readOperationalLocation,
  type OperationalLocation,
} from "../device/location";
import { OperationalMap } from "../maps/OperationalMap";
import { useSession } from "../session/SessionProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { Card } from "./Card";
import { PresentationMediaPanel } from "./PresentationMediaPanel";
import { Screen } from "./Screen";
export function DriverProfileScreen() {
  const session = useSession();
  const drivers = domainQueries.drivers();
  const driver = drivers.data?.find(
    (item) =>
      firstString(item, ["user_id", "userId"]) === session.context?.user.id,
  );
  return (
    <Screen eyebrow="Driver identity" title="Profile" action={<Back />}>
      {drivers.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : !driver ? (
        <Unavailable text="No approved driver profile is attached to this account." />
      ) : (
        <>
          <View style={styles.profileHero}>
            <View style={styles.avatar}>
              <UserRound color="white" size={32} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>
                {firstString(driver, [
                  "display_name",
                  "displayName",
                  "full_name",
                  "fullName",
                ]) ??
                  session.context?.profile?.display_name ??
                  "SKIMA driver"}
              </Text>
              <Text style={styles.heroBody}>
                {displayReference(driver) ?? "Driver profile"}
              </Text>
              <Text style={styles.heroStatus}>
                {(
                  firstString(driver, [
                    "verification_status",
                    "verificationStatus",
                  ]) ??
                  displayStatus(driver) ??
                  "configured"
                ).replace(/[_-]/g, " ")}
              </Text>
            </View>
          </View>
          <Card>
            <Field
              label="Phone"
              value={
                firstString(driver, ["phone", "phone_number", "phoneNumber"]) ??
                "Not returned"
              }
            />
            <Field
              label="Licence"
              value={
                firstString(driver, [
                  "licence_number",
                  "licenceNumber",
                  "licenseNumber",
                ]) ?? "Protected or unavailable"
              }
            />
            <Field
              label="Availability"
              value={(
                firstString(driver, [
                  "online_status",
                  "onlineStatus",
                  "availability_status",
                ]) ?? "Offline"
              ).replace(/[_-]/g, " ")}
            />
            <Field
              label="Approval"
              value={(
                firstString(driver, [
                  "approval_status",
                  "approvalStatus",
                  "verification_status",
                ]) ?? "Configured"
              ).replace(/[_-]/g, " ")}
            />
          </Card>
          <Pressable
            style={styles.primary}
            onPress={() => router.push("/(driver)/id-card" as never)}
          >
            <CreditCard color="white" size={19} />
            <Text style={styles.primaryText}>View SKIMA Driver ID</Text>
          </Pressable>
        </>
      )}
    </Screen>
  );
}
export function DriverServiceZoneScreen() {
  const session = useSession();
  const drivers = domainQueries.drivers();
  const driver = drivers.data?.find(
    (item) =>
      firstString(item, ["user_id", "userId"]) === session.context?.user.id,
  );
  const zones = driver
    ? stringValues(driver.zones ?? driver.service_zones ?? driver.serviceZones)
    : [];
  return (
    <Screen
      eyebrow="Your work area"
      title="Service zones"
      action={<Back />}
    >
      {drivers.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <>
          <View style={styles.info}>
            <MapPin color={colors.brand} size={27} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Where you can accept jobs</Text>
              <Text style={styles.body}>
                These are the areas currently assigned to your driver account.
              </Text>
            </View>
          </View>
          {zones.map((zone) => (
            <Card key={zone}>
              <View style={styles.row}>
                <MapPin color={colors.brand} size={20} />
                <Text style={styles.title}>{zone}</Text>
                <ShieldCheck color={colors.success} size={20} />
              </View>
            </Card>
          ))}
          {zones.length === 0 ? (
            <Unavailable
              text={
                firstString(driver, [
                  "service_zone",
                  "zone_name",
                  "serviceZone",
                ]) ?? "No service area is listed yet."
              }
            />
          ) : null}
        </>
      )}
    </Screen>
  );
}
export function StationProfileScreen() {
  const runtime = useStationRuntime();
  const branch = nestedRecord(runtime.data, "branch");
  const id = branch ? recordId(branch) : null;
  const hours =
    nestedRecord(branch, "operatingHours") ??
    nestedRecord(branch, "operating_hours");
  const sizes = numberValues(
    branch?.supportedCylinderSizesKg ?? branch?.supported_cylinder_sizes_kg,
  );
  return (
    <Screen eyebrow="Approved station" title="Branch profile" action={<Back />}>
      {runtime.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : !branch ? (
        <StationActivation runtime={runtime} />
      ) : (
        <>
          <View style={styles.profileHero}>
            <View style={styles.avatar}>
              <Building2 color="white" size={32} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.heroTitle}>
                {firstString(branch, ["displayName", "display_name", "name"]) ??
                  "SKIMA station"}
              </Text>
              <Text style={styles.heroBody}>
                {firstString(branch, [
                  "formattedAddress",
                  "formatted_address",
                  "address",
                ]) ?? "Address unavailable"}
              </Text>
              <Text style={styles.heroStatus}>
                {(
                  firstString(branch, [
                    "complianceStatus",
                    "compliance_status",
                    "approvalStatus",
                  ]) ?? "configured"
                ).replace(/[_-]/g, " ")}
              </Text>
            </View>
          </View>
          <Card>
            <Field
              label="Availability"
              value={(
                firstString(branch, [
                  "availabilityStatus",
                  "availability_status",
                ]) ?? "Unavailable"
              ).replace(/[_-]/g, " ")}
            />
            <Field
              label="Operating hours"
              value={`${firstString(hours, ["opensAt", "opens_at"]) ?? "—"} – ${firstString(hours, ["closesAt", "closes_at"]) ?? "—"}`}
            />
            <Field
              label="Service radius"
              value={
                firstNumber(branch, [
                  "serviceRadiusMeters",
                  "service_radius_meters",
                ]) !== null
                  ? `${firstNumber(branch, ["serviceRadiusMeters", "service_radius_meters"])} m`
                  : "Not configured"
              }
            />
            <Field
              label="Supported cylinders"
              value={
                sizes.length
                  ? sizes.map((size) => `${size} kg`).join(", ")
                  : "Configure in inventory"
              }
            />
          </Card>
          {id ? (
            <PresentationMediaPanel subjectId={id} subjectType="station" />
          ) : null}
        </>
      )}
    </Screen>
  );
}

function StationActivation({
  runtime,
}: {
  runtime: ReturnType<typeof useStationRuntime>;
}) {
  const session = useSession();
  const organization =
    session.context?.organizations.find((item) => item.organizationId) ?? null;
  const organizationId = organization?.organizationId ?? null;
  const [location, setLocation] = useState<OperationalLocation | null>(null);
  const [detecting, setDetecting] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const activation = useGatewayMutation({
    path: "/lpg/stations/activate",
    schema: ActionResponseSchema,
    invalidate: [["station-runtime"], ["stations"]],
  });
  const detect = async () => {
    setDetecting(true);
    setNotice(null);
    try {
      setLocation(await readOperationalLocation());
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Station location could not be detected.",
      );
    } finally {
      setDetecting(false);
    }
  };
  useEffect(() => {
    void detect();
  }, []);
  const activate = async () => {
    if (!organizationId || !location) return;
    setNotice(null);
    try {
      await activation.mutateAsync({
        organizationId,
        ownerUserId: session.context?.user.id,
        branchKey: "lpg.station.primary",
        displayName: organization?.displayName ?? "Primary station",
        formattedAddress: location.formattedAddress,
        latitude: location.latitude,
        longitude: location.longitude,
        supportedCylinderSizesKg: [],
        refillCapacityKg: 0,
        currentAvailableKg: 0,
        metadata: {
          locationProvider: location.providerSource,
          locationAccuracyMeters: location.accuracyMeters,
        },
        source: "skima.lpg.station_activation_ui",
        idempotencyKey: `skima:lpg:station-activation:${organizationId}:primary`,
      });
      await Promise.all([runtime.refetch(), session.refresh()]);
      setNotice("Station branch activated from the verified device location.");
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Station branch could not be activated.",
      );
    }
  };
  return (
    <View style={styles.setup}>
      <View style={styles.info}>
        <MapPin color={colors.brand} size={28} />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Finish the first station location</Text>
          <Text style={styles.body}>
            Your station account is ready. Allow location access to place this
            branch accurately on the map.
          </Text>
        </View>
      </View>
      {location ? (
        <>
          <OperationalMap
            points={[
              {
                latitude: location.latitude,
                longitude: location.longitude,
                label: organization?.displayName ?? "Station",
                kind: "station",
              },
            ]}
          />
          <Card>
            <Field label="Detected address" value={location.formattedAddress} />
            <Field
              label="Coordinates"
              value={`${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`}
            />
          </Card>
        </>
      ) : null}
      <Pressable
        disabled={
          detecting || activation.isPending || !location || !organizationId
        }
        onPress={() => (location ? void activate() : void detect())}
        style={styles.activate}
      >
        {detecting || activation.isPending ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.activateText}>
            Activate station at this location
          </Text>
        )}
      </Pressable>
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
    </View>
  );
}
export function StationReportsScreen() {
  const runtime = useStationRuntime();
  const settlements = domainQueries.settlements();
  const orders = nestedRecords(runtime.data, "orders");
  const completed = orders.filter((item) =>
    ["completed", "station_settled", "delivered"].some((state) =>
      (displayStatus(item) ?? "").includes(state),
    ),
  );
  const active = orders.filter((item) => !completed.includes(item));
  const totalKg = completed.reduce(
    (sum, item) =>
      sum + (firstNumber(item, ["actualKg", "actual_kg", "refillKg"]) ?? 0),
    0,
  );
  const net = (settlements.data ?? []).reduce(
    (sum, item) => sum + (firstNumber(item, ["net_amount", "netAmount"]) ?? 0),
    0,
  );
  const currency =
    firstString(settlements.data?.[0], ["currency_code", "currencyCode"]) ??
    "NGN";
  return (
    <Screen
      eyebrow="Station activity"
      title="Station reports"
      action={<Back />}
    >
      {runtime.isPending || settlements.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <>
          <View style={styles.metrics}>
            <Metric label="Active jobs" value={String(active.length)} />
            <Metric label="Completed" value={String(completed.length)} />
            <Metric label="Verified kg" value={totalKg.toFixed(1)} />
          </View>
          <View style={styles.reportHero}>
            <BarChart3 color="white" size={28} />
            <View>
              <Text style={styles.heroBody}>TOTAL SETTLEMENTS</Text>
              <Text style={styles.heroTitle}>{money(net, currency)}</Text>
            </View>
          </View>
          <Text style={styles.section}>Recent completed operations</Text>
          {completed.slice(0, 10).map((item, index) => (
            <Card key={recordId(item) ?? String(index)}>
              <View style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.title}>
                    {displayReference(item) ?? "Completed LPG operation"}
                  </Text>
                  <Text style={styles.body}>
                    {(displayStatus(item) ?? "completed").replace(/[_-]/g, " ")}
                  </Text>
                </View>
                <Text style={styles.title}>
                  {firstNumber(item, ["actualKg", "actual_kg", "refillKg"]) ??
                    "—"}{" "}
                  kg
                </Text>
              </View>
            </Card>
          ))}
          {completed.length === 0 ? (
            <Unavailable text="No completed station jobs are available for this period." />
          ) : null}
        </>
      )}
    </Screen>
  );
}
export function StationRolesScreen() {
  const session = useSession();
  const roles = useOrganizationRoles();
  const organizationId =
    session.context?.organizations.find((item) => item.organizationId)
      ?.organizationId ?? null;
  const records = (roles.data ?? []).filter(
    (role) =>
      firstString(role, ["organization_id", "organizationId"]) ===
      organizationId,
  );
  return (
    <Screen
      eyebrow="Access policy"
      title="Roles and permissions"
      action={<Back />}
    >
      {roles.isPending ? (
        <ActivityIndicator color={colors.brand} />
      ) : (
        <>
          {records.map((role, index) => {
            const permissions = stringValues(
              role.permission_keys ?? role.permissionKeys ?? role.permissions,
            );
            return (
              <Card key={recordId(role) ?? String(index)}>
                <View style={styles.row}>
                  <ShieldCheck color={colors.brand} size={23} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>
                      {firstString(role, [
                        "display_name",
                        "displayName",
                        "key",
                      ]) ?? "Station role"}
                    </Text>
                    <Text style={styles.body}>
                      {permissions.length} access {permissions.length === 1 ? "area" : "areas"}
                    </Text>
                  </View>
                </View>
              </Card>
            );
          })}
          {records.length === 0 ? (
            <Unavailable text="No organization roles are visible to this account." />
          ) : null}
        </>
      )}
    </Screen>
  );
}
function Back() {
  return (
    <Pressable onPress={() => router.back()}>
      <Text style={styles.back}>Back</Text>
    </Pressable>
  );
}
function Field({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value}</Text>
    </View>
  );
}
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.body}>{label}</Text>
    </View>
  );
}
function Unavailable({ text }: { text: string }) {
  return (
    <View style={styles.empty}>
      <ShieldCheck color={colors.brand} size={30} />
      <Text style={styles.body}>{text}</Text>
    </View>
  );
}
function stringValues(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
function numberValues(value: unknown) {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
}
function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}
const styles = StyleSheet.create({
  back: { color: colors.brand, fontWeight: "900" },
  profileHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.brand,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.16)",
  },
  heroTitle: { color: "white", fontSize: 23, fontWeight: "900" },
  heroBody: { color: "#FFF1F2", marginTop: 4 },
  heroStatus: {
    color: "white",
    fontWeight: "900",
    textTransform: "capitalize",
    marginTop: 5,
  },
  label: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "800",
    textTransform: "uppercase",
  },
  value: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "800",
    textTransform: "capitalize",
  },
  info: {
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: "#FFF0F1",
  },
  title: { color: colors.ink, fontSize: 17, fontWeight: "900" },
  body: { color: colors.muted, lineHeight: 20 },
  primary: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontWeight: "900" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  metrics: { flexDirection: "row", gap: spacing.md },
  metric: {
    flex: 1,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  metricValue: { color: colors.ink, fontSize: 27, fontWeight: "900" },
  reportHero: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.xl,
    borderRadius: radii.lg,
    backgroundColor: colors.brand,
  },
  section: { color: colors.ink, fontSize: 20, fontWeight: "900" },
  permission: { color: colors.muted, lineHeight: 20 },
  empty: {
    minHeight: 180,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  setup: { gap: spacing.md },
  activate: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  activateText: { color: "white", fontWeight: "900" },
  notice: { color: colors.danger, fontWeight: "700", lineHeight: 20 },
});
