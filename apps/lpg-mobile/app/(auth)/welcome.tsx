import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import { ArrowRight, ShieldCheck, Truck, Warehouse } from "lucide-react-native";
import type { ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppTheme } from "../../src/native/theme/ThemeProvider";
import { colors, radii, spacing } from "../../src/native/theme/tokens";
import { BrandMark } from "../../src/native/ui/BrandMark";

export default function Welcome() {
  const { palette, scheme } = useAppTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 860;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]}>
      <LinearGradient
        colors={scheme === "dark" ? ["#090A0C", "#190E11", "#090A0C"] : ["#FFFFFF", "#FFF5F6", "#F7F7F5"]}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.glow} />
      <ScrollView contentContainerStyle={styles.outer} showsVerticalScrollIndicator={false}>
        <View style={[styles.shell, wide && styles.shellWide]}>
          <View style={styles.brandRow}>
            <BrandMark compact />
            <Text style={[styles.brandText, { color: palette.ink }]}>SKIMA LPG</Text>
          </View>

          <View style={styles.copy}>
            <Text style={styles.kicker}>REFILL • DELIVERY • STATION OPERATIONS</Text>
            <Text style={[styles.title, { color: palette.ink }]}>Your LPG journey, coordinated.</Text>
            <Text style={[styles.body, { color: palette.muted }]}>
              Request refills, follow your cylinder, complete delivery work, or operate an approved station from one SKIMA account.
            </Text>
          </View>

          <View style={[styles.roles, wide && styles.rolesWide]}>
            <Role icon={<ShieldCheck color={colors.brand} size={20} />} title="Customer" body="Refills, tracking and wallet" />
            <Role icon={<Truck color={colors.brand} size={20} />} title="Driver" body="Approved delivery operations" />
            <Role icon={<Warehouse color={colors.brand} size={20} />} title="Station" body="Reception, refill and settlement" />
          </View>

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(auth)/register")}
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            >
              <Text style={styles.primaryText}>Create account</Text>
              <ArrowRight color="#FFFFFF" size={18} />
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(auth)/login")}
              style={({ pressed }) => [
                styles.secondary,
                { borderColor: palette.border, backgroundColor: palette.surface },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.secondaryText, { color: palette.ink }]}>Sign in</Text>
            </Pressable>
          </View>

          <Text style={[styles.note, { color: palette.muted }]}>
            After sign-in, SKIMA shows the policy that applies to your workspace, then guides you through the real app controls.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Role({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  const { palette } = useAppTheme();
  return (
    <View style={styles.role}>
      <View style={[styles.roleIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <View style={styles.roleCopy}>
        <Text style={[styles.roleTitle, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.roleBody, { color: palette.muted }]}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  glow: {
    position: "absolute",
    width: 430,
    height: 430,
    borderRadius: 215,
    right: -210,
    top: -170,
    backgroundColor: "rgba(237,28,46,.10)",
  },
  outer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 30,
  },
  shell: { width: "100%", maxWidth: 760, gap: 30 },
  shellWide: { paddingVertical: 28 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  brandText: { fontSize: 14, fontWeight: "900", letterSpacing: -0.2 },
  copy: { gap: 12 },
  kicker: { color: colors.brand, fontSize: 10, fontWeight: "900", letterSpacing: 1.25 },
  title: { maxWidth: 650, fontSize: 42, lineHeight: 47, fontWeight: "900", letterSpacing: -1.35 },
  body: { maxWidth: 620, fontSize: 16, lineHeight: 24 },
  roles: { gap: 10 },
  rolesWide: { flexDirection: "row" },
  role: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: 6 },
  roleIcon: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  roleCopy: { flex: 1, minWidth: 0, gap: 2 },
  roleTitle: { fontSize: 13, fontWeight: "900" },
  roleBody: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
  actions: { gap: 10 },
  primary: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: radii.lg,
    backgroundColor: colors.brand,
  },
  primaryText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  secondary: {
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radii.lg,
  },
  secondaryText: { fontSize: 14, fontWeight: "900" },
  note: { maxWidth: 600, fontSize: 10, lineHeight: 16 },
  pressed: { opacity: 0.76 },
});
