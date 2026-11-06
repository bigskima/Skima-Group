import { useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { LockKeyhole, Mail, ShieldCheck, Truck, UserRound, Gift, ArrowLeft } from "lucide-react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "../ui/AppButton";
import { AppField } from "../ui/AppField";
import { BrandMark } from "../ui/BrandMark";

type AuthMode = "login" | "register" | "forgot" | "reset";

export function SignInScreen({ initialMode = "login" }: { initialMode?: AuthMode }) {
  const { palette } = useAppTheme();
  const { signIn, signUp, supabase } = useSession();
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [referralCode, setReferralCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    setSuccess(false);
    try {
      if (mode === "login") {
        const ok = await signIn(email, password);
        if (!ok) throw new Error("Check your email and password, then try again.");
      } else if (mode === "register") {
        if (!name.trim()) throw new Error("Enter your name.");
        if (password.length < 8) throw new Error("Use at least 8 characters for your password.");
        const ok = await signUp(name, email, password, referralCode);
        if (!ok) throw new Error("Your account could not be created. Check the details and try again.");
        setSuccess(true);
        setNotice("Your SKIMA account is ready. You can now continue.");
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
          redirectTo: "skima-logistics://reset-password",
        });
        if (error) throw error;
        setSuccess(true);
        setNotice("If this email belongs to a SKIMA account, a secure reset link has been sent.");
      } else {
        if (password.length < 8) throw new Error("Use at least 8 characters for your new password.");
        if (password !== confirm) throw new Error("The passwords do not match.");
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setSuccess(true);
        setNotice("Password updated. Sign in with your new password.");
      }
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "We could not complete that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const title = mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "forgot" ? "Reset password" : "Choose a new password";
  const subtitle = mode === "login" ? "Manage your deliveries." : mode === "register" ? "Book trusted logistics services." : mode === "forgot" ? "We’ll email you a secure link." : "Use at least 8 characters.";
  const canSubmit = mode === "login" ? Boolean(email.trim() && password)
    : mode === "register" ? Boolean(name.trim() && email.trim() && password.length >= 8)
      : mode === "forgot" ? Boolean(email.trim())
        : Boolean(password.length >= 8 && confirm);

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setNotice(null);
    setSuccess(false);
  };

  return (
    <KeyboardAvoidingView style={[styles.page, { backgroundColor: palette.canvas }]} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.outer}>
        <View pointerEvents="none" style={styles.ambient}>
          <View style={[styles.orb, styles.orbTop, { backgroundColor: palette.brandSoft }]} />
          <View style={[styles.orb, styles.orbBottom, { backgroundColor: palette.soft }]} />
        </View>
        <View style={styles.content}>
          <View style={styles.brandRow}>
            <BrandMark />
            <Text style={[styles.product, { color: palette.muted }]}>LOGISTICS</Text>
          </View>
          <View style={styles.hero}>
            <View style={[styles.heroIcon, { backgroundColor: palette.brandSoft }]}><Truck color={palette.brand} size={23} /></View>
            <Text style={[styles.eyebrow, { color: palette.brand }]}>SKIMA LOGISTICS</Text>
            <Text style={[styles.heroTitle, { color: palette.ink }]}>Move what matters.</Text>
            <Text style={[styles.subtitle, { color: palette.muted }]}>{subtitle}</Text>
          </View>
          <View style={[styles.form, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            {mode !== "login" && mode !== "register" ? (
              <Pressable onPress={() => switchMode("login")} style={styles.back}>
                <ArrowLeft color={palette.brand} size={16} />
                <Text style={[styles.backText, { color: palette.brand }]}>Back to sign in</Text>
              </Pressable>
            ) : null}
            <View style={styles.formHeading}>
              <Text style={[styles.formTitle, { color: palette.ink }]}>{title}</Text>
              <Text style={[styles.formSub, { color: palette.muted }]}>{mode === "login" ? "Welcome back." : mode === "register" ? "It takes less than a minute." : subtitle}</Text>
            </View>
            {mode === "register" ? (
              <AppField label="Your name" value={name} onChangeText={setName} placeholder="Full name" leading={<UserRound color={palette.muted} size={16} />} />
            ) : null}
            {mode !== "reset" ? (
              <AppField label="Email" value={email} onChangeText={setEmail} placeholder="you@example.com" autoCapitalize="none" keyboardType="email-address" leading={<Mail color={palette.muted} size={16} />} />
            ) : null}
            {mode !== "forgot" ? (
              <AppField label={mode === "reset" ? "New password" : "Password"} value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry autoCapitalize="none" leading={<LockKeyhole color={palette.muted} size={16} />} />
            ) : null}
            {mode === "reset" ? (
              <AppField label="Confirm password" value={confirm} onChangeText={setConfirm} placeholder="Enter it again" secureTextEntry autoCapitalize="none" leading={<LockKeyhole color={palette.muted} size={16} />} />
            ) : null}
            {mode === "register" ? (
              <AppField label="Referral code (optional)" value={referralCode} onChangeText={setReferralCode} placeholder="Enter a code, if you have one" autoCapitalize="characters" leading={<Gift color={palette.muted} size={16} />} optional />
            ) : null}
            {mode === "login" ? (
              <Pressable onPress={() => switchMode("forgot")} style={styles.forgot}>
                <Text style={[styles.forgotText, { color: palette.brand }]}>Forgot password?</Text>
              </Pressable>
            ) : null}
            {notice ? (
              <View style={[styles.notice, { backgroundColor: success ? palette.successSoft : palette.dangerSoft }]}>
                <Text style={[styles.noticeText, { color: success ? palette.success : palette.danger }]}>{notice}</Text>
              </View>
            ) : null}
            <AppButton label={busy ? "Please wait…" : mode === "login" ? "Sign in" : mode === "register" ? "Create account" : mode === "forgot" ? "Send reset link" : "Update password"} fullWidth loading={busy} disabled={!canSubmit} onPress={() => void submit()} trailingIcon={<ShieldCheck color="#FFFFFF" size={16} />} />
            {mode === "login" ? (
              <Text style={[styles.footer, { color: palette.muted }]}>New to SKIMA? <Text onPress={() => switchMode("register")} style={{ color: palette.brand, fontWeight: "900" }}>Create account</Text></Text>
            ) : mode === "register" ? (
              <Text style={[styles.footer, { color: palette.muted }]}>Already a member? <Text onPress={() => switchMode("login")} style={{ color: palette.brand, fontWeight: "900" }}>Sign in</Text></Text>
            ) : null}
          </View>
        </View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  outer: { flexGrow: 1, alignItems: "center", justifyContent: "center", paddingVertical: 26, paddingHorizontal: 18 },
  ambient: { ...StyleSheet.absoluteFill, overflow: "hidden" },
  orb: { position: "absolute", borderRadius: 200, opacity: 0.58 },
  orbTop: { width: 290, height: 290, top: -175, right: -125 },
  orbBottom: { width: 210, height: 210, bottom: 55, left: -150 },
  content: { width: "100%", maxWidth: 460, gap: 21 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  product: { ...typography.eyebrow, fontSize: 9, letterSpacing: 1.3 },
  hero: { gap: 7, paddingTop: 2 },
  heroIcon: { width: 46, height: 46, borderRadius: 15, alignItems: "center", justifyContent: "center", marginBottom: 2 },
  eyebrow: { ...typography.eyebrow, fontSize: 8 },
  heroTitle: { ...typography.display, fontSize: 31, lineHeight: 36, letterSpacing: -0.9 },
  subtitle: { ...typography.body, fontSize: 12, lineHeight: 18, maxWidth: 340 },
  form: { gap: 13, padding: 18, borderWidth: 1, borderRadius: 23 },
  back: { flexDirection: "row", alignItems: "center", gap: 6 },
  backText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  formHeading: { gap: 3 },
  formTitle: { ...typography.heading, fontSize: 19 },
  formSub: { ...typography.caption, fontSize: 10, lineHeight: 15 },
  forgot: { alignSelf: "flex-end", paddingVertical: 1 },
  forgotText: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  notice: { padding: 10, borderRadius: radii.md },
  noticeText: { ...typography.caption, fontSize: 10, lineHeight: 15 },
  footer: { ...typography.caption, fontSize: 10, textAlign: "center" },
});
