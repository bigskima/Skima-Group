import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { z } from "zod";
import { Check, MapPin, Search } from "lucide-react-native";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { RecordArraySchema, asString } from "../api/logistics";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { radii, spacing, typography } from "../theme/tokens";
import { AppField } from "./AppField";

type Place = Record<string, unknown>;
type PickerMode = "address" | "service_area";

const AutocompleteSchema = z.object({
  predictions: z.array(z.record(z.string(), z.unknown())),
  provider: z.string().optional(),
  providerAttribution: z.string().optional(),
});

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function normalized(value: string | null | undefined) {
  return (value ?? "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
}

function geographyMatches(place: Place, candidates: readonly string[]) {
  const name = normalized(asString(place, "canonical_name"));
  const aliases = Array.isArray(place.aliases)
    ? place.aliases.filter((alias): alias is string => typeof alias === "string").map(normalized)
    : [];
  return candidates.some((candidate) => {
    const target = normalized(candidate);
    return target && (name === target || aliases.includes(target));
  });
}

function nearestGeography(prediction: Place, geographies: readonly Place[]) {
  const address = objectValue(prediction.addressComponents ?? prediction.address_components) ?? {};
  const localityCandidates = [
    asString(address, "village"),
    asString(address, "town"),
    asString(address, "subLocality"),
    asString(address, "locality"),
    asString(address, "city"),
    asString(address, "name"),
    asString(address, "district"),
    asString(address, "lga"),
  ].filter((value): value is string => Boolean(value));
  const lgaCandidates = [
    asString(address, "lga"),
    asString(address, "district"),
    asString(address, "city_district"),
    asString(address, "suburb"),
  ].filter((value): value is string => Boolean(value));
  const stateCandidates = [
    asString(address, "state"),
    asString(address, "region"),
  ].filter((value): value is string => Boolean(value));

  const specific = geographies.find((item) => geographyMatches(item, localityCandidates));
  if (specific) return specific;
  const lga = geographies.find((item) => geographyMatches(item, lgaCandidates));
  if (lga) return lga;
  const state = geographies.find((item) => geographyMatches(item, stateCandidates));
  if (state) return state;
  return geographies.find((item) => /state$/i.test(asString(item, "canonical_name") ?? "")) ??
    geographies.find((item) => normalized(asString(item, "canonical_name")) === "nigeria") ??
    null;
}

function toAddressPlace(prediction: Place, geographies: readonly Place[]): Place | null {
  const description = asString(prediction, "description", "formattedAddress", "formatted_address");
  const location = objectValue(prediction.location);
  const geography = nearestGeography(prediction, geographies);
  const id = asString(geography, "id");
  if (!description || !id) return null;
  const address = objectValue(prediction.addressComponents ?? prediction.address_components) ?? {};
  const state = asString(address, "state", "region");
  const locality = asString(address, "village", "town", "subLocality", "locality", "city", "district");
  const lga = asString(address, "lga", "city_district");
  const country = asString(address, "country") ?? "Nigeria";
  const context = [locality, lga, state, country].filter(Boolean).join(" · ");
  return {
    id,
    canonical_name: description,
    display_name: description,
    formatted_address: asString(prediction, "formattedAddress", "formatted_address") ?? description,
    parent_name: context || asString(geography, "canonical_name") || "Nigeria",
    country_code: "NG",
    address_components: address,
    location: location,
    place_id: asString(prediction, "placeId", "place_id"),
    location_source: "locationiq",
    geography_source: "canonical_parent",
  };
}

function uniquePlaces(geographies: readonly Place[], predictions: readonly Place[]) {
  const used = new Set<string>();
  const result: Place[] = [];
  for (const place of [...geographies, ...predictions]) {
    const name = asString(place, "canonical_name", "description");
    const key = normalized(name);
    if (!name || used.has(key)) continue;
    used.add(key);
    result.push(place);
  }
  return result;
}

export function GeographyPicker({ label, value, selected, onChange, onSelect, error, mode = "address", searchContext }: {
  label: string;
  value: string;
  selected: Place | null;
  onChange(value: string): void;
  onSelect(place: Place): void;
  error?: string | null;
  mode?: PickerMode;
  searchContext?: string;
}) {
  const { palette } = useAppTheme();
  const { api, status } = useSession();
  const search = value.trim();
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 260);
    return () => clearTimeout(handle);
  }, [search]);

  const query = useQuery<Place[]>({
    queryKey: ["skima-logistics", "geography-search", debouncedSearch.toLowerCase()],
    enabled: status === "authenticated" && !selected && debouncedSearch.length >= 2,
    queryFn: ({ signal }) => api.get(
      `/runtime/logistics/geographies?countryCode=NG&search=${encodeURIComponent(debouncedSearch)}`,
      RecordArraySchema,
      { signal },
    ),
    staleTime: 60_000,
  });
  const lookupText = useMemo(() => {
    const context = searchContext?.trim();
    const suffix = context ? `, ${context}, Nigeria` : ", Nigeria";
    return `${debouncedSearch.trim()}${/\bnigeria\b/i.test(debouncedSearch) ? "" : suffix}`;
  }, [debouncedSearch, searchContext]);
  const autocomplete = useQuery({
    queryKey: ["skima-logistics", "address-autocomplete", lookupText.toLowerCase()],
    enabled: status === "authenticated" && mode === "address" && !selected && debouncedSearch.length >= 3,
    queryFn: ({ signal }) => api.post(
      "/lpg/maps/autocomplete",
      { input: lookupText },
      AutocompleteSchema,
      { signal },
    ),
    staleTime: 60_000,
    retry: 1,
  });

  const addressPredictions = useMemo(() => {
    const available = query.data ?? [];
    return (autocomplete.data?.predictions ?? [])
      .map((item) => toAddressPlace(item, available))
      .filter((item): item is Place => item !== null);
  }, [autocomplete.data, query.data]);
  const places = useMemo(() => mode === "service_area"
    ? (query.data ?? [])
    : uniquePlaces(query.data ?? [], addressPredictions), [mode, query.data, addressPredictions]);
  const selectedName = selected ? asString(selected, "canonical_name", "display_name") : null;
  const loading = query.isPending || (mode === "address" && debouncedSearch.length >= 3 && autocomplete.isPending);
  const searchFailed = Boolean(query.error) && (mode === "service_area" || Boolean(autocomplete.error));
  const manualBase = (query.data ?? []).find((item) =>
    /state$/i.test(asString(item, "canonical_name") ?? "")
  ) ?? (query.data ?? []).find((item) => normalized(asString(item, "canonical_name")) === "nigeria");
  const useManualAddress = () => {
    const id = asString(manualBase, "id");
    if (!id || !search) return;
    onSelect({
      id,
      canonical_name: search,
      display_name: search,
      formatted_address: search,
      parent_name: asString(manualBase, "canonical_name") ?? "Nigeria",
      country_code: "NG",
      location_source: "manual",
      geography_source: "canonical_parent",
    });
  };

  return (
    <View style={styles.group}>
      <AppField
        label={label}
        value={selectedName ?? value}
        onChangeText={onChange}
        onSubmitEditing={() => undefined}
        placeholder={mode === "service_area" ? "Search state, LGA or service area" : "Search town, street, landmark or house address"}
        autoCorrect={false}
        returnKeyType="search"
        leading={<MapPin color={selected ? palette.success : palette.muted} size={17} />}
        error={error}
      />
      {selected ? (
        <View style={[styles.selected, { backgroundColor: palette.successSoft, borderColor: palette.success }]}>
          <View style={[styles.selectedIcon, { backgroundColor: palette.surface }]}><Check color={palette.success} size={15} /></View>
          <View style={styles.selectedCopy}>
            <Text style={[styles.selectedTitle, { color: palette.ink }]} numberOfLines={2}>{selectedName}</Text>
            <Text style={[styles.selectedMeta, { color: palette.muted }]}>
              {asString(selected, "parent_name") ?? asString(selected, "country_code") ?? "NG"}
              {asString(selected, "location_source") === "manual" ? " · Manual address" : asString(selected, "location_source") === "locationiq" ? " · Address result" : " · Service area"}
            </Text>
          </View>
          <Pressable accessibilityRole="button" onPress={() => onChange("")}><Text style={[styles.change, { color: palette.brand }]}>Change</Text></Pressable>
        </View>
      ) : search.length < 2 ? (
        <View style={styles.hintRow}>
          <Search color={palette.muted} size={13} />
          <Text style={[styles.hint, { color: palette.muted }]}>
            {mode === "service_area" ? "Enter a state, LGA or town." : "Enter a town, street, bus stop, landmark or house number."}
          </Text>
        </View>
      ) : loading ? (
        <View style={[styles.resultsState, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
          <Text style={[styles.hint, { color: palette.muted }]}>Searching Nigeria locations and address suggestions…</Text>
        </View>
      ) : places.length ? (
        <View style={[styles.results, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          {places.slice(0, 8).map((place, index) => {
            const id = asString(place, "id");
            const name = asString(place, "canonical_name", "description") ?? "Location";
            const parent = asString(place, "hierarchy_path", "parent_name", "state_name", "lga_name") ?? "Nigeria";
            const source = asString(place, "location_source");
            return (
              <Pressable key={id ? `${id}:${name}` : `${name}:${index}`} accessibilityRole="button" onPress={() => onSelect(place)}
                style={({ pressed }) => [styles.resultRow, pressed && { backgroundColor: palette.brandSofter }]}>
                <View style={[styles.resultIcon, { backgroundColor: palette.brandSoft }]}><MapPin color={palette.brand} size={15} /></View>
                <View style={styles.resultCopy}>
                  <Text style={[styles.resultTitle, { color: palette.ink }]} numberOfLines={2}>{name}</Text>
                  <Text style={[styles.resultMeta, { color: palette.muted }]} numberOfLines={2}>
                    {parent}{source === "locationiq" ? " · Detailed address" : ""}
                  </Text>
                </View>
                <Check color={palette.borderStrong} size={15} />
              </Pressable>
            );
          })}
        </View>
      ) : (
        <View style={[styles.resultsState, { backgroundColor: palette.surfaceSubtle, borderColor: palette.border }]}>
          <Text style={[styles.hint, { color: palette.muted }]}>
            {searchFailed ? "The location catalogue or address service is unavailable." : "No exact result in SKIMA's catalogue. You can still enter the full address manually."}
          </Text>
          {mode === "address" && manualBase && search.length >= 3 ? (
            <Pressable accessibilityRole="button" onPress={useManualAddress} style={[styles.manualButton, { borderColor: palette.borderStrong }]}>
              <Text style={[styles.manualTitle, { color: palette.brand }]}>Use “{search}” as a manual address</Text>
              <Text style={[styles.hint, { color: palette.muted }]}>It will be associated with {asString(manualBase, "canonical_name")}; add the street, nearby bus stop or house number in the address.</Text>
            </Pressable>
          ) : null}
        </View>
      )}
      {mode === "address" && !selected && autocomplete.data?.providerAttribution ? (
        <Text style={[styles.attribution, { color: palette.muted }]}>{autocomplete.data.providerAttribution}</Text>
      ) : null}
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
  resultsState: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.md, gap: spacing.sm },
  manualButton: { borderWidth: StyleSheet.hairlineWidth, borderRadius: radii.md, padding: spacing.sm, gap: 3 },
  manualTitle: { ...typography.caption, fontSize: 11, fontWeight: "900" },
  attribution: { ...typography.caption, fontSize: 8, lineHeight: 12 },
});
