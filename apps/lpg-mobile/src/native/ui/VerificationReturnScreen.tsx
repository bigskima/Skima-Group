import { router, useLocalSearchParams } from "expo-router";
import { CheckCircle2, ShieldCheck } from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";

import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { Screen } from "./Screen";

export function VerificationReturnScreen() {
  const { palette } = useAppTheme();
  const params = useLocalSearchParams<{
    status?: string;
    session_id?: string;
    sessionId?: string;
  }>();

  const providerStatus = (params.status ?? "submitted").replace(/[_-]/g, " ");
  const providerSessionId = params.session_id ?? params.sessionId ?? null;

  return (
    <Screen
      eyebrow="Identity verification"
      title="Verification submitted"
      subtitle="You are back in SKIMA. We will confirm the result securely before updating your application."
    >
      <View
        style={[
          styles.hero,
          shadows.raised,
          { backgroundColor: palette.success },
        ]}
      >
        <View style={styles.heroIcon}>
          <CheckCircle2 color="#FFFFFF" size={30} />
        </View>
        <View style={styles.heroCopy}>
          <Text style={styles.heroEyebrow}>DIDIT FLOW COMPLETE</Text>
          <Text style={styles.heroTitle}>Welcome back to SKIMA</Text>
          <Text style={styles.heroBody}>
            Your identity session has returned to SKIMA. The provider redirect is not used as the final approval decision; SKIMA will use the secured verification result from the backend.
          </Text>
        </View>
      </View>

      <View
        style={[
          styles.card,
          shadows.soft,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ]}
      >
        <View style={[styles.iconTile, { backgroundColor: palette.brandSoft }]}>
          <ShieldCheck color={palette.brand} size={22} />
        </View>
        <View style={styles.cardCopy}>
          <Text style={[styles.cardTitle, { color: palette.ink }]}>Verification return received</Text>
          <Text style={[styles.cardBody, { color: palette.muted }]}>
            Provider status: {providerStatus}. Return to the application you were completing and use Check result if the verified state has not appeared yet.
          </Text>
          {providerSessionId ? (
            <Text numberOfLines={1} style={[styles.reference, { color: palette.mutedStrong }]}>
              Session: {providerSessionId}
            </Text>
          ) : null}
        </View>
      </View>

      <AppButton
        label="Return to driver application"
        fullWidth
        size="lg"
        onPress={() => router.replace("/(customer)/driver-application")}
      />
      <AppButton
        label="Return to station application"
        fullWidth
        variant="secondary"
        onPress={() => router.replace("/(customer)/station-application")}
      />
      <AppButton
        label="Go to account"
        fullWidth
        variant="ghost"
        onPress={() => router.replace("/(customer)/account")}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.lg,
    borderRadius: radii.xl,
  },
  heroIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,.14)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroCopy: { flex: 1, gap: 4 },
  heroEyebrow: { color: "rgba(255,255,255,.72)", ...typography.eyebrow, fontSize: 9 },
  heroTitle: { color: "#FFFFFF", ...typography.heading, fontSize: 20 },
  heroBody: { color: "rgba(255,255,255,.88)", ...typography.caption, lineHeight: 18 },
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.xl,
    padding: spacing.lg,
  },
  iconTile: {
    width: 44,
    height: 44,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  cardCopy: { flex: 1, minWidth: 0, gap: 5 },
  cardTitle: { ...typography.bodyStrong, fontSize: 14 },
  cardBody: { ...typography.caption, lineHeight: 18 },
  reference: { ...typography.caption, fontSize: 10 },
});
