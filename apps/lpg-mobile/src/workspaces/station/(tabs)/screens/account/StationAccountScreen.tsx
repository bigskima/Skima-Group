import { Boxes, Building2, FileCheck2, Settings, ShieldCheck, UserRoundCog, Users } from "lucide-react";

import { useStationsQuery } from "@lpg/features/stations/api";
import { hasAnyPermission, getFirstRecordString } from "@lpg/shared/api/records";
import { MenuRow, PageHeading, PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import type { StationScreenProps } from "../../navigation/stationRoutes";

export function StationAccountScreen(props: StationScreenProps) {
  const stations = useStationsQuery();
  const station = stations.data?.[0];
  const canManage = hasAnyPermission(props.context, ["lpg.stations.manage"]);
  const canManageStaff = hasAnyPermission(props.context, ["business.staff.manage"]);
  const canReadInventory = hasAnyPermission(props.context, ["lpg.cylinders.read"]);

  return (
    <QueryState loading={stations.isLoading} error={stations.error}>
      <PageHeading title="Station Account" subtitle="Profile, people, access, and settings" />
      {station ? (
        <section className="profile-card">
          <div className="avatar-large"><Building2 aria-hidden="true" /></div>
          <div><h2>{getFirstRecordString(station, ["display_name", "displayName"]) ?? "Station"}</h2><p>{getFirstRecordString(station, ["formatted_address", "formattedAddress"]) ?? "Branch address unavailable"}</p><StatusChip tone="success" label="Backend approved" /></div>
        </section>
      ) : <PolishedEmpty icon={<Building2 />} title="No station branch returned" message="Station access is active only for an approved branch or accepted staff role." />}
      <section className="panel-card">
        {canManage ? <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("station-profile")}><MenuRow icon={<Building2 />} title="Station Profile" text="Branch identity and operating information" /></button> : null}
        {canReadInventory ? <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("inventory")}><MenuRow icon={<Boxes />} title="Inventory" text="Cylinder and branch stock records" /></button> : null}
        {canManageStaff ? <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("staff")}><MenuRow icon={<Users />} title="Staff" text="Members and branch assignments" /></button> : null}
        {canManageStaff ? <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("roles")}><MenuRow icon={<UserRoundCog />} title="Roles And Permissions" text="Capability-based station access" /></button> : null}
        {canManage ? <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("station-settings")}><MenuRow icon={<Settings />} title="Station Settings" text="Hours, pricing, and notifications" /></button> : null}
        <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("station-documents")}><MenuRow icon={<FileCheck2 />} title="Documents" text="Backend-managed compliance media" /></button>
        <MenuRow icon={<ShieldCheck />} title="Access" text="This screen is filtered by your current station permissions" />
      </section>
    </QueryState>
  );
}
