import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";
import { PlatformRecordSchema } from "./records";

const NotificationCenterSchema = z.object({
  items: z.array(PlatformRecordSchema),
  unreadCount: z.number().int().nonnegative(),
  totalCount: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  hasMore: z.boolean(),
});

export type NotificationCenter = z.infer<typeof NotificationCenterSchema>;

export function useNotificationCenter(limit: number, includeRead: boolean) {
  const session = useSession();
  return useQuery({
    queryKey: ["lpg-expo", "notification-center", limit, includeRead],
    enabled: session.status === "authenticated",
    refetchInterval: 30000,
    queryFn: async () => {
      const result = await session.supabase.rpc("read_notification_center", {
        target_limit: limit,
        target_offset: 0,
        target_include_read: includeRead,
      });
      if (result.error) throw result.error;
      return NotificationCenterSchema.parse(result.data);
    },
  });
}

export function useMarkNotificationRead() {
  const session = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ messageId, read = true }: { messageId: string; read?: boolean }) => {
      const result = await session.supabase.rpc("mark_notification_read", {
        target_message_id: messageId,
        target_read: read,
      });
      if (result.error) throw result.error;
      return result.data as string;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["lpg-expo", "notification-center"] });
    },
  });
}

export function useMarkAllNotificationsRead() {
  const session = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const result = await session.supabase.rpc("mark_all_notifications_read");
      if (result.error) throw result.error;
      return typeof result.data === "number" ? result.data : 0;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["lpg-expo", "notification-center"] });
    },
  });
}
