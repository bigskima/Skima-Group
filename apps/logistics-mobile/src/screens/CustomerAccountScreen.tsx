import { router } from "expo-router";
import { ChevronRight, CircleHelp, LogOut, Moon, ShieldCheck, Sun, UserRound } from "lucide-react-native";
import { Alert, StyleSheet, Text, View } from "react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { BrandMark } from "../ui/BrandMark";
import { Card } from "../ui/Card";
import { Screen } from "../ui/Screen";

export function CustomerAccountScreen() {
  const { palette, scheme, toggle } = useAppTheme();
  const { session, context, signOut } = useSession();
  const name = context?.profile?.display_name ?? (typeof session?.user.user_metadata?.display_name === "string" ? session.user.user_metadata.display_name : "SKIMA customer");
  const email = session?.user.email ?? "Signed-in account";
  return (
    <Screen eyebrow="YOUR ACCOUNT" title="Account & preferences" subtitle="Manage your SKIMA Logistics experience.">
      <View style={styles.brandRow}><BrandMark /></View>
      <Card padding="lg">
        <View style={styles.profileRow}>
          <View style={[styles.avatar, { backgroundColor: palette.brandSoft }]}><UserRound color={palette.brand} size={25} /></View>
          <View style={styles.profileCopy}>
            <Text style={[styles.profileName, { color: palette.ink }]}>{name}</Text>
            <Text style={[styles.profileEmail, { color: palette.muted }]}>{email}</Text>
            <View style={[styles.secure, { backgroundColor: palette.successSoft }]}><ShieldCheck color={palette.success} size={12} /><Text style={[styles.secureText, { color: palette.success }]}>Secure account</Text></View>
          </View>
        </View>
      </Card>

      <View style={styles.section}>
        <Text style={[styles.sectionTitle, { color: palette.ink }]}>Preferences</Text>
        <PressableRow icon={scheme === "dark" ? <Moon color={palette.brand} size={19} /> : <Sun color={palette.brand} size={19} />}
          title="Appearance" subtitle={scheme === "dark" ? "Dark mode" : "Light mode"} action={scheme === "dark" ? "Switch to light" : "Switch to dark"} onPress={() => void toggle()} />
        <PressableRow icon={<CircleHelp color={palette.brand} size={19} />} title="Help & support" subtitle="Get assistance with a request or booking" action="Coming soon" disabled />
      </View>

      <Card variant="subtle" padding="lg">
        <View style={styles.securityRow}><ShieldCheck color={palette.success} size={18} /><Text style={[styles.securityTitle, { color: palette.ink }]}>Your information is protected</Text></View>
        <Text style={[styles.securityCopy, { color: palette.muted }]}>Your account is secured through SKIMA authentication. Job and payment details are shared only with the participants authorised to see them.</Text>
      </Card>

      <AppButton label="Sign out" variant="secondary" fullWidth icon={<LogOut color={palette.ink} size={16} />} onPress={() => Alert.alert("Sign out?", "You can sign back in at any time.", [
        { text: "Cancel", style: "cancel" },
        { text: "Sign out", style: "destructive", onPress: () => { void signOut().then(() => router.replace("/(auth)/sign-in" as never)); } },
      ])} />
      <Text style={[styles.version, { color: palette.muted }]}>SKIMA Logistics · Customer app</Text>
    </Screen>
  );
}

function PressableRow({ icon, title, subtitle, action, disabled, onPress }: {
  icon: React.ReactNode; title: string; subtitle: string; action: string; disabled?: boolean; onPress?: () => void;
}) {
  const { palette } = useAppTheme();
  return (
    <View style={[styles.preferenceRow, { backgroundColor: palette.surface, borderColor: palette.border, opacity: disabled ? 0.55 : 1 }]}>
      <View style={[styles.preferenceIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <View style={styles.preferenceCopy}><Text style={[styles.preferenceTitle, { color: palette.ink }]}>{title}</Text><Text style={[styles.preferenceSubtitle, { color: palette.muted }]}>{subtitle}</Text></View>
      {disabled ? <Text style={[styles.coming, { color: palette.muted }]}>{action}</Text> : <Text style={[styles.action, { color: palette.brand }]}>{action}</Text>}
      {!disabled ? <ChevronRight color={palette.muted} size={16} /> : null}
    </View>
  );
}
const styles = StyleSheet.create({
  brandRow: { marginTop: -7, marginBottom: 0 },
  profileRow: { flexDirection: "row", alignItems: "center", gap: 14 },
  avatar: { width: 58, height: 58, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  profileCopy: { flex: 1, gap: 4 },
  profileName: { ...typography.heading, fontSize: 17 },
  profileEmail: { ...typography.caption, fontSize: 11 },
  secure: { alignSelf: "flex-start", flexDirection: "row", gap: 5, alignItems: "center", paddingVertical: 4, paddingHorizontal: 8, borderRadius: radii.pill, marginTop: 3 },
  secureText: { ...typography.caption, fontSize: 9, fontWeight: "900" },
  section: { gap: 9 },
  sectionTitle: { ...typography.sectionTitle, paddingHorizontal: 2 },
  preferenceRow: { minHeight: 70, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg },
  preferenceIcon: { width: 36, height: 36, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  preferenceCopy: { flex: 1, gap: 2 },
  preferenceTitle: { ...typography.bodyStrong, fontSize: 12 },
  preferenceSubtitle: { ...typography.caption, fontSize: 9 },
  action: { ...typography.caption, fontSize: 9, fontWeight: "900" },
  coming: { ...typography.caption, fontSize: 9 },
  securityRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  securityTitle: { ...typography.bodyStrong, fontSize: 13 },
  securityCopy: { ...typography.caption, lineHeight: 18, fontSize: 10 },
  version: { ...typography.caption, fontSize: 9, textAlign: "center" },
});
