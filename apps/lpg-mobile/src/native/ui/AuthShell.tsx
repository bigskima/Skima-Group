import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { useAppTheme } from "../theme/ThemeProvider";
import { colors, shadows } from "../theme/tokens";
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
  const { palette, scheme } = useAppTheme();
  const { width } = useWindowDimensions();
  const compact = width < 520;
  const dark = scheme === "dark";

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: dark ? "#090A0C" : "#F8F8F9" }]}>
      <LinearGradient
        colors={dark ? ["#08090B", "#130B0E", "#090A0C"] : ["#FFFFFF", "#FFF6F7", "#F8F8F9"]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.glow} />

      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.outer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.shell, compact && styles.shellCompact]}>
          <View style={styles.brandBar}>
            <View style={[styles.logoPlate, { backgroundColor: palette.surface, borderColor: palette.border }]}>
              <BrandMark compact />
            </View>
            <View style={styles.brandCopy}>
              <Text style={[styles.brandName, { color: palette.ink }]}>SKIMA</Text>
              <Text style={[styles.brandCaption, { color: palette.muted }]}>LPG</Text>
            </View>
            {action ? <View style={styles.action}>{action}</View> : null}
          </View>

          <BlurView
            intensity={dark ? 22 : 64}
            tint={dark ? "dark" : "light"}
            style={[
              styles.card,
              shadows.floating,
              {
                borderColor: dark ? "rgba(255,255,255,.10)" : "rgba(25,25,27,.08)",
                backgroundColor: dark ? "rgba(18,18,21,.90)" : "rgba(255,255,255,.90)",
              },
            ]}
          >
            <View style={styles.accent} />
            <View style={styles.heading}>
              <Text style={styles.eyebrow}>{eyebrow}</Text>
              <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
              <Text style={[styles.body, { color: palette.muted }]}>{body}</Text>
            </View>

            <View style={styles.form}>{children}</View>

            {footer ? (
              <>
                <View style={[styles.divider, { backgroundColor: palette.border }]} />
                <View style={styles.footer}>{footer}</View>
              </>
            ) : null}
          </BlurView>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  glow: {
    position: "absolute",
    width: 390,
    height: 390,
    borderRadius: 195,
    right: -210,
    top: -190,
    backgroundColor: "rgba(226,29,47,.12)",
  },
  outer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 28,
  },
  shell: { width: "100%", maxWidth: 460, gap: 18 },
  shellCompact: { gap: 14 },
  brandBar: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  logoPlate: {
    width: 48,
    height: 48,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
  },
  brandCopy: { gap: 1 },
  brandName: { fontSize: 15, lineHeight: 18, fontWeight: "900", letterSpacing: 1.1 },
  brandCaption: { fontSize: 10, lineHeight: 13, fontWeight: "700", letterSpacing: 1.4 },
  action: { position: "absolute", right: 0 },
  card: {
    overflow: "hidden",
    width: "100%",
    gap: 18,
    borderWidth: 1,
    borderRadius: 28,
    padding: 19,
  },
  accent: {
    position: "absolute",
    top: 0,
    left: 34,
    right: 34,
    height: 2,
    backgroundColor: colors.brand,
  },
  heading: { alignItems: "center", gap: 6, paddingHorizontal: 6 },
  eyebrow: {
    color: colors.brand,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "900",
    letterSpacing: 1.05,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 27,
    lineHeight: 32,
    fontWeight: "900",
    letterSpacing: -0.75,
    textAlign: "center",
  },
  body: {
    maxWidth: 360,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "500",
    textAlign: "center",
  },
  form: { gap: 15 },
  divider: { height: StyleSheet.hairlineWidth },
  footer: { paddingTop: 1 },
});
