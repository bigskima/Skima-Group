import { LinearGradient } from "expo-linear-gradient";
import { Redirect, router } from "expo-router";
import { LockKeyhole, Mail, ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSession } from "../../src/native/session/SessionProvider";
import { useAppTheme } from "../../src/native/theme/ThemeProvider";
import { colors, radii, spacing } from "../../src/native/theme/tokens";
import { AuthShell } from "../../src/native/ui/AuthShell";
import { friendlyError } from "../../src/native/utilities/friendlyError";

export default function Login() {
  const session = useSession();
  const { palette } = useAppTheme();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    if (!email.trim() || !password || pending) return;
    setPending(true);
    setMessage(null);
    try {
      const signedIn = await session.signIn(email.trim().toLowerCase(), password);
      if (signedIn) router.replace("/(customer)");
      else setMessage("We couldn't sign you in. Check your details and try again.");
    } catch (cause) {
      setMessage(friendlyError(cause, "We couldn't sign you in. Check your details and try again."));
    } finally {
      setPending(false);
    }
  };

  if (session.status === "authenticated") return <Redirect href="/(customer)" />;

  return (
    <AuthShell
      eyebrow="Welcome back"
      title="Sign in to SKIMA"
      body="Continue your refill, delivery, driver or station work from one secure account."
      footer={
        <View style={styles.footerArea}>
          <View style={styles.footerLinks}>
            <Pressable onPress={() => router.push("/(auth)/register")}>
              <Text style={styles.linkStrong}>Create account</Text>
            </Pressable>
            <Pressable onPress={() => router.push("/(auth)/forgot-password")}>
              <Text style={[styles.linkMuted, { color: palette.muted }]}>Forgot password?</Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push("../verify-driver")}
            style={({ pressed }) => [
              styles.publicVerify,
              { backgroundColor: palette.surfaceSubtle, borderColor: palette.border, opacity: pressed ? 0.74 : 1 },
            ]}
          >
            <View style={[styles.publicVerifyIcon, { backgroundColor: palette.brandSoft }]}>
              <ShieldCheck color={palette.brand} size={18} />
            </View>
            <View style={styles.publicVerifyCopy}>
              <Text style={[styles.publicVerifyTitle, { color: palette.ink }]}>Verify a SKIMA driver</Text>
              <Text style={[styles.publicVerifyBody, { color: palette.muted }]}>Public lookup · no sign-in required</Text>
            </View>
          </Pressable>
        </View>
      }
    >
      <View style={[styles.field, { backgroundColor: palette.input, borderColor: palette.border }]}>
        <Mail color={palette.muted} size={18} />
        <TextInput
          accessibilityLabel="Email address"
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="Email address"
          placeholderTextColor={palette.muted}
          returnKeyType="next"
          style={[styles.input, { color: palette.ink }]}
          value={email}
        />
      </View>

      <View style={[styles.field, { backgroundColor: palette.input, borderColor: palette.border }]}>
        <LockKeyhole color={palette.muted} size={18} />
        <TextInput
          accessibilityLabel="Password"
          autoComplete="current-password"
          onChangeText={setPassword}
          onSubmitEditing={() => void submit()}
          placeholder="Password"
          placeholderTextColor={palette.muted}
          secureTextEntry
          style={[styles.input, { color: palette.ink }]}
          value={password}
        />
      </View>

      {session.error || message ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {session.error ? friendlyError(new Error(session.error), "We couldn't sign you in. Check your details and try again.") : message}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={!email.trim() || !password || pending}
        onPress={() => void submit()}
        style={({ pressed }) => [styles.button, (!email.trim() || !password) && styles.disabled, (pressed || pending) && styles.pressed]}
      >
        <LinearGradient colors={[colors.brand, colors.brandDark]} style={styles.buttonFill}>
          {pending ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Sign in</Text>}
        </LinearGradient>
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  field: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  input: { flex: 1, minHeight: 52, fontSize: 15, fontWeight: "700" },
  button: { minHeight: 54, overflow: "hidden", borderRadius: radii.md },
  buttonFill: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  buttonText: { color: "white", fontSize: 15, fontWeight: "900" },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18, fontWeight: "800" },
  footerArea: { gap: spacing.md },
  footerLinks: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  linkStrong: { color: colors.brand, fontSize: 13, fontWeight: "900" },
  linkMuted: { fontSize: 13, fontWeight: "900" },
  publicVerify: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.sm, padding: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md },
  publicVerifyIcon: { width: 38, height: 38, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  publicVerifyCopy: { flex: 1, gap: 2 },
  publicVerifyTitle: { fontSize: 13, fontWeight: "900" },
  publicVerifyBody: { fontSize: 10, fontWeight: "700" },
  disabled: { opacity: 0.52 },
  pressed: { opacity: 0.76 },
});
