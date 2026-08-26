import { router } from "expo-router";
import {
  BarChart3,
  BriefcaseBusiness,
  Building2,
  Clock3,
  CreditCard,
  Gauge,
  MapPin,
  ShieldCheck,
  UserRound,
} from "lucide-react-native";
import {
  domainQueries,
  useOrganizationRoles,
  useStationRuntime,
} from "../api/domains";
import {
  displayReference,
  displayStatus,
  firstNumber,
  firstString,
  nestedRecord,
  nestedRecords,
  recordId,
} from "../api/records";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { PresentationMediaPanel } from "./PresentationMediaPanel";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";
import { StyleSheet, Text, View } from "react-native";

export function DriverProfileScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const drivers = domainQueries.drivers();
  const driver = drivers.data?.find(
    (item) => firstString(item, ["user_id", "userId"]) === session.context?.user.id,
  );

  if (drivers.isPending) {
    return (
      <Screen eyebrow="Driver profile" title="Profile" action={<BackButton />}>
        <ScreenSkeleton cards={3} />
      </Screen>
    );
  }

  if (!driver) {
    return (
      <Screen
        eyebrow="Driver profile"
        title="Profile"
        subtitle="Your approved driver profile will appear here when your account is ready."
        action={<BackButton />}
      >
        <EmptyState
          icon={<UserRound color={palette.brand} size={28} />}
          title="Driver profile not active yet"
          description="No active approved driver profile is attached to this account. Check your driver application for its current status."
          action={<AppButton label="View application" onPress={() => router.push("/(driver)/application" as never)} />}
        />
      </Screen>
    );
  }

  const name =
    firstString(driver, ["display_name", "displayName", "full_name", "fullName"]) ??
    session.context?.profile?.display_name ??
    "SKIMA driver";
  const verification =
    firstString(driver, ["verification_status", "verificationStatus"]) ??
    displayStatus(driver) ??
    "pending";
  const availability =
    firstString(driver, ["online_status", "onlineStatus", "availability_status"]) ?? "offline";
  const approval =
    firstString(driver, ["approval_status", "approvalStatus", "verification_status"]) ?? "pending";

  return (
    <Screen
      eyebrow="Driver profile"
      title="Profile"
      subtitle="Your driver details, approval and job information."
      action={<BackButton />}
    >
      <View style={[styles.profileHero, shadows.raised, { backgroundColor: palette.brand }]}>
        <View style={styles.avatar}><UserRound color="#FFFFFF" size={31} /></View>
        <View style={styles.heroCopy}>
          <Text style={styles.heroEyebrow}>SKIMA DRIVER</Text>
          <Text style={styles.heroTitle}>{name}</Text>
          <Text style={styles.heroBody}>{displayReference(driver) ?? "Driver profile"}</Text>
          <View style={styles.heroPills}>
            <StatusPill label={friendly(verification)} tone={approvalTone(verification)} />
            <StatusPill label={friendly(availability)} tone={availability === "online" ? "success" : availability === "busy" ? "warning" : "neutral"} />
          </View>
        </View>
      </View>

      <SectionHeader title="Driver details" description="Information on your current driver profile." />
      <View style={[styles.detailCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <InfoField label="Phone" value={firstString(driver, ["phone", "phone_number", "phoneNumber"]) ?? "Not available"} />
        <Divider />
        <InfoField label="Driver licence" value={firstString(driver, ["licence_number", "licenceNumber", "licenseNumber"]) ?? "Protected or unavailable"} />
        <Divider />
        <InfoField label="Job availability" value={friendly(availability)} />
        <Divider />
        <InfoField label="Approval status" value={friendly(approval)} />
      </View>

      <AppButton
        label="View SKIMA Driver ID"
        fullWidth
        size="lg"
        icon={<CreditCard color="#FFFFFF" size={19} />}
        onPress={() => router.push("/(driver)/id-card" as never)}
      />

      <View style={[styles.trustNote, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <ShieldCheck color={palette.mutedStrong} size={18} />
        <Text style={[styles.trustText, { color: palette.muted }]}>Your Driver Pass shows only information approved for public verification. Your private identity documents remain protected.</Text>
      </View>
    </Screen>
  );
}

export function DriverServiceZoneScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const drivers = domainQueries.drivers();
  const driver = drivers.data?.find(
    (item) => firstString(item, ["user_id", "userId"]) === session.context?.user.id,
  );
  const zones = driver ? stringValues(driver.zones ?? driver.service_zones ?? driver.serviceZones) : [];
  const fallbackZone = firstString(driver, ["service_zone", "zone_name", "serviceZone"]);

  return (
    <Screen
      eyebrow="Service areas"
      title="Service areas"
      subtitle="These are the places where you are approved to receive jobs."
      action={<BackButton />}
    >
      {drivers.isPending ? (
        <ScreenSkeleton cards={3} />
      ) : !driver ? (
        <EmptyState
          icon={<MapPin color={palette.brand} size={27} />}
          title="Driver profile unavailable"
          description="Your service areas will appear when your approved driver account is ready."
        />
      ) : (
        <>
          <View style={[styles.infoHero, { backgroundColor: palette.brandSoft }]}>
            <MapPin color={palette.brand} size={26} />
            <View style={styles.infoCopy}>
              <Text style={[styles.infoTitle, { color: palette.ink }]}>Approved service areas</Text>
              <Text style={[styles.infoBody, { color: palette.muted }]}>You may receive jobs from more than one nearby area when SKIMA has approved those areas for you.</Text>
            </View>
          </View>

          <View style={styles.zoneList}>
            {zones.length ? (
              zones.map((zone) => (
                <View key={zone} style={[styles.zoneCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  <View style={[styles.zoneIcon, { backgroundColor: palette.brandSoft }]}><MapPin color={palette.brand} size={20} /></View>
                  <Text style={[styles.zoneName, { color: palette.ink }]}>{zone}</Text>
                  <StatusPill label="Approved" tone="success" />
                </View>
              ))
            ) : fallbackZone ? (
              <View style={[styles.zoneCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={[styles.zoneIcon, { backgroundColor: palette.brandSoft }]}><MapPin color={palette.brand} size={20} /></View>
                <Text style={[styles.zoneName, { color: palette.ink }]}>{fallbackZone}</Text>
                <StatusPill label="Approved" tone="success" />
              </View>
            ) : (
              <EmptyState
                icon={<MapPin color={palette.brand} size={27} />}
                title="No service area listed"
                description="Your approved service areas are not available yet. Check again shortly."
              />
            )}
          </View>

          <View style={[styles.trustNote, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
            <ShieldCheck color={palette.mutedStrong} size={18} />
            <Text style={[styles.trustText, { color: palette.muted }]}>Jobs are offered based on your approved service areas, vehicle, availability and account status.</Text>
          </View>
        </>
      )}
    </Screen>
  );
}

export function StationProfileScreen() {
  const { palette } = useAppTheme();
  const runtime = useStationRuntime();
  const branch = nestedRecord(runtime.data, "branch");
  const id = branch ? recordId(branch) : null;
  const hours = nestedRecord(branch, "operatingHours") ?? nestedRecord(branch, "operating_hours");
  const sizes = numberValues(branch?.supportedCylinderSizesKg ?? branch?.supported_cylinder_sizes_kg);

  return (
    <Screen
      eyebrow="Station profile"
      title="Branch profile"
      subtitle="Your station profile and current branch information."
      action={<BackButton />}
    >
      {runtime.isPending ? (
        <ScreenSkeleton cards={3} />
      ) : runtime.error ? (
        <EmptyState
          icon={<Building2 color={palette.brand} size={27} />}
          title="Station profile could not be loaded"
          description="Check your connection and refresh the station workspace."
          action={<AppButton label="Retry" onPress={() => void runtime.refetch()} />}
        />
      ) : !branch ? (
        <StationAwaitingActivation />
      ) : (
        <>
          <View style={[styles.profileHero, shadows.raised, { backgroundColor: palette.brand }]}>
            <View style={styles.avatar}><Building2 color="#FFFFFF" size={31} /></View>
            <View style={styles.heroCopy}>
              <Text style={styles.heroEyebrow}>SKIMA STATION</Text>
              <Text style={styles.heroTitle}>{firstString(branch, ["displayName", "display_name", "name"]) ?? "SKIMA station"}</Text>
              <Text style={styles.heroBody}>{firstString(branch, ["formattedAddress", "formatted_address", "address"]) ?? "Address unavailable"}</Text>
              <View style={styles.heroPills}>
                <StatusPill
                  label={friendly(firstString(branch, ["complianceStatus", "compliance_status", "approvalStatus"]) ?? "pending")}
                  tone="success"
                />
                <StatusPill
                  label={friendly(firstString(branch, ["availabilityStatus", "availability_status"]) ?? "unavailable")}
                  tone={(firstString(branch, ["availabilityStatus", "availability_status"]) ?? "") === "available" ? "success" : "warning"}
                />
              </View>
            </View>
          </View>

          <SectionHeader title="Branch details" description="Current information for this station branch." />
          <View style={styles.metricGrid}>
            <ProfileMetric icon={<Clock3 color={palette.brand} size={19} />} label="Hours" value={`${firstString(hours, ["opensAt", "opens_at"]) ?? "—"} – ${firstString(hours, ["closesAt", "closes_at"]) ?? "—"}`} />
            <ProfileMetric icon={<Gauge color={palette.brand} size={19} />} label="Service radius" value={formatRadius(firstNumber(branch, ["serviceRadiusMeters", "service_radius_meters"]))} />
          </View>

          <View style={[styles.detailCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <InfoField label="Availability" value={friendly(firstString(branch, ["availabilityStatus", "availability_status"]) ?? "unavailable")} />
            <Divider />
            <InfoField label="Supported cylinders" value={sizes.length ? sizes.map((size) => `${size} kg`).join(", ") : "Not available"} />
          </View>

          {id ? <PresentationMediaPanel subjectId={id} subjectType="station" /> : null}
        </>
      )}
    </Screen>
  );
}

function StationAwaitingActivation() {
  const { palette } = useAppTheme();
  return (
    <>
      <EmptyState
        icon={<Building2 color={palette.brand} size={28} />}
        title="Your station is not ready to receive orders yet"
        description="Your application is approved, but SKIMA is still completing your station setup. We will notify you when it can receive orders."
        action={<AppButton label="View application status" onPress={() => router.push("/(station)/application" as never)} />}
      />
      <View style={[styles.trustNote, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <ShieldCheck color={palette.mutedStrong} size={18} />
        <Text style={[styles.trustText, { color: palette.muted }]}>SKIMA will complete setup for the approved branch. This profile will update automatically when the station is ready.</Text>
      </View>
    </>
  );
}

export function StationReportsScreen() {
  const { palette } = useAppTheme();
  const runtime = useStationRuntime();
  const settlements = domainQueries.settlements();
  const orders = nestedRecords(runtime.data, "orders");
  const completed = orders.filter((item) =>
    ["completed", "station_settled", "delivered"].some((state) => (displayStatus(item) ?? "").includes(state)),
  );
  const active = orders.filter((item) => !completed.includes(item));
  const totalKg = completed.reduce(
    (sum, item) => sum + (firstNumber(item, ["actualKg", "actual_kg", "refillKg"]) ?? 0),
    0,
  );
  const net = (settlements.data ?? []).reduce(
    (sum, item) => sum + (firstNumber(item, ["net_amount", "netAmount"]) ?? 0),
    0,
  );
  const currency = firstString(settlements.data?.[0], ["currency_code", "currencyCode"]) ?? "NGN";

  return (
    <Screen
      eyebrow="Station activity"
      title="Reports"
      subtitle="See completed orders and station earnings."
      action={<BackButton />}
    >
      {runtime.isPending || settlements.isPending ? (
        <ScreenSkeleton cards={3} />
      ) : runtime.error || settlements.error ? (
        <EmptyState
          icon={<BarChart3 color={palette.brand} size={27} />}
          title="Station report could not be loaded"
          description="Check your connection and refresh the station workspace."
          action={<AppButton label="Retry" onPress={() => void Promise.all([runtime.refetch(), settlements.refetch()])} />}
        />
      ) : (
        <>
          <View style={styles.metricGrid}>
            <ProfileMetric icon={<BriefcaseBusiness color={palette.brand} size={19} />} label="Active jobs" value={String(active.length)} />
            <ProfileMetric icon={<ShieldCheck color={palette.success} size={19} />} label="Completed" value={String(completed.length)} />
            <ProfileMetric icon={<Gauge color={palette.brand} size={19} />} label="Verified kg" value={totalKg.toFixed(1)} />
          </View>

          <View style={[styles.reportHero, shadows.raised, { backgroundColor: palette.brand }]}>
            <BarChart3 color="#FFFFFF" size={27} />
            <View style={styles.reportCopy}>
              <Text style={styles.reportEyebrow}>TOTAL EARNINGS</Text>
              <Text adjustsFontSizeToFit numberOfLines={1} style={styles.reportValue}>{money(net, currency)}</Text>
            </View>
          </View>

          <SectionHeader title="Recent completed orders" description="The latest LPG orders completed by this station." />
          <View style={styles.operationList}>
            {completed.length ? (
              completed.slice(0, 10).map((item, index) => (
                <View key={recordId(item) ?? String(index)} style={[styles.operationCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                  <View style={[styles.operationIcon, { backgroundColor: palette.brandSoft }]}><BriefcaseBusiness color={palette.brand} size={20} /></View>
                  <View style={styles.operationCopy}>
                    <Text numberOfLines={1} style={[styles.operationTitle, { color: palette.ink }]}>{displayReference(item) ?? "Completed LPG operation"}</Text>
                    <Text style={[styles.operationMeta, { color: palette.muted }]}>{friendly(displayStatus(item) ?? "completed")}</Text>
                  </View>
                  <Text style={[styles.operationKg, { color: palette.ink }]}>{firstNumber(item, ["actualKg", "actual_kg", "refillKg"]) ?? "—"} kg</Text>
                </View>
              ))
            ) : (
              <EmptyState
                icon={<BarChart3 color={palette.brand} size={27} />}
                title="No completed operations yet"
                description="Completed LPG orders will appear here."
              />
            )}
          </View>
        </>
      )}
    </Screen>
  );
}

export function StationRolesScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const roles = useOrganizationRoles();
  const organizationId = session.context?.organizations.find((item) => item.organizationId)?.organizationId ?? null;
  const records = (roles.data ?? []).filter(
    (role) => firstString(role, ["organization_id", "organizationId"]) === organizationId,
  );

  return (
    <Screen
      eyebrow="Station access"
      title="Roles & permissions"
      subtitle="Review the team roles available for this station."
      action={<BackButton />}
    >
      {roles.isPending ? (
        <ScreenSkeleton cards={3} />
      ) : roles.error ? (
        <EmptyState
          icon={<ShieldCheck color={palette.brand} size={27} />}
          title="Roles could not be loaded"
          description="Check your connection and try again."
          action={<AppButton label="Retry" onPress={() => void roles.refetch()} />}
        />
      ) : records.length ? (
        <View style={styles.roleList}>
          {records.map((role, index) => {
            const permissions = stringValues(role.permission_keys ?? role.permissionKeys ?? role.permissions);
            return (
              <View key={recordId(role) ?? String(index)} style={[styles.roleCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
                <View style={[styles.roleIcon, { backgroundColor: palette.brandSoft }]}><ShieldCheck color={palette.brand} size={21} /></View>
                <View style={styles.roleCopy}>
                  <Text style={[styles.roleTitle, { color: palette.ink }]}>{firstString(role, ["display_name", "displayName", "key"]) ?? "Station role"}</Text>
                  <Text style={[styles.roleMeta, { color: palette.muted }]}>{permissions.length} access {permissions.length === 1 ? "area" : "areas"}</Text>
                </View>
                <StatusPill label="Available" tone="brand" />
              </View>
            );
          })}
        </View>
      ) : (
        <EmptyState
          icon={<ShieldCheck color={palette.brand} size={27} />}
          title="No roles visible"
          description="No organisation roles are currently visible to this account."
        />
      )}
    </Screen>
  );
}

function BackButton() {
  return <AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />;
}

function InfoField({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.fieldRow}>
      <Text style={[styles.fieldLabel, { color: palette.muted }]}>{label}</Text>
      <Text style={[styles.fieldValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function Divider() {
  const { palette } = useAppTheme();
  return <View style={[styles.divider, { backgroundColor: palette.border }]} />;
}

function ProfileMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={[styles.metricIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <Text numberOfLines={1} style={[styles.metricValue, { color: palette.ink }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: palette.muted }]}>{label}</Text>
    </View>
  );
}

function stringValues(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numberValues(value: unknown) {
  return Array.isArray(value) ? value.map(Number).filter(Number.isFinite) : [];
}

function money(value: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

function formatRadius(value: number | null) {
  if (value === null) return "Not available";
  return value >= 1000 ? `${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)} km` : `${value} m`;
}

function friendly(value: string) {
  return value.replace(/[_-]/g, " ").replace(/^./, (letter) => letter.toUpperCase());
}

function approvalTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const normalized = value.toLowerCase();
  if (["approved", "verified", "active"].some((part) => normalized.includes(part))) return "success";
  if (["rejected", "suspended", "deactivated"].some((part) => normalized.includes(part))) return "danger";
  if (["pending", "review"].some((part) => normalized.includes(part))) return "warning";
  return "brand";
}

const styles = StyleSheet.create({
  profileHero: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  avatar: { width: 62, height: 62, borderRadius: 21, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,.14)" },
  heroCopy: { flex: 1, minWidth: 0, gap: 3 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  heroTitle: { color: "#FFFFFF", ...typography.heading, fontSize: 22 },
  heroBody: { color: "rgba(255,255,255,.84)", ...typography.caption },
  heroPills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.xs },
  detailCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  fieldRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  fieldLabel: { ...typography.caption, flex: 0.42 },
  fieldValue: { ...typography.bodyStrong, fontSize: 14, flex: 0.58, textAlign: "right" },
  divider: { height: StyleSheet.hairlineWidth },
  trustNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  trustText: { flex: 1, ...typography.caption, lineHeight: 18 },
  infoHero: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md, borderRadius: radii.xl, padding: spacing.lg },
  infoCopy: { flex: 1, gap: 3 },
  infoTitle: { ...typography.subheading, fontSize: 15 },
  infoBody: { ...typography.caption, lineHeight: 18 },
  zoneList: { gap: spacing.sm },
  zoneCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  zoneIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  zoneName: { flex: 1, ...typography.bodyStrong, fontSize: 14 },
  metricGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  metric: { flex: 1, minWidth: 110, gap: 5, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  metricIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  metricValue: { ...typography.heading, fontSize: 18 },
  metricLabel: { ...typography.caption },
  reportHero: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  reportCopy: { flex: 1, minWidth: 0 },
  reportEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  reportValue: { color: "#FFFFFF", fontSize: 30, lineHeight: 37, fontWeight: "900", letterSpacing: -0.7, marginTop: 3 },
  operationList: { gap: spacing.sm },
  operationCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  operationIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  operationCopy: { flex: 1, minWidth: 0, gap: 2 },
  operationTitle: { ...typography.bodyStrong, fontSize: 14 },
  operationMeta: { ...typography.caption },
  operationKg: { ...typography.bodyStrong, fontSize: 14 },
  roleList: { gap: spacing.sm },
  roleCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  roleIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  roleCopy: { flex: 1, minWidth: 0, gap: 2 },
  roleTitle: { ...typography.bodyStrong, fontSize: 14 },
  roleMeta: { ...typography.caption },
});