import { useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { LockKeyhole, Mail, ShieldCheck, Truck } from "lucide-react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { AppField } from "../ui/AppField";
import { BrandMark } from "../ui/BrandMark";

export function SignInScreen() {
  const { palette } = useAppTheme();
  const { signIn } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    if (!email.trim() || !password) { setError("Enter your email and password to continue."); return; }
    setBusy(true); setError(null);
    try {
      const ok = await signIn(email, password);
      if (!ok) setError("We couldn't sign you in. Check your details and try again.");
    } finally { setBusy(false); }
  };
  return (
    <KeyboardAvoidingView style={[styles.page, { backgroundColor: palette.canvas }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.outer}>
        <View pointerEvents="none" style={styles.ambient}>
          <View style={[styles.orb, styles.orbTop, { backgroundColor: palette.brandSoft }]} />
          <View style={[styles.orb, styles.orbBottom, { backgroundColor: palette.soft }]} />
        </View>
        <View style={styles.content}>
          <BrandMark />
          <View style={styles.hero}>
            <View style={[styles.heroIcon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={26} /></View>
            <Text style={[styles.eyebrow, { color: palette.brand }]}>MOVE WITH CONFIDENCE</Text>
            <Text style={[styles.title, { color: palette.ink }]}>Your city.{"\n"}Connected.</Text>
            <Text style={[styles.subtitle, { color: palette.muted }]}>Find trusted logistics companies for deliveries, moving, freight and more.</Text>
          </View>
          <View style={[styles.form, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.formHeading}>
              <Text style={[styles.formTitle, { color: palette.ink }]}>Welcome back</Text>
              <Text style={[styles.formSub, { color: palette.muted }]}>Sign in to manage your logistics requests.</Text>
            </View>
            <AppField label="Email address" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" leading={<Mail color={palette.muted} size={17} />} />
            <AppField label="Password" value={password} onChangeText={setPassword} placeholder="Enter your password" secureTextEntry autoCapitalize="none" leading={<LockKeyhole color={palette.muted} size={17} />} />
            {error ? <View style={[styles.error, { backgroundColor: palette.dangerSoft }]}><Text style={[styles.errorText, { color: palette.danger }]}>{error}</Text></View> : null}
            <AppButton label="Sign in securely" fullWidth loading={busy} onPress={() => void submit()} trailingIcon={<ShieldCheck color="#FFFFFF" size={17} />} />
            <Text style={[styles.footnote, { color: palette.muted }]}>Your account is protected by SKIMA’s secure sign-in.</Text>
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
const styles = StyleSheet.create({
  page: { flex: 1 },
  outer: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingVertical: 36, paddingHorizontal: 20 },
  ambient: { ...StyleSheet.absoluteFillObject, overflow: "hidden" },
  orb: { position: "absolute", borderRadius: 200, opacity: 0.7 },
  orbTop: { width: 310, height: 310, top: -170, right: -120 },
  orbBottom: { width: 220, height: 220, bottom: 70, left: -160 },
  content: { width: "100%", maxWidth: 480, gap: 28 },
  hero: { gap: 10, paddingTop: 12 },
  heroIcon: { width: 54, height: 54, borderRadius: 19, alignItems: "center", justifyContent: "center", marginBottom: 5 },
  eyebrow: { ...typography.eyebrow, fontSize: 9 },
  title: { ...typography.display, fontSize: 38, lineHeight: 43, letterSpacing: -1.2 },
  subtitle: { ...typography.body, fontSize: 14, lineHeight: 21, maxWidth: 380 },
  form: { gap: 17, padding: spacing.lg, borderWidth: 1, borderRadius: 28 },
  formHeading: { gap: 4, marginBottom: 2 },
  formTitle: { ...typography.heading, fontSize: 21 },
  formSub: { ...typography.caption, fontSize: 12, lineHeight: 18 },
  error: { padding: spacing.md, borderRadius: radii.md },
  errorText: { ...typography.caption, lineHeight: 18 },
  footnote: { ...typography.caption, textAlign: "center", fontSize: 10 },
});
