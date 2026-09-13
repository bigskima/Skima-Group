import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";
import { PlatformRecordSchema } from "./records";

const WalletActivitySchema = z.object({
  items: z.array(PlatformRecordSchema),
  totalCount: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
});

export type WalletActivity = z.infer<typeof WalletActivitySchema>;

export function useWalletActivity(walletId: string | null, limit = 25) {
  const session = useSession();
  return useQuery({
    queryKey: ["lpg-expo", "wallet-activity", walletId, limit],
    enabled: session.status === "authenticated" && Boolean(walletId),
    refetchInterval: 30000,
    queryFn: async () => {
      const result = await session.supabase.rpc("read_wallet_activity", {
        target_wallet_id: walletId,
        target_limit: limit,
        target_offset: 0,
      });
      if (result.error) throw result.error;
      return WalletActivitySchema.parse(result.data);
    },
  });
}
