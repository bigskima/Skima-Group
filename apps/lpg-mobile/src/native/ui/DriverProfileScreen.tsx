import { router } from "expo-router";
import { CreditCard, MapPin, ShieldCheck, UserRound } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { domainQueries } from "../api/domains";
import {
  displayReference,
  displayStatus,
  firstString,
  recordId,
} from "../api/records";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { PublicEntityImageEditor } from "./PublicEntityImageEditor";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { SectionHeader } from "./SectionHeader";
import { StatusPill } from "./StatusPill";

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
        subtitle="Your approved Driver profile will appear here when your account is ready."
        action={<BackButton />}
      >
        <EmptyState
          icon={<UserRound color={palette.brand} size={28} />}
          title="Driver profile not active yet"
          description="No active approved Driver profile is attached to this account. Check your Driver application for its current status."
          action={<AppButton label="View application" onPress={() => router.push("/(driver)/application" as never)} />}
        />
      </Screen>
    );
  }

  const driverId = recordId(driver);
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
      subtitle="Manage the information and public image people see for your SKIMA Driver identity."
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

      {driverId ? (
        <PublicEntityImageEditor
          entityType="driver"
          entityId={driverId}
          mediaRole="driver.photo.public"
          title="Public Driver photo"
          description="Choose the optional public-facing photo customers and Stations can use to recognize you. This does not replace your confidential KYC or identity evidence."
          label="Driver public photo"
          aspect={[1, 1]}
          variant="avatar"
        />
      ) : null}

      <SectionHeader title="Driver details" description="Core information on your active Driver profile." />
      <View style={[styles.detailCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <InfoField label="Phone" value={firstString(driver, ["phone", "phone_number", "phoneNumber"]) ?? "Not available"} />
        <Divider />
        <InfoField label="Driver licence" value={firstString(driver, ["licence_number", "licenceNumber", "licenseNumber"]) ?? "Protected or unavailable"} />
        <Divider />
        <InfoField label="Job availability" value={friendly(availability)} />
        <Divider />
        <InfoField label="Approval status" value={friendly(approval)} />
      </View>

      <View style={styles.actionGrid}>
        <AppButton
          label="Driver ID"
          variant="secondary"
          icon={<CreditCard color={palette.brand} size={18} />}
          onPress={() => router.push("/(driver)/id-card" as never)}
        />
        <AppButton
          label="Service areas"
          variant="secondary"
          icon={<MapPin color={palette.brand} size={18} />}
          onPress={() => router.push("/(driver)/service-zone" as never)}
        />
      </View>

      <View style={[styles.trustNote, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <ShieldCheck color={palette.mutedStrong} size={18} />
        <Text style={[styles.trustText, { color: palette.muted }]}>Public profile media and confidential verification evidence are stored and governed separately. Updating this photo does not alter your KYC record.</Text>
      </View>
    </Screen>
  );
}

function BackButton() {
  return <AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />;
}

function InfoField({ label, value }: { label: string; value: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.infoField}>
      <Text style={[styles.infoLabel, { color: palette.muted }]}>{label}</Text>
      <Text selectable style={[styles.infoValue, { color: palette.ink }]}>{value}</Text>
    </View>
  );
}

function Divider() {
  const { palette } = useAppTheme();
  return <View style={[styles.divider, { backgroundColor: palette.border }]} />;
}

function friendly(value: string) {
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function approvalTone(value: string): "neutral" | "brand" | "success" | "warning" | "danger" {
  const normalized = value.toLowerCase();
  if (["approved", "verified", "active"].some((part) => normalized.includes(part))) return "success";
  if (["rejected", "suspended", "failed"].some((part) => normalized.includes(part))) return "danger";
  if (["pending", "review"].some((part) => normalized.includes(part))) return "warning";
  return "neutral";
}

const styles = StyleSheet.create({
  profileHero: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  avatar: { width: 58, height: 58, borderRadius: 20, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroCopy: { flex: 1, minWidth: 0, gap: 3 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 8 },
  heroTitle: { color: "#FFFFFF", ...typography.heading, fontSize: 21 },
  heroBody: { color: "rgba(255,255,255,.84)", ...typography.caption },
  heroPills: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: 5 },
  detailCard: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.md },
  infoField: { gap: 4, paddingVertical: 5 },
  infoLabel: { ...typography.caption, fontSize: 10 },
  infoValue: { ...typography.bodyStrong, fontSize: 14 },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.sm },
  actionGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  trustNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  trustText: { flex: 1, ...typography.caption, lineHeight: 18 },
});
