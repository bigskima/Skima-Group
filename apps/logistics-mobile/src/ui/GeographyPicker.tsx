import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Check, MapPin, Search } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { RecordArraySchema, asString } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppField } from "./AppField";

type Place = Record<string, unknown>;
export function GeographyPicker({ label, value, selected, onChange, onSelect, error }: {
  label: string; value: string; selected: Place | null; onChange(value: string): void;
  onSelect(place: Place): void; error?: string | null;
}) {
  const { palette } = useAppTheme();
  const { api, status } = useSession();
  const search = value.trim();
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 260);
    return () => clearTimeout(handle);
  }, [search]);
  const query = useQuery({
    queryKey: ["skima-logistics", "geography-search", debouncedSearch.toLowerCase()],
    enabled: status === "authenticated" && !selected && debouncedSearch.length >= 2,
    queryFn: ({ signal }) => api.get(
      `/runtime/logistics/geographies?countryCode=NG&search=${encodeURIComponent(debouncedSearch)}`,
      RecordArraySchema,
      { signal },
    ),
    staleTime: 60_000,
  });
  const selectedName = selected ? asString(selected, "canonical_name", "display_name") : null;
  return (
    <View style={styles.group}>
      <AppField
        label={label}
        value={selectedName ?? value}
        onChangeText={(text) => onChange(text)}
        onSubmitEditing={() => undefined}
        placeholder="Search city, town or LGA"
        autoCorrect={false}
        returnKeyType="search"
        leading={<MapPin color={selected ? palette.success : palette.muted} size={17} />}
        error={error}
      />
      {selected ? (
        <View style={[styles.selected, { backgroundColor: palette.successSoft, borderColor: palette.success }]}>
          <View style={[styles.selectedIcon, { backgroundColor: palette.surface }]}><Check color={palette.success} size={15} /></View>
          <View style={styles.selectedCopy}>
            <Text style={[styles.selectedTitle, { color: palette.ink }]}>{selectedName}</Text>
            <Text style={[styles.selectedMeta, { color: palette.muted }]}>{asString(selected, "country_code") ?? "NG"} · Selected location</Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => onChange("")}><Text style={[styles.change, { color: palette.brand }]}>Change</Text></Pressable>
        </View>
      ) : search.length < 2 ? (
        <View style={styles.hintRow}>
          <Search color={palette.muted} size={13} />
          <Text style={[styles.hint, { color: palette.muted }]}>Enter at least two letters to find a location.</Text>
        </View>
      ) : query.isPending ? (
        <View style={[styles.resultsState, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
          <Text style={[styles.hint, { color: palette.muted }]}>Searching SKIMA locations…</Text>
        </View>
      ) : query.error ? (
        <View style={[styles.resultsState, { backgroundColor: palette.dangerSoft, borderColor: palette.danger }]}>
          <Text style={[styles.hint, { color: palette.danger }]}>Locations could not be loaded. Check your connection and try again.</Text>
        </View>
      ) : (query.data ?? []).length ? (
        <View style={[styles.results, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {(query.data ?? []).slice(0, 6).map((place) => {
            const id = asString(place, "id");
            const name = asString(place, "canonical_name") ?? "Location";
            const parent = asString(place, "parent_name", "state_name", "lga_name") ?? "Nigeria";
            return (
              <Pressable key={id ?? name} accessibilityRole="button" onPress={() => onSelect(place)}
                style={({ pressed }) => [styles.resultRow, pressed && { backgroundColor: palette.brandSofter }]}>
                <View style={[styles.resultIcon, { backgroundColor: palette.brandSoft }]}><MapPin color={palette.brand} size={15} /></View>
                <View style={styles.resultCopy}>
                  <Text style={[styles.resultTitle, { color: palette.ink }]}>{name}</Text>
                  <Text style={[styles.resultMeta, { color: palette.muted }]}>{parent}</Text>
                </View>
                <Check color={palette.borderStrong} size={15} />
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={[styles.resultsState, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
          <Text style={[styles.hint, { color: palette.muted }]}>No matching active location found. Try another spelling or a nearby town.</Text>
        </View>
      )}
    </View>
  );
}
const styles = StyleSheet.create({
  group: { gap: 8 },
  selected: { flexDirection: "row", alignItems: "center", gap: 9, borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, padding: 10 },
  selectedIcon: { width: 30, height: 30, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  selectedCopy: { flex: 1, gap: 2 },
  selectedTitle: { ...typography.bodyStrong, fontSize: 12 },
  selectedMeta: { ...typography.caption, fontSize: 9 },
  change: { ...typography.caption, fontSize: 10, fontWeight: "900" },
  hintRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 3 },
  hint: { ...typography.caption, fontSize: 10, lineHeight: 15 },
  results: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.lg, overflow: "hidden" },
  resultRow: { minHeight: 57, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: "rgba(128,128,128,.16)" },
  resultIcon: { width: 31, height: 31, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  resultCopy: { flex: 1, gap: 2 },
  resultTitle: { ...typography.bodyStrong, fontSize: 12 },
  resultMeta: { ...typography.caption, fontSize: 9 },
  resultsState: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md },
});
