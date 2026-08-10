import { Redirect } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useSession } from "../src/native/session/SessionProvider";
import { useAppTheme } from "../src/native/theme/ThemeProvider";
import { ScreenSkeleton } from "../src/native/ui/ScreenSkeleton";

export default function Index() {
  const session = useSession();
  const { palette } = useAppTheme();
  if (session.status === "loading")
    return (
      <View style={[styles.loading, { backgroundColor: palette.canvas }]}>
        <ScreenSkeleton cards={4} />
      </View>
    );
  if (session.status !== "authenticated")
    return <Redirect href="/(auth)/welcome" />;
  return <Redirect href="/(customer)" />;
}
const styles = StyleSheet.create({
  loading: {
    flex: 1,
    padding: 24,
  },
});
