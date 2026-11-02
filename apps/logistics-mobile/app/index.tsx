import { Redirect } from "expo-router";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { useSession } from "../src/session/SessionProvider";
import { useAppTheme } from "../src/theme/ThemeProvider";
import { BrandMark } from "../src/ui/BrandMark";

export default function IndexRoute() {
  const { status } = useSession();
  const { palette } = useAppTheme();
  if (status === "loading") {
    return (
      <View style={[styles.loading, { backgroundColor: palette.canvas }]}>
        <BrandMark />
        <ActivityIndicator color={palette.brand} size="large" />
      </View>
    );
  }
  return <Redirect href={status === "authenticated" ? "/(customer)" : "/(auth)/sign-in"} />;
}
const styles = StyleSheet.create({ loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 24 } });
