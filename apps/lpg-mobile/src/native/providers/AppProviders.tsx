import NetInfo from "@react-native-community/netinfo";
import {
  QueryClient,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useEffect, useState, type PropsWithChildren } from "react";
import { AppState, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { SessionProvider } from "../session/SessionProvider";
import { useNotificationLifecycle } from "../notifications/useNotificationLifecycle";
import { BackendNotificationBridge } from "../notifications/BackendNotificationBridge";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { GlobalQueryFailure } from "./GlobalQueryFailure";

export function AppProviders({ children }: PropsWithChildren) {
  useNotificationLifecycle();
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 2, staleTime: 20_000 } },
      }),
  );
  const [persister] = useState(() =>
    createAsyncStoragePersister({
      storage: AsyncStorage,
      key: "skima:lpg:public-config-cache:v1",
    }),
  );
  useEffect(() => {
    onlineManager.setEventListener((setOnline) =>
      NetInfo.addEventListener((state) =>
        setOnline(Boolean(state.isConnected)),
      ),
    );
    if (Platform.OS !== "web")
      return AppState.addEventListener("change", (state) =>
        focusManager.setFocused(state === "active"),
      ).remove;
  }, []);
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PersistQueryClientProvider
          client={client}
          persistOptions={{
            persister,
            buster: "lpg-expo-v1",
            dehydrateOptions: {
              shouldDehydrateQuery: (query) => query.meta?.persist === true,
            },
          }}
        >
          <GlobalQueryFailure />
          <SessionProvider>
            <BackendNotificationBridge />
            <AppErrorBoundary>{children}</AppErrorBoundary>
          </SessionProvider>
        </PersistQueryClientProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
