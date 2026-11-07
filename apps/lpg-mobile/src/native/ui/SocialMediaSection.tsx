import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, Text, View } from "react-native";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ExternalLink, Globe } from "lucide-react-native";

type SocialRow = {
  id: string;
  platform_key: string;
  platform_name: string;
  icon_key: string;
  icon_url: string | null;
  display_name: string;
  handle: string | null;
  profile_url: string;
};
type Palette = {
  surface: string; surfaceSubtle: string; border: string; brand: string;
  brandSoft: string; ink: string; muted: string;
};

const glyphs: Record<string, string> = {
  x: "𝕏", twitter: "𝕏", tiktok: "♪", "music-2": "♪",
  instagram: "◎", facebook: "f", youtube: "▶", linkedin: "in",
  threads: "@", pinterest: "P", snapchat: "👻", whatsapp: "◉",
};

export function SocialMediaSection({ supabase, surface, palette }: {
  supabase: SupabaseClient;
  surface: string;
  palette: Palette;
}) {
  const [rows, setRows] = useState<SocialRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    void supabase.rpc("read_active_social_accounts", { target_surface: surface })
      .then(({ data, error }) => {
        if (!active) return;
        if (error) throw error;
        setRows(Array.isArray(data) ? data as SocialRow[] : []);
      })
      .catch(() => { if (active) setRows([]); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [supabase, surface]);

  if (loading) return (
    <View style={{ minHeight: 52, justifyContent: "center", alignItems: "center" }}>
      <ActivityIndicator color={palette.brand} size="small" />
    </View>
  );
  if (!rows.length) return null;

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
        <Text style={{ color: palette.ink, fontSize: 14, fontWeight: "900" }}>Follow SKIMA</Text>
        <Text style={{ color: palette.muted, fontSize: 10 }}>Official channels</Text>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 9, paddingRight: 12 }}>
        {rows.map((row) => (
          <Pressable
            key={row.id}
            accessibilityRole="link"
            accessibilityLabel={"Open " + row.display_name}
            onPress={() => { void Linking.openURL(row.profile_url).catch(() => undefined); }}
            style={({ pressed }) => ({
              minHeight: 48, flexDirection: "row", alignItems: "center", gap: 9,
              paddingHorizontal: 12, borderRadius: 14, borderWidth: 1,
              borderColor: palette.border, backgroundColor: palette.surface,
              opacity: pressed ? 0.72 : 1,
            })}
          >
            {row.icon_url ? (
              <Image source={{ uri: row.icon_url }} style={{ width: 24, height: 24, borderRadius: 7 }} />
            ) : (
              <View style={{ width: 28, height: 28, borderRadius: 9, alignItems: "center", justifyContent: "center", backgroundColor: palette.brandSoft }}>
                <Text style={{ color: palette.brand, fontWeight: "900", fontSize: row.icon_key === "linkedin" ? 10 : 17 }}>
                  {glyphs[row.platform_key] ?? glyphs[row.icon_key] ?? "↗"}
                </Text>
              </View>
            )}
            <View style={{ gap: 2 }}>
              <Text numberOfLines={1} style={{ color: palette.ink, fontSize: 11, fontWeight: "800" }}>{row.platform_name}</Text>
              <Text numberOfLines={1} style={{ color: palette.muted, fontSize: 9 }}>{row.handle || row.display_name}</Text>
            </View>
            <ExternalLink size={13} color={palette.muted} />
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
