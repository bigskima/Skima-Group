import { View } from "react-native";
import { StoreAuthScreen } from "../src/screens/StoreAuthScreen";
import { StoreApp } from "../src/screens/StoreApp";
import { useSession } from "../src/session/SessionProvider";
import { useAppTheme } from "../src/theme/ThemeProvider";
import { ScreenSkeleton } from "../src/ui/ScreenSkeleton";

export default function Index() {
  const { status } = useSession();
  const { palette } = useAppTheme();
  if (status === "loading") {
    return <View style={{ flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: palette.canvas, padding: 18, paddingTop: 52 }}>
      <ScreenSkeleton variant="dashboard" cards={2} />
    </View>;
  }
  return status === "authenticated" ? <StoreApp /> : <StoreAuthScreen />;
}
