import { useQuery } from "@tanstack/react-query";
import type { ZodType } from "zod";

import { useSession } from "../../app/providers/SessionProvider";

export function useGatewayQuery<TData>(input: {
  readonly key: readonly unknown[];
  readonly path: string;
  readonly schema: ZodType<TData>;
  readonly enabled?: boolean;
}) {
  const session = useSession();

  return useQuery({
    enabled: session.status === "authenticated" && (input.enabled ?? true),
    queryFn: ({ signal }) => session.api.get(input.path, input.schema, { signal }),
    queryKey: ["lpg-mobile", ...input.key, input.path],
  });
}
