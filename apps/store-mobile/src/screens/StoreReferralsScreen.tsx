import { useQuery } from "@tanstack/react-query";
import { Gift, Share2, UsersRound, Trophy, ShieldCheck } from "lucide-react-native";
import { useState } from "react";
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Share, StyleSheet, Switch, Text, View } from "react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";

type Row = Record<string, unknown>;
function value(row: Row | null | undefined, key: string) {
  const item = row?.[key];
  return typeof item === "string" || typeof item === "number" ? String(item) : "";
}
function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((item): item is Row => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

export function ReferralsScreen() {
  const session = useSession();
  const { palette } = useAppTheme();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const dashboard = useQuery({
    queryKey: ["shared-referral-dashboard", session.session?.user.id],
    enabled: session.status === "authenticated",
    staleTime: 60_000,
    retry: false,
    queryFn: async () => {
      const { data, error } = await session.supabase.rpc("read_my_referral_dashboard", { target_campaign_id: null });
      if (error) throw error;
      return data as Row;
    },
  });
  const data = dashboard.data ?? {};
  const code = value(data, "referralCode");
  const campaigns = rows(data.activeCampaigns);
  const referrals = rows(data.referrals);
  const leaderboard = rows(data.leaderboard);
  const optIn = data.leaderboardOptIn === true;

  const share = async () => {
    if (!code) return;
    try {
      await Share.share({
        message: "Join me on SKIMA. Use my referral code " + code + " when you create your account. It works across Refill, Store, Logistics and Bills.",
      });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The invite could not be shared.");
    }
  };

  const toggleVisibility = async (visible: boolean) => {
    setSaving(true);
    setNotice("");
    try {
      const { error } = await session.supabase.rpc("set_my_referral_leaderboard_visibility", { target_visible: visible });
      if (error) throw error;
      await dashboard.refetch();
      setNotice(visible ? "You are now visible on the referral leaderboard." : "Your leaderboard profile is private.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Privacy setting could not be saved.");
    } finally {
      setSaving(false);
    }
  };

  if (dashboard.isPending) {
    return <View style={styles.loading}><ActivityIndicator color={palette.brand} /><Text style={[styles.meta, { color: palette.muted }]}>Loading your referral dashboard…</Text></View>;
  }
  if (dashboard.error) {
    return <View style={styles.loading}><Text style={[styles.cardTitle, { color: palette.ink }]}>Referrals are unavailable</Text><Text style={[styles.meta, { color: palette.muted }]}>{dashboard.error instanceof Error ? dashboard.error.message : "Please try again."}</Text><Pressable onPress={() => void dashboard.refetch()}><Text style={{ color: palette.brand }}>Retry</Text></Pressable></View>;
  }

  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={dashboard.isRefetching} onRefresh={() => void dashboard.refetch()} tintColor={palette.brand} />}>
      <View style={[styles.hero, { backgroundColor: palette.brand }]}>
        <View style={styles.heroIcon}><Gift color="#FFFFFF" size={22} /></View>
        <Text style={styles.heroEyebrow}>SHARED SKIMA REFERRALS</Text>
        <Text style={styles.heroTitle}>Invite. Earn. Grow.</Text>
        <Text style={styles.heroBody}>One code works across Refill, Store, Logistics and Bills. Sharing is optional.</Text>
        <View style={styles.codeBox}>
          <View style={{ flex: 1 }}>
            <Text style={styles.codeLabel}>YOUR REFERRAL CODE</Text>
            <Text selectable style={styles.code}>{code || "—"}</Text>
          </View>
          <Pressable style={styles.shareButton} onPress={() => void share()} disabled={!code} accessibilityRole="button">
            <Share2 size={17} color={palette.brand} /><Text style={styles.shareLabel}>Share</Text>
          </Pressable>
        </View>
      </View>

      {notice ? <Text style={[styles.notice, { color: palette.brand }]}>{notice}</Text> : null}
      <View style={styles.stats}>
        <Metric label="Your referrals" number={String(referrals.length)} />
        <Metric label="Active campaigns" number={String(campaigns.length)} />
      </View>

      <View style={styles.sectionHead}><Gift color={palette.brand} size={18} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Campaigns</Text></View>
      {campaigns.length === 0 ? <Empty text="No active campaigns right now. Your referral code is still ready to share." /> : campaigns.map((campaign) => {
        const apps = Array.isArray(campaign.targetAppKeys) ? (campaign.targetAppKeys as unknown[]).filter((item): item is string => typeof item === "string") : [];
        return (
          <View key={value(campaign, "id")} style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
            <Text style={[styles.cardTitle, { color: palette.ink }]}>{value(campaign, "displayName")}</Text>
            <Text style={[styles.body, { color: palette.muted }]}>{value(campaign, "description")}</Text>
            <Text style={[styles.meta, { color: palette.brand }]}>Available in {apps.map((item) => item.toUpperCase()).join(", ") || "selected SKIMA apps"}</Text>
            {value(campaign, "terms") ? <Text style={[styles.meta, { color: palette.muted }]}>{value(campaign, "terms")}</Text> : null}
          </View>
        );
      })}

      <View style={styles.sectionHead}><UsersRound color={palette.brand} size={18} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Your referrals</Text></View>
      {referrals.length === 0 ? <Empty text="Your invited friends will appear here after they join with your code." /> : referrals.map((referral) => (
        <View key={value(referral, "id")} style={[styles.rowCard, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: palette.ink }]}>{value(referral, "displayName") || "SKIMA member"}</Text>
            <Text style={[styles.meta, { color: palette.muted }]}>{value(referral, "appKey").toUpperCase()} · {value(referral, "campaignName") || "General referral"}</Text>
          </View>
          <Text style={[styles.status, { color: value(referral, "status") === "qualified" ? palette.success : palette.muted }]}>{value(referral, "status").replace(/_/g, " ")}</Text>
        </View>
      ))}

      <View style={styles.sectionHead}><Trophy color={palette.brand} size={18} /><Text style={[styles.sectionTitle, { color: palette.ink }]}>Referral leaderboard</Text></View>
      <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
        <View style={styles.privacyRow}>
          <View style={{ flex: 1 }}>
            <Text style={[styles.cardTitle, { color: palette.ink }]}>Show my name</Text>
            <Text style={[styles.meta, { color: palette.muted }]}>Your profile appears only when you opt in.</Text>
          </View>
          <Switch value={optIn} disabled={saving} onValueChange={(value) => void toggleVisibility(value)} trackColor={{ true: palette.brand }} />
        </View>
        {leaderboard.length === 0 ? <Text style={[styles.body, { color: palette.muted }]}>The leaderboard will appear as members opt in and invite friends.</Text> : leaderboard.map((entry, index) => (
          <View key={String(entry.rank ?? index)} style={styles.leader}>
            <Text style={[styles.rank, { color: palette.brand }]}>#{value(entry, "rank") || String(index + 1)}</Text>
            <Text style={[styles.leaderName, { color: palette.ink }]}>{value(entry, "displayName") || "SKIMA member"}{entry.isMe === true ? " (you)" : ""}</Text>
            <Text style={[styles.status, { color: palette.muted }]}>{value(entry, "referralCount")} invites</Text>
          </View>
        ))}
      </View>
      <View style={[styles.info, { backgroundColor: palette.surfaceSubtle }]}>
        <ShieldCheck color={palette.success} size={16} />
        <Text style={[styles.meta, { color: palette.muted }]}>Referral rewards follow each campaign's terms and qualification rules. A reward is not credited until it is approved and fulfilled.</Text>
      </View>
    </ScrollView>
  );
}

function Metric({ label, number }: { label: string; number: string }) {
  const { palette } = useAppTheme();
  return <View style={[styles.metric, { backgroundColor: palette.surface, borderColor: palette.border }]}><Text style={[styles.meta, { color: palette.muted }]}>{label}</Text><Text style={[styles.metricValue, { color: palette.ink }]}>{number}</Text></View>;
}
function Empty({ text }: { text: string }) {
  const { palette } = useAppTheme();
  return <View style={[styles.empty, { backgroundColor: palette.surfaceSubtle }]}><Text style={[styles.meta, { color: palette.muted }]}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  content: { padding: 16, gap: 12, paddingBottom: 32 },
  hero: { borderRadius: 22, padding: 17, gap: 8 },
  heroIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: "rgba(255,255,255,.17)", alignItems: "center", justifyContent: "center" },
  heroEyebrow: { color: "#FFFFFF", fontSize: 8, fontWeight: "900", letterSpacing: 1.4 },
  heroTitle: { color: "#FFFFFF", fontSize: 23, fontWeight: "900", letterSpacing: -0.5 },
  heroBody: { color: "rgba(255,255,255,.82)", fontSize: 11, lineHeight: 16 },
  codeBox: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, marginTop: 4, borderRadius: 14, backgroundColor: "rgba(255,255,255,.13)" },
  codeLabel: { color: "rgba(255,255,255,.8)", fontSize: 8, fontWeight: "900", letterSpacing: 1 },
  code: { color: "#FFFFFF", fontSize: 21, fontWeight: "900", letterSpacing: 1.5, marginTop: 3 },
  shareButton: { minHeight: 38, paddingHorizontal: 12, borderRadius: 11, backgroundColor: "#FFFFFF", flexDirection: "row", alignItems: "center", gap: 6 },
  shareLabel: { color: "#E21D2E", fontSize: 10, fontWeight: "900" },
  notice: { fontSize: 10, fontWeight: "800" },
  stats: { flexDirection: "row", gap: 9 },
  metric: { flex: 1, padding: 12, borderWidth: 1, borderRadius: 13, gap: 4 },
  metricValue: { fontSize: 20, fontWeight: "900" },
  sectionHead: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 6 },
  sectionTitle: { fontSize: 13, fontWeight: "900" },
  card: { borderWidth: 1, borderRadius: 14, padding: 13, gap: 7 },
  rowCard: { borderWidth: 1, borderRadius: 13, padding: 12, flexDirection: "row", alignItems: "center", gap: 9 },
  cardTitle: { fontSize: 11, fontWeight: "900" },
  body: { fontSize: 10, lineHeight: 15 },
  meta: { fontSize: 9, lineHeight: 14 },
  status: { fontSize: 9, fontWeight: "900", textTransform: "capitalize" },
  empty: { padding: 14, borderRadius: 12 },
  privacyRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  leader: { flexDirection: "row", alignItems: "center", gap: 9, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: "rgba(128,128,128,.18)" },
  rank: { width: 28, fontSize: 11, fontWeight: "900" },
  leaderName: { flex: 1, fontSize: 10, fontWeight: "800" },
  info: { flexDirection: "row", alignItems: "flex-start", gap: 8, padding: 10, borderRadius: 12 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 10 },
});
