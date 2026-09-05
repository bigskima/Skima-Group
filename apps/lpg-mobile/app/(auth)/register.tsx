import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { ArrowLeft, Eye, EyeOff, LockKeyhole, Mail, UserRound } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSession } from "../../src/native/session/SessionProvider";
import { useAppTheme } from "../../src/native/theme/ThemeProvider";
import { colors, radii, spacing } from "../../src/native/theme/tokens";
import { AuthShell } from "../../src/native/ui/AuthShell";
import { friendlyError } from "../../src/native/utilities/friendlyError";

export default function Register() {
  const session = useSession();
  const { palette } = useAppTheme();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ready = Boolean(name.trim() && email.trim() && password);

  const submit = async () => {
    if (!ready || pending) return;
    setPending(true);
    setMessage(null);
    try {
      const result = await session.supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { display_name: name.trim(), source: "skima.lpg.mobile" } },
      });
      if (result.error) throw result.error;
      setMessage(
        result.data.session
          ? "Your account is ready."
          : "Check your email to confirm your account, then sign in.",
      );
      if (result.data.session) router.replace("/");
    } catch (cause) {
      setMessage(
        friendlyError(
          cause,
          "We couldn't create your account. Check your details or sign in if you already use SKIMA.",
        ),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Create account"
      title="Join SKIMA"
      body="Start with a customer account. Driver and station workspaces become available only after the required application and approval."
      action={<BackAction />}
      footer={
        <Text style={[styles.footerText, { color: palette.muted }]}>
          Already use SKIMA?{" "}
          <Text onPress={() => router.push("/(auth)/login")} style={styles.linkStrong}>
            Sign in
          </Text>
        </Text>
      }
    >
      <View style={styles.fieldBlock}>
        <Text style={[styles.label, { color: palette.ink }]}>Full name</Text>
        <View style={[styles.field, { backgroundColor: palette.input, borderColor: palette.border }]}>
          <UserRound color={palette.muted} size={18} />
          <TextInput
            accessibilityLabel="Full name"
            autoComplete="name"
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={palette.muted}
            style={[styles.input, { color: palette.ink }]}
            value={name}
          />
        </View>
      </View>

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
            style={[styles.input, { color: palette.ink }]}
            value={email}
          />
        </View>
      </View>

      <View style={styles.fieldBlock}>
        <Text style={[styles.label, { color: palette.ink }]}>Password</Text>
        <View style={[styles.field, { backgroundColor: palette.input, borderColor: palette.border }]}>
          <LockKeyhole color={palette.muted} size={18} />
          <TextInput
            accessibilityLabel="Password"
            autoComplete="new-password"
            onChangeText={setPassword}
            onSubmitEditing={() => void submit()}
            placeholder="Create a password"
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
        <Text style={[styles.helper, { color: palette.muted }]}>
          Password requirements are enforced securely by SKIMA when you create the account.
        </Text>
      </View>

      {message ? (
        <Text
          accessibilityRole="alert"
          style={[styles.message, { color: message.includes("couldn't") ? colors.danger : colors.success }]}
        >
          {message}
        </Text>
      ) : null}

      <Pressable
        accessibilityRole="button"
        disabled={!ready || pending}
        onPress={() => void submit()}
        style={({ pressed }) => [styles.button, !ready && styles.disabled, (pressed || pending) && styles.pressed]}
      >
        <LinearGradient colors={[colors.brand, colors.brandDark]} style={styles.buttonFill}>
          {pending ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Create account</Text>}
        </LinearGradient>
      </Pressable>

      <Text style={[styles.legal, { color: palette.muted }]}>
        After sign-in, SKIMA will show the policies that apply to your account and workspace before the guided app tour begins.
      </Text>
    </AuthShell>
  );
}

function BackAction() {
  return (
    <Pressable accessibilityLabel="Go back" accessibilityRole="button" hitSlop={8} onPress={() => router.back()} style={styles.backButton}>
      <ArrowLeft color={colors.brand} size={20} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fieldBlock: { gap: 8 },
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
  helper: { fontSize: 10, lineHeight: 15, fontWeight: "700" },
  button: { minHeight: 56, overflow: "hidden", borderRadius: radii.lg, marginTop: 2 },
  buttonFill: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  buttonText: { color: "white", fontSize: 15, fontWeight: "900" },
  message: { fontSize: 12, lineHeight: 18, fontWeight: "800" },
  footerText: { textAlign: "center", fontSize: 13, lineHeight: 20, fontWeight: "700" },
  linkStrong: { color: colors.brand, fontWeight: "900" },
  legal: { fontSize: 10, lineHeight: 16, textAlign: "center" },
  backButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: "rgba(237,28,46,.08)",
  },
  disabled: { opacity: 0.48 },
  pressed: { opacity: 0.8 },
});
