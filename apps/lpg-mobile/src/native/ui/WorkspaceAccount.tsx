import { router } from "expo-router";
import {
  Bell,
  Building2,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  MapPin,
  Moon,
  ReceiptText,
  Settings2,
  Sun,
  Truck,
  WalletCards,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { Card } from "./Card";
import { ProfilePhotoEditor } from "./ProfilePhotoEditor";
import { Screen } from "./Screen";
import { SectionHeader } from "./SectionHeader";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

const menus = {
  driver: [
    { label: "SKIMA Driver Pass", href: "/(driver)/id-card", icon: FileCheck2 },
    { label: "Driver profile", href: "/(driver)/profile", icon: Truck },
    { label: "Service zones", href: "/(driver)/service-zone", icon: MapPin },
    { label: "Application & approval", href: "/(driver)/application", icon: FileCheck2 },
    { label: "Vehicles", href: "/(driver)/vehicles", icon: Truck },
    { label: "Documents", href: "/(driver)/documents", icon: FileCheck2 },
  ],
  station: [
    { label: "Branch profile", href: "/(station)/profile", icon: Building2 },
    { label: "Inventory & capacity", href: "/(station)/inventory", icon: Settings2 },
    { label: "Station reports", href: "/(station)/reports", icon: ReceiptText },
    { label: "Station settings & pricing", href: "/(station)/settings", icon: Settings2 },
    { label: "Staff & permissions", href: "/(station)/staff", icon: Building2 },
    { label: "Roles & permission keys", href: "/(station)/roles", icon: Settings2 },
    { label: "Application & approval", href: "/(station)/application", icon: FileCheck2 },
    { label: "Documents", href: "/(station)/documents", icon: FileCheck2 },
  ],
  customer: [
    { label: "Apply to drive", href: "/(customer)/driver-application", icon: Truck },
    { label: "Apply as a station", href: "/(customer)/station-application", icon: Building2 },
    { label: "Delivery addresses", href: "/(customer)/locations", icon: MapPin },
    { label: "Stations near you", href: "/(customer)/stations", icon: Building2 },
    { label: "Transactions", href: "/(customer)/transactions", icon: WalletCards },
  ],
} as const;

export function WorkspaceAccount({ workspace }: { workspace: string }) {
  const session = useSession();
  const theme = useAppTheme();
  const group = workspace.toLowerCase() as keyof typeof menus;
  const operational = menus[group] ?? menus.customer;
  const roles = session.context?.roles
    .map((role) => role.displayName ?? role.key)
    .filter(Boolean)
    .join(" · ");

  return (
    <Screen
      eyebrow={workspace}
      title="Account"
      subtitle="Profile, workspace access, preferences, and support."
    >
      <WorkspaceSwitcher current={group} />

      <Card padding="lg">
        <View style={styles.profileCard}>
          <ProfilePhotoEditor />
          <View style={styles.identity}>
            <Text style={[styles.name, { color: theme.palette.ink }]}>
              {session.context?.profile?.display_name ?? "SKIMA member"}
            </Text>
            <Text style={[styles.email, { color: theme.palette.muted }]}>
              {session.context?.user.email ?? ""}
            </Text>
            <View style={[styles.roleBadge, { backgroundColor: theme.palette.brandSoft }]}>
              <Text style={[styles.roleText, { color: theme.palette.brand }]}>{roles || workspace}</Text>
            </View>
          </View>
        </View>
      </Card>

      <SectionHeader title="Preferences" description="Personal settings for this device." />
      <Pressable
        accessibilityRole="button"
        onPress={() => void theme.toggle()}
        style={({ pressed }) => [
          styles.theme,
          shadows.soft,
          {
            backgroundColor: theme.palette.surface,
            borderColor: theme.palette.border,
            opacity: pressed ? 0.74 : 1,
          },
        ]}
      >
        <View style={[styles.themeIcon, { backgroundColor: theme.palette.brandSoft }]}>
          {theme.scheme === "dark" ? (
            <Sun color={theme.palette.warning} size={20} />
          ) : (
            <Moon color={theme.palette.brand} size={20} />
          )}
        </View>
        <View style={styles.themeCopy}>
          <Text style={[styles.menuText, { color: theme.palette.ink }]}>
            {theme.scheme === "dark" ? "Use light appearance" : "Use dark appearance"}
          </Text>
          <Text style={[styles.meta, { color: theme.palette.muted }]}>Saved on this device.</Text>
        </View>
        <ChevronRight color={theme.palette.muted} size={18} />
      </Pressable>

      <SectionHeader
        title={group === "customer" ? "Your SKIMA account" : `${workspace} tools`}
        description={group === "customer" ? "Manage service details and partner applications." : "Manage operational access and records."}
      />
      <View style={[styles.menu, shadows.soft, { borderColor: theme.palette.border, backgroundColor: theme.palette.surface }]}>
        <Menu icon={Bell} label="Notifications" onPress={() => router.push(`/${`(${group})`}/notifications` as never)} />
        {operational.map((item) => (
          <Menu key={item.label} icon={item.icon} label={item.label} onPress={() => router.push(item.href as never)} />
        ))}
        <Menu icon={CircleHelp} label="Support & safety" onPress={() => router.push(`/${`(${group})`}/support` as never)} last />
      </View>

      <View style={styles.signOutWrap}>
        <AppButton label="Sign out" variant="danger" fullWidth onPress={() => void session.signOut()} />
      </View>
    </Screen>
  );
}

function Menu({
  icon: Icon,
  label,
  onPress,
  last = false,
}: {
  icon: typeof Bell;
  label: string;
  onPress?: () => void;
  last?: boolean;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [
        styles.menuRow,
        !last && { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth },
        { opacity: pressed ? 0.7 : 1 },
      ]}
    >
      <View style={[styles.menuIcon, { backgroundColor: palette.brandSoft }]}>
        <Icon color={palette.brand} size={19} />
      </View>
      <Text style={[styles.menuText, { color: palette.ink }]}>{label}</Text>
      <ChevronRight color={palette.muted} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  profileCard: { alignItems: "center", gap: spacing.md },
  identity: { alignItems: "center", gap: spacing.xs },
  name: { ...typography.heading, textAlign: "center" },
  email: { ...typography.caption, textAlign: "center" },
  meta: { ...typography.caption },
  roleBadge: { marginTop: 3, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radii.pill },
  roleText: { ...typography.caption, fontSize: 11, fontWeight: "900", textAlign: "center" },
  theme: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  themeIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  themeCopy: { flex: 1, gap: 3 },
  menu: { borderRadius: radii.lg, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  menuRow: { minHeight: 64, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md },
  menuIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  menuText: { ...typography.bodyStrong, flex: 1, fontSize: 14 },
  signOutWrap: { marginTop: spacing.sm },
});
