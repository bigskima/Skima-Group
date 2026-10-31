import { useQuery } from "@tanstack/react-query";
import { useSession } from "../session/SessionProvider";
import type { PlatformRecord } from "../api/records";
import { ScanWorkspaceScreen } from "./ScanWorkspaceScreen";

type StationDriverJob = {
  id: string;
  lpgOrderId: string;
  publicReference?: string | null;
  status: string;
  orderStatus: string;
  requestedKg?: number | null;
  actualKg?: number | null;
};

export function StationManagedDriverScanScreen() {
  const { supabase } = useSession();
  const jobs = useQuery<PlatformRecord[], Error>({
    queryKey: ["station-managed-driver-jobs", "continuous-scan"],
    queryFn: async () => {
      const result = await supabase.rpc("read_lpg_station_managed_driver_jobs", { target_limit: 100 });
      if (result.error) throw result.error;
      if (!Array.isArray(result.data)) throw new Error("Station delivery jobs were returned in an unexpected format.");
      return (result.data as StationDriverJob[])
        .filter((job) => job.status === "accepted" || job.status === "en_route")
        .map((job) => ({
          ...job,
          id: job.lpgOrderId,
          status: job.orderStatus,
          publicReference: job.publicReference ?? "Station delivery",
        })) as PlatformRecord[];
    },
    refetchInterval: 10000,
  });
  return <ScanWorkspaceScreen jobs={jobs} workspace="driver" />;
}
