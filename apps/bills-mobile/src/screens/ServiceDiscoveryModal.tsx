import { useQuery } from "@tanstack/react-query";
import type { SupabaseClient } from "@supabase/supabase-js";
import { useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useAppTheme } from "../theme/ThemeProvider";

type ServiceLink = {
  service_key: string;
  display_name: string;
  description: string;
  web_url: string;
  android_store_url: string | null;
  ios_store_url: string | null;
  sort_order: number;
};

type Props = {
  visible: boolean;
  currentServiceKey: string;
  title: string;
  message: string;
  supabase: SupabaseClient;
  onClose: () => void;
};

export function ServiceDiscoveryModal(props: Props) {
  const { palette } = useAppTheme();
  const [opening, setOpening] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const links = useQuery({
    queryKey: ["customer-service-discovery-links"],
    enabled: props.visible,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await props.supabase
        .from("customer_service_discovery_links")
        .select("service_key,display_name,description,web_url,android_store_url,ios_store_url,sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as ServiceLink[];
    },
  });
  const choices = (links.data ?? []).filter((item) => item.service_key !== props.currentServiceKey);

  const openService = async (item: ServiceLink) => {
    const storeUrl = Platform.OS === "android"
      ? item.android_store_url
      : Platform.OS === "ios"
        ? item.ios_store_url
        : null;
    const destination = storeUrl || item.web_url;
    if (!/^https?:\/\//i.test(destination)) {
      setOpenError("This service link is not available yet.");
      return;
    }
    setOpening(item.service_key);
    setOpenError(null);
    try {
      await Linking.openURL(destination);
      props.onClose();
    } catch {
      setOpenError("We could not open that service right now. Please try again.");
    } finally {
      setOpening(null);
    }
  };

  return (
    <Modal visible={props.visible} transparent animationType="fade" statusBarTranslucent onRequestClose={props.onClose}>
      <View style={styles.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} accessibilityLabel="Close service list" />
        <View style={[styles.dialog, { backgroundColor: palette.surface, borderColor: palette.border }]}>
          <View style={styles.headingRow}>
            <View style={[styles.iconWrap, { backgroundColor: palette.brandSoft }]}>
              <Text style={[styles.iconText, { color: palette.brand }]}>S</Text>
            </View>
            <Pressable onPress={props.onClose} hitSlop={12} accessibilityRole="button" accessibilityLabel="Close">
              <Text style={[styles.close, { color: palette.muted }]}>×</Text>
            </Pressable>
          </View>
          <Text style={[styles.title, { color: palette.ink }]}>{props.title}</Text>
          <Text style={[styles.message, { color: palette.muted }]}>{props.message}</Text>
          {links.isPending ? (
            <View style={styles.loading}>
              <ActivityIndicator color={palette.brand} />
              <Text style={[styles.message, { color: palette.muted }]}>Loading services…</Text>
            </View>
          ) : choices.length ? (
            <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
              {choices.map((item) => (
                <Pressable
                  key={item.service_key}
                  accessibilityRole="button"
                  disabled={opening !== null}
                  onPress={() => void openService(item)}
                  style={({ pressed }) => [
                    styles.service,
                    { borderColor: palette.border, backgroundColor: pressed ? palette.surfaceSubtle : palette.surface },
                  ]}
                >
                  <View style={styles.serviceCopy}>
                    <Text style={[styles.serviceTitle, { color: palette.ink }]}>{item.display_name}</Text>
                    {item.description ? <Text style={[styles.serviceDescription, { color: palette.muted }]}>{item.description}</Text> : null}
                  </View>
                  {opening === item.service_key
                    ? <ActivityIndicator color={palette.brand} />
                    : <Text style={[styles.arrow, { color: palette.brand }]}>›</Text>}
                </Pressable>
              ))}
            </ScrollView>
          ) : (
            <Text style={[styles.message, { color: palette.muted }]}>More SKIMA services will appear here soon.</Text>
          )}
          {links.isError ? <Text style={[styles.error, { color: palette.danger }]}>Service links could not be loaded. Please try again later.</Text> : null}
          {openError ? <Text style={[styles.error, { color: palette.danger }]}>{openError}</Text> : null}
          <Pressable onPress={props.onClose} accessibilityRole="button" style={[styles.done, { backgroundColor: palette.brand }]}>
            <Text style={styles.doneText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(10, 12, 16, 0.58)", justifyContent: "center", alignItems: "center", padding: 18 },
  dialog: { width: "100%", maxWidth: 480, maxHeight: "86%", borderWidth: 1, borderRadius: 24, padding: 20, gap: 12, overflow: "hidden" },
  headingRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  iconWrap: { width: 42, height: 42, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  iconText: { fontSize: 20, fontWeight: "900" },
  close: { fontSize: 28, lineHeight: 30, fontWeight: "700" },
  title: { fontSize: 21, fontWeight: "900" },
  message: { fontSize: 13, lineHeight: 19 },
  loading: { alignItems: "center", justifyContent: "center", padding: 18, gap: 8 },
  list: { flexGrow: 0, maxHeight: 340 },
  listContent: { gap: 8, paddingVertical: 2 },
  service: { minHeight: 66, borderWidth: 1, borderRadius: 15, padding: 13, flexDirection: "row", alignItems: "center", gap: 10 },
  serviceCopy: { flex: 1, gap: 3 },
  serviceTitle: { fontSize: 14, fontWeight: "800" },
  serviceDescription: { fontSize: 11, lineHeight: 16 },
  arrow: { fontSize: 25, fontWeight: "900" },
  error: { fontSize: 11, lineHeight: 16 },
  done: { minHeight: 46, borderRadius: 14, alignItems: "center", justifyContent: "center", padding: 10 },
  doneText: { color: "#FFFFFF", fontSize: 13, fontWeight: "900" },
});
