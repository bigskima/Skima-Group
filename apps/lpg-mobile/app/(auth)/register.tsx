import { Redirect, router } from "expo-router";
import { Eye, EyeOff, LockKeyhole, Mail, UserRound } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useSession } from "../../src/native/session/SessionProvider";
import { useAppTheme } from "../../src/native/theme/ThemeProvider";
import { colors, radii } from "../../src/native/theme/tokens";
import {
  AuthFeedback,
  AuthPrimaryButton,
  AuthTextField,
} from "../../src/native/ui/AuthControls";
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
  const [success, setSuccess] = useState(false);
  const ready = Boolean(name.trim() && email.trim() && password);

  const clearFeedback = () => {
    if (message) setMessage(null);
    if (success) setSuccess(false);
    if (session.error) session.clearAuthError();
  };

  const submit = async () => {
    if (!ready || pending) return;
    setPending(true);
    setMessage(null);
    setSuccess(false);
    session.clearAuthError();

    try {
      const result = await session.signUp({
        displayName: name,
        email,
        password,
      });

      if (result.sessionStarted) {
        router.replace("/");
        return;
      }

      setSuccess(true);
      setMessage(
        result.confirmationRequired
          ? "Your account was created. Check your email to confirm it, then return here and sign in."
          : "Your SKIMA account is ready.",
      );
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

  if (session.status === "authenticated") return <Redirect href="/" />;

  return (
    <AuthShell
      activeMode="register"
      eyebrow="Create your SKIMA identity"
      title="One account. Start as a customer."
      body="Create your account here. Driver and station access is added later only after the required application and approval."
      runtimeMessage={session.authRuntimeMessage}
      runtimeStatus={session.authRuntimeStatus}
      footer={
        <View style={styles.footerStack}>
          <Text style={[styles.footerText, { color: palette.muted }]}>
            Already use SKIMA?{" "}
            <Text onPress={() => router.replace("/(auth)/login")} style={styles.linkStrong}>
              Sign in instead
            </Text>
          </Text>
          <Text style={[styles.policyText, { color: palette.muted }]}>
            SKIMA will show the policies that apply to your account before the guided app tour begins.
          </Text>
        </View>
      }
    >
      <AuthTextField
        accessibilityLabel="Full name"
        autoComplete="name"
        icon={<UserRound color={palette.mutedStrong} size={18} strokeWidth={2.2} />}
        label="Full name"
        onChangeText={(value) => {
          setName(value);
          clearFeedback();
        }}
        placeholder="Your name"
        textContentType="name"
        value={name}
      />

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
        textContentType="emailAddress"
        value={email}
      />

      <AuthTextField
        accessibilityLabel="Password"
        autoComplete="new-password"
        helper="SKIMA does not invent a separate password rule here. Your Supabase Auth policy is the authority."
        icon={<LockKeyhole color={palette.mutedStrong} size={18} strokeWidth={2.2} />}
        label="Password"
        onChangeText={(value) => {
          setPassword(value);
          clearFeedback();
        }}
        onSubmitEditing={() => void submit()}
        placeholder="Create a password"
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
        textContentType="newPassword"
        value={password}
      />

      {message ? <AuthFeedback message={message} tone={success ? "success" : "error"} /> : null}

      <AuthPrimaryButton
        disabled={!ready || session.authRuntimeStatus === "unavailable"}
        label="Create my SKIMA account"
        onPress={() => void submit()}
        pending={pending}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  eyeButton: {
    width: 34,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
  },
  footerStack: { gap: 9 },
  footerText: {
    textAlign: "center",
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "700",
  },
  linkStrong: { color: colors.brand, fontWeight: "900" },
  policyText: {
    textAlign: "center",
    fontSize: 9,
    lineHeight: 14,
    fontWeight: "600",
  },
});
