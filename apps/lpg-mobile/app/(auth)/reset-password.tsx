import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { ArrowLeft, Eye, EyeOff, LockKeyhole } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSession } from "../../src/native/session/SessionProvider";
import { useAppTheme } from "../../src/native/theme/ThemeProvider";
import { colors, radii, spacing } from "../../src/native/theme/tokens";
import { AuthShell } from "../../src/native/ui/AuthShell";
import { friendlyError } from "../../src/native/utilities/friendlyError";

export default function ResetPassword() {
  const session = useSession();
  const { palette } = useAppTheme();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ready = Boolean(password && confirm);

  const submit = async () => {
    if (!ready || pending) return;
    if (password !== confirm) {
      setMessage("The passwords do not match.");
      return;
    }
    setPending(true);
    setMessage(null);
    try {
      const { error } = await session.supabase.auth.updateUser({ password });
      if (error) throw error;
      setMessage("Your password has been updated.");
      router.replace("/");
    } catch (cause) {
      setMessage(friendlyError(cause, "We couldn't update your password. Open the newest reset email and try again."));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Secure recovery"
      title="Choose a new password"
      body="Enter your new password below. SKIMA will apply the password policy configured for your account."
      action={<BackAction />}
      footer={
        <Text style={[styles.footerText, { color: palette.muted }]}>
          Return to{" "}
          <Text onPress={() => router.push("/(auth)/login")} style={styles.linkStrong}>sign in</Text>
        </Text>
      }
    >
      <View style={styles.fieldBlock}>
        <Text style={[styles.label, { color: palette.ink }]}>New password</Text>
        <View style={[styles.field, { backgroundColor: palette.input, borderColor: palette.border }]}>
          <LockKeyhole color={palette.muted} size={18} />
          <TextInput
            accessibilityLabel="New password"
            autoComplete="new-password"
            onChangeText={setPassword}
            placeholder="Enter a new password"
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

      <View style={styles.fieldBlock}>
        <Text style={[styles.label, { color: palette.ink }]}>Confirm password</Text>
        <View style={[styles.field, { backgroundColor: palette.input, borderColor: palette.border }]}>
          <LockKeyhole color={palette.muted} size={18} />
          <TextInput
            accessibilityLabel="Confirm new password"
            autoComplete="new-password"
            onChangeText={setConfirm}
            onSubmitEditing={() => void submit()}
            placeholder="Enter it again"
            placeholderTextColor={palette.muted}
            secureTextEntry={!showPassword}
            style={[styles.input, { color: palette.ink }]}
            value={confirm}
          />
        </View>
      </View>

      {message ? (
        <Text
          accessibilityRole="alert"
          style={[styles.message, { color: message.includes("couldn't") || message.includes("not match") ? colors.danger : colors.success }]}
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
          {pending ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Update password</Text>}
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
