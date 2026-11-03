import { Redirect } from "expo-router";
import { ProviderTabs } from "../../src/navigation/ProviderTabs";
import { useSession } from "../../src/session/SessionProvider";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useAppTheme } from "../../src/theme/ThemeProvider";

export default function ProviderLayout() {
  const { status } = useSession();
  const { palette } = useAppTheme();
  if (status === "loading") return <View style={[styles.loading, { backgroundColor: palette.canvas }]}><ActivityIndicator color={palette.brand} size="large" /></View>;
  if (status !== "authenticated") return <Redirect href="/(auth)/sign-in" />;
  return <ProviderTabs />;
}
const styles = StyleSheet.create({ loading: { flex: 1, alignItems: "center", justifyContent: "center" } });
