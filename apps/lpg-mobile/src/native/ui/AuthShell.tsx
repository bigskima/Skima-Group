import { BlurView } from "expo-blur";
import { LinearGradient } from "expo-linear-gradient";
import { router } from "expo-router";
import {
  Check,
  CircleAlert,
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

import type { AuthRuntimeState } from "../session/authRuntime";
import { useAppTheme } from "../theme/ThemeProvider";
import { colors, radii, shadows, spacing } from "../theme/tokens";
import { BrandMark } from "./BrandMark";

type AuthMode = "login" | "register";

export function AuthShell({
  eyebrow,
  title,
  body,
  action,
  children,
  footer,
  activeMode,
  runtimeStatus,
  runtimeMessage,
}: {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly activeMode?: AuthMode;
  readonly runtimeStatus?: AuthRuntimeState;
  readonly runtimeMessage?: string | null;
}) {
  const { palette, scheme } = useAppTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 920;
  const dark = scheme === "dark";

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: dark ? "#090A0C" : "#F7F7F8" }]}>
      <LinearGradient
        colors={
          dark
            ? ["#08090B", "#140B0E", "#0B0C0F", "#08090B"]
            : ["#FFFFFF", "#FFF6F7", "#F7F7F8", "#FFFFFF"]
        }
        locations={[0, 0.34, 0.72, 1]}
        end={{ x: 1, y: 1 }}
        start={{ x: 0, y: 0 }}
        style={StyleSheet.absoluteFill}
      />

      <View style={styles.orbPrimary} />
      <View style={styles.orbSecondary} />
      <View style={[styles.gridLine, styles.gridLineOne]} />
      <View style={[styles.gridLine, styles.gridLineTwo]} />

      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.outer, wide && styles.outerWide]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={[styles.shell, wide && styles.shellWide]}>
          <View style={[styles.hero, wide && styles.heroWide]}>
            <View style={styles.brandRow}>
              <View style={[styles.brandBadge, { backgroundColor: dark ? "rgba(255,255,255,.06)" : "rgba(255,255,255,.78)" }]}>
                <BrandMark compact />
              </View>
              <View style={styles.brandCopy}>
                <Text style={[styles.brandName, { color: palette.ink }]}>SKIMA</Text>
                <Text style={[styles.brandDescriptor, { color: palette.muted }]}>LPG network</Text>
              </View>
              <View style={styles.brandAction}>{action}</View>
            </View>

            <View style={[styles.heroCopy, !wide && styles.heroCopyMobile]}>
              <View style={styles.heroEyebrow}>
                <Sparkles color={palette.brand} size={14} strokeWidth={2.5} />
                <Text style={[styles.heroEyebrowText, { color: palette.brand }]}>
                  ONE IDENTITY · EVERY SKIMA WORKSPACE
                </Text>
              </View>

              <Text style={[styles.promise, !wide && styles.promiseMobile, { color: palette.ink }]}>
                Refill, deliver and operate with one secure account.
              </Text>

              <Text style={[styles.promiseBody, !wide && styles.promiseBodyMobile, { color: palette.muted }]}>
                Customers, approved drivers and approved stations move through the same protected SKIMA account without mixing permissions.
              </Text>
            </View>

            <View style={[styles.roleRail, wide && styles.roleRailWide]}>
              <RoleSignal
                icon={<ShieldCheck color={palette.brand} size={17} />}
                title="Customer"
                body="Order & track"
              />
              <RoleSignal
                icon={<Truck color={palette.brand} size={17} />}
                title="Driver"
                body="Approved jobs"
              />
              <RoleSignal
                icon={<Warehouse color={palette.brand} size={17} />}
                title="Station"
                body="Operate & settle"
              />
            </View>

            {wide ? (
              <View style={[styles.securityStrip, { borderColor: palette.border }]}>
                <LockKeyhole color={palette.mutedStrong} size={16} />
                <Text style={[styles.securityStripText, { color: palette.muted }]}>
                  Supabase authentication · role-scoped workspaces · protected account recovery
                </Text>
              </View>
            ) : null}
          </View>

          <View style={[styles.formColumn, wide && styles.formColumnWide]}>
            <BlurView
              intensity={dark ? 24 : 68}
              tint={dark ? "dark" : "light"}
              style={[
                styles.formCard,
                shadows.floating,
                {
                  borderColor: dark ? "rgba(255,255,255,.10)" : "rgba(25,25,27,.08)",
                  backgroundColor: dark ? "rgba(18,18,21,.88)" : "rgba(255,255,255,.86)",
                },
              ]}
            >
              <View style={styles.formCardAccent} />

              {activeMode ? <AuthModeTabs activeMode={activeMode} /> : null}

              <View style={styles.heading}>
                <View style={styles.headingTopline}>
                  <Text style={styles.eyebrow}>{eyebrow}</Text>
                  <RuntimeBadge status={runtimeStatus} />
                </View>
                <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
                <Text style={[styles.body, { color: palette.muted }]}>{body}</Text>
              </View>

              {runtimeStatus === "unavailable" && runtimeMessage ? (
                <View
                  accessibilityRole="alert"
                  style={[
                    styles.runtimeAlert,
                    {
                      backgroundColor: palette.dangerSoft,
                      borderColor: palette.danger + "3D",
                    },
                  ]}
                >
                  <CircleAlert color={palette.danger} size={17} />
                  <Text style={[styles.runtimeAlertText, { color: palette.danger }]}>
                    {runtimeMessage}
                  </Text>
                </View>
              ) : null}

              <View style={styles.form}>{children}</View>
              {footer ? (
                <>
                  <View style={[styles.footerDivider, { backgroundColor: palette.border }]} />
                  <View style={styles.footer}>{footer}</View>
                </>
              ) : null}
            </BlurView>

            <View style={styles.privacyRow}>
              <Check color={palette.success} size={14} strokeWidth={2.7} />
              <Text style={[styles.privacyText, { color: palette.muted }]}>
                SKIMA never asks for your password outside this secure account screen.
              </Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function AuthModeTabs({ activeMode }: { readonly activeMode: AuthMode }) {
  const { palette } = useAppTheme();

  return (
    <View style={[styles.tabs, { backgroundColor: palette.soft, borderColor: palette.border }]}>
      <AuthModeTab
        active={activeMode === "login"}
        label="Sign in"
        onPress={() => router.replace("/(auth)/login")}
      />
      <AuthModeTab
        active={activeMode === "register"}
        label="Create account"
        onPress={() => router.replace("/(auth)/register")}
      />
    </View>
  );
}

function AuthModeTab({
  active,
  label,
  onPress,
}: {
  readonly active: boolean;
  readonly label: string;
  readonly onPress: () => void;
}) {
  const { palette } = useAppTheme();

  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.tab,
        active && [
          styles.tabActive,
          shadows.subtle,
          { backgroundColor: palette.surface, borderColor: palette.border },
        ],
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.tabLabel, { color: active ? palette.ink : palette.muted }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function RuntimeBadge({ status }: { readonly status?: AuthRuntimeState }) {
  const { palette } = useAppTheme();
  if (!status) return null;

  const label = status === "ready" ? "Secure link ready" : status === "checking" ? "Checking secure link" : "Link unavailable";
  const color = status === "ready" ? palette.success : status === "unavailable" ? palette.danger : palette.mutedStrong;
  const backgroundColor =
    status === "ready"
      ? palette.successSoft
      : status === "unavailable"
        ? palette.dangerSoft
        : palette.soft;

  return (
    <View style={[styles.runtimeBadge, { backgroundColor }]}>
      <View style={[styles.runtimeDot, { backgroundColor: color }]} />
      <Text style={[styles.runtimeBadgeText, { color }]}>{label}</Text>
    </View>
  );
}

function RoleSignal({
  icon,
  title,
  body,
}: {
  readonly icon: ReactNode;
  readonly title: string;
  readonly body: string;
}) {
  const { palette } = useAppTheme();

  return (
    <View
      style={[
        styles.roleSignal,
        {
          backgroundColor: palette.surfaceSubtle,
          borderColor: palette.border,
        },
      ]}
    >
      <View style={[styles.roleIcon, { backgroundColor: palette.brandSoft }]}>{icon}</View>
      <View style={styles.roleText}>
        <Text style={[styles.roleTitle, { color: palette.ink }]}>{title}</Text>
        <Text style={[styles.roleBody, { color: palette.muted }]}>{body}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  orbPrimary: {
    position: "absolute",
    width: 470,
    height: 470,
    borderRadius: 235,
    right: -245,
    top: -210,
    backgroundColor: "rgba(226,29,47,.14)",
  },
  orbSecondary: {
    position: "absolute",
    width: 300,
    height: 300,
    borderRadius: 150,
    left: -190,
    bottom: -150,
    backgroundColor: "rgba(226,29,47,.065)",
  },
  gridLine: {
    position: "absolute",
    height: 1,
    width: "150%",
    left: "-20%",
    backgroundColor: "rgba(226,29,47,.055)",
    transform: [{ rotate: "-12deg" }],
  },
  gridLineOne: { top: "27%" },
  gridLineTwo: { top: "67%" },
  outer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  outerWide: { paddingHorizontal: 34, paddingVertical: 34 },
  shell: {
    width: "100%",
    maxWidth: 1120,
    gap: 20,
  },
  shellWide: {
    minHeight: 680,
    flexDirection: "row",
    alignItems: "center",
    gap: 72,
  },
  hero: { gap: 18 },
  heroWide: {
    flex: 1.05,
    alignSelf: "stretch",
    justifyContent: "center",
    gap: 30,
    paddingVertical: 36,
  },
  brandRow: {
    minHeight: 48,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  brandBadge: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.08)",
  },
  brandCopy: { gap: 1 },
  brandName: {
    fontSize: 15,
    lineHeight: 18,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  brandDescriptor: { fontSize: 10, lineHeight: 14, fontWeight: "700" },
  brandAction: { marginLeft: "auto" },
  heroCopy: { maxWidth: 590, gap: 13 },
  heroCopyMobile: { gap: 9 },
  heroEyebrow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  heroEyebrowText: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "900",
    letterSpacing: 1.1,
  },
  promise: {
    maxWidth: 600,
    fontSize: 47,
    lineHeight: 50,
    fontWeight: "900",
    letterSpacing: -1.75,
  },
  promiseMobile: {
    maxWidth: 500,
    fontSize: 29,
    lineHeight: 33,
    letterSpacing: -0.9,
  },
  promiseBody: {
    maxWidth: 560,
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "500",
  },
  promiseBodyMobile: { fontSize: 13, lineHeight: 19 },
  roleRail: {
    flexDirection: "row",
    gap: 8,
  },
  roleRailWide: { maxWidth: 590, gap: 10 },
  roleSignal: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 9,
  },
  roleIcon: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 11,
  },
  roleText: { flex: 1, minWidth: 0, gap: 1 },
  roleTitle: { fontSize: 10, lineHeight: 14, fontWeight: "900" },
  roleBody: { fontSize: 8, lineHeight: 11, fontWeight: "600" },
  securityStrip: {
    maxWidth: 590,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderTopWidth: 1,
    paddingTop: 16,
  },
  securityStripText: { flex: 1, fontSize: 10, lineHeight: 15, fontWeight: "600" },
  formColumn: { width: "100%", gap: 11 },
  formColumnWide: { flex: 0.86, maxWidth: 480 },
  formCard: {
    overflow: "hidden",
    width: "100%",
    gap: 19,
    borderWidth: 1,
    borderRadius: 30,
    padding: 18,
  },
  formCardAccent: {
    position: "absolute",
    top: 0,
    left: 28,
    right: 28,
    height: 2,
    borderBottomLeftRadius: 2,
    borderBottomRightRadius: 2,
    backgroundColor: colors.brand,
    opacity: 0.82,
  },
  tabs: {
    flexDirection: "row",
    gap: 4,
    borderWidth: 1,
    borderRadius: 16,
    padding: 4,
  },
  tab: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "transparent",
  },
  tabActive: {},
  tabLabel: { fontSize: 12, lineHeight: 16, fontWeight: "900" },
  heading: { gap: 7 },
  headingTopline: {
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  eyebrow: {
    color: colors.brand,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "900",
    letterSpacing: 1.25,
    textTransform: "uppercase",
  },
  runtimeBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: radii.pill,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  runtimeDot: { width: 6, height: 6, borderRadius: 3 },
  runtimeBadgeText: { fontSize: 8, lineHeight: 11, fontWeight: "900" },
  title: {
    fontSize: 30,
    lineHeight: 34,
    fontWeight: "900",
    letterSpacing: -0.9,
  },
  body: { maxWidth: 430, fontSize: 12, lineHeight: 18, fontWeight: "500" },
  runtimeAlert: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 9,
    borderWidth: 1,
    borderRadius: radii.md,
    padding: 11,
  },
  runtimeAlertText: { flex: 1, fontSize: 10, lineHeight: 16, fontWeight: "700" },
  form: { gap: 15 },
  footerDivider: { height: StyleSheet.hairlineWidth },
  footer: { paddingTop: 1 },
  privacyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 8,
  },
  privacyText: { fontSize: 9, lineHeight: 13, fontWeight: "600", textAlign: "center" },
  pressed: { opacity: 0.76 },
});
