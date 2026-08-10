import { WorkspaceTabs, stationTabs } from "../../src/native/navigation/WorkspaceTabs";
import { WorkspaceGate } from "../../src/native/navigation/WorkspaceGate";
export default function Layout() { return <WorkspaceGate workspace="station"><WorkspaceTabs tabs={stationTabs} hidden={["job/[id]", "notifications", "application", "documents", "staff", "settings", "support", "inventory", "withdraw", "profile", "reports", "roles"]} /></WorkspaceGate>; }
