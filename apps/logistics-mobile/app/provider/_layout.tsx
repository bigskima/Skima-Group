import { Redirect, Stack } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useSession } from "../../src/session/SessionProvider";
import { useAppTheme } from "../../src/theme/ThemeProvider";

export default function LegacyProviderLayout() {
  const { status } = useSession();
  const { palette } = useAppTheme();

  if (status === "loading") {
    return (
      <View style={[styles.loading, { backgroundColor: palette.canvas }]}>
        <ActivityIndicator color={palette.brand} size="large" />
      </View>
    );
  }
  if (status !== "authenticated") return <Redirect href="/(auth)/sign-in" />;

  // Legacy /provider URLs are retained as stack routes only. The canonical
  // provider navigation lives under /(provider), with its four explicit tabs.
  return <Stack screenOptions={{ headerShown: false }} />;
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
