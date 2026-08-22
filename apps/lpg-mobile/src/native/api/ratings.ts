import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { useSession } from "../session/SessionProvider";
import { idempotencyKey } from "../utilities/idempotency";

const RatingStateSchema = z.object({
  eligible: z.boolean(),
  orderId: z.string().uuid(),
  driverProfileId: z.string().uuid().nullable().optional(),
  stationBranchId: z.string().uuid().nullable().optional(),
  driverRating: z.number().int().min(1).max(5).nullable().optional(),
  stationRating: z.number().int().min(1).max(5).nullable().optional(),
});

export type RatingSubject = "driver" | "station";
export type ComplaintSubject = "driver" | "station" | "order" | "payment" | "cylinder";
export type ComplaintCategory =
  | "underfill"
  | "safety"
  | "lost_cylinder"
  | "switched_cylinder"
  | "damaged_cylinder"
  | "delivery"
  | "payment"
  | "conduct"
  | "fraud"
  | "pricing"
  | "other";

export function useOrderRatingState(orderId: string | null) {
  const session = useSession();
  return useQuery({
    queryKey: ["lpg", "order-rating-state", orderId],
    enabled: session.status === "authenticated" && Boolean(orderId),
    retry: 1,
    queryFn: async () => {
      const { data, error } = await session.supabase.rpc("read_lpg_order_rating_state", {
        target_order_id: orderId,
      });
      if (error) throw error;
      return RatingStateSchema.parse(data);
    },
  });
}

export function useSubmitLpgRating(orderId: string, subject: RatingSubject) {
  const session = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ rating, feedbackTags, comment }: { rating: number; feedbackTags: string[]; comment: string }) => {
      if (session.status !== "authenticated") throw new Error("Sign in to rate this service.");
      const { data, error } = await session.supabase.rpc("submit_lpg_rating", {
        target_order_id: orderId,
        target_subject_type: subject,
        target_rating: rating,
        target_feedback_tags: feedbackTags,
        target_comment: comment.trim() || null,
        target_source: "skima.lpg.mobile",
        target_idempotency_key: idempotencyKey("lpg-rating", `${orderId}:${subject}`),
        target_metadata: { surface: "customer_order_rating" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["lpg", "order-rating-state", orderId] });
    },
  });
}

export function useCreateLpgComplaint(orderId: string) {
  const session = useSession();
  return useMutation({
    mutationFn: async ({
      subject,
      category,
      description,
      severity,
    }: {
      subject: ComplaintSubject;
      category: ComplaintCategory;
      description: string;
      severity: "standard" | "high" | "critical";
    }) => {
      if (session.status !== "authenticated") throw new Error("Sign in to report this issue.");
      const { data, error } = await session.supabase.rpc("create_lpg_service_complaint", {
        target_order_id: orderId,
        target_subject_type: subject,
        target_category: category,
        target_description: description.trim(),
        target_severity: severity,
        target_source: "skima.lpg.mobile",
        target_idempotency_key: idempotencyKey("lpg-complaint", `${orderId}:${subject}:${category}`),
        target_metadata: { surface: "customer_order_issue" },
      });
      if (error) throw error;
      return data;
    },
  });
}
