import { router } from "expo-router";
import {
  Bell,
  ChevronRight,
  CircleHelp,
  FileCheck2,
  Moon,
  Sun,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { Card } from "./Card";
import { ProfilePhotoEditor } from "./ProfilePhotoEditor";
import { Screen } from "./Screen";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

const menus = {
  driver: [
    { label: "View SKIMA Driver ID", href: "/(driver)/id-card" },
    { label: "Driver profile", href: "/(driver)/profile" },
    { label: "Service zones", href: "/(driver)/service-zone" },
    { label: "Application and approval", href: "/(driver)/application" },
    { label: "Vehicles", href: "/(driver)/vehicles" },
    { label: "Documents", href: "/(driver)/documents" },
  ],
  station: [
    { label: "Branch profile", href: "/(station)/profile" },
    { label: "Inventory and capacity", href: "/(station)/inventory" },
    { label: "Station reports", href: "/(station)/reports" },
    { label: "Station settings and pricing", href: "/(station)/settings" },
    { label: "Staff and permissions", href: "/(station)/staff" },
    { label: "Roles and permission keys", href: "/(station)/roles" },
    { label: "Application and approval", href: "/(station)/application" },
    { label: "Documents", href: "/(station)/documents" },
  ],
  customer: [
    { label: "Apply to drive", href: "/(customer)/driver-application" },
    { label: "Apply as a station", href: "/(customer)/station-application" },
    { label: "Delivery addresses", href: "/(customer)/locations" },
    { label: "Stations near you", href: "/(customer)/stations" },
    { label: "Transactions", href: "/(customer)/transactions" },
  ],
} as const;

export function WorkspaceAccount({ workspace }: { workspace: string }) {
  const session = useSession();
  const theme = useAppTheme();
  const group = workspace.toLowerCase() as keyof typeof menus;
  const operational = menus[group] ?? menus.customer;
  return (
    <Screen eyebrow={workspace} title="Account">
      <WorkspaceSwitcher current={group} />
      <Card>
        <ProfilePhotoEditor />
        <View style={styles.identity}>
          <Text style={[styles.name, { color: theme.palette.ink }]}>
            {session.context?.profile?.display_name ?? "SKIMA member"}
          </Text>
          <Text style={[styles.meta, { color: theme.palette.muted }]}>
            {session.context?.user.email ?? ""}
          </Text>
          <Text style={[styles.meta, { color: theme.palette.muted }]}>
            {session.context?.roles
              .map((role) => role.displayName ?? role.key)
              .filter(Boolean)
              .join(" · ") || "Customer"}
          </Text>
        </View>
      </Card>

      <Pressable
        onPress={() => void theme.toggle()}
        style={[
          styles.theme,
          {
            backgroundColor: theme.palette.surface,
            borderColor: theme.palette.border,
          },
        ]}
      >
        <View
          style={[styles.themeIcon, { backgroundColor: theme.palette.soft }]}
        >
          {theme.scheme === "dark" ? (
            <Sun color={colors.accent} size={20} />
          ) : (
            <Moon color={colors.brand} size={20} />
          )}
        </View>
        <View style={styles.themeCopy}>
          <Text style={[styles.menuText, { color: theme.palette.ink }]}>
            {theme.scheme === "dark"
              ? "Use light appearance"
              : "Use dark appearance"}
          </Text>
          <Text style={[styles.meta, { color: theme.palette.muted }]}>
            Changes immediately and stays selected on this device.
          </Text>
        </View>
      </Pressable>

      <View
        style={[
          styles.menu,
          {
            borderColor: theme.palette.border,
            backgroundColor: theme.palette.surface,
          },
        ]}
      >
        <Menu
          icon={Bell}
          label="Notifications"
          onPress={() => router.push(`/${`(${group})`}/notifications` as never)}
        />
        {operational.map((item) => (
          <Menu
            key={item.label}
            icon={FileCheck2}
            label={item.label}
            onPress={() => router.push(item.href as never)}
          />
        ))}
        <Menu
          icon={CircleHelp}
          label="Support and safety"
          onPress={() => router.push(`/${`(${group})`}/support` as never)}
        />
      </View>
      <Pressable onPress={() => void session.signOut()} style={styles.signOut}>
        <Text style={styles.out}>Sign out</Text>
      </Pressable>
    </Screen>
  );
}

function Menu({
  icon: Icon,
  label,
  onPress,
}: {
  icon: typeof Bell;
  label: string;
  onPress?: () => void;
}) {
  const { palette } = useAppTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.menuRow, { borderBottomColor: palette.border }]}
    >
      <View style={[styles.menuIcon, { backgroundColor: palette.brandSoft }]}>
        <Icon color={colors.brand} size={20} />
      </View>
      <Text style={[styles.menuText, { color: palette.ink }]}>{label}</Text>
      <ChevronRight color={palette.muted} size={18} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: "center", gap: spacing.xs },
  name: { fontSize: 22, fontWeight: "900", textAlign: "center" },
  meta: { lineHeight: 20, textAlign: "center" },
  theme: {
    minHeight: 78,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    borderWidth: 1,
  },
  themeIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  themeCopy: { flex: 1, gap: 3 },
  menu: { borderRadius: radii.lg, overflow: "hidden", borderWidth: 1 },
  menuRow: {
    minHeight: 66,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  menuIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  menuText: { flex: 1, fontWeight: "800" },
  signOut: { alignSelf: "flex-start", paddingVertical: spacing.md },
  out: { color: colors.danger, fontWeight: "900" },
});
