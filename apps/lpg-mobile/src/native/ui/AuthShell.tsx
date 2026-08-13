import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, spacing } from "../theme/tokens";
import { BrandMark } from "./BrandMark";

export function AuthShell({ eyebrow, title, body, action, children, footer }: {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  const { palette } = useAppTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 840;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: palette.canvas }]}>
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.outer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.shell, wide && styles.shellWide]}>
          <View style={[styles.brandPanel, wide && styles.brandPanelWide]}>
            <LinearGradient
              colors={["#0D1712", "#1D3428"]}
              end={{ x: 1, y: 1 }}
              start={{ x: 0, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
            <View style={styles.brandGlow} />
            <View style={styles.brandTop}>
              <BrandMark inverse />
              {action}
            </View>
            <View style={styles.brandCopy}>
              <Text style={styles.brandKicker}>SECURE REFILL ACCESS</Text>
              <Text style={styles.brandTitle}>One account for customers, drivers and stations.</Text>
              <Text style={styles.brandBody}>Manage LPG refill journeys with verified identity, live status and protected account recovery.</Text>
            </View>
            <View style={styles.signalRow}>
              <Signal label="Protected" />
              <Signal label="Tracked" />
              <Signal label="Verified" />
            </View>
          </View>

          <View style={[styles.card, wide && styles.cardWide, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <View style={styles.mobileLogo}>
              <BrandMark />
            </View>
            <View style={styles.heading}>
              <Text style={styles.eyebrow}>{eyebrow}</Text>
              <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
              <Text style={[styles.body, { color: palette.muted }]}>{body}</Text>
            </View>
            <View style={styles.form}>{children}</View>
            {footer ? <View style={styles.footer}>{footer}</View> : null}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Signal({ label }: { readonly label: string }) {
  return (
    <View style={styles.signal}>
      <View style={styles.signalDot} />
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
  shell: { width: "100%", maxWidth: 1060, gap: 14 },
  shellWide: { flexDirection: "row", alignItems: "stretch", gap: 18 },
  brandPanel: {
    minHeight: 260,
    overflow: "hidden",
    justifyContent: "space-between",
    gap: spacing.lg,
    padding: 20,
    borderRadius: 30,
  },
  brandPanelWide: { flex: 1, minHeight: 560, padding: 26 },
  brandGlow: {
    position: "absolute",
    right: -100,
    top: -110,
    width: 260,
    height: 260,
    borderRadius: 130,
    backgroundColor: "rgba(237,28,46,.38)",
  },
  brandTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  brandCopy: { maxWidth: 430, gap: 10 },
  brandKicker: { color: "rgba(255,255,255,.62)", fontSize: 9, fontWeight: "900", letterSpacing: 1.5 },
  brandTitle: { color: "white", fontSize: 34, lineHeight: 38, fontWeight: "900", letterSpacing: -0.9 },
  brandBody: { color: "rgba(255,255,255,.68)", fontSize: 14, lineHeight: 21 },
  signalRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  signal: {
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 10,
    borderRadius: radii.pill,
    backgroundColor: "rgba(255,255,255,.10)",
  },
  signalDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  signalText: { color: "rgba(255,255,255,.76)", fontSize: 11, fontWeight: "900" },
  card: {
    gap: 18,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 30,
    shadowColor: "#09100C",
    shadowOffset: { width: 0, height: 16 },
    shadowOpacity: 0.08,
    shadowRadius: 28,
  },
  cardWide: { flex: 0.82, justifyContent: "center", padding: 26 },
  mobileLogo: { alignSelf: "flex-start" },
  heading: { gap: 7 },
  eyebrow: { color: colors.brand, fontSize: 10, fontWeight: "900", letterSpacing: 1.3 },
  title: { fontSize: 30, lineHeight: 34, fontWeight: "900", letterSpacing: -0.8 },
  body: { fontSize: 14, lineHeight: 21 },
  form: { gap: 12 },
  footer: { paddingTop: 2 },
});
