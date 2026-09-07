import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  ArrowRight,
  BadgeCheck,
  ChevronRight,
  LockKeyhole,
  ShieldCheck,
  Sparkles,
  Truck,
  Warehouse,
} from "lucide-react-native";
import type { ReactNode } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "../../src/native/theme/ThemeProvider";
import { colors, radii, shadows } from "../../src/native/theme/tokens";
import { BrandMark } from "../../src/native/ui/BrandMark";

export default function Welcome() {
  const { palette, scheme } = useAppTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const dark = scheme === "dark";

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: dark ? "#08090B" : "#F7F7F8" }]}>
      <LinearGradient
        colors={
          dark
            ? ["#08090B", "#140B0E", "#090A0C"]
            : ["#FFFFFF", "#FFF5F6", "#F7F7F8"]
        }
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.heroOrb} />
      <View style={styles.heroOrbSmall} />

      <ScrollView contentContainerStyle={styles.outer} showsVerticalScrollIndicator={false}>
        <View style={[styles.shell, wide && styles.shellWide]}>
          <View style={[styles.hero, wide && styles.heroWide]}>
            <View style={styles.brandRow}>
              <View style={[styles.logoPlate, { backgroundColor: palette.surface }]}>
                <BrandMark compact />
              </View>
              <View>
                <Text style={[styles.brandName, { color: palette.ink }]}>SKIMA</Text>
                <Text style={[styles.brandSub, { color: palette.muted }]}>LPG network</Text>
              </View>
            </View>

            <View style={styles.copy}>
              <View style={styles.kickerRow}>
                <Sparkles color={palette.brand} size={14} strokeWidth={2.5} />
                <Text style={[styles.kicker, { color: palette.brand }]}>
                  ONE ACCOUNT · REAL LPG OPERATIONS
                </Text>
              </View>
              <Text style={[styles.title, !wide && styles.titleMobile, { color: palette.ink }]}>
                Your LPG journey, coordinated from pickup to return.
              </Text>
              <Text style={[styles.body, { color: palette.muted }]}>
                Request refills, follow your cylinder, work approved delivery jobs, or operate an approved station without juggling separate accounts.
              </Text>
            </View>

            <View style={[styles.trustStrip, { borderColor: palette.border }]}>
              <TrustPoint icon={<LockKeyhole color={palette.success} size={15} />} text="Protected account" />
              <TrustPoint icon={<BadgeCheck color={palette.success} size={15} />} text="Role-based access" />
              <TrustPoint icon={<ShieldCheck color={palette.success} size={15} />} text="Audited operations" />
            </View>
          </View>

          <BlurView
            intensity={dark ? 24 : 70}
            tint={dark ? "dark" : "light"}
            style={[
              styles.entryCard,
              shadows.floating,
              {
                borderColor: dark ? "rgba(255,255,255,.10)" : "rgba(25,25,27,.08)",
                backgroundColor: dark ? "rgba(18,18,21,.88)" : "rgba(255,255,255,.88)",
              },
            ]}
          >
            <View style={styles.entryAccent} />
            <View style={styles.entryHeading}>
              <Text style={styles.entryEyebrow}>Choose how to continue</Text>
              <Text style={[styles.entryTitle, { color: palette.ink }]}>Your SKIMA account starts here.</Text>
              <Text style={[styles.entryBody, { color: palette.muted }]}>
                Everyone starts with customer access. Driver and station workspaces appear only after approval.
              </Text>
            </View>

            <View style={styles.roles}>
              <RoleCard
                icon={<ShieldCheck color={palette.brand} size={19} />}
                title="Customer"
                body="Refill, wallet, tracking"
                note="Available after account creation"
              />
              <RoleCard
                icon={<Truck color={palette.brand} size={19} />}
                title="Driver"
                body="Pickup and delivery work"
                note="Requires approved driver application"
              />
              <RoleCard
                icon={<Warehouse color={palette.brand} size={19} />}
                title="Station"
                body="Refill and settlement"
                note="Requires approved station access"
              />
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(auth)/register")}
              style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
            >
              <LinearGradient
                colors={[colors.brand, "#F33C4E", colors.brandDark]}
                end={{ x: 1, y: 1 }}
                start={{ x: 0, y: 0 }}
                style={styles.primaryFill}
              >
                <Text style={styles.primaryText}>Create my SKIMA account</Text>
                <View style={styles.primaryIcon}>
                  <ArrowRight color="#FFFFFF" size={17} strokeWidth={2.5} />
                </View>
              </LinearGradient>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              onPress={() => router.push("/(auth)/login")}
              style={({ pressed }) => [
                styles.secondary,
                { borderColor: palette.border, backgroundColor: palette.surfaceSubtle },
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.secondaryText, { color: palette.ink }]}>I already have an account</Text>
              <ChevronRight color={palette.mutedStrong} size={18} />
            </Pressable>

            <Text style={[styles.note, { color: palette.muted }]}>
              After sign-in, SKIMA loads the policy and guided onboarding that apply to your actual workspace.
            </Text>
          </BlurView>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function RoleCard({
  icon,
  title,
  body,
  note,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly body: string;
  readonly note: string;
}) {
  const { palette } = useAppTheme();

  return (
    <View style={[styles.role, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
      <View style={[styles.roleIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <View style={styles.roleCopy}>
        <Text style={[styles.roleTitle, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.roleBody, { color: palette.mutedStrong }]}>{body}</Text>
        <Text style={[styles.roleNote, { color: palette.muted }]}>{note}</Text>
      </View>
    </View>
  );
}

function TrustPoint({ icon, text }: { readonly icon: ReactNode; readonly text: string }) {
  const { palette } = useAppTheme();

  return (
    <View style={styles.trustPoint}>
      {icon}
      <Text style={[styles.trustText, { color: palette.mutedStrong }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  heroOrb: {
    position: "absolute",
    width: 500,
    height: 500,
    borderRadius: 250,
    right: -260,
    top: -210,
    backgroundColor: "rgba(226,29,47,.13)",
  },
  heroOrbSmall: {
    position: "absolute",
    width: 270,
    height: 270,
    borderRadius: 135,
    left: -170,
    bottom: -110,
    backgroundColor: "rgba(226,29,47,.055)",
  },
  outer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 17,
    paddingVertical: 22,
  },
  shell: { width: "100%", maxWidth: 1120, gap: 28 },
  shellWide: { minHeight: 690, flexDirection: "row", alignItems: "center", gap: 72 },
  hero: { gap: 24 },
  heroWide: { flex: 1.05, gap: 34 },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 11 },
  logoPlate: {
    width: 53,
    height: 53,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,.04)",
  },
  brandName: { fontSize: 15, lineHeight: 18, fontWeight: "900", letterSpacing: 1.15 },
  brandSub: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
  copy: { maxWidth: 610, gap: 13 },
  kickerRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  kicker: { fontSize: 9, lineHeight: 13, fontWeight: "900", letterSpacing: 1.15 },
  title: {
    fontSize: 49,
    lineHeight: 52,
    fontWeight: "900",
    letterSpacing: -1.8,
  },
  titleMobile: { fontSize: 32, lineHeight: 36, letterSpacing: -1.05 },
  body: { maxWidth: 580, fontSize: 15, lineHeight: 23, fontWeight: "500" },
  trustStrip: {
    maxWidth: 600,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    borderTopWidth: 1,
    paddingTop: 15,
  },
  trustPoint: { flexDirection: "row", alignItems: "center", gap: 6 },
  trustText: { fontSize: 9, lineHeight: 13, fontWeight: "700" },
  entryCard: {
    overflow: "hidden",
    width: "100%",
    maxWidth: 480,
    gap: 17,
    borderWidth: 1,
    borderRadius: 30,
    padding: 18,
  },
  entryAccent: {
    position: "absolute",
    top: 0,
    left: 28,
    right: 28,
    height: 2,
    backgroundColor: colors.brand,
  },
  entryHeading: { gap: 7 },
  entryEyebrow: {
    color: colors.brand,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "900",
    letterSpacing: 1.15,
    textTransform: "uppercase",
  },
  entryTitle: { fontSize: 28, lineHeight: 32, fontWeight: "900", letterSpacing: -0.75 },
  entryBody: { fontSize: 11, lineHeight: 17, fontWeight: "500" },
  roles: { gap: 8 },
  role: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 11,
  },
  roleIcon: {
    width: 39,
    height: 39,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  roleCopy: { flex: 1, minWidth: 0, gap: 1 },
  roleTitle: { fontSize: 11, lineHeight: 15, fontWeight: "900" },
  roleBody: { fontSize: 9, lineHeight: 13, fontWeight: "800" },
  roleNote: { fontSize: 8, lineHeight: 12, fontWeight: "600" },
  primary: {
    minHeight: 60,
    overflow: "hidden",
    borderRadius: radii.lg,
    ...shadows.raised,
  },
  primaryFill: {
    minHeight: 60,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
  },
  primaryText: { color: "#FFFFFF", fontSize: 14, lineHeight: 19, fontWeight: "900" },
  primaryIcon: {
    width: 29,
    height: 29,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,.16)",
  },
  secondary: {
    minHeight: 55,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderRadius: radii.lg,
  },
  secondaryText: { fontSize: 12, lineHeight: 17, fontWeight: "900" },
  note: { fontSize: 9, lineHeight: 14, textAlign: "center", fontWeight: "600" },
  pressed: { opacity: 0.78, transform: [{ scale: 0.993 }] },
});
