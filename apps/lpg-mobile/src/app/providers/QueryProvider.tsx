import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

export function QueryProvider(props: { readonly children: ReactNode }) {
  const [client] = useState(() => new QueryClient({
    defaultOptions: {
      mutations: { retry: 0 },
      queries: {
        refetchOnReconnect: true,
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 30_000,
      },
    },
  }));

  return <QueryClientProvider client={client}>{props.children}</QueryClientProvider>;
}
