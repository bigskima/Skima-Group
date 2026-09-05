import { router } from "expo-router";
import {
  ChevronRight,
  FileText,
  LogOut,
  Moon,
  ShieldCheck,
  Sun,
} from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { Screen } from "./Screen";

type Workspace = "customer" | "driver" | "station";

export function WorkspaceAccountSettingsScreen({ workspace }: { workspace: Workspace }) {
  const session = useSession();
  const theme = useAppTheme();
  const policyHref = workspace === "customer"
    ? "/policies/customer-terms"
    : "/policies/partner-participation";

  return (
    <Screen
      eyebrow="Account"
      title="Settings"
      subtitle="Appearance, privacy and account access."
      action={<AppButton label="Back" size="sm" variant="ghost" onPress={() => router.back()} />}
    >
      <View style={styles.group}>
        <Text style={[styles.groupTitle, { color: theme.palette.ink }]}>Preferences</Text>
        <View style={[styles.list, shadows.soft, { backgroundColor: theme.palette.surface, borderColor: theme.palette.border }]}>
          <SettingsRow
            icon={theme.scheme === "dark" ? Sun : Moon}
            label="Appearance"
            detail={theme.scheme === "dark" ? "Dark mode is on" : "Light mode is on"}
            value={theme.scheme === "dark" ? "Switch to light" : "Switch to dark"}
            onPress={() => void theme.toggle()}
          />
        </View>
      </View>

      <View style={styles.group}>
        <Text style={[styles.groupTitle, { color: theme.palette.ink }]}>Privacy & terms</Text>
        <View style={[styles.list, shadows.soft, { backgroundColor: theme.palette.surface, borderColor: theme.palette.border }]}>
          <SettingsRow
            icon={FileText}
            label={workspace === "customer" ? "Customer terms" : "Partner terms"}
            detail="Service rules, privacy and your rights"
            onPress={() => router.push(policyHref as never)}
          />
          <SettingsRow
            icon={ShieldCheck}
            label="Account protection"
            detail="Your account and role access are protected by SKIMA permissions"
            last
          />
        </View>
      </View>

      <View style={[styles.signOutCard, { backgroundColor: theme.palette.surface, borderColor: theme.palette.border }]}>
        <View style={[styles.dangerIcon, { backgroundColor: theme.palette.dangerSoft }]}>
          <LogOut color={theme.palette.danger} size={21} />
        </View>
        <View style={styles.signOutCopy}>
          <Text style={[styles.signOutTitle, { color: theme.palette.ink }]}>Sign out</Text>
          <Text style={[styles.signOutBody, { color: theme.palette.muted }]}>
            Sign out of this device. Your SKIMA account and saved server data remain protected.
          </Text>
        </View>
        <AppButton
          label="Sign out"
          variant="danger"
          fullWidth
          onPress={() => void session.signOut()}
        />
      </View>
    </Screen>
  );
}

function SettingsRow({
  icon: Icon,
  label,
  detail,
  value,
  onPress,
  last = false,
}: {
  icon: typeof Moon;
  label: string;
  detail: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
}) {
  const { palette } = useAppTheme();

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth },
        { opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: palette.brandSoft }]}>
        <Icon color={palette.brand} size={20} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.label, { color: palette.ink }]}>{label}</Text>
        <Text numberOfLines={2} style={[styles.detail, { color: palette.muted }]}>{detail}</Text>
        {value ? <Text style={[styles.value, { color: palette.brand }]}>{value}</Text> : null}
      </View>
      {onPress ? <ChevronRight color={palette.muted} size={18} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  groupTitle: { ...typography.sectionTitle, fontSize: 15, paddingHorizontal: 2 },
  list: { borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  iconWrap: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  label: { ...typography.bodyStrong, fontSize: 14 },
  detail: { ...typography.caption, fontSize: 10, lineHeight: 14 },
  value: { ...typography.caption, fontSize: 10, fontWeight: "900", marginTop: 2 },
  signOutCard: { gap: spacing.md, borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  dangerIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  signOutCopy: { gap: 3 },
  signOutTitle: { ...typography.subheading, fontSize: 15 },
  signOutBody: { ...typography.caption, lineHeight: 18 },
});
