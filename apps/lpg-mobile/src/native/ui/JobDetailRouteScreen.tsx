import { useQuery } from "@tanstack/react-query";
import { router, useLocalSearchParams } from "expo-router";
import { Clock3, PackageCheck, ShieldCheck } from "lucide-react-native";
import { z } from "zod";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";
import { AppButton } from "./AppButton";
import { EmptyState } from "./EmptyState";
import { JobDetailScreen } from "./JobDetailScreen";
import { RequestFailureState } from "./RequestFailureState";
import { Screen } from "./Screen";
import { ScreenSkeleton } from "./ScreenSkeleton";

const RouteStateSchema = z.object({
  state: z.enum(["accessible", "unavailable"]),
  reason: z.string().optional(),
  status: z.string().nullable().optional(),
  paymentStatus: z.string().nullable().optional(),
  publicReference: z.string().nullable().optional(),
});

export function JobDetailRouteScreen({ workspace }: { workspace: "driver" | "station" }) {
  const params = useLocalSearchParams<{ id?: string }>();
  const id = params.id ?? null;
  const session = useSession();
  const { palette } = useAppTheme();
  const routeState = useQuery({
    queryKey: ["lpg-expo", "job-route-state", workspace, id],
    enabled: session.status === "authenticated" && Boolean(id),
    staleTime: 10_000,
    queryFn: async () => {
      const result = await session.supabase.rpc("read_lpg_job_route_state", {
        target_lpg_order_id: id,
        target_workspace: workspace,
      });
      if (result.error) throw result.error;
      return RouteStateSchema.parse(result.data);
    },
  });

  if (!id) {
    return (
      <Screen eyebrow={workspace === "station" ? "Station job" : "Driver job"} title="Job unavailable">
        <EmptyState
          icon={<PackageCheck color={palette.brand} size={28} />}
          title="Job reference is missing"
          description="Return to your jobs and open the item again."
          action={<AppButton label="Back to jobs" onPress={() => router.replace(`/${workspace === "station" ? "(station)" : "(driver)"}/jobs` as never)} />}
        />
      </Screen>
    );
  }

  if (routeState.isPending) {
    return (
      <Screen eyebrow={workspace === "station" ? "Station job" : "Driver job"} title="Job details">
        <ScreenSkeleton cards={3} />
      </Screen>
    );
  }

  if (routeState.error) {
    return (
      <Screen
        eyebrow={workspace === "station" ? "Station job" : "Driver job"}
        title="Job unavailable"
        action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
      >
        <RequestFailureState
          error={routeState.error}
          onRetry={() => void routeState.refetch()}
          overrides={workspace === "station" ? {
            permission: {
              title: "This job is no longer available to your Station",
              description: "The job may have been reassigned, cancelled, completed outside your current branch access, or your Station permissions may have changed. Refresh the Station queue for the latest actionable jobs.",
            },
            role: {
              title: "Station job access restricted",
              description: "Your Station role no longer includes access to this job. Ask the Station Owner if you believe your role should include order access.",
            },
            station_scope: {
              title: "This job belongs to another Station",
              description: "The order is no longer assigned to this Station. Return to the queue to see current Station jobs.",
            },
          } : undefined}
        />
      </Screen>
    );
  }

  if (routeState.data?.state === "unavailable") {
    const reason = routeState.data.reason ?? "unavailable";
    const expired = reason === "payment_expired";
    return (
      <Screen
        eyebrow={workspace === "station" ? "Station job" : "Driver job"}
        title={routeState.data.publicReference ?? "Job unavailable"}
        subtitle="This record is retained for audit history but is no longer actionable."
        action={<AppButton label="Back" variant="ghost" size="sm" onPress={() => router.back()} />}
      >
        <EmptyState
          icon={expired ? <Clock3 color={palette.warning} size={28} /> : <ShieldCheck color={palette.brand} size={28} />}
          title={expired ? "Payment window expired" : "Job no longer available"}
          description={
            expired
              ? "The customer did not complete payment within the allowed window. SKIMA expired the order and removed the stale Station/Driver assignment, so no operational action is required."
              : "This job is no longer active for your current workspace. Refresh your jobs to see current work."
          }
          action={<AppButton label="Return to jobs" onPress={() => router.replace(`/${workspace === "station" ? "(station)" : "(driver)"}/jobs` as never)} />}
        />
      </Screen>
    );
  }

  return <JobDetailScreen workspace={workspace} />;
}
