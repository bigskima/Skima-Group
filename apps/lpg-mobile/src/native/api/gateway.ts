import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { z } from "zod";
import { useSession } from "../session/SessionProvider";

export function useGatewayQuery<T>(input: {
  key: readonly unknown[];
  path: string;
  schema: z.ZodType<T>;
  enabled?: boolean;
  refetchInterval?: number;
  persist?: boolean;
  globalError?: boolean;
}) {
  const session = useSession();
  return useQuery({
    queryKey: [
      "lpg-expo",
      ...input.key,
      session.session?.user.id ?? "anonymous",
    ],
    enabled: session.status === "authenticated" && (input.enabled ?? true),
    queryFn: ({ signal }) =>
      session.api.get(input.path, input.schema, { signal }),
    refetchInterval: input.refetchInterval,
    meta: {
      globalError: input.globalError === true,
      persist: input.persist === true,
    },
  });
}
export function useGatewayMutation<T, V>(input: {
  path: string;
  schema: z.ZodType<T>;
  invalidate?: readonly (readonly unknown[])[];
}) {
  const session = useSession();
  const client = useQueryClient();
  return useMutation<T, Error, V>({
    mutationFn: (body) => session.api.post(input.path, body, input.schema),
    onSuccess: async () => {
      for (const key of input.invalidate ?? [])
        await client.invalidateQueries({ queryKey: ["lpg-expo", ...key] });
    },
  });
}
