import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { LpgMobileApp } from "./App";
import { LpgSessionProvider } from "./session";
import "./styles.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <LpgSessionProvider>
        <LpgMobileApp />
      </LpgSessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
