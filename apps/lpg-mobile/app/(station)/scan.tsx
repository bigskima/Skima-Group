import { domainQueries } from "../../src/native/api/domains";
import { ScanWorkspaceScreen } from "../../src/native/ui/ScanWorkspaceScreen";

export default function Scan() {
  return <ScanWorkspaceScreen jobs={domainQueries.stationJobs()} workspace="station" />;
}
