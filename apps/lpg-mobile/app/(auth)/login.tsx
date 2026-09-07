import { Redirect, router } from "expo-router";
import { Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useSession } from "../../src/native/session/SessionProvider";
import { useAppTheme } from "../../src/native/theme/ThemeProvider";
import { colors, radii, spacing } from "../../src/native/theme/tokens";
import {
  AuthFeedback,
  AuthPrimaryButton,
  AuthTextField,
} from "../../src/native/ui/AuthControls";
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

  const clearFeedback = () => {
    if (message) setMessage(null);
    if (session.error) session.clearAuthError();
  };

  const submit = async () => {
    if (!ready || pending) return;
    setPending(true);
    setMessage(null);
    session.clearAuthError();

    try {
      const signedIn = await session.signIn(email, password);
      if (signedIn) router.replace("/");
    } catch (cause) {
      setMessage(
        friendlyError(
          cause,
          "We couldn't sign you in. Check your details and try again.",
        ),
      );
    } finally {
      setPending(false);
    }
  };

  if (session.status === "authenticated") return <Redirect href="/" />;

  const errorMessage = session.error ?? message;

  return (
    <AuthShell
      activeMode="login"
      eyebrow="Secure account access"
      title="Welcome back"
      body="Sign in once. SKIMA will unlock only the customer, driver or station workspaces your account is allowed to use."
      runtimeMessage={session.authRuntimeMessage}
      runtimeStatus={session.authRuntimeStatus}
      footer={
        <View style={styles.footerStack}>
          <Text style={[styles.footerText, { color: palette.muted }]}>
            New to SKIMA?{" "}
            <Text onPress={() => router.replace("/(auth)/register")} style={styles.linkStrong}>
              Create your account
            </Text>
          </Text>
          <View style={[styles.footerTrust, { backgroundColor: palette.soft }]}>
            <ShieldCheck color={palette.success} size={15} />
            <Text style={[styles.footerTrustText, { color: palette.mutedStrong }]}>
              Your account decides access. Signing in never grants driver or station authority by itself.
            </Text>
          </View>
        </View>
      }
    >
      <AuthTextField
        accessibilityLabel="Email address"
        autoCapitalize="none"
        autoComplete="email"
        icon={<Mail color={palette.mutedStrong} size={18} strokeWidth={2.2} />}
        keyboardType="email-address"
        label="Email address"
        onChangeText={(value) => {
          setEmail(value);
          clearFeedback();
        }}
        placeholder="you@example.com"
        returnKeyType="next"
        value={email}
      />

      <View style={styles.passwordBlock}>
        <View style={styles.passwordTopline}>
          <Text style={[styles.passwordHint, { color: palette.mutedStrong }]}>Password</Text>
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => router.push("/(auth)/forgot-password")}
          >
            <Text style={styles.forgotLink}>Forgot password?</Text>
          </Pressable>
        </View>

        <AuthTextField
          accessibilityLabel="Password"
          autoComplete="current-password"
          icon={<LockKeyhole color={palette.mutedStrong} size={18} strokeWidth={2.2} />}
          label=""
          onChangeText={(value) => {
            setPassword(value);
            clearFeedback();
          }}
          onSubmitEditing={() => void submit()}
          placeholder="Enter your password"
          returnKeyType="go"
          rightAction={
            <Pressable
              accessibilityLabel={showPassword ? "Hide password" : "Show password"}
              accessibilityRole="button"
              hitSlop={10}
              onPress={() => setShowPassword((value) => !value)}
              style={styles.eyeButton}
            >
              {showPassword ? (
                <EyeOff color={palette.mutedStrong} size={19} />
              ) : (
                <Eye color={palette.mutedStrong} size={19} />
              )}
            </Pressable>
          }
          secureTextEntry={!showPassword}
          value={password}
        />
      </View>

      {errorMessage ? <AuthFeedback message={errorMessage} tone="error" /> : null}

      <AuthPrimaryButton
        disabled={!ready || session.authRuntimeStatus === "unavailable"}
        label="Continue to SKIMA"
        onPress={() => void submit()}
        pending={pending}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  passwordBlock: { gap: 7 },
  passwordTopline: {
    minHeight: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    paddingHorizontal: 2,
  },
  passwordHint: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
    letterSpacing: 0.25,
  },
  forgotLink: {
    color: colors.brand,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "900",
  },
  eyeButton: {
    width: 34,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
  },
  footerStack: { gap: 12 },
  footerText: {
    textAlign: "center",
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "700",
  },
  linkStrong: { color: colors.brand, fontWeight: "900" },
  footerTrust: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: radii.md,
    padding: 10,
  },
  footerTrustText: {
    flex: 1,
    fontSize: 9,
    lineHeight: 14,
    fontWeight: "600",
  },
});
