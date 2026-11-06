import { useQuery } from "@tanstack/react-query";
import { Image, StyleSheet, Text, View } from "react-native";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";

type LogoRecord = { url: string; label: string };
export function BillsBrandMark({ size = 138, compact = false }: { size?: number; compact?: boolean }) {
  const { supabase } = useSession();
  const { palette } = useAppTheme();
  const placements = compact ? ["mobile.brand.logo.compact", "mobile.brand.logo.primary"] : ["mobile.brand.logo.primary"];
  const logo = useQuery<LogoRecord | null>({
    queryKey: ["bills-server-brand-logo", compact ? "compact" : "primary"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("read_published_product_content", {
        target_placement_keys: placements,
        target_module_key: null,
        target_audience_key: "public",
        target_country_code: null,
        target_region: null,
        target_city: null,
      });
      if (error) throw error;
      const rows = Array.isArray(data) ? data as Record<string, unknown>[] : [];
      for (const placement of placements) {
        const row = rows.find((item) => item.placement_key === placement);
        if (!row) continue;
        const metadata = isRecord(row.metadata) ? row.metadata : {};
        const directUrl = readString(metadata.media_public_url) ?? readString(metadata.mediaPublicUrl);
        const bucket = readString(row.media_storage_bucket);
        const storagePath = readString(row.media_storage_path);
        const url = directUrl ?? (bucket && storagePath ? supabase.storage.from(bucket).getPublicUrl(storagePath).data.publicUrl : null);
        if (url) return { url, label: readString(row.accessibility_label) ?? readString(row.title) ?? "SKIMA" };
      }
      return null;
    },
  });
  if (logo.data?.url) return <Image accessibilityLabel={logo.data.label} resizeMode="contain" source={{ uri: logo.data.url }} style={compact ? styles.compactImage : { width: size, height: 40 }} />;
  return compact ? (
    <View accessibilityLabel="SKIMA" style={[styles.compactFallback, { backgroundColor: palette.brand }]}><Text style={styles.compactInitial}>S</Text></View>
  ) : (
    <View accessibilityLabel="SKIMA" style={styles.wordmark}><Text style={[styles.name, { color: palette.ink }]}>SKIMA</Text></View>
  );
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function readString(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
const styles = StyleSheet.create({
  compactImage: { width: 44, height: 44 },
  compactFallback: { width: 44, height: 44, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  compactInitial: { color: "#FFFFFF", fontSize: 22, fontWeight: "900" },
  wordmark: { width: 138, height: 40, justifyContent: "center" },
  name: { fontSize: 22, fontWeight: "900", letterSpacing: 1.4 },
});
