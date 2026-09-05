import { router } from "expo-router";
import {
  Bell,
  ChevronRight,
  CircleHelp,
  LayoutGrid,
  Settings2,
  ShieldCheck,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { ProfilePhotoEditor } from "./ProfilePhotoEditor";
import { Screen } from "./Screen";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

type Workspace = "customer" | "driver" | "station";

export function WorkspaceAccount({ workspace }: { workspace: string }) {
  const session = useSession();
  const theme = useAppTheme();
  const group = workspace.toLowerCase() as Workspace;
  const roleNames = session.context?.roles.map((role) => role.displayName ?? role.key).filter(Boolean) ?? [];
  const primaryRole = roleNames[0] ?? workspace;
  const displayName = session.context?.profile?.display_name ?? "SKIMA member";
  const email = session.context?.user.email ?? "";

  return (
    <Screen
      eyebrow={workspace}
      title="Account"
      subtitle="Your profile and the places you use most."
    >
      <WorkspaceSwitcher current={group} />

      <View style={[styles.profileHero, shadows.raised, { backgroundColor: theme.palette.brand }]}>
        <View style={styles.heroGlowOne} />
        <View style={styles.heroGlowTwo} />
        <ProfilePhotoEditor variant="onBrand" />
        <View style={styles.identity}>
          <Text numberOfLines={1} style={styles.name}>{displayName}</Text>
          {email ? <Text numberOfLines={1} style={styles.email}>{email}</Text> : null}
          <View style={styles.roleRow}>
            <View style={styles.roleBadge}>
              <ShieldCheck color="#FFFFFF" size={13} />
              <Text numberOfLines={1} style={styles.roleText}>{primaryRole}</Text>
            </View>
            {roleNames.length > 1 ? <Text style={styles.roleMore}>+{roleNames.length - 1} more roles</Text> : null}
          </View>
        </View>
      </View>

      <View style={styles.sectionHeading}>
        <Text style={[styles.sectionTitle, { color: theme.palette.ink }]}>Manage</Text>
        <Text style={[styles.sectionDescription, { color: theme.palette.muted }]}>
          Choose what you want to manage.
        </Text>
      </View>

      <View style={styles.quickGrid}>
        <QuickTile
          icon={Bell}
          label="Notifications"
          detail="Orders, approvals and money"
          onPress={() => router.push(`/(${group})/notifications` as never)}
        />
        <QuickTile
          icon={LayoutGrid}
          label={group === "customer" ? "SKIMA services" : `${workspace} tools`}
          detail={group === "customer" ? "Locations, stations and partner options" : "Profile, operations and approvals"}
          onPress={() => router.push(`/(${group})/account-tools` as never)}
        />
        <QuickTile
          icon={Settings2}
          label="Account settings"
          detail="Appearance, terms and sign out"
          onPress={() => router.push(`/(${group})/account-settings` as never)}
        />
        <QuickTile
          icon={CircleHelp}
          label="Safety & support"
          detail="Get help or report an issue"
          onPress={() => router.push(`/(${group})/support` as never)}
        />
      </View>
    </Screen>
  );
}

function QuickTile({
  icon: Icon,
  label,
  detail,
  onPress,
}: {
  icon: typeof Bell;
  label: string;
  detail: string;
  onPress: () => void;
}) {
  const { palette } = useAppTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.quickTile,
        shadows.soft,
        {
          backgroundColor: palette.surface,
          borderColor: palette.border,
          opacity: pressed ? 0.72 : 1,
          transform: [{ scale: pressed ? 0.985 : 1 }],
        },
      ]}
    >
      <View style={[styles.quickIcon, { backgroundColor: palette.brandSoft }]}>
        <Icon color={palette.brand} size={21} />
      </View>
      <View style={styles.quickCopy}>
        <Text numberOfLines={1} style={[styles.quickLabel, { color: palette.ink }]}>{label}</Text>
        <Text numberOfLines={2} style={[styles.quickDetail, { color: palette.muted }]}>{detail}</Text>
      </View>
      <ChevronRight color={palette.muted} size={17} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  profileHero: {
    position: "relative",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
    borderRadius: radii.xl,
    overflow: "hidden",
  },
  heroGlowOne: {
    position: "absolute",
    width: 160,
    height: 160,
    borderRadius: 80,
    right: -58,
    top: -72,
    backgroundColor: "rgba(255,255,255,.11)",
  },
  heroGlowTwo: {
    position: "absolute",
    width: 110,
    height: 110,
    borderRadius: 55,
    left: -44,
    bottom: -54,
    backgroundColor: "rgba(255,255,255,.08)",
  },
  identity: { width: "100%", minWidth: 0, alignItems: "center", gap: 4 },
  name: { maxWidth: "100%", color: "#FFFFFF", ...typography.heading, fontSize: 20, lineHeight: 25, textAlign: "center" },
  email: { maxWidth: "100%", color: "rgba(255,255,255,.82)", ...typography.caption, lineHeight: 18, textAlign: "center" },
  roleRow: { width: "100%", flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: spacing.sm, marginTop: 5 },
  roleBadge: { maxWidth: "100%", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.pill, backgroundColor: "rgba(255,255,255,.15)" },
  roleText: { flexShrink: 1, color: "#FFFFFF", ...typography.caption, fontSize: 10, fontWeight: "900" },
  roleMore: { color: "rgba(255,255,255,.78)", ...typography.caption, fontSize: 10 },
  sectionHeading: { gap: 3, marginTop: spacing.xs },
  sectionTitle: { ...typography.heading, fontSize: 18 },
  sectionDescription: { ...typography.caption, maxWidth: 540 },
  quickGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  quickTile: {
    minWidth: 142,
    flexGrow: 1,
    flexBasis: "47%",
    minHeight: 112,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.md,
    gap: spacing.sm,
  },
  quickIcon: { width: 40, height: 40, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  quickCopy: { flex: 1, minWidth: 0, gap: 2 },
  quickLabel: { ...typography.bodyStrong, fontSize: 14 },
  quickDetail: { ...typography.caption, fontSize: 10, lineHeight: 14 },
});
