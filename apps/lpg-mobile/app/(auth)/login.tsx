import { LinearGradient } from "expo-linear-gradient";
import { Redirect, router } from "expo-router";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react-native";
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
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ready = Boolean(email.trim() && password);

  const submit = async () => {
    if (!ready || pending) return;
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
      title="Sign in"
      body="Use the account you created for SKIMA. Your available customer, driver and station workspaces will load after sign-in."
      footer={
        <Text style={[styles.footerText, { color: palette.muted }]}>
          New to SKIMA?{" "}
          <Text onPress={() => router.push("/(auth)/register")} style={styles.linkStrong}>
            Create an account
          </Text>
        </Text>
      }
    >
      <View style={styles.fieldBlock}>
        <Text style={[styles.label, { color: palette.ink }]}>Email</Text>
        <View style={[styles.field, { backgroundColor: palette.input, borderColor: palette.border }]}>
          <Mail color={palette.muted} size={18} />
          <TextInput
            accessibilityLabel="Email address"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={palette.muted}
            returnKeyType="next"
            style={[styles.input, { color: palette.ink }]}
            value={email}
          />
        </View>
      </View>

      <View style={styles.fieldBlock}>
        <View style={styles.labelRow}>
          <Text style={[styles.label, { color: palette.ink }]}>Password</Text>
          <Pressable accessibilityRole="button" onPress={() => router.push("/(auth)/forgot-password")}>
            <Text style={styles.linkStrong}>Forgot password?</Text>
          </Pressable>
        </View>
        <View style={[styles.field, { backgroundColor: palette.input, borderColor: palette.border }]}>
          <LockKeyhole color={palette.muted} size={18} />
          <TextInput
            accessibilityLabel="Password"
            autoComplete="current-password"
            onChangeText={setPassword}
            onSubmitEditing={() => void submit()}
            placeholder="Enter your password"
            placeholderTextColor={palette.muted}
            secureTextEntry={!showPassword}
            style={[styles.input, { color: palette.ink }]}
            value={password}
          />
          <Pressable
            accessibilityLabel={showPassword ? "Hide password" : "Show password"}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => setShowPassword((value) => !value)}
          >
            {showPassword ? <EyeOff color={palette.muted} size={18} /> : <Eye color={palette.muted} size={18} />}
          </Pressable>
        </View>
      </View>

      {session.error || message ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {session.error ? friendlyError(new Error(session.error), "We couldn't sign you in. Check your details and try again.") : message}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={!ready || pending}
        onPress={() => void submit()}
        style={({ pressed }) => [styles.button, !ready && styles.disabled, (pressed || pending) && styles.pressed]}
      >
        <LinearGradient colors={[colors.brand, colors.brandDark]} style={styles.buttonFill}>
          {pending ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Sign in to SKIMA</Text>}
        </LinearGradient>
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  fieldBlock: { gap: 8 },
  labelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  label: { fontSize: 12, fontWeight: "900" },
  field: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    paddingHorizontal: spacing.md,
  },
  input: { flex: 1, minHeight: 54, fontSize: 15, fontWeight: "700" },
  button: { minHeight: 56, overflow: "hidden", borderRadius: radii.lg, marginTop: 2 },
  buttonFill: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  buttonText: { color: "white", fontSize: 15, fontWeight: "900" },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18, fontWeight: "800" },
  footerText: { textAlign: "center", fontSize: 13, lineHeight: 20, fontWeight: "700" },
  linkStrong: { color: colors.brand, fontSize: 12, fontWeight: "900" },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.8 },
});
