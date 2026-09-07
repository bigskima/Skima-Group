import { Component, type ErrorInfo, type ReactNode, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

import "@skima/ui/styles.css";
import "./styles.css";
import "./production-ui.css";
import "./admin-grade.css";

import { ErrorState } from "@skima/ui";
import { App } from "./App";
import { SessionProvider } from "./session";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 30_000,
    },
  },
});

interface AppErrorBoundaryState {
  readonly message: string | null;
}

class AppErrorBoundary extends Component<
  { readonly children: ReactNode },
  AppErrorBoundaryState
> {
  readonly state: AppErrorBoundaryState = {
    message: null,
  };

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    return {
      message: error instanceof Error ? error.message : "This area could not be displayed.",
    };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error("Skima frontend render error", { error, info });
  }

  render() {
    if (this.state.message) {
      return (
        <main className="skima-auth-page">
          <ErrorState title="Page unavailable" message={this.state.message} />
        </main>
      );
    }

    return this.props.children;
  }
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <App />
        </SessionProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
