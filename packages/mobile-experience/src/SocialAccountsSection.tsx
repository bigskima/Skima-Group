import { useEffect, useState } from "react";
import { Image, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import {
  Facebook,
  Globe,
  Instagram,
  Linkedin,
  Music2,
  Youtube,
} from "lucide-react-native";

type SocialAccount = {
  id: string;
  platform_key: string;
  platform_name: string;
  icon_key: string;
  icon_url: string | null;
  display_name: string;
  handle: string | null;
  profile_url: string;
};

type SocialPalette = {
  surface: string;
  surfaceSubtle: string;
  ink: string;
  muted: string;
  border: string;
  brand: string;
  brandSoft: string;
};

const iconMap = {
  instagram: Instagram,
  facebook: Facebook,
  youtube: Youtube,
  linkedin: Linkedin,
  tiktok: Music2,
  music: Music2,
  globe: Globe,
} as const;

export function SocialAccountsSection({
  supabase,
  surface,
  palette,
  title = "Follow SKIMA",
}: {
  supabase: { rpc: (name: string, args?: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> };
  surface: string;
  palette: SocialPalette;
  title?: string;
}) {
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void supabase.rpc("read_active_social_accounts", { target_surface: surface })
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) {
          setAccounts([]);
          return;
        }
        setAccounts(Array.isArray(data) ? data as SocialAccount[] : []);
      })
      .catch(() => {
        if (alive) setAccounts([]);
      })
      .finally(() => {
        if (alive) setLoaded(true);
      });
    return () => { alive = false; };
  }, [supabase, surface]);

  if (!loaded || accounts.length === 0) return null;

  return (
    <View style={[styles.card, { backgroundColor: palette.surface, borderColor: palette.border }]}>
      <View style={styles.heading}>
        <View style={[styles.headingIcon, { backgroundColor: palette.brandSoft }]}>
          <Globe color={palette.brand} size={17} />
        </View>
        <View style={styles.headingCopy}>
          <Text style={[styles.title, { color: palette.ink }]}>{title}</Text>
          <Text style={[styles.subtitle, { color: palette.muted }]}>Our official channels</Text>
        </View>
      </View>
      <View style={styles.accounts}>
        {accounts.map((account) => (
          <Pressable
            key={account.id}
            accessibilityRole="link"
            accessibilityLabel={`Open ${account.platform_name}: ${account.handle ?? account.display_name}`}
            onPress={() => {
              if (/^https:\/\//i.test(account.profile_url)) {
                void Linking.openURL(account.profile_url).catch(() => undefined);
              }
            }}
            style={({ pressed }) => [
              styles.account,
              {
                backgroundColor: palette.surfaceSubtle,
                borderColor: palette.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            {account.icon_url && /^https:\/\//i.test(account.icon_url) ? (
              <Image source={{ uri: account.icon_url }} style={styles.iconImage} />
            ) : account.icon_key.toLowerCase() === "twitter" || account.platform_key.toLowerCase() === "x" ? (
              <View style={[styles.iconBadge, { backgroundColor: "#111111" }]}>
                <Text style={styles.xIcon}>𝕏</Text>
              </View>
            ) : (() => {
              const Icon = iconMap[account.icon_key.toLowerCase() as keyof typeof iconMap] ?? Globe;
              return <View style={[styles.iconBadge, { backgroundColor: palette.brandSoft }]}><Icon color={palette.brand} size={18} /></View>;
            })()}
            <View style={styles.accountCopy}>
              <Text numberOfLines={1} style={[styles.accountName, { color: palette.ink }]}>{account.platform_name}</Text>
              <Text numberOfLines={1} style={[styles.handle, { color: palette.muted }]}>{account.handle || account.display_name}</Text>
            </View>
            <Text style={[styles.open, { color: palette.brand }]}>↗</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: StyleSheet.hairlineWidth, borderRadius: 18, padding: 14, gap: 12 },
  heading: { flexDirection: "row", alignItems: "center", gap: 10 },
  headingIcon: { width: 34, height: 34, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  headingCopy: { flex: 1, gap: 2 },
  title: { fontSize: 14, fontWeight: "900" },
  subtitle: { fontSize: 10, fontWeight: "600" },
  accounts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  account: { minWidth: 132, flexGrow: 1, flexBasis: "46%", flexDirection: "row", alignItems: "center", gap: 9, borderWidth: StyleSheet.hairlineWidth, borderRadius: 13, padding: 9 },
  iconBadge: { width: 32, height: 32, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  iconImage: { width: 32, height: 32, borderRadius: 9 },
  xIcon: { color: "#FFFFFF", fontSize: 20, fontWeight: "800", lineHeight: 24 },
  accountCopy: { flex: 1, minWidth: 0, gap: 2 },
  accountName: { fontSize: 11, fontWeight: "900" },
  handle: { fontSize: 10, fontWeight: "600" },
  open: { fontSize: 17, fontWeight: "900" },
});
