import { useQuery } from "@tanstack/react-query";
import { z } from "zod";

import { useSession } from "../session/SessionProvider";

const ManagedDriverEarningsSchema = z.object({
  isManaged: z.boolean(),
  driverProfileId: z.string().uuid().nullable(),
  currencyCode: z.string(),
  pendingEarnings: z.coerce.number(),
  availableForPayout: z.coerce.number(),
  paidToWallet: z.coerce.number(),
  lifetimeEarnings: z.coerce.number(),
  driverWalletId: z.string().uuid().nullable(),
  driverWalletBalance: z.coerce.number(),
  lastPaidAt: z.string().nullable(),
});

export type ManagedDriverEarnings = z.infer<typeof ManagedDriverEarningsSchema>;

export function useManagedDriverEarnings(enabled: boolean) {
  const session = useSession();

  return useQuery({
    queryKey: ["lpg-expo", "managed-driver-earnings"],
    enabled: enabled && session.status === "authenticated",
    refetchInterval: 30000,
    queryFn: async () => {
      const result = await session.supabase.rpc("read_my_lpg_managed_driver_earnings");
      if (result.error) throw result.error;
      return ManagedDriverEarningsSchema.parse(result.data);
    },
  });
}
