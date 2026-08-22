import { router, useLocalSearchParams } from "expo-router";
import { CheckCircle2, KeyRound, ShieldCheck } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, firstString } from "../api/records";
import { useSession } from "../session/SessionProvider";
import { draftStore } from "../storage/drafts";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { friendlyError } from "../utilities/friendlyError";
import { idempotencyKey } from "../utilities/idempotency";
import { AppButton } from "./AppButton";
import { Screen } from "./Screen";

type NoticeTone = "success" | "error" | "neutral";

export function DeliveryVerificationScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const session = useSession();
  const { palette } = useAppTheme();
  const owner = session.context?.profile?.id ?? session.context?.user.id ?? "";
  const draftType = `customer-delivery-verification-${id ?? "unknown"}`;
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<NoticeTone>("neutral");

  const mutation = useGatewayMutation({
    path: "/lpg/orders/delivery-challenge",
    schema: ActionResponseSchema,
    invalidate: [["orders"]],
  });

  useEffect(() => {
    if (!owner || !id) return;
    void draftStore.load(owner, draftType).then((draft) => {
      if (typeof draft?.values.challengeId === "string") {
        setChallengeId(draft.values.challengeId);
      }
    });
  }, [draftType, id, owner]);

  const request = async () => {
    setNotice(null);
    if (!id || !session.context?.user.email) {
      setNoticeTone("error");
      setNotice("A valid order and verified account email are required.");
      return;
    }

    try {
      const result = await mutation.mutateAsync({
        action: "request",
        lpgOrderId: id,
        channel: "in_app",
        recipientAddress: session.context.user.email,
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("delivery-challenge", id),
      });
      const resultId =
        typeof result === "string"
          ? result
          : firstString(result, ["id", "challengeId", "challenge_id"]);

      if (typeof resultId !== "string") {
        throw new Error("A verification code could not be created. Please try again.");
      }

      setChallengeId(resultId);
      const now = new Date().toISOString();
      await draftStore.save({
        version: 1,
        type: draftType,
        ownerProfileId: owner,
        workflowId: id,
        step: "challenge-issued",
        values: { challengeId: resultId },
        pendingMedia: [],
        createdAt: now,
        updatedAt: now,
      });
      setNoticeTone("success");
      setNotice("Your verification code is ready in SKIMA.");
    } catch (cause) {
      setNoticeTone("error");
      setNotice(friendlyError(cause, "The verification code could not be created."));
    }
  };

  const verify = async () => {
    setNotice(null);
    if (!id || !challengeId || code.trim().length < 4) {
      setNoticeTone("error");
      setNotice("Enter the verification code for this delivery.");
      return;
    }

    try {
      await mutation.mutateAsync({
        action: "verify",
        lpgOrderId: id,
        challengeId,
        code: code.trim(),
        source: "skima.lpg.mobile",
        idempotencyKey: idempotencyKey("delivery-verify", challengeId),
      });
      await draftStore.clear(owner, draftType);
      setNoticeTone("success");
      setNotice("Delivery confirmed successfully.");
      router.replace(`/(customer)/orders/${id}/feedback` as never);
    } catch (cause) {
      setNoticeTone("error");
      setNotice(
        friendlyError(cause, "Delivery could not be confirmed. Check the code and try again."),
      );
    }
  };

  const noticeBackground =
    noticeTone === "success"
      ? palette.successSoft
      : noticeTone === "error"
        ? palette.dangerSoft
        : palette.surfaceSubtle;
  const noticeColor =
    noticeTone === "success"
      ? palette.success
      : noticeTone === "error"
        ? palette.danger
        : palette.mutedStrong;

  return (
    <Screen
      eyebrow="Secure hand-over"
      title="Confirm your delivery"
      subtitle="Complete this final check only after your cylinder has been returned to you."
      action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
    >
      <View style={[styles.hero, shadows.raised, { backgroundColor: palette.brand }]}>
        <View style={styles.heroIcon}>
          <ShieldCheck color="#FFFFFF" size={27} />
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.heroEyebrow}>SKIMA SECURE DELIVERY</Text>
          <Text style={styles.heroTitle}>Confirm only when the cylinder is with you</Text>
          <Text style={styles.heroBody}>
            Verification completes the hand-over and allows the order lifecycle to move to its confirmed delivery state.
          </Text>
        </View>
      </View>

      <View style={[styles.stepCard, shadows.soft, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={[styles.stepIcon, { backgroundColor: challengeId ? palette.successSoft : palette.brandSoft }]}>
          {challengeId ? (
            <CheckCircle2 color={palette.success} size={22} />
          ) : (
            <KeyRound color={palette.brand} size={22} />
          )}
        </View>
        <View style={styles.stepCopy}>
          <Text style={[styles.stepTitle, { color: palette.ink }]}>
            {challengeId ? "Verification code ready" : "Get your verification code"}
          </Text>
          <Text style={[styles.stepBody, { color: palette.muted }]}>
            {challengeId
              ? "Enter the code generated for this order. It can only be used for this delivery confirmation."
              : "Request a code for this order before confirming the hand-over."}
          </Text>
        </View>
      </View>

      {!challengeId ? (
        <AppButton
          label="Get verification code"
          fullWidth
          size="lg"
          loading={mutation.isPending}
          icon={<KeyRound color="#FFFFFF" size={18} />}
          onPress={() => void request()}
        />
      ) : (
        <View style={[styles.codeCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <Text style={[styles.fieldLabel, { color: palette.ink }]}>Verification code</Text>
          <TextInput
            accessibilityLabel="Delivery verification code"
            value={code}
            onChangeText={setCode}
            keyboardType="number-pad"
            autoComplete="one-time-code"
            placeholder="••••••"
            placeholderTextColor={palette.muted}
            maxLength={8}
            style={[
              styles.input,
              { backgroundColor: palette.input, borderColor: palette.borderStrong, color: palette.ink },
            ]}
          />
          <Text style={[styles.hint, { color: palette.muted }]}>Check the code carefully before confirming the delivery.</Text>
          <AppButton
            label="Confirm delivery"
            fullWidth
            size="lg"
            loading={mutation.isPending}
            disabled={code.trim().length < 4}
            icon={<CheckCircle2 color="#FFFFFF" size={18} />}
            onPress={() => void verify()}
          />
          <AppButton
            label="Request a new code"
            variant="ghost"
            fullWidth
            disabled={mutation.isPending}
            onPress={() => void request()}
          />
        </View>
      )}

      {notice ? (
        <View style={[styles.notice, { backgroundColor: noticeBackground }]}> 
          <Text accessibilityRole="alert" style={[styles.noticeText, { color: noticeColor }]}>{notice}</Text>
        </View>
      ) : null}

      <View style={[styles.safety, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
        <ShieldCheck color={palette.mutedStrong} size={18} />
        <Text style={[styles.safetyText, { color: palette.muted }]}>Do not share this code with anyone who is not completing this specific SKIMA delivery with you.</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    borderRadius: radii.xl,
    padding: spacing.lg,
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: { flex: 1, gap: 5 },
  heroEyebrow: { color: "rgba(255,255,255,.76)", ...typography.eyebrow, fontSize: 9 },
  heroTitle: { color: "#FFFFFF", ...typography.heading, fontSize: 20 },
  heroBody: { color: "rgba(255,255,255,.84)", ...typography.caption, lineHeight: 19 },
  stepCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.lg,
  },
  stepIcon: { width: 46, height: 46, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  stepCopy: { flex: 1, gap: 4 },
  stepTitle: { ...typography.subheading },
  stepBody: { ...typography.body, fontSize: 13, lineHeight: 19 },
  codeCard: {
    gap: spacing.sm + 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.lg,
  },
  fieldLabel: { ...typography.caption, fontSize: 13, fontWeight: "900" },
  input: {
    minHeight: 62,
    borderWidth: 1,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 8,
    textAlign: "center",
  },
  hint: { ...typography.caption, textAlign: "center" },
  notice: { padding: spacing.md, borderRadius: radii.md },
  noticeText: { ...typography.caption, fontWeight: "800", textAlign: "center" },
  safety: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm + 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
    padding: spacing.md,
  },
  safetyText: { flex: 1, ...typography.caption, lineHeight: 18 },
});