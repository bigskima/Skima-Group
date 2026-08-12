import { LinearGradient } from "expo-linear-gradient";
import { Redirect, router } from "expo-router";
import { LockKeyhole, Mail } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { useSession } from "../../src/native/session/SessionProvider";
import { useAppTheme } from "../../src/native/theme/ThemeProvider";
import { colors, radii, spacing } from "../../src/native/theme/tokens";
import { BrandMark } from "../../src/native/ui/BrandMark";
import { Screen } from "../../src/native/ui/Screen";
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
      else setMessage("We couldn’t open your account. Check the message below and try again.");
    } catch (cause) {
      setMessage(friendlyError(cause, "We couldn’t sign you in. Please try again."));
    } finally {
      setPending(false);
    }
  };

  if (session.status === "authenticated") return <Redirect href="/(customer)" />;

  return (
    <Screen eyebrow="Welcome back" title="Sign in to SKIMA">
      <View style={styles.wrap}>
        <BrandMark />
        <Text style={[styles.copy, { color: palette.muted }]}>Continue your refill, delivery or station work.</Text>
        <View style={styles.form}>
          <View style={[styles.field, { backgroundColor: palette.input, borderColor: palette.border }]}>
            <Mail color={palette.muted} size={18} />
            <TextInput accessibilityLabel="Email address" autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="Email address" placeholderTextColor={palette.muted} value={email} onChangeText={setEmail} onSubmitEditing={() => undefined} style={[styles.input, { color: palette.ink }]} />
          </View>
          <View style={[styles.field, { backgroundColor: palette.input, borderColor: palette.border }]}>
            <LockKeyhole color={palette.muted} size={18} />
            <TextInput accessibilityLabel="Password" autoComplete="current-password" placeholder="Password" placeholderTextColor={palette.muted} secureTextEntry value={password} onChangeText={setPassword} onSubmitEditing={() => void submit()} style={[styles.input, { color: palette.ink }]} />
          </View>
          {session.error || message ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {session.error ? friendlyError(new Error(session.error), "We couldn’t sign you in. Check your details and try again.") : message}
            </Text>
          ) : null}
          <Pressable accessibilityRole="button" disabled={!email.trim() || !password || pending} onPress={() => void submit()} style={({ pressed }) => [styles.button, (pressed || pending) && { opacity: .76 }]}>
            <LinearGradient colors={[colors.brand, colors.brandDark]} style={styles.buttonFill}>
              {pending ? <ActivityIndicator color="white" /> : <Text style={styles.buttonText}>Sign in</Text>}
            </LinearGradient>
          </Pressable>
          <View style={styles.links}>
            <Pressable onPress={() => router.push("/(auth)/register")}><Text style={styles.link}>Create account</Text></Pressable>
            <Pressable onPress={() => router.push("/(auth)/forgot-password")}><Text style={styles.link}>Forgot password?</Text></Pressable>
          </View>
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%", maxWidth: 460, gap: 18 },
  copy: { fontSize: 14, lineHeight: 20 },
  form: { gap: 12 },
  field: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 10, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, paddingHorizontal: spacing.md },
  input: { flex: 1, minHeight: 50, fontSize: 15 },
  button: { minHeight: 52, overflow: "hidden", borderRadius: radii.md },
  buttonFill: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  buttonText: { color: "white", fontSize: 15, fontWeight: "900" },
  error: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  links: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md, paddingTop: 2 },
  link: { color: colors.brand, fontSize: 12, fontWeight: "900" },
});
