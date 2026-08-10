import { router } from "expo-router";
import { MapPinned, ShieldCheck, Truck, Zap } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing } from "../../src/native/theme/tokens";
import { Screen } from "../../src/native/ui/Screen";

export default function Welcome() {
  return (
    <Screen eyebrow="SKIMA LPG" title="Safe refill fulfilment, end to end">
      <View style={styles.hero}>
        <View style={styles.brandMark}>
          <Zap color="white" fill="white" size={32} />
        </View>
        <Text style={styles.heroTitle}>
          Pickup, refill and return with verified operational evidence.
        </Text>
        <Text style={styles.heroBody}>
          Customers, approved drivers and approved stations work from one
          backend-authoritative LPG journey.
        </Text>
      </View>
      <View style={styles.features}>
        <Feature
          icon={<ShieldCheck color={colors.brand} size={24} />}
          title="Verified cylinder identity"
          body="QR identity, safety checks and evidence remain tied to the backend record."
        />
        <Feature
          icon={<MapPinned color={colors.brand} size={24} />}
          title="Authorised live progress"
          body="See approved station, assignment and location updates without invented ETAs."
        />
        <Feature
          icon={<Truck color={colors.brand} size={24} />}
          title="One controlled workflow"
          body="Payment, refill, delivery and settlement advance only through authorised actions."
        />
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(auth)/register")}
          style={styles.primary}
        >
          <Text style={styles.primaryText}>Create customer account</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(auth)/login")}
          style={styles.secondary}
        >
          <Text style={styles.secondaryText}>Sign in securely</Text>
        </Pressable>
      </View>
      <Text style={styles.note}>
        Driver and station workspaces require backend approval before they
        become available.
      </Text>
    </Screen>
  );
}

function Feature({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <View style={styles.feature}>
      <View style={styles.featureIcon}>{icon}</View>
      <View style={{ flex: 1, gap: 4 }}>
        <Text style={styles.featureTitle}>{title}</Text>
        <Text style={styles.featureBody}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: {
    minHeight: 300,
    justifyContent: "center",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.xl,
    overflow: "hidden",
    borderRadius: 30,
    backgroundColor: colors.brand,
  },
  brandMark: {
    width: 62,
    height: 62,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 31,
    backgroundColor: "rgba(255,255,255,.17)",
  },
  heroTitle: {
    maxWidth: 700,
    color: "white",
    fontSize: 30,
    lineHeight: 37,
    fontWeight: "900",
  },
  heroBody: {
    maxWidth: 680,
    color: "#FFF1F2",
    fontSize: 16,
    lineHeight: 24,
  },
  features: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  feature: {
    flex: 1,
    minWidth: 260,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
  },
  featureIcon: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 24,
    backgroundColor: "#FFF0F1",
  },
  featureTitle: { color: colors.ink, fontSize: 16, fontWeight: "900" },
  featureBody: { color: colors.muted, lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  primary: {
    minHeight: 56,
    flex: 1,
    minWidth: 240,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "white", fontSize: 16, fontWeight: "900" },
  secondary: {
    minHeight: 56,
    flex: 1,
    minWidth: 240,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    borderWidth: 1,
    borderColor: colors.brand,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  secondaryText: { color: colors.brand, fontSize: 16, fontWeight: "900" },
  note: { color: colors.muted, textAlign: "center", lineHeight: 20 },
});
