import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { LockKeyhole, Mail, UserRound } from "lucide-react-native";
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
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const valid = name.trim().length >= 2 && email.trim().length > 4 && password.length >= 8;

  const submit = async () => {
    if (!valid || pending) return;
    setPending(true);
    setMessage(null);
    try {
      const result = await session.supabase.auth.signUp({
        email: email.trim().toLowerCase(),
        password,
        options: { data: { display_name: name.trim(), source: "skima.lpg.mobile" } },
      });
      if (result.error) throw result.error;
      setMessage(result.data.session ? "Your account is ready. Opening SKIMA..." : "Check your email to confirm your account, then sign in.");
      if (result.data.session) router.replace("/");
    } catch (cause) {
      setMessage(friendlyError(cause, "We couldn't create your account. Check the details or sign in if you already use SKIMA."));
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell
      eyebrow="Create access"
      title="Start with SKIMA"
      body="Create your customer account first. Driver and station access can be requested inside your account."
      action={<BackAction />}
      footer={
        <Pressable onPress={() => router.push("/(auth)/login")}>
          <Text style={[styles.centerLink, { color: palette.muted }]}>Already have an account? <Text style={styles.linkStrong}>Sign in</Text></Text>
        </Pressable>
      }
    >
      <View style={[styles.field, { backgroundColor: palette.input, borderColor: palette.border }]}>
        <UserRound color={palette.muted} size={18} />
        <TextInput
          accessibilityLabel="Full name"
          autoComplete="name"
          onChangeText={setName}
          placeholder="Full name"
          placeholderTextColor={palette.muted}
          style={[styles.input, { color: palette.ink }]}
          value={name}
        />
      </View>

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
          style={[styles.input, { color: palette.ink }]}
          value={email}
        />
      </View>

      <View style={[styles.field, { backgroundColor: palette.input, borderColor: palette.border }]}>
        <LockKeyhole color={palette.muted} size={18} />
        <TextInput
          accessibilityLabel="Password"
          autoComplete="new-password"
          onChangeText={setPassword}
          onSubmitEditing={() => void submit()}
          placeholder="Password, minimum 8 characters"
          placeholderTextColor={palette.muted}
          secureTextEntry
          style={[styles.input, { color: palette.ink }]}
          value={password}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={!valid || pending}
        onPress={() => void submit()}
        style={({ pressed }) => [styles.button, !valid && styles.disabled, (pressed || pending) && styles.pressed]}
      >
        <LinearGradient colors={[colors.brand, colors.brandDark]} style={styles.buttonFill}>
          {pending ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Create my account</Text>}
        </LinearGradient>
      </Pressable>

      {message ? <Text style={[styles.message, { color: message.includes("couldn't") ? colors.danger : colors.success }]}>{message}</Text> : null}
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
  centerLink: { textAlign: "center", fontSize: 13, fontWeight: "800" },
  linkStrong: { color: colors.brand, fontWeight: "900" },
  backButton: { minHeight: 38, justifyContent: "center", paddingHorizontal: 12, borderRadius: radii.pill, backgroundColor: "rgba(255,255,255,.12)" },
  backText: { color: "white", fontSize: 12, fontWeight: "900" },
  disabled: { opacity: 0.52 },
  pressed: { opacity: 0.76 },
});
