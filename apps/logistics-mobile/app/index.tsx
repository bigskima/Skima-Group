import { Redirect } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSession } from "../src/session/SessionProvider";
import { useAppTheme } from "../src/theme/ThemeProvider";
import { ScreenSkeleton } from "../src/ui/ScreenSkeleton";

export default function IndexRoute() {
  const { status } = useSession();
  const { palette } = useAppTheme();
  if (status === "loading") {
    return (
      <View style={[styles.loading, { backgroundColor: palette.canvas }]}>
        <ScreenSkeleton variant="dashboard" cards={2} />
      </View>
    );
  }
  return <Redirect href={status === "authenticated" ? "/(customer)" : "/(auth)/sign-in"} />;
}
const styles = StyleSheet.create({ loading: { flex: 1, justifyContent: "center", gap: 24, padding: 18, paddingTop: 52 } });
