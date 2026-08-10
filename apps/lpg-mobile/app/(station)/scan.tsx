import { domainQueries } from "../../src/native/api/domains";
import { ScanWorkspaceScreen } from "../../src/native/ui/ScanWorkspaceScreen";
export default function Scan() { return <ScanWorkspaceScreen workspace="Station" jobs={domainQueries.stationJobs()} />; }
