import { QueryClient, QueryClientProvider, focusManager, onlineManager } from "@tanstack/react-query";
import { useEffect, useState, type PropsWithChildren } from "react";
import { AppState, Platform } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "../theme/ThemeProvider";
import { SessionProvider } from "../session/SessionProvider";
import { LogisticsGuideProvider } from "../onboarding/LogisticsGuideProvider";

export function AppProviders({ children }: PropsWithChildren) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { retry: 2, staleTime: 20_000, refetchOnWindowFocus: true } },
  }));
  useEffect(() => {
    onlineManager.setEventListener((setOnline) => NetInfo.addEventListener((state) =>
      setOnline(state.isConnected !== false && state.isInternetReachable !== false),
    ));
    if (Platform.OS !== "web") {
      const subscription = AppState.addEventListener("change", (state) => {
        focusManager.setFocused(state === "active");
      });
      return () => subscription.remove();
    }
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <SessionProvider><LogisticsGuideProvider>{children}</LogisticsGuideProvider></SessionProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
