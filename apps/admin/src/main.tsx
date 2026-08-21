import { Component, type ErrorInfo, type ReactNode, StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LayoutDashboard, WalletCards } from "lucide-react";

import "@skima/ui/styles.css";
import "./styles.css";
import "./production-ui.css";
import "./admin-grade.css";

import { ErrorState, type NavItem } from "@skima/ui";
import { App } from "./App";
import { AdminShell } from "./AdminShell";
import { AdminRevenueWorkspace } from "./admin-revenue-workspace";
import { SessionProvider, useSessionState } from "./session";

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

function AdminRoot() {
  const sessionState = useSessionState();
  const [route, setRoute] = useState(readHashRoute);

  useEffect(() => {
    const handleHashChange = () => setRoute(readHashRoute());
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  const navigate = (href: string) => {
    window.location.hash = href === "/" ? "" : href;
    setRoute(href);
  };

  if (route === "/revenue" && sessionState.status === "authenticated" && sessionState.context) {
    const revenueNavigation: readonly NavItem[] = [
      { key: "overview", label: "Overview", href: "/", icon: LayoutDashboard },
      { key: "finance", label: "Finance", href: "/finance", icon: WalletCards },
      { key: "revenue", label: "Money & Revenue", href: "/revenue", icon: WalletCards },
    ];

    return (
      <AdminShell
        brand="Skima"
        navItems={revenueNavigation}
        activeHref="/revenue"
        contextLabel={sessionState.context.platformAdmin?.title ?? "Platform administrator"}
        userLabel={sessionState.context.profile?.display_name ?? sessionState.context.user.email ?? "Administrator"}
        onNavigate={navigate}
        onSignOut={sessionState.signOut}
      >
        <AdminRevenueWorkspace onOpenFinance={() => navigate("/finance")} />
      </AdminShell>
    );
  }

  return <App />;
}

function readHashRoute(): string {
  const value = window.location.hash.replace(/^#/, "").trim();
  if (!value) return "/";
  return value.startsWith("/") ? value : `/${value}`;
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <AppErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <AdminRoot />
        </SessionProvider>
      </QueryClientProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
