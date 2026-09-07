import * as Linking from "expo-linking";
import { router } from "expo-router";
import { ArrowLeft, Mail } from "lucide-react-native";
import { useState } from "react";
import { Pressable, StyleSheet, Text } from "react-native";

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

export default function ForgotPassword() {
  const session = useSession();
  const { palette } = useAppTheme();
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const ready = Boolean(email.trim());

  const submit = async () => {
    if (!ready || pending) return;
    setPending(true);
    setMessage(null);
    setSuccess(false);

    try {
      await session.requestPasswordReset(
        email,
        Linking.createURL("reset-password"),
      );
      setSuccess(true);
      setMessage(
        "If this email belongs to a SKIMA account, a secure reset link has been sent.",
      );
    } catch (cause) {
      setMessage(
        friendlyError(
          cause,
          "We couldn't send the reset email. Check your connection and try again.",
        ),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell
      action={<BackAction />}
      eyebrow="Protected account recovery"
      title="Recover access"
      body="Enter the email connected to your SKIMA account. For privacy, we never reveal whether an address is registered."
      footer={
        <Text style={[styles.footerText, { color: palette.muted }]}>
          Remembered your password?{" "}
          <Text onPress={() => router.replace("/(auth)/login")} style={styles.linkStrong}>
            Back to sign in
          </Text>
        </Text>
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
          setMessage(null);
          setSuccess(false);
        }}
        onSubmitEditing={() => void submit()}
        placeholder="you@example.com"
        returnKeyType="send"
        value={email}
      />

      {message ? <AuthFeedback message={message} tone={success ? "success" : "error"} /> : null}

      <AuthPrimaryButton
        disabled={!ready}
        label="Send secure reset link"
        onPress={() => void submit()}
        pending={pending}
      />
    </AuthShell>
  );
}

function BackAction() {
  return (
    <Pressable
      accessibilityLabel="Go back"
      accessibilityRole="button"
      hitSlop={8}
      onPress={() => router.canGoBack() ? router.back() : router.replace("/(auth)/login")}
      style={styles.backButton}
    >
      <ArrowLeft color={colors.brand} size={19} strokeWidth={2.4} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  footerText: {
    textAlign: "center",
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "700",
  },
  linkStrong: { color: colors.brand, fontWeight: "900" },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: "rgba(226,29,47,.10)",
  },
});
