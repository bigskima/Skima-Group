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
  const [message, setMessage] = useState<string | null>(null);
  const status = check?.status ?? "not_started";
  const sessionId = check?.sessionId ?? localSessionId;
  const passed = status === "passed";
  const automaticAvailable = check?.automaticAvailable ?? true;
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

      const result = await start.mutateAsync({
        applicationId: resolvedApplicationId,
        verificationKey,
        idempotencyKey: idempotencyKey(
          "verification-start",
          `${resolvedApplicationId}:${verificationKey}`,
        ),
      });

      setLocalSessionId(result.id);
      if (result.verificationUrl) {
        const supported = await Linking.canOpenURL(result.verificationUrl);
        if (!supported) throw new Error("The secure verification page could not be opened.");
        await Linking.openURL(result.verificationUrl);
        setMessage("Complete the secure check, return to SKIMA, then tap Check result.");
      } else {
        setMessage("Verification session started. Tap Check result after completing the provider flow.");
      }
    } catch (cause) {
      setMessage(
        friendlyError(
          cause,
          canFallback
            ? "Automatic verification is unavailable right now. Use the fallback evidence below."
            : "Automatic verification could not be started. Please try again.",
        ),
      );
    }
  };

  const refreshVerification = async () => {
    setMessage(null);
    try {
      const resolvedApplicationId = applicationId;
      if (!resolvedApplicationId || !sessionId) {
        throw new Error("Start the verification check before refreshing its result.");
      }

      const result = await refresh.mutateAsync({
        applicationId: resolvedApplicationId,
        sessionId,
        idempotencyKey: idempotencyKey(
          "verification-refresh",
          `${resolvedApplicationId}:${verificationKey}:${sessionId}`,
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
                : "FALLBACK AVAILABLE"}
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
      ) : !automaticAvailable && check ? (
        <View style={[styles.fallbackBox, { backgroundColor: palette.warningSoft }]}>
          <FileWarning color={palette.warning} size={18} />
          <Text style={[styles.fallbackText, { color: palette.ink }]}>
            Automatic verification is not configured for this check yet.
            {canFallback ? " Use the fallback evidence shown below." : " Try again later."}
          </Text>
        </View>
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
              disabled={isBusy || !applicationId}
              onPress={() => void refreshVerification()}
              style={({ pressed }) => [
                styles.secondary,
                {
                  backgroundColor: palette.surfaceSubtle,
                  borderColor: palette.border,
                },
                pressed && styles.pressed,
                (isBusy || !applicationId) && styles.disabled,
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
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.lg,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
  },
  iconTile: {
    width: 46,
    height: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  headingCopy: { flex: 1, minWidth: 0, gap: 3 },
  eyebrow: { ...typography.eyebrow, fontSize: 8 },
  title: { ...typography.subheading, fontSize: 16 },
  body: { ...typography.caption, lineHeight: 18 },
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
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
  },
  primaryText: { color: "#FFFFFF", fontSize: 12, fontWeight: "900" },
  secondary: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.md,
  },
  secondaryText: { fontSize: 11, fontWeight: "900" },
  successBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  successText: { flex: 1, ...typography.caption, lineHeight: 17, fontWeight: "700" },
  fallbackBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  fallbackText: { flex: 1, ...typography.caption, lineHeight: 17, fontWeight: "700" },
  message: { ...typography.caption, lineHeight: 17, fontWeight: "700" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.993 }] },
  disabled: { opacity: 0.5 },
});
