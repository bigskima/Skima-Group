import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { useCallback, useEffect, useState } from "react";
import {
  ChevronRight,
  CircleHelp,
  Copy,
  UsersRound,
  FileText,
  LogOut,
  MessageCircle,
  Moon,
  ShieldCheck,
  Sun,
} from "lucide-react-native";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { useSession } from "../session/SessionProvider";
import { GuideTarget, useInAppGuide } from "../onboarding/InAppGuideProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, shadows, spacing, typography } from "../theme/tokens";
import { AppButton } from "./AppButton";
import { Screen } from "./Screen";

type Workspace = "customer" | "driver" | "station";

type AffiliateReferral = {
  id: string;
  status: string;
  stationName?: string;
  submittedAt?: string;
  activatedAt?: string;
  earned?: number;
};

type StationAffiliateSummary = {
  id?: string;
  status: "not_applied" | "pending" | "active" | "suspended" | "rejected" | string;
  referralCode?: string | null;
  commissionWalletId?: string | null;
  currencyCode?: string;
  availableBalance?: number;
  referralCount?: number;
  activeReferrals?: number;
  totalEarned?: number;
  reviewReason?: string | null;
  referrals?: AffiliateReferral[];
};

export function WorkspaceAccountSettingsScreen({ workspace }: { workspace: Workspace }) {
  const session = useSession();
  const guide = useInAppGuide();
  const [affiliate, setAffiliate] = useState<StationAffiliateSummary | null>(null);
  const [affiliateLoading, setAffiliateLoading] = useState(false);
  const [affiliateSubmitting, setAffiliateSubmitting] = useState(false);
  const [affiliateError, setAffiliateError] = useState<string | null>(null);
  const [affiliateNotice, setAffiliateNotice] = useState<string | null>(null);
  const [linkCodeLoading, setLinkCodeLoading] = useState(false);

  const refreshAffiliate = useCallback(async () => {
    setAffiliateLoading(true);
    try {
      const result = await session.supabase.rpc("read_my_lpg_station_affiliate");
      if (result.error) throw result.error;
      setAffiliate((result.data ?? null) as StationAffiliateSummary | null);
      setAffiliateError(null);
    } catch (error) {
      setAffiliateError(error instanceof Error ? error.message : "Affiliate details could not be loaded.");
    } finally {
      setAffiliateLoading(false);
    }
  }, [session.supabase]);
  const theme = useAppTheme();

  useEffect(() => {
    if (workspace === "customer" && session.status === "authenticated") void refreshAffiliate();
  }, [workspace, session.status, refreshAffiliate]);

  const applyForAffiliate = async () => {
    setAffiliateSubmitting(true);
    setAffiliateError(null);
    setAffiliateNotice(null);
    try {
      const result = await session.supabase.rpc("request_lpg_station_affiliate");
      if (result.error) throw result.error;
      await refreshAffiliate();
      setAffiliateNotice("Your affiliate request has been submitted for SKIMA review.");
    } catch (error) {
      setAffiliateError(error instanceof Error ? error.message : "Your affiliate request could not be submitted.");
    } finally {
      setAffiliateSubmitting(false);
    }
  };

  const copyReferralCode = async () => {
    if (!affiliate?.referralCode || affiliate.status !== "active") return;
    try {
      await Clipboard.setStringAsync(affiliate.referralCode);
      setAffiliateNotice("Referral code copied.");
    } catch {
      setAffiliateError("Clipboard access was unavailable. You can select and copy the code manually.");
    }
  };

  const generateWhatsAppLinkCode = async () => {
    if (linkCodeLoading || session.status !== "authenticated") return;
    setLinkCodeLoading(true);
    try {
      const result = await session.supabase.rpc("issue_skima_whatsapp_link_code");
      if (result.error) throw result.error;
      if (typeof result.data !== "string" || !/^[A-F0-9]{16}$/.test(result.data)) {
        throw new Error("SKIMA returned an invalid linking code. Please try again.");
      }
      const code = result.data;
      const publicNumber = (process.env.EXPO_PUBLIC_SKIMA_WHATSAPP_NUMBER ?? "").replace(/\D/g, "");
      const message = "Send this code to the official SKIMA LPG WhatsApp number within 10 minutes:\n\n" + code + "\n\nDo not share this code with another person.";
      const copyAction = { text: "Copy code", onPress: () => { void Clipboard.setStringAsync(code); } };
      if (publicNumber.length >= 6 && publicNumber.length <= 20) {
        Alert.alert("WhatsApp linking code", message, [
          { text: "Close", style: "cancel" },
          copyAction,
          {
            text: "Open WhatsApp",
            onPress: () => {
              const url = "https://wa.me/" + publicNumber + "?text=" + encodeURIComponent(code);
              void Linking.openURL(url).catch(() => {
                Alert.alert("Could not open WhatsApp", "Copy the one-time code and send it to the official SKIMA LPG WhatsApp number.");
              });
            },
          },
        ]);
      } else {
        Alert.alert("WhatsApp linking code", message, [
          { text: "Close", style: "cancel" },
          copyAction,
        ]);
      }
    } catch (error) {
      Alert.alert(
        "Could not generate code",
        error instanceof Error ? error.message : "Please try again when your connection is available.",
      );
    } finally {
      setLinkCodeLoading(false);
    }
  };

  const policyHref = workspace === "customer"
    ? "/policies/customer-terms"
    : workspace === "driver"
      ? "/policies/driver-operations"
      : "/policies/station-operations";
  const policyLabel = workspace === "customer"
    ? "Customer terms"
    : workspace === "driver"
      ? "Driver policy"
      : "Station policy";

  return (
    <Screen
      eyebrow="Account"
      title="Settings"
      subtitle="Appearance, privacy and account access."
      action={<AppButton label="Back" size="sm" variant="ghost" onPress={() => router.back()} />}
    >
      <View style={styles.group}>
        <Text style={[styles.groupTitle, { color: theme.palette.ink }]}>Preferences</Text>
        <View style={[styles.list, shadows.soft, { backgroundColor: theme.palette.surface, borderColor: theme.palette.border }]}>
          <SettingsRow
            icon={theme.scheme === "dark" ? Sun : Moon}
            label="Appearance"
            detail={theme.scheme === "dark" ? "Dark mode is on" : "Light mode is on"}
            value={theme.scheme === "dark" ? "Switch to light" : "Switch to dark"}
            onPress={() => void theme.toggle()}
          />
          <GuideTarget targetKey="account.app-guide">
            <SettingsRow
              icon={CircleHelp}
              label="App guide"
              detail="Replay the practical guide for this workspace"
              value="Start guided tour"
              onPress={() => void guide.startNow(workspace)}
              last
            />
          </GuideTarget>
        </View>
      </View>

      {workspace === "customer" ? (
        <View style={styles.group}>
          <Text style={[styles.groupTitle, { color: theme.palette.ink }]}>Earning opportunities</Text>
          <View style={[styles.affiliateCard, shadows.soft, { backgroundColor: theme.palette.surface, borderColor: theme.palette.border }]}>
            <GuideTarget targetKey="account.station-affiliate">
            <View style={styles.affiliateHeading}>
              <View style={[styles.iconWrap, { backgroundColor: theme.palette.brandSoft }]}>
                <UsersRound color={theme.palette.brand} size={20} />
              </View>
              <View style={styles.copy}>
                <Text style={[styles.label, { color: theme.palette.ink }]}>SKIMA Station Affiliate</Text>
                <Text style={[styles.detail, { color: theme.palette.muted }]}>
                  Refer eligible LPG stations. When approved stations activate and generate eligible SKIMA revenue, you can earn a configured commission for the policy's limited earning period.
                </Text>
              </View>
            </View>
          </GuideTarget>

            {affiliateLoading && !affiliate ? (
              <Text style={[styles.affiliateBody, { color: theme.palette.muted }]}>Loading affiliate status…</Text>
            ) : null}

            {affiliate?.status === "not_applied" || !affiliate ? (
              <View style={styles.affiliateActions}>
                <Text style={[styles.affiliateBody, { color: theme.palette.muted }]}>
                  Apply to become an affiliate. SKIMA reviews the request before activating a referral code.
                </Text>
                <AppButton
                  label="Apply to become an affiliate"
                  fullWidth
                  loading={affiliateSubmitting}
                  disabled={affiliateSubmitting || session.status !== "authenticated"}
                  onPress={() => void applyForAffiliate()}
                />
              </View>
            ) : affiliate.status === "pending" ? (
              <View style={[styles.affiliateStatus, { backgroundColor: theme.palette.surfaceSubtle }]}>
                <Text style={[styles.affiliateStatusTitle, { color: theme.palette.ink }]}>Application pending review</Text>
                <Text style={[styles.affiliateBody, { color: theme.palette.muted }]}>
                  Your referral code is reserved but cannot be used until SKIMA activates your affiliate account.
                </Text>
              </View>
            ) : affiliate.status === "active" ? (
              <>
                <View style={[styles.referralCodeBox, { backgroundColor: theme.palette.surfaceSubtle, borderColor: theme.palette.border }]}>
                  <View style={styles.copy}>
                    <Text style={[styles.detail, { color: theme.palette.muted }]}>Your active referral code</Text>
                    <Text selectable style={[styles.referralCode, { color: theme.palette.ink }]}>{affiliate.referralCode ?? "Code unavailable"}</Text>
                  </View>
                  <AppButton label="Copy" size="sm" variant="secondary" onPress={() => void copyReferralCode()} disabled={!affiliate.referralCode} />
                </View>
                <View style={styles.affiliateMetrics}>
                  <View style={styles.affiliateMetric}>
                    <Text style={[styles.metricValue, { color: theme.palette.ink }]}>{affiliate.referralCount ?? 0}</Text>
                    <Text style={[styles.detail, { color: theme.palette.muted }]}>Stations referred</Text>
                  </View>
                  <View style={styles.affiliateMetric}>
                    <Text style={[styles.metricValue, { color: theme.palette.ink }]}>{affiliate.activeReferrals ?? 0}</Text>
                    <Text style={[styles.detail, { color: theme.palette.muted }]}>Activated stations</Text>
                  </View>
                </View>
                <View style={[styles.affiliateBalance, { backgroundColor: theme.palette.surfaceSubtle }]}>
                  <Text style={[styles.detail, { color: theme.palette.muted }]}>Total affiliate commissions</Text>
                  <Text style={[styles.balanceValue, { color: theme.palette.ink }]}>
                    ₦{Number(affiliate.totalEarned ?? 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                  <Text style={[styles.detail, { color: theme.palette.muted }]}>
                    Available in affiliate wallet: ₦{Number(affiliate.availableBalance ?? 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </Text>
                </View>
                <AppButton
                  label="Withdraw affiliate earnings"
                  fullWidth
                  disabled={!affiliate.commissionWalletId || Number(affiliate.availableBalance ?? 0) <= 0}
                  onPress={() => {
                    if (!affiliate.commissionWalletId) return;
                    router.push(("/customer/wallet/affiliate-withdraw?walletId=" + encodeURIComponent(affiliate.commissionWalletId)) as never);
                  }}
                />
                {(affiliate.referrals ?? []).length ? (
                  <View style={styles.affiliateReferralList}>
                    <Text style={[styles.affiliateStatusTitle, { color: theme.palette.ink }]}>Your referrals</Text>
                    {(affiliate.referrals ?? []).slice(0, 8).map((referral) => (
                      <View key={referral.id} style={[styles.affiliateReferralRow, { borderBottomColor: theme.palette.border }]}>
                        <View style={styles.copy}>
                          <Text style={[styles.label, { color: theme.palette.ink }]}>{referral.stationName ?? "Station application"}</Text>
                          <Text style={[styles.detail, { color: theme.palette.muted }]}>{referral.status.replaceAll("_", " ")}</Text>
                        </View>
                        <Text style={[styles.detail, { color: theme.palette.ink }]}>
                          ₦{Number(referral.earned ?? 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}
              </>
            ) : (
              <View style={[styles.affiliateStatus, { backgroundColor: theme.palette.surfaceSubtle }]}>
                <Text style={[styles.affiliateStatusTitle, { color: theme.palette.ink }]}>
                  Affiliate account {affiliate.status}
                </Text>
                <Text style={[styles.affiliateBody, { color: theme.palette.muted }]}>
                  {affiliate.reviewReason || "Your affiliate account is not currently active. Contact SKIMA support if you need a review."}
                </Text>
              </View>
            )}
            {affiliateNotice ? <Text style={[styles.affiliateNotice, { color: theme.palette.success }]}>{affiliateNotice}</Text> : null}
            {affiliateError ? (
              <Text accessibilityRole="alert" style={[styles.affiliateNotice, { color: theme.palette.danger }]}>{affiliateError}</Text>
            ) : null}
            {!affiliateLoading && affiliate && affiliate.status !== "not_applied" ? (
              <Pressable onPress={() => void refreshAffiliate()} style={styles.refreshAffiliate}>
                <Text style={[styles.value, { color: theme.palette.brand }]}>Refresh affiliate status</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {workspace === "customer" ? (
        <View style={styles.group}>
          <Text style={[styles.groupTitle, { color: theme.palette.ink }]}>Customer channels</Text>
          <View style={[styles.list, shadows.soft, { backgroundColor: theme.palette.surface, borderColor: theme.palette.border }]}>
            <SettingsRow
              icon={MessageCircle}
              label="WhatsApp ordering"
              detail="Link this chat securely to your SKIMA account for LPG orders and wallet-related help."
              value={linkCodeLoading ? "Generating one-time code…" : "Generate linking code"}
              onPress={() => void generateWhatsAppLinkCode()}
              last
            />
          </View>
        </View>
      ) : null}

      <View style={styles.group}>
        <Text style={[styles.groupTitle, { color: theme.palette.ink }]}>Privacy & terms</Text>
        <View style={[styles.list, shadows.soft, { backgroundColor: theme.palette.surface, borderColor: theme.palette.border }]}>
          <SettingsRow
            icon={FileText}
            label={policyLabel}
            detail={workspace === "customer"
              ? "LPG service rules, payments, refunds and your rights"
              : workspace === "driver"
                ? "Driver operations, location, custody, earnings and safety"
                : "Station operations, refills, settlements, staff and safety"}
            onPress={() => router.push(policyHref as never)}
          />
          <SettingsRow
            icon={ShieldCheck}
            label="Privacy notice"
            detail="How SKIMA uses location, account, payment, verification and AI data"
            onPress={() => router.push("/policies/privacy" as never)}
          />
          <SettingsRow
            icon={ShieldCheck}
            label="Account protection"
            detail="Your account and role access are protected by SKIMA permissions"
            last
          />
        </View>
      </View>

      <View style={[styles.signOutCard, { backgroundColor: theme.palette.surface, borderColor: theme.palette.border }]}>
        <View style={[styles.dangerIcon, { backgroundColor: theme.palette.dangerSoft }]}>
          <LogOut color={theme.palette.danger} size={21} />
        </View>
        <View style={styles.signOutCopy}>
          <Text style={[styles.signOutTitle, { color: theme.palette.ink }]}>Sign out</Text>
          <Text style={[styles.signOutBody, { color: theme.palette.muted }]}>
            Sign out of this device. Your SKIMA account and saved server data remain protected.
          </Text>
        </View>
        <AppButton
          label="Sign out"
          variant="danger"
          fullWidth
          onPress={() => void session.signOut()}
        />
      </View>
    </Screen>
  );
}

function SettingsRow({
  icon: Icon,
  label,
  detail,
  value,
  onPress,
  last = false,
}: {
  icon: typeof Moon;
  label: string;
  detail: string;
  value?: string;
  onPress?: () => void;
  last?: boolean;
}) {
  const { palette } = useAppTheme();

  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        !last && { borderBottomColor: palette.border, borderBottomWidth: StyleSheet.hairlineWidth },
        { opacity: pressed ? 0.72 : 1 },
      ]}
    >
      <View style={[styles.iconWrap, { backgroundColor: palette.brandSoft }]}>
        <Icon color={palette.brand} size={20} />
      </View>
      <View style={styles.copy}>
        <Text style={[styles.label, { color: palette.ink }]}>{label}</Text>
        <Text numberOfLines={2} style={[styles.detail, { color: palette.muted }]}>{detail}</Text>
        {value ? <Text style={[styles.value, { color: palette.brand }]}>{value}</Text> : null}
      </View>
      {onPress ? <ChevronRight color={palette.muted} size={18} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  group: { gap: spacing.sm },
  affiliateCard: { gap: spacing.md, borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  affiliateHeading: { flexDirection: "row", alignItems: "flex-start", gap: spacing.md },
  affiliateActions: { gap: spacing.sm },
  affiliateBody: { ...typography.caption, fontSize: 12, lineHeight: 18 },
  affiliateStatus: { gap: 4, borderRadius: radii.lg, padding: spacing.md },
  affiliateStatusTitle: { ...typography.bodyStrong, fontSize: 13 },
  referralCodeBox: { flexDirection: "row", alignItems: "center", gap: spacing.sm, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: spacing.md },
  referralCode: { fontSize: 23, fontWeight: "900", letterSpacing: 2 },
  affiliateMetrics: { flexDirection: "row", gap: spacing.sm },
  affiliateMetric: { flex: 1, gap: 4, padding: spacing.md, borderRadius: radii.lg, backgroundColor: "transparent", borderWidth: StyleSheet.hairlineWidth, borderColor: "#80808030" },
  metricValue: { fontSize: 22, fontWeight: "900" },
  affiliateBalance: { gap: 4, borderRadius: radii.lg, padding: spacing.md },
  balanceValue: { fontSize: 24, fontWeight: "900" },
  affiliateReferralList: { gap: spacing.sm },
  affiliateReferralRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth },
  affiliateNotice: { ...typography.caption, fontSize: 12, lineHeight: 18 },
  refreshAffiliate: { alignSelf: "flex-start", paddingVertical: spacing.xs },
  groupTitle: { ...typography.sectionTitle, fontSize: 15, paddingHorizontal: 2 },
  list: { borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { minHeight: 82, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  iconWrap: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  label: { ...typography.bodyStrong, fontSize: 14 },
  detail: { ...typography.caption, fontSize: 10, lineHeight: 14 },
  value: { ...typography.caption, fontSize: 10, fontWeight: "900", marginTop: 2 },
  signOutCard: { gap: spacing.md, borderRadius: radii.xl, borderWidth: StyleSheet.hairlineWidth, padding: spacing.lg },
  dangerIcon: { width: 44, height: 44, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  signOutCopy: { gap: 3 },
  signOutTitle: { ...typography.subheading, fontSize: 15 },
  signOutBody: { ...typography.caption, lineHeight: 18 },
});
