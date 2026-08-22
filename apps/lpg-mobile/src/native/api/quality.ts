import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";

import { useSession } from "../session/SessionProvider";
import { idempotencyKey } from "../utilities/idempotency";

const RatingStateSchema = z.object({
  eligible: z.boolean(),
  orderId: z.string().uuid(),
  driverProfileId: z.string().uuid().nullable(),
  stationBranchId: z.string().uuid().nullable(),
  driverRating: z.number().int().min(1).max(5).nullable(),
  stationRating: z.number().int().min(1).max(5).nullable(),
});

const PartnerReputationSchema = z.object({
  subjectType: z.enum(["driver", "station"]),
  subjectId: z.string().uuid(),
  averageRating: z.coerce.number().min(1).max(5).nullable(),
  relationshipCount: z.coerce.number().int().nonnegative(),
  ratingEventCount: z.coerce.number().int().nonnegative(),
  recentAverageRating: z.coerce.number().min(1).max(5).nullable(),
  recentRatingCount: z.coerce.number().int().nonnegative(),
});

export type LpgOrderRatingState = z.infer<typeof RatingStateSchema>;
export type LpgPartnerReputation = z.infer<typeof PartnerReputationSchema>;

export function useLpgOrderRatingState(orderId: string | null) {
  const session = useSession();
  return useQuery({
    queryKey: ["lpg-quality", "order-rating-state", orderId],
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

export function useLpgPartnerReputation(
  subjectType: "driver" | "station",
  subjectId: string | null,
) {
  const session = useSession();
  return useQuery({
    queryKey: ["lpg-quality", "partner-reputation", subjectType, subjectId],
    enabled: Boolean(subjectId),
    retry: 1,
    queryFn: async () => {
      const { data, error } = await session.supabase.rpc("read_lpg_partner_reputation", {
        target_subject_type: subjectType,
        target_subject_id: subjectId,
      });
      if (error) throw error;
      return PartnerReputationSchema.parse(data);
    },
  });
}

export function useSubmitLpgRating(orderId: string) {
  const session = useSession();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      subjectType,
      rating,
      feedbackTags,
      comment,
    }: {
      readonly subjectType: "driver" | "station";
      readonly rating: number;
      readonly feedbackTags: readonly string[];
      readonly comment: string;
    }) => {
      const { data, error } = await session.supabase.rpc("submit_lpg_rating", {
        target_order_id: orderId,
        target_subject_type: subjectType,
        target_rating: rating,
        target_feedback_tags: [...feedbackTags],
        target_comment: comment.trim() || null,
        target_source: "skima.lpg.mobile",
        target_idempotency_key: idempotencyKey(
          "lpg-rating",
          `${orderId}:${subjectType}:${Date.now()}`,
        ),
        target_metadata: { surface: "order_feedback" },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: ["lpg-quality", "order-rating-state", orderId],
      });
    },
  });
}

export function useCreateLpgComplaint(orderId: string) {
  const session = useSession();
  return useMutation({
    mutationFn: async ({
      subjectType,
      category,
      severity,
      description,
    }: {
      readonly subjectType: "driver" | "station" | "order" | "payment" | "cylinder";
      readonly category:
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
      readonly severity: "standard" | "high" | "critical";
      readonly description: string;
    }) => {
      const { data, error } = await session.supabase.rpc("create_lpg_service_complaint", {
        target_order_id: orderId,
        target_subject_type: subjectType,
        target_category: category,
        target_description: description.trim(),
        target_severity: severity,
        target_source: "skima.lpg.mobile",
        target_idempotency_key: idempotencyKey("lpg-complaint", `${orderId}:${Date.now()}`),
        target_metadata: { surface: "order_feedback" },
      });
      if (error) throw error;
      return data;
    },
  });
}
