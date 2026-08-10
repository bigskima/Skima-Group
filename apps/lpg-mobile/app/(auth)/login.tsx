import { Redirect, router } from "expo-router";
import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, useColorScheme } from "react-native";
import { useSession } from "../../src/native/session/SessionProvider";
import { colors, radii, spacing } from "../../src/native/theme/tokens";
import { Screen } from "../../src/native/ui/Screen";

export default function Login() {
  const session = useSession();
  const dark = useColorScheme() === "dark";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  if (session.status === "authenticated") return <Redirect href="/" />;
  return <Screen eyebrow="Welcome back" title="Move safely with SKIMA">
    <View style={styles.wrap}>
      <Text style={[styles.copy, { color: dark ? colors.darkMuted : colors.muted }]}>Sign in to continue your LPG orders, assignments, or station operations.</Text>
      <View style={styles.form}>
        <TextInput accessibilityLabel="Email address" autoCapitalize="none" autoComplete="email" keyboardType="email-address" placeholder="Email address" placeholderTextColor={colors.muted} value={email} onChangeText={setEmail} style={[styles.input, dark && styles.inputDark]} />
        <TextInput accessibilityLabel="Password" autoComplete="current-password" placeholder="Password" placeholderTextColor={colors.muted} secureTextEntry value={password} onChangeText={setPassword} style={[styles.input, dark && styles.inputDark]} />
        {session.error ? <Text accessibilityRole="alert" style={styles.error}>{session.error}</Text> : null}
        <Pressable accessibilityRole="button" disabled={!email || !password || session.status === "loading"} onPress={() => void session.signIn(email.trim(), password)} style={({ pressed }) => [styles.button, pressed && { opacity: .85 }]}>
          {session.status === "loading" ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Sign in securely</Text>}
        </Pressable>
        <View style={styles.links}><Pressable onPress={() => router.push("/(auth)/register")}><Text style={styles.link}>Create an account</Text></Pressable><Pressable onPress={() => router.push("/(auth)/forgot-password")}><Text style={styles.link}>Forgot password?</Text></Pressable></View>
      </View>
    </View>
  </Screen>;
}
const styles = StyleSheet.create({
  wrap: { width: "100%", maxWidth: 480, gap: spacing.xl }, copy: { fontSize: 17, lineHeight: 26 }, form: { gap: spacing.md },
  input: { minHeight: 54, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, paddingHorizontal: spacing.md, backgroundColor: colors.surface, color: colors.ink, fontSize: 16 },
  inputDark: { backgroundColor: colors.darkSurface, borderColor: "#33443A", color: colors.darkInk },
  button: { minHeight: 56, borderRadius: radii.md, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.lg },
  buttonText: { color: "white", fontSize: 16, fontWeight: "800" }, error: { color: colors.danger, lineHeight: 20 }, links: { flexDirection: "row", justifyContent: "space-between", gap: spacing.md }, link: { color: colors.brand, fontWeight: "800" }
});
