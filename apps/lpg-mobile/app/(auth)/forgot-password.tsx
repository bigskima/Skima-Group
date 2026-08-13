import * as Linking from "expo-linking";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { Mail } from "lucide-react-native";
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

  const submit = async () => {
    if (!email.trim() || pending) return;
    setPending(true);
    setMessage(null);
    try {
      const { error } = await session.supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: Linking.createURL("reset-password"),
      });
      if (error) throw error;
      setMessage("If this email belongs to an account, your reset link is on its way.");
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
      body="Enter the email linked to your SKIMA account. We will send a secure reset link if the account exists."
      action={<BackAction />}
      footer={
        <Pressable onPress={() => router.push("/(auth)/login")}>
          <Text style={styles.centerLink}>Remembered it? <Text style={styles.linkStrong}>Sign in</Text></Text>
        </Pressable>
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
          onSubmitEditing={() => void submit()}
          placeholder="Email address"
          placeholderTextColor={palette.muted}
          style={[styles.input, { color: palette.ink }]}
          value={email}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={!email.trim() || pending}
        onPress={() => void submit()}
        style={({ pressed }) => [styles.button, !email.trim() && styles.disabled, (pressed || pending) && styles.pressed]}
      >
        <LinearGradient colors={[colors.brand, colors.brandDark]} style={styles.buttonFill}>
          {pending ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Send reset link</Text>}
        </LinearGradient>
      </Pressable>

      {message ? <Text style={[styles.message, { color: message.includes("couldn't") ? colors.danger : colors.brandDark }]}>{message}</Text> : null}
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
