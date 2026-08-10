import { router, useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useGatewayMutation } from "../api/gateway";
import { ActionResponseSchema, firstString } from "../api/records";
import { useSession } from "../session/SessionProvider";
import { draftStore } from "../storage/drafts";
import { colors, radii, spacing } from "../theme/tokens";
import { idempotencyKey } from "../utilities/idempotency";
import { Screen } from "./Screen";
export function DeliveryVerificationScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const session = useSession();
  const owner = session.context?.profile?.id ?? session.context?.user.id ?? "";
  const draftType = `customer-delivery-verification-${id ?? "unknown"}`;
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const mutation = useGatewayMutation({
    path: "/lpg/orders/delivery-challenge",
    schema: ActionResponseSchema,
    invalidate: [["orders"]],
  });
  useEffect(() => {
    if (!owner || !id) return;
    void draftStore.load(owner, draftType).then((draft) => {
      if (typeof draft?.values.challengeId === "string")
        setChallengeId(draft.values.challengeId);
    });
  }, [draftType, id, owner]);
  const request = async () => {
    if (!id || !session.context?.user.email) {
      setNotice("An order and verified account email are required.");
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
      if (typeof resultId !== "string")
        throw new Error("The backend did not return a challenge identifier.");
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
      setNotice("Verification code requested through the configured channel.");
    } catch (cause) {
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Verification could not be requested.",
      );
    }
  };
  const verify = async () => {
    if (!id || !challengeId || code.trim().length < 4) {
      setNotice("Enter the verification code.");
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
      setNotice("Delivery verified by the backend.");
      router.replace(`/(customer)/orders/${id}` as never);
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Verification failed.",
      );
    }
  };
  return (
    <Screen
      eyebrow="Secure handover"
      title="Delivery verification"
      action={
        <Pressable onPress={() => router.back()}>
          <Text style={styles.back}>Back</Text>
        </Pressable>
      }
    >
      <View style={styles.card}>
        <Text style={styles.title}>Customer confirmation</Text>
        <Text style={styles.body}>
          The backend binds this challenge to your account and order. A local
          code entry never completes delivery by itself.
        </Text>
        {!challengeId ? (
          <Pressable
            disabled={mutation.isPending}
            onPress={() => void request()}
            style={styles.primary}
          >
            {mutation.isPending ? (
              <ActivityIndicator color="white" />
            ) : (
              <Text style={styles.primaryText}>Request verification code</Text>
            )}
          </Pressable>
        ) : (
          <>
            <TextInput
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              placeholder="Verification code"
              placeholderTextColor={colors.muted}
              style={styles.input}
            />
            <Pressable
              disabled={mutation.isPending}
              onPress={() => void verify()}
              style={styles.primary}
            >
              {mutation.isPending ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text style={styles.primaryText}>Verify delivery</Text>
              )}
            </Pressable>
          </>
        )}
        {notice ? (
          <Text accessibilityRole="alert" style={styles.notice}>
            {notice}
          </Text>
        ) : null}
      </View>
    </Screen>
  );
}
const styles = StyleSheet.create({
  back: { color: colors.brand, fontWeight: "800" },
  card: {
    maxWidth: 620,
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: { color: colors.ink, fontSize: 20, fontWeight: "900" },
  body: { color: colors.muted, lineHeight: 22 },
  input: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingHorizontal: spacing.md,
    color: colors.ink,
    fontSize: 18,
    letterSpacing: 3,
  },
  primary: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontWeight: "900" },
  notice: { color: colors.success, fontWeight: "700" },
});
