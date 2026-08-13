import { LinearGradient } from "expo-linear-gradient";
import { KeyRound, MapPinned, ShieldCheck } from "lucide-react-native";
import type { ComponentType, ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { BrandMark } from "./BrandMark";

export function AuthShell({
  eyebrow,
  title,
  body,
  action,
  children,
  footer,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  const { palette } = useAppTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 880;
  const dark = palette.scheme === "dark";

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: dark ? "#07110C" : "#F4F7F3" }]}>
      <LinearGradient
        colors={dark ? ["#07110C", "#101F17", "#07110C"] : ["#F8FBF6", "#EFF5EF", "#F8FBF6"]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.outer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.shell, wide && styles.shellWide]}>
          <LinearGradient
            colors={["#0B1510", "#16281E", "#241719"]}
            end={{ x: 1, y: 1 }}
            start={{ x: 0, y: 0 }}
            style={[styles.intro, wide && styles.introWide]}
          >
            <View style={styles.redGlow} />
            <View style={styles.goldGlow} />
            <View style={styles.brandTop}>
              <View style={styles.logoPlate}>
                <BrandMark compact inverse />
              </View>
              {action}
            </View>

            <View style={styles.introCopy}>
              <Text style={styles.introEyebrow}>SECURE LPG ACCESS</Text>
              <Text style={styles.introTitle}>
                Verified refill, delivery and station operations.
              </Text>
              <Text style={styles.introBody}>
                One protected account for customer orders, driver work and station activity.
              </Text>
            </View>

            <View style={styles.signalRow}>
              <Signal Icon={ShieldCheck} label="Protected login" />
              <Signal Icon={MapPinned} label="Live journey" />
              <Signal Icon={KeyRound} label="Safe recovery" />
            </View>
          </LinearGradient>

          <View
            style={[
              styles.card,
              wide && styles.cardWide,
              {
                backgroundColor: dark ? "rgba(20,33,25,.96)" : "#FFFFFF",
                borderColor: dark ? "#2A3A31" : "#DDE5DF",
                shadowColor: palette.shadow,
              },
            ]}
          >
            <View style={styles.cardBrand}>
              <BrandMark compact />
              <View style={styles.cardBrandText}>
                <Text style={styles.eyebrow}>{eyebrow}</Text>
                <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
              </View>
            </View>
            <Text style={[styles.body, { color: palette.muted }]}>{body}</Text>
            <View style={styles.form}>{children}</View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Signal({
  Icon,
  label,
}: {
  readonly Icon: ComponentType<{ color: string; size: number; strokeWidth?: number }>;
  readonly label: string;
}) {
  return (
    <View style={styles.signal}>
      <Icon color="#F8FBF7" size={15} strokeWidth={2.2} />
      <Text style={styles.signalText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  outer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 18,
  },
  shell: { width: "100%", maxWidth: 1080, gap: 14 },
  shellWide: { flexDirection: "row", alignItems: "stretch", gap: 18 },
  intro: {
    minHeight: 268,
    overflow: "hidden",
    justifyContent: "space-between",
    gap: spacing.lg,
    padding: 20,
    borderRadius: 32,
  },
  introWide: { flex: 1, minHeight: 580, padding: 28 },
  redGlow: {
    position: "absolute",
    right: -92,
    top: -96,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(237,28,46,.36)",
  },
  goldGlow: {
    position: "absolute",
    left: -78,
    bottom: -86,
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: "rgba(232,184,74,.16)",
  },
  brandTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  logoPlate: {
    width: 58,
    height: 58,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.14)",
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,.08)",
  },
  introCopy: { maxWidth: 460, gap: 10 },
  introEyebrow: {
    color: "#F8B6BE",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.5,
  },
  introTitle: {
    color: "white",
    fontSize: 34,
    lineHeight: 38,
    fontWeight: "900",
    letterSpacing: -0.9,
  },
  introBody: {
    color: "rgba(255,255,255,.70)",
    fontSize: 14,
    lineHeight: 21,
  },
  signalRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  signal: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.12)",
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,.10)",
  },
  signalText: {
    color: "rgba(255,255,255,.82)",
    fontSize: 11,
    fontWeight: "900",
  },
  card: {
    gap: 18,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 32,
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.1,
    shadowRadius: 30,
  },
  cardWide: { flex: 0.82, justifyContent: "center", padding: 28 },
  cardBrand: { flexDirection: "row", alignItems: "center", gap: 13 },
  cardBrandText: { flex: 1, gap: 3 },
  eyebrow: {
    color: colors.brand,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.3,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "900",
    letterSpacing: -0.8,
  },
  body: { fontSize: 14, lineHeight: 21 },
  form: { gap: 12 },
  footer: { paddingTop: 2 },
});
