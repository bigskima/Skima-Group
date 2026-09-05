import * as Linking from "expo-linking";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { ArrowLeft, Mail } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSession } from "../../src/native/session/SessionProvider";
import { useAppTheme } from "../../src/native/theme/ThemeProvider";
import { colors, radii, spacing } from "../../src/native/theme/tokens";
import { AuthShell } from "../../src/native/ui/AuthShell";
import { friendlyError } from "../../src/native/utilities/friendlyError";

export default function ForgotPassword() {
  const session = useSession();
  const { palette } = useAppTheme();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ready = Boolean(email.trim());

  const submit = async () => {
    if (!ready || pending) return;
    setPending(true);
    setMessage(null);
    try {
      const { error } = await session.supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: Linking.createURL("reset-password"),
      });
      if (error) throw error;
      setMessage("If this email belongs to a SKIMA account, a reset link has been sent.");
    } catch (cause) {
      setMessage(friendlyError(cause, "We couldn't send the reset email. Check your connection and try again."));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Reset your password"
      body="Enter the email linked to your account. For your privacy, SKIMA does not reveal whether an email is registered."
      action={<BackAction />}
      footer={
        <Text style={[styles.footerText, { color: palette.muted }]}>
          Remembered your password?{" "}
          <Text onPress={() => router.push("/(auth)/login")} style={styles.linkStrong}>Sign in</Text>
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
            onSubmitEditing={() => void submit()}
            placeholder="you@example.com"
            placeholderTextColor={palette.muted}
            style={[styles.input, { color: palette.ink }]}
            value={email}
          />
        </View>
      </View>

      {message ? (
        <Text accessibilityRole="alert" style={[styles.message, { color: message.includes("couldn't") ? colors.danger : colors.success }]}>
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
          {pending ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Send reset link</Text>}
        </LinearGradient>
      </Pressable>
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
  button: { minHeight: 56, overflow: "hidden", borderRadius: radii.lg },
  buttonFill: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  buttonText: { color: "white", fontSize: 15, fontWeight: "900" },
  message: { fontSize: 12, lineHeight: 18, fontWeight: "800" },
  footerText: { textAlign: "center", fontSize: 13, lineHeight: 20, fontWeight: "700" },
  linkStrong: { color: colors.brand, fontWeight: "900" },
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
