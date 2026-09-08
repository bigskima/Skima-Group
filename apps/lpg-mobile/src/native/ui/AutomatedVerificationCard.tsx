import * as Linking from "expo-linking";
import {
  CheckCircle2,
  Clock3,
  ExternalLink,
  FileWarning,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react-native";
import { useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import {
  type VerificationCheck,
  useRefreshVerification,
  useStartVerification,
} from "../api/verification";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";

export function AutomatedVerificationCard({
  applicationId,
  verificationKey,
  title,
  description,
  check,
  ensureApplicationId,
}: {
  readonly applicationId?: string | null;
  readonly verificationKey: string;
  readonly title: string;
  readonly description: string;
  readonly check?: VerificationCheck | null;
  readonly ensureApplicationId?: () => Promise<string>;
}) {
  const { palette } = useAppTheme();
  const start = useStartVerification();
  const refresh = useRefreshVerification();
  const [localSessionId, setLocalSessionId] = useState<string | null>(null);
  const [localApplicationId, setLocalApplicationId] = useState<string | null>(null);
  const [localAutomaticUnavailable, setLocalAutomaticUnavailable] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const status = check?.status ?? "not_started";
  const sessionId = check?.sessionId ?? localSessionId;
  const resolvedApplicationId = applicationId ?? localApplicationId;
  const passed = status === "passed";
  const automaticAvailable =
    (check?.automaticAvailable ?? true) && !localAutomaticUnavailable;
  const pendingProviderReview = status === "manual_review";
  const canFallback = check?.manualFallbackAllowed ?? true;
  const isBusy = start.isPending || refresh.isPending;

  const startVerification = async () => {
    setMessage(null);
    try {
      const resolvedApplicationId =
        applicationId ?? (ensureApplicationId ? await ensureApplicationId() : null);
      if (!resolvedApplicationId) {
        throw new Error("Save this application step before starting verification.");
      }
      setLocalApplicationId(resolvedApplicationId);

      const result = await start.mutateAsync({
        applicationId: resolvedApplicationId,
        verificationKey,
        idempotencyKey: idempotencyKey(
          "verification-start",
          `${resolvedApplicationId}:${verificationKey}`,
        ),
      });

      setLocalSessionId(result.id);
      setLocalAutomaticUnavailable(false);
      if (result.verificationUrl) {
        const supported = await Linking.canOpenURL(result.verificationUrl);
        if (!supported) throw new Error("The secure verification page could not be opened.");
        await Linking.openURL(result.verificationUrl);
        setMessage("Complete the secure check, return to SKIMA, then tap Check result.");
      } else {
        setMessage("Verification session started. Tap Check result after completing the provider flow.");
      }
    } catch (cause) {
      setLocalAutomaticUnavailable(true);
      setMessage(
        friendlyError(
          cause,
          canFallback
            ? "Secure verification is temporarily unavailable. Continue with the accepted fallback evidence below or try again later."
            : "Secure verification could not be started. Please try again later.",
        ),
      );
    }
  };

  const refreshVerification = async () => {
    setMessage(null);
    try {
      const activeApplicationId = resolvedApplicationId;
      if (!activeApplicationId || !sessionId) {
        throw new Error("Start the verification check before refreshing its result.");
      }

      const result = await refresh.mutateAsync({
        applicationId: activeApplicationId,
        sessionId,
        idempotencyKey: idempotencyKey(
          "verification-refresh",
          `${activeApplicationId}:${verificationKey}:${sessionId}`,
        ),
      });

      if (result.status === "passed") {
        setMessage("Verified automatically. You do not need to upload duplicate evidence for this check.");
      } else if (result.status === "manual_review") {
        setMessage("The verification provider is reviewing this check. SKIMA will keep the result synchronized.");
      } else if (result.status === "failed") {
        setMessage("Automatic verification did not pass. Retry or use the allowed fallback evidence.");
      } else {
        setMessage("Verification is still in progress. Finish the secure flow, then check again.");
      }
    } catch (cause) {
      setMessage(
        friendlyError(
          cause,
          "SKIMA could not refresh this verification result. Your saved application is unchanged.",
        ),
      );
    }
  };

  return (
    <View
      style={[
        styles.card,
        shadows.soft,
        {
          backgroundColor: palette.surface,
          borderColor: passed
            ? palette.success
            : status === "failed"
              ? palette.danger
              : palette.border,
        },
      ]}
    >
      <View style={styles.headingRow}>
        <View
          style={[
            styles.iconTile,
            {
              backgroundColor: passed
                ? palette.successSoft
                : status === "failed"
                  ? palette.dangerSoft
                  : palette.brandSoft,
            },
          ]}
        >
          {passed ? (
            <CheckCircle2 color={palette.success} size={22} strokeWidth={2.4} />
          ) : pendingProviderReview ? (
            <Clock3 color={palette.warning} size={22} strokeWidth={2.4} />
          ) : status === "failed" ? (
            <TriangleAlert color={palette.danger} size={22} strokeWidth={2.4} />
          ) : (
            <ShieldCheck color={palette.brand} size={22} strokeWidth={2.4} />
          )}
        </View>
        <View style={styles.headingCopy}>
          <Text style={[styles.eyebrow, { color: passed ? palette.success : palette.brand }]}>
            {passed
              ? "VERIFIED AUTOMATICALLY"
              : automaticAvailable
                ? "SECURE AUTOMATIC CHECK"
                : "VERIFICATION OPTIONS"}
          </Text>
          <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
          <Text style={[styles.body, { color: palette.muted }]}>{description}</Text>
        </View>
      </View>

      {check?.providerDisplayName && automaticAvailable ? (
        <View style={[styles.providerPill, { backgroundColor: palette.surfaceSubtle }]}>
          <ShieldCheck color={palette.mutedStrong} size={13} />
          <Text style={[styles.providerText, { color: palette.mutedStrong }]}>
            Secure check powered by {check.providerDisplayName}
          </Text>
        </View>
      ) : null}

      {passed ? (
        <View style={[styles.successBox, { backgroundColor: palette.successSoft }]}>
          <CheckCircle2 color={palette.success} size={17} />
          <Text style={[styles.successText, { color: palette.success }]}>
            This check is complete. SKIMA will not ask you to upload the document it replaces.
          </Text>
        </View>
      ) : !automaticAvailable ? (
        <>
          <View style={[styles.fallbackBox, { backgroundColor: palette.warningSoft }]}>
            <FileWarning color={palette.warning} size={18} />
            <Text style={[styles.fallbackText, { color: palette.ink }]}>
              The secure check is temporarily unavailable.
              {canFallback
                ? " You can continue with accepted fallback evidence or retry later."
                : " Retry the secure check later before continuing."}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={isBusy}
            onPress={() => void startVerification()}
            style={({ pressed }) => [
              styles.secondary,
              {
                backgroundColor: palette.surfaceSubtle,
                borderColor: palette.border,
              },
              pressed && styles.pressed,
              isBusy && styles.disabled,
            ]}
          >
            {start.isPending ? (
              <ActivityIndicator color={palette.brand} />
            ) : (
              <>
                <RefreshCw color={palette.brand} size={16} strokeWidth={2.4} />
                <Text style={[styles.secondaryText, { color: palette.brand }]}>Retry secure verification</Text>
              </>
            )}
          </Pressable>
        </>
      ) : (
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            disabled={isBusy}
            onPress={() => void startVerification()}
            style={({ pressed }) => [
              styles.primary,
              { backgroundColor: palette.brand },
              pressed && styles.pressed,
              isBusy && styles.disabled,
            ]}
          >
            {start.isPending ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <>
                <ExternalLink color="#FFFFFF" size={17} strokeWidth={2.4} />
                <Text style={styles.primaryText}>
                  {sessionId ? "Open secure check" : "Start secure verification"}
                </Text>
              </>
            )}
          </Pressable>

          {sessionId ? (
            <Pressable
              accessibilityRole="button"
              disabled={isBusy || !resolvedApplicationId}
              onPress={() => void refreshVerification()}
              style={({ pressed }) => [
                styles.secondary,
                {
                  backgroundColor: palette.surfaceSubtle,
                  borderColor: palette.border,
                },
                pressed && styles.pressed,
                (isBusy || !resolvedApplicationId) && styles.disabled,
              ]}
            >
              {refresh.isPending ? (
                <ActivityIndicator color={palette.brand} />
              ) : (
                <>
                  <RefreshCw color={palette.brand} size={16} strokeWidth={2.4} />
                  <Text style={[styles.secondaryText, { color: palette.brand }]}>Check result</Text>
                </>
              )}
            </Pressable>
          ) : null}
        </View>
      )}

      {check?.failureMessage ? (
        <Text style={[styles.message, { color: palette.danger }]}>{check.failureMessage}</Text>
      ) : message ? (
        <Text style={[styles.message, { color: palette.mutedStrong }]}>{message}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
  },
  iconTile: {
    width: 38,
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
  },
  headingCopy: { flex: 1, minWidth: 0, gap: 3 },
  eyebrow: { ...typography.eyebrow, fontSize: 8 },
  title: { ...typography.subheading, fontSize: 14 },
  body: { ...typography.caption, fontSize: 10, lineHeight: 15 },
  providerPill: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: radii.pill,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  providerText: { ...typography.caption, fontSize: 9, fontWeight: "700" },
  actions: { gap: spacing.sm },
  primary: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  primaryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  secondary: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  secondaryText: { fontSize: 11, fontWeight: "900" },
  successBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: radii.md,
    padding: 9,
  },
  successText: { flex: 1, ...typography.caption, lineHeight: 17, fontWeight: "700" },
  fallbackBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: radii.md,
    padding: 9,
  },
  fallbackText: { flex: 1, ...typography.caption, lineHeight: 17, fontWeight: "700" },
  message: { ...typography.caption, lineHeight: 17, fontWeight: "700" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.993 }] },
  disabled: { opacity: 0.5 },
});
