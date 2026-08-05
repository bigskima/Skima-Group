import { BarChart3, Boxes, Building2, FileCheck2, Settings, ShieldCheck, UserRoundCog, Users } from "lucide-react";

import { useStationRuntimeQuery } from "@lpg/features/stations/api";
import { firstLinkedMediaAssetId, useEntityMediaLinksQuery } from "@lpg/features/media/api";
import { RuntimeMediaImage } from "@lpg/features/media/RuntimeMediaImage";
import { hasAnyPermission, getFirstRecordString, getRecordId, getRecordObject, statusTone, formatStatus } from "@lpg/shared/api/records";
import { MenuRow, PageHeading, PolishedEmpty, StatusChip } from "@lpg/shared/ui/lpgComponents";
import { QueryState } from "@lpg/shared/ui/QueryState";
import { AccountSkeleton } from "@lpg/shared/ui/ScreenSkeletons";
import type { StationScreenProps } from "../../navigation/stationRoutes";

export function StationAccountScreen(props: StationScreenProps) {
  const runtime = useStationRuntimeQuery();
  const station = getRecordObject(runtime.data, "branch");
  const mediaLinks = useEntityMediaLinksQuery("lpg.station_branch", getRecordId(station));
  const canManage = hasAnyPermission(props.context, ["lpg.stations.manage"]);
  const canManageStaff = hasAnyPermission(props.context, ["business.staff.manage"]);
  const canReadInventory = hasAnyPermission(props.context, ["lpg.cylinders.read"]);

  return (
    <QueryState loading={runtime.isLoading || mediaLinks.isLoading} error={runtime.error ?? mediaLinks.error} skeleton={<AccountSkeleton />}>
      <PageHeading title="Station Account" subtitle="Profile, people, access, and settings" />
      {station ? (
        <section className="profile-card">
          <div className="avatar-large"><RuntimeMediaImage assetId={firstLinkedMediaAssetId(mediaLinks.data, "station.photo")} alt="Station" fallback={<Building2 aria-hidden="true" />} /></div>
          <div><h2>{getFirstRecordString(station, ["displayName"]) ?? "Station"}</h2><p>{getFirstRecordString(station, ["formattedAddress"]) ?? "Branch address unavailable"}</p><StatusChip tone={statusTone(getFirstRecordString(station, ["approvalStatus"]))} label={formatStatus(getFirstRecordString(station, ["approvalStatus"]))} /></div>
        </section>
      ) : <PolishedEmpty icon={<Building2 />} title="No station branch returned" message="Station access is active only for an approved branch or accepted staff role." />}
      <section className="panel-card">
        {canManage ? <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("station-profile")}><MenuRow icon={<Building2 />} title="Station Profile" text="Branch identity and operating information" /></button> : null}
        {canReadInventory ? <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("inventory")}><MenuRow icon={<Boxes />} title="Inventory" text="Cylinder and branch stock records" /></button> : null}
        {canManageStaff ? <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("staff")}><MenuRow icon={<Users />} title="Staff" text="Members and branch assignments" /></button> : null}
        {canManageStaff ? <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("roles")}><MenuRow icon={<UserRoundCog />} title="Roles And Permissions" text="Capability-based station access" /></button> : null}
        {canManage ? <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("station-settings")}><MenuRow icon={<Settings />} title="Station Settings" text="Hours, pricing, and notifications" /></button> : null}
        {canManage ? <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("station-reports")}><MenuRow icon={<BarChart3 />} title="Reports" text="Live jobs, refill volume, and settlements" /></button> : null}
        <button type="button" className="unstyled-record-button" onClick={() => props.navigation.navigate("station-documents")}><MenuRow icon={<FileCheck2 />} title="Documents" text="Backend-managed compliance media" /></button>
        <MenuRow icon={<ShieldCheck />} title="Access" text="This screen is filtered by your current station permissions" />
      </section>
    </QueryState>
  );
}
