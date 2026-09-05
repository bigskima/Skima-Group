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
import { colors, spacing } from "../theme/tokens";
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
  const wide = width >= 900;
  const dark = scheme === "dark";

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: dark ? "#0A0B0D" : "#F8F8F7" }]}>
      <LinearGradient
        colors={dark ? ["#0A0B0D", "#151012", "#0A0B0D"] : ["#FFFFFF", "#FFF7F7", "#F7F7F5"]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.brandGlow} />
      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={styles.outer}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.shell, wide && styles.shellWide]}>
          <View style={[styles.intro, wide && styles.introWide]}>
            <View style={styles.topRow}>
              <BrandMark compact />
              {action}
            </View>
            <View style={styles.introCopy}>
              <Text style={styles.product}>SKIMA LPG</Text>
              <Text style={[styles.promise, { color: palette.ink }]}>
                LPG refill and delivery, coordinated in one place.
              </Text>
              <Text style={[styles.promiseBody, { color: palette.muted }]}>
                Order as a customer, work as an approved driver, or operate an approved station from the same protected account.
              </Text>
            </View>
            {wide ? (
              <Text style={[styles.securityNote, { color: palette.muted }]}>
                Secure account access • Role-based workspaces • Protected recovery
              </Text>
            ) : null}
          </View>

          <View style={[styles.formPane, wide && styles.formPaneWide]}>
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

const styles = StyleSheet.create({
  safe: { flex: 1 },
  brandGlow: {
    position: "absolute",
    right: -150,
    top: -170,
    width: 390,
    height: 390,
    borderRadius: 195,
    backgroundColor: "rgba(237,28,46,.08)",
  },
  outer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 22,
    paddingVertical: 28,
  },
  shell: { width: "100%", maxWidth: 1040, gap: 36 },
  shellWide: { minHeight: 620, flexDirection: "row", alignItems: "center", gap: 84 },
  intro: { gap: spacing.xl },
  introWide: { flex: 1, justifyContent: "space-between", alignSelf: "stretch", paddingVertical: 36 },
  topRow: { minHeight: 48, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.md },
  introCopy: { maxWidth: 500, gap: 12 },
  product: {
    color: colors.brand,
    fontSize: 11,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  promise: {
    maxWidth: 520,
    fontSize: 36,
    lineHeight: 41,
    fontWeight: "900",
    letterSpacing: -1.1,
  },
  promiseBody: { maxWidth: 500, fontSize: 15, lineHeight: 23 },
  securityNote: { fontSize: 12, lineHeight: 18, fontWeight: "700" },
  formPane: { width: "100%", gap: 24 },
  formPaneWide: { flex: 0.78, maxWidth: 430 },
  heading: { gap: 8 },
  eyebrow: {
    color: colors.brand,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  title: {
    fontSize: 32,
    lineHeight: 37,
    fontWeight: "900",
    letterSpacing: -0.9,
  },
  body: { maxWidth: 420, fontSize: 14, lineHeight: 21 },
  form: { gap: 16 },
  footer: { paddingTop: 2 },
});
