import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import type { ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
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
  readonly eyebrow?: string;
  readonly title: string;
  readonly body?: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
}) {
  const { palette, scheme } = useAppTheme();
  const { width } = useWindowDimensions();
  const compact = width < 520;
  const dark = scheme === "dark";

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: dark ? "#08090B" : "#F7F7F8" }]}>
      <LinearGradient
        colors={dark ? ["#07080A", "#120A0D", "#090A0C"] : ["#FFFFFF", "#FFF7F8", "#F5F5F7"]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={styles.glowPrimary} />
      <View pointerEvents="none" style={styles.glowSecondary} />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.keyboard}
      >
        <ScrollView
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={styles.outer}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.shell, compact && styles.shellCompact]}>
            <View style={styles.brandBar}>
              <View style={styles.brandRow}>
                <View
                  style={[
                    styles.logoPlate,
                    {
                      backgroundColor: palette.surface,
                      borderColor: palette.border,
                    },
                  ]}
                >
                  <BrandMark compact />
                </View>
                <View style={styles.brandCopy}>
                  <Text style={[styles.brandName, { color: palette.ink }]}>SKIMA</Text>
                  <Text style={[styles.brandCaption, { color: palette.muted }]}>LPG</Text>
                </View>
              </View>
              {action ? <View style={styles.action}>{action}</View> : null}
            </View>

            <BlurView
              intensity={dark ? 24 : 70}
              tint={dark ? "dark" : "light"}
              style={[
                styles.card,
                shadows.floating,
                {
                  borderColor: dark ? "rgba(255,255,255,.10)" : "rgba(25,25,27,.07)",
                  backgroundColor: dark ? "rgba(18,18,21,.92)" : "rgba(255,255,255,.92)",
                },
              ]}
            >
              <View pointerEvents="none" style={styles.accent} />

              <View style={styles.heading}>
                {eyebrow ? <Text style={styles.eyebrow}>{eyebrow}</Text> : null}
                <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
                {body ? <Text style={[styles.body, { color: palette.muted }]}>{body}</Text> : null}
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  keyboard: { flex: 1 },
  glowPrimary: {
    position: "absolute",
    width: 420,
    height: 420,
    borderRadius: 210,
    right: -225,
    top: -210,
    backgroundColor: "rgba(226,29,47,.13)",
  },
  glowSecondary: {
    position: "absolute",
    width: 280,
    height: 280,
    borderRadius: 140,
    left: -190,
    bottom: -130,
    backgroundColor: "rgba(226,29,47,.055)",
  },
  outer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 24,
  },
  shell: { width: "100%", maxWidth: 452, gap: 20 },
  shellCompact: { gap: 15 },
  brandBar: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoPlate: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
    borderWidth: StyleSheet.hairlineWidth,
  },
  brandCopy: { gap: 0 },
  brandName: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: "900",
    letterSpacing: 1.05,
  },
  brandCaption: {
    fontSize: 9,
    lineHeight: 12,
    fontWeight: "800",
    letterSpacing: 1.55,
  },
  action: { marginLeft: 16 },
  card: {
    overflow: "hidden",
    width: "100%",
    gap: 22,
    borderWidth: 1,
    borderRadius: 32,
    paddingHorizontal: 20,
    paddingTop: 27,
    paddingBottom: 21,
  },
  accent: {
    position: "absolute",
    top: 0,
    left: 44,
    right: 44,
    height: 2,
    backgroundColor: colors.brand,
  },
  heading: {
    gap: 7,
    paddingHorizontal: 2,
  },
  eyebrow: {
    color: colors.brand,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "900",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 31,
    lineHeight: 36,
    fontWeight: "900",
    letterSpacing: -1.05,
  },
  body: {
    maxWidth: 350,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "500",
  },
  form: { gap: 16 },
  divider: { height: StyleSheet.hairlineWidth },
  footer: { paddingTop: 1 },
});
