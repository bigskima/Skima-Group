import { router } from "expo-router";
import { ArrowLeft, Eye, EyeOff, LockKeyhole } from "lucide-react-native";
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

export default function ResetPassword() {
  const session = useSession();
  const { palette } = useAppTheme();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const ready = Boolean(password && confirm);

  const submit = async () => {
    if (!ready || pending) return;
    if (password !== confirm) {
      setSuccess(false);
      setMessage("The two passwords do not match.");
      return;
    }

    setPending(true);
    setMessage(null);
    setSuccess(false);

    try {
      await session.updatePassword(password);
      setSuccess(true);
      setMessage("Your password is updated. You can continue with your SKIMA account.");
      setTimeout(() => router.replace("/"), 450);
    } catch (cause) {
      setMessage(
        friendlyError(
          cause,
          "We couldn't update your password. Open the newest reset email and try again.",
        ),
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <AuthShell
      action={<BackAction />}
      eyebrow="Secure recovery"
      title="Choose a new password"
      body="Set the new password for your SKIMA account. The Supabase Auth policy configured for SKIMA remains the source of truth."
      footer={
        <Text style={[styles.footerText, { color: palette.muted }]}>
          Need to start again?{" "}
          <Text onPress={() => router.replace("/(auth)/forgot-password")} style={styles.linkStrong}>
            Request another link
          </Text>
        </Text>
      }
    >
      <AuthTextField
        accessibilityLabel="New password"
        autoComplete="new-password"
        icon={<LockKeyhole color={palette.mutedStrong} size={18} strokeWidth={2.2} />}
        label="New password"
        onChangeText={(value) => {
          setPassword(value);
          setMessage(null);
          setSuccess(false);
        }}
        placeholder="Enter your new password"
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

      <AuthTextField
        accessibilityLabel="Confirm new password"
        autoComplete="new-password"
        icon={<LockKeyhole color={palette.mutedStrong} size={18} strokeWidth={2.2} />}
        label="Confirm password"
        onChangeText={(value) => {
          setConfirm(value);
          setMessage(null);
          setSuccess(false);
        }}
        onSubmitEditing={() => void submit()}
        placeholder="Enter it again"
        returnKeyType="go"
        secureTextEntry={!showPassword}
        value={confirm}
      />

      {message ? <AuthFeedback message={message} tone={success ? "success" : "error"} /> : null}

      <AuthPrimaryButton
        disabled={!ready}
        label="Update password"
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
  eyeButton: {
    width: 34,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: "rgba(226,29,47,.10)",
  },
});
