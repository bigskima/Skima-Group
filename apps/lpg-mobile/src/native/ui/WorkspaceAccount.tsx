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
  ShieldCheck,
  Sun,
  Truck,
  UserRound,
  WalletCards,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { ProfilePhotoEditor } from "./ProfilePhotoEditor";
import { Screen } from "./Screen";
import { SectionHeader } from "./SectionHeader";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

const menus = {
  driver: [
    { label: "SKIMA Driver Pass", detail: "Your current public driver identity", href: "/(driver)/id-card", icon: FileCheck2 },
    { label: "Driver profile", detail: "Operational identity and approval", href: "/(driver)/profile", icon: UserRound },
    { label: "Service areas", detail: "Approved dispatch coverage", href: "/(driver)/service-zone", icon: MapPin },
    { label: "Vehicles", detail: "Vehicle approval and capability", href: "/(driver)/vehicles", icon: Truck },
    { label: "Application status", detail: "Review your driver application", href: "/(driver)/application", icon: FileCheck2 },
    { label: "Documents", detail: "Submitted driver evidence", href: "/(driver)/documents", icon: FileCheck2 },
  ],
  station: [
    { label: "Branch profile", detail: "Station identity and current status", href: "/(station)/profile", icon: Building2 },
    { label: "Inventory & capacity", detail: "Refill stock and cylinder queue", href: "/(station)/inventory", icon: Settings2 },
    { label: "Station reports", detail: "Completed operations and activity", href: "/(station)/reports", icon: ReceiptText },
    { label: "Settings & pricing", detail: "Hours, availability and station price", href: "/(station)/settings", icon: Settings2 },
    { label: "Staff & permissions", detail: "Station team access", href: "/(station)/staff", icon: Building2 },
    { label: "Roles", detail: "Configured organisation roles", href: "/(station)/roles", icon: ShieldCheck },
    { label: "Application status", detail: "Review station approval progress", href: "/(station)/application", icon: FileCheck2 },
    { label: "Documents", detail: "Submitted station evidence", href: "/(station)/documents", icon: FileCheck2 },
  ],
  customer: [
    { label: "Delivery locations", detail: "Pickup and return addresses", href: "/(customer)/locations", icon: MapPin },
    { label: "Stations near you", detail: "Verified public station profiles", href: "/(customer)/stations", icon: Building2 },
    { label: "Transactions", detail: "Wallet and payment activity", href: "/(customer)/transactions", icon: WalletCards },
    { label: "Apply to drive", detail: "Become a SKIMA driver partner", href: "/(customer)/driver-application", icon: Truck },
    { label: "Apply as a station", detail: "Register an LPG station partnership", href: "/(customer)/station-application", icon: Building2 },
  ],
} as const;

export function WorkspaceAccount({ workspace }: { workspace: string }) {
  const session = useSession();
  const theme = useAppTheme();
  const { width } = useWindowDimensions();
  const compactProfile = width < 600;
  const group = workspace.toLowerCase() as keyof typeof menus;
  const operational = menus[group] ?? menus.customer;
  const roleNames = session.context?.roles.map((role) => role.displayName ?? role.key).filter(Boolean) ?? [];
  const primaryRole = roleNames[0] ?? workspace;
  const displayName = session.context?.profile?.display_name ?? "SKIMA member";
  const email = session.context?.user.email ?? "";

  return (
    <Screen
      eyebrow={`${workspace} workspace`}
      title="Account"
      subtitle="Manage your SKIMA identity, workspace tools, preferences and support."
    >
      <WorkspaceSwitcher current={group} />

      <View
        style={[
          styles.profileHero,
          compactProfile && styles.profileHeroCompact,
          shadows.raised,
          { backgroundColor: theme.palette.brand },
        ]}
      >
        <View style={[styles.photoShell, compactProfile && styles.photoShellCompact]}>
          <ProfilePhotoEditor variant="onBrand" />
        </View>
        <View style={[styles.identity, compactProfile && styles.identityCompact]}>
          <Text
            numberOfLines={compactProfile ? 2 : 1}
            style={[styles.name, compactProfile && styles.nameCompact]}
          >
            {displayName}
          </Text>
          {email ? (
            <Text
              numberOfLines={compactProfile ? 2 : 1}
              style={[styles.email, compactProfile && styles.emailCompact]}
            >
              {email}
            </Text>
          ) : null}
          <View style={[styles.roleRow, compactProfile && styles.roleRowCompact]}>
            <View style={[styles.roleBadge, compactProfile && styles.roleBadgeCompact]}>
              <ShieldCheck color="#FFFFFF" size={13} />
              <Text numberOfLines={1} style={styles.roleText}>{primaryRole}</Text>
            </View>
            {roleNames.length > 1 ? <Text style={styles.roleMore}>+{roleNames.length - 1} more</Text> : null}
          </View>
        </View>
      </View>

      <View style={[styles.accountNote, { backgroundColor: theme.palette.surfaceSubtle, borderColor: theme.palette.border }]}>
        <ShieldCheck color={theme.palette.mutedStrong} size={18} />
        <Text style={[styles.accountNoteText, { color: theme.palette.muted }]}>
          {group === "customer"
            ? "Your customer account can also start Driver or Station applications without creating a separate login."
            : `This ${group} workspace shows only the tools attached to your current SKIMA access and permissions.`}
        </Text>
      </View>

      <SectionHeader
        title={group === "customer" ? "Your SKIMA services" : `${workspace} workspace tools`}
        description={group === "customer" ? "Service settings, transactions and partner applications." : "Operational identity, records and role-specific controls."}
      />
      <View style={[styles.menu, shadows.soft, { borderColor: theme.palette.border, backgroundColor: theme.palette.surface }]}>
        <Menu
          icon={Bell}
          label="Notifications"
          detail="Orders, approvals, money and account updates"
          onPress={() => router.push(`/${`(${group})`}/notifications` as never)}
        />
        {operational.map((item) => (
          <Menu key={item.label} icon={item.icon} label={item.label} detail={item.detail} onPress={() => router.push(item.href as never)} />
        ))}
        <Menu
          icon={CircleHelp}
          label="Safety & support"
          detail="Report an LPG or fulfilment issue"
          onPress={() => router.push(`/${`(${group})`}/support` as never)}
          last
        />
      </View>

      <SectionHeader title="Appearance" description="Choose how SKIMA looks on this device." />
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
          {theme.scheme === "dark" ? <Sun color={theme.palette.warning} size={21} /> : <Moon color={theme.palette.brand} size={21} />}
        </View>
        <View style={styles.themeCopy}>
          <Text style={[styles.menuText, { color: theme.palette.ink }]}>{theme.scheme === "dark" ? "Use light appearance" : "Use dark appearance"}</Text>
          <Text style={[styles.meta, { color: theme.palette.muted }]}>Current appearance: {theme.scheme === "dark" ? "Dark" : "Light"}</Text>
        </View>
        <ChevronRight color={theme.palette.muted} size={18} />
      </Pressable>

      <View style={[styles.signOutCard, { backgroundColor: theme.palette.surface, borderColor: theme.palette.border }]}>
        <View style={styles.signOutCopy}>
          <Text style={[styles.signOutTitle, { color: theme.palette.ink }]}>Sign out of SKIMA</Text>
          <Text style={[styles.signOutBody, { color: theme.palette.muted }]}>Your saved account data remains protected. Local unfinished drafts stay on this device where supported.</Text>
        </View>
        <AppButton label="Sign out" variant="danger" fullWidth onPress={() => void session.signOut()} />
      </View>
    </Screen>
  );
}

function Menu({
  icon: Icon,
  label,
  detail,
  onPress,
  last = false,
}: {
  icon: typeof Bell;
  label: string;
  detail: string;
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
      <View style={[styles.menuIcon, { backgroundColor: palette.brandSoft }]}><Icon color={palette.brand} size={20} /></View>
      <View style={styles.menuCopy}>
        <Text style={[styles.menuText, { color: palette.ink }]}>{label}</Text>
        <Text numberOfLines={2} style={[styles.menuDetail, { color: palette.muted }]}>{detail}</Text>
      </View>
      <ChevronRight color={palette.muted} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  profileHero: { flexDirection: "row", alignItems: "center", gap: spacing.lg, padding: spacing.lg, borderRadius: radii.xl, overflow: "hidden" },
  profileHeroCompact: { flexDirection: "column", alignItems: "center", gap: spacing.lg, paddingHorizontal: spacing.md, paddingVertical: spacing.lg },
  photoShell: { flexShrink: 0, alignItems: "center", justifyContent: "center" },
  photoShellCompact: { width: "100%" },
  identity: { flex: 1, minWidth: 0, gap: 4 },
  identityCompact: { width: "100%", alignItems: "center" },
  name: { color: "#FFFFFF", ...typography.heading, fontSize: 22 },
  nameCompact: { maxWidth: "100%", textAlign: "center", fontSize: 20, lineHeight: 25 },
  email: { color: "rgba(255,255,255,.82)", ...typography.caption, lineHeight: 18 },
  emailCompact: { maxWidth: "100%", textAlign: "center" },
  roleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: spacing.sm, marginTop: 5 },
  roleRowCompact: { justifyContent: "center" },
  roleBadge: { maxWidth: "82%", flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 5, borderRadius: radii.pill, backgroundColor: "rgba(255,255,255,.14)" },
  roleBadgeCompact: { maxWidth: "100%" },
  roleText: { flexShrink: 1, color: "#FFFFFF", ...typography.caption, fontSize: 10, fontWeight: "900" },
  roleMore: { color: "rgba(255,255,255,.76)", ...typography.caption, fontSize: 10 },
  accountNote: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm + 2, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  accountNoteText: { flex: 1, ...typography.caption, lineHeight: 18 },
  menu: { borderRadius: radii.xl, overflow: "hidden", borderWidth: StyleSheet.hairlineWidth },
  menuRow: { minHeight: 72, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  menuIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  menuCopy: { flex: 1, minWidth: 0, gap: 2 },
  menuText: { ...typography.bodyStrong, fontSize: 14 },
  menuDetail: { ...typography.caption, fontSize: 10, lineHeight: 14 },
  meta: { ...typography.caption },
  theme: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, borderRadius: radii.lg, borderWidth: StyleSheet.hairlineWidth },
  themeIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  themeCopy: { flex: 1, minWidth: 0, gap: 3 },
  signOutCard: { gap: spacing.md, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.xl, padding: spacing.lg },
  signOutCopy: { gap: 3 },
  signOutTitle: { ...typography.subheading, fontSize: 15 },
  signOutBody: { ...typography.caption, lineHeight: 18 },
});
