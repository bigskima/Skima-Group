import { router } from "expo-router";
import { Clock3, Power, ShieldCheck, Store } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useStationRuntime } from "../api/domains";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, firstString, nestedRecord, recordId } from "../api/records";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";
import { StatusPill } from "./StatusPill";

export function StationOperatingSettingsScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const hasPermission = (permission: string) =>
    Boolean(
      session.context?.platformAdmin ||
        session.context?.permissions.includes(permission) ||
        session.context?.roles.some((role) => role.permissions.includes(permission)),
    );
  const canManage = hasPermission("lpg.stations.manage");

  const runtime = useStationRuntime();
  const branch = nestedRecord(runtime.data, "branch");
  const branchId = branch ? recordId(branch) : null;
  const hours = nestedRecord(branch, "operatingHours") ?? nestedRecord(branch, "operating_hours");

  const [availability, setAvailability] = useState("available");
  const [opens, setOpens] = useState("");
  const [closes, setCloses] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeSuccess, setNoticeSuccess] = useState(false);

  const mutation = useGatewayMutation({
    path: "/lpg/stations/settings",
    schema: ActionResponseSchema,
    invalidate: [["station-runtime"], ["stations"]],
  });

  useEffect(() => {
    if (!branch) return;
    setAvailability(firstString(branch, ["availabilityStatus", "availability_status"]) ?? "available");
    setOpens(firstString(hours, ["opensAt", "opens_at"]) ?? "");
    setCloses(firstString(hours, ["closesAt", "closes_at"]) ?? "");
  }, [branch, hours]);

  const save = async () => {
    setNotice(null);
    if (!canManage || !branchId) {
      setNoticeSuccess(false);
      setNotice("Your current station role cannot change operating settings.");
      return;
    }
    try {
      await mutation.mutateAsync({
        stationBranchId: branchId,
        availabilityStatus: availability,
        operatingHours: { opensAt: opens, closesAt: closes },
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("station-settings", branchId),
      });
      setNoticeSuccess(true);
      setNotice("Operating settings updated.");
    } catch (cause) {
      setNoticeSuccess(false);
      setNotice(friendlyError(cause, "Operating settings could not be saved."));
    }
  };

  return (
    <Screen
      eyebrow="Station settings"
      title="Availability & hours"
      subtitle="Control whether this branch can receive orders and when it operates."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      {runtime.isPending ? (
        <ScreenSkeleton cards={1} />
      ) : runtime.error || !branch ? (
        <EmptyState
          icon={<Store color={palette.brand} size={27} />}
          title="Operating settings unavailable"
          description="The station branch could not be loaded."
          action={<AppButton label="Retry" onPress={() => void runtime.refetch()} />}
        />
      ) : (
        <>
          <View style={[styles.hero, shadows.raised, { backgroundColor: availability === "available" ? palette.brand : palette.ink }]}>
            <View style={styles.heroTop}>
              <View style={styles.heroCopy}>
                <Text style={styles.heroEyebrow}>BRANCH STATUS</Text>
                <Text style={styles.heroTitle}>{availabilityLabel(availability)}</Text>
              </View>
              <View style={styles.heroIcon}><Power color="#FFFFFF" size={24} /></View>
            </View>
            <View style={styles.heroFooter}>
              <StatusPill
                label={availabilityLabel(availability)}
                tone={availability === "available" ? "success" : availability === "paused" ? "warning" : "neutral"}
              />
              <Text style={styles.heroHours}>{opens && closes ? `${opens} – ${closes}` : "Hours not fully set"}</Text>
            </View>
          </View>

          <View style={[styles.card, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.lead}>
              <View style={[styles.iconWrap, { backgroundColor: palette.brandSoft }]}><Power color={palette.brand} size={21} /></View>
              <View style={styles.copy}>
                <Text style={[styles.title, { color: palette.ink }]}>Operating status</Text>
                <Text style={[styles.body, { color: palette.muted }]}>
                  {canManage ? "Choose the branch's current operating state." : "Your role can view this setting but cannot change it."}
                </Text>
              </View>
            </View>

            <View style={styles.choices}>
              {["available", "paused", "closed", "unavailable"].map((value) => (
                <AppButton
                  key={value}
                  label={availabilityLabel(value)}
                  size="sm"
                  variant={availability === value ? "primary" : "secondary"}
                  disabled={!canManage}
                  onPress={() => setAvailability(value)}
                />
              ))}
            </View>

            <View style={[styles.divider, { backgroundColor: palette.border }]} />

            <View style={styles.lead}>
              <View style={[styles.iconWrap, { backgroundColor: palette.brandSoft }]}><Clock3 color={palette.brand} size={21} /></View>
              <View style={styles.copy}>
                <Text style={[styles.title, { color: palette.ink }]}>Operating hours</Text>
                <Text style={[styles.body, { color: palette.muted }]}>Use 24-hour time, for example 08:00 to 18:00.</Text>
              </View>
            </View>

            <View style={styles.timeGrid}>
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: palette.ink }]}>Opens</Text>
                <TextInput
                  editable={canManage}
                  value={opens}
                  onChangeText={setOpens}
                  placeholder="08:00"
                  placeholderTextColor={palette.muted}
                  autoCapitalize="none"
                  style={[styles.input, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink, opacity: canManage ? 1 : 0.65 }]}
                />
              </View>
              <View style={styles.fieldGroup}>
                <Text style={[styles.fieldLabel, { color: palette.ink }]}>Closes</Text>
                <TextInput
                  editable={canManage}
                  value={closes}
                  onChangeText={setCloses}
                  placeholder="18:00"
                  placeholderTextColor={palette.muted}
                  autoCapitalize="none"
                  style={[styles.input, { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink, opacity: canManage ? 1 : 0.65 }]}
                />
              </View>
            </View>

            {canManage ? (
              <AppButton label="Save changes" fullWidth loading={mutation.isPending} onPress={() => void save()} />
            ) : (
              <PermissionNotice text="Operating settings are read-only for your current station role." />
            )}
          </View>

          {notice ? (
            <View style={[styles.notice, { backgroundColor: noticeSuccess ? palette.successSoft : palette.dangerSoft }]}>
              <Text accessibilityRole="alert" style={[styles.noticeText, { color: noticeSuccess ? palette.success : palette.danger }]}>{notice}</Text>
            </View>
          ) : null}
        </>
      )}
    </Screen>
  );
}

function PermissionNotice({ text }: { text: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.permission, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
      <ShieldCheck color={palette.mutedStrong} size={18} />
      <Text style={[styles.permissionText, { color: palette.muted }]}>{text}</Text>
    </View>
  );
}

function availabilityLabel(value: string) {
  const labels: Record<string, string> = {
    available: "Available",
    paused: "Paused",
    closed: "Closed",
    unavailable: "Unavailable",
  };
  return labels[value] ?? value.replace(/[_-]/g, " ");
}

const styles = StyleSheet.create({
  hero: { gap: spacing.md, padding: spacing.lg, borderRadius: radii.xl },
  heroTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: spacing.md },
  heroCopy: { flex: 1, gap: 3 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  heroTitle: { color: "#FFFFFF", ...typography.title, fontSize: 27 },
  heroIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: "rgba(255,255,255,.14)", alignItems: "center", justifyContent: "center" },
  heroFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  heroHours: { color: "rgba(255,255,255,.86)", ...typography.caption, fontWeight: "800" },
  card: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  lead: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  iconWrap: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, gap: 3 },
  title: { ...typography.subheading, fontSize: 15 },
  body: { ...typography.caption, lineHeight: 18 },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  divider: { height: StyleSheet.hairlineWidth },
  timeGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  fieldGroup: { flex: 1, minWidth: 130, gap: spacing.sm },
  fieldLabel: { ...typography.caption, fontSize: 13, fontWeight: "900" },
  input: { minHeight: 54, borderWidth: 1, borderRadius: radii.md, paddingHorizontal: spacing.md, fontSize: 16 },
  permission: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md },
  permissionText: { flex: 1, ...typography.caption, lineHeight: 18 },
  notice: { borderRadius: radii.md, padding: spacing.md },
  noticeText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
});
