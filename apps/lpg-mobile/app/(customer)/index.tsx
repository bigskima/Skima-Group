import { router } from "expo-router";
import { ScanLine, ShieldCheck } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useAppTheme } from "../../src/native/theme/ThemeProvider";
import { radii, shadows, spacing } from "../../src/native/theme/tokens";
import { CustomerDashboard } from "../../src/native/ui/PremiumDashboard";

export default function CustomerHome() {
  const { palette } = useAppTheme();

  return (
    <View style={styles.root}>
      <CustomerDashboard />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Verify a SKIMA driver"
        onPress={() => router.push("/verify-driver?mode=scan" as never)}
        style={({ pressed }) => [
          styles.verifyCard,
          shadows.raised,
          {
            backgroundColor: palette.surface,
            borderColor: palette.brand,
            opacity: pressed ? 0.86 : 1,
          },
        ]}
      >
        <View style={[styles.icon, { backgroundColor: palette.brandSoft }]}>
          <ScanLine color={palette.brand} size={21} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: palette.ink }]}>Verify Driver</Text>
          <Text style={[styles.body, { color: palette.muted }]}>Scan the Driver Pass or enter the SKIMA Driver ID</Text>
        </View>
        <ShieldCheck color={palette.brand} size={20} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  verifyCard: {
    position: "absolute",
    right: spacing.md,
    bottom: 92,
    width: 280,
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderRadius: radii.lg,
  },
  icon: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
  },
  copy: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: "900" },
  body: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
});
