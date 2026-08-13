import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { LockKeyhole } from "lucide-react-native";
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
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const valid = password.length >= 8 && confirm.length >= 8;

  const submit = async () => {
    if (!valid || pending) return;
    if (password !== confirm) {
      setMessage("Passwords do not match.");
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
      eyebrow="Secure reset"
      title="Choose a new password"
      body="Use a strong password with at least 8 characters to protect your refill account."
      action={<BackAction />}
      footer={
        <Pressable onPress={() => router.push("/(auth)/login")}>
          <Text style={styles.centerLink}>Return to <Text style={styles.linkStrong}>sign in</Text></Text>
        </Pressable>
      }
    >
      <View style={[styles.field, { backgroundColor: palette.input, borderColor: palette.border }]}>
        <LockKeyhole color={palette.muted} size={18} />
        <TextInput
          accessibilityLabel="New password"
          autoComplete="new-password"
          onChangeText={setPassword}
          placeholder="New password"
          placeholderTextColor={palette.muted}
          secureTextEntry
          style={[styles.input, { color: palette.ink }]}
          value={password}
        />
      </View>

      <View style={[styles.field, { backgroundColor: palette.input, borderColor: palette.border }]}>
        <LockKeyhole color={palette.muted} size={18} />
        <TextInput
          accessibilityLabel="Confirm new password"
          autoComplete="new-password"
          onChangeText={setConfirm}
          onSubmitEditing={() => void submit()}
          placeholder="Confirm new password"
          placeholderTextColor={palette.muted}
          secureTextEntry
          style={[styles.input, { color: palette.ink }]}
          value={confirm}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={!valid || pending}
        onPress={() => void submit()}
        style={({ pressed }) => [styles.button, !valid && styles.disabled, (pressed || pending) && styles.pressed]}
      >
        <LinearGradient colors={[colors.brand, colors.brandDark]} style={styles.buttonFill}>
          {pending ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Update password</Text>}
        </LinearGradient>
      </Pressable>

      {message ? <Text style={[styles.message, { color: message.includes("couldn't") || message.includes("match") ? colors.danger : colors.brandDark }]}>{message}</Text> : null}
    </AuthShell>
  );
}

function BackAction() {
  return (
    <Pressable accessibilityRole="button" onPress={() => router.back()} style={styles.backButton}>
      <Text style={styles.backText}>Back</Text>
    </Pressable>
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
  message: { fontSize: 12, lineHeight: 18, fontWeight: "800" },
  centerLink: { color: colors.muted, textAlign: "center", fontSize: 13, fontWeight: "800" },
  linkStrong: { color: colors.brand, fontWeight: "900" },
  backButton: { minHeight: 38, justifyContent: "center", paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: "rgba(255,255,255,.12)" },
  backText: { color: "white", fontSize: 12, fontWeight: "900" },
  disabled: { opacity: 0.52 },
  pressed: { opacity: 0.76 },
});
