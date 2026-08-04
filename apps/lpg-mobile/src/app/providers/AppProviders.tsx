import type { ReactNode } from "react";

import { ErrorBoundary } from "./ErrorBoundary";
import { QueryProvider } from "./QueryProvider";
import { SessionProvider } from "./SessionProvider";
import { ThemeProvider } from "./ThemeProvider";

export function AppProviders(props: { readonly children: ReactNode }) {
  return (
    <ErrorBoundary>
      <QueryProvider>
        <SessionProvider>
          <ThemeProvider>{props.children}</ThemeProvider>
        </SessionProvider>
      </QueryProvider>
    </ErrorBoundary>
  );
}
