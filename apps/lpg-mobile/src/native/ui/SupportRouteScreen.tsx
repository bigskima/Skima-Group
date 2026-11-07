import { router } from "expo-router";
import { useLpgConfig } from "../api/domains";
import { firstString, nestedRecords, ActionResponseSchema } from "../api/records";
import { useGatewayMutation } from "../api/gateway";
import { SupportCenter } from "@skima/mobile-experience/SupportCenter";
import { useSession } from "../session/SessionProvider";
import { useAppTheme } from "../theme/ThemeProvider";

export function SupportRouteScreen({ workspace }: {
  workspace: "customer" | "driver" | "station";
}) {
  const session = useSession();
  const { palette } = useAppTheme();
  const config = useLpgConfig();
  const safetyMutation = useGatewayMutation({
    path: "/lpg/safety-incidents",
    schema: ActionResponseSchema,
    invalidate: [["safety-incidents"]],
  });
  const permissions = session.context?.permissions ?? [];
  const safetyIncidentTypes = nestedRecords(config.data, "safetyIncidentTypes")
    .map((item) => ({
      key: firstString(item, ["key"]) ?? "",
      label: firstString(item, ["displayName", "display_name"]) ?? "Safety issue",
    }))
    .filter((item) => Boolean(item.key));
  const safetySeverities = nestedRecords(config.data, "safetySeverities")
    .map((item) => ({
      key: firstString(item, ["key"]) ?? "",
      label: firstString(item, ["displayName", "display_name"]) ?? "Severity",
    }))
    .filter((item) => Boolean(item.key));
  const reportSafetyIncident = async (input: {
    incidentType: string;
    severity: string;
    description: string;
    orderReference?: string;
    idempotencyKey: string;
  }) => {
    const orderId = input.orderReference?.trim() ?? "";
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(orderId);
    await safetyMutation.mutateAsync({
      lpgOrderId: isUuid ? orderId : undefined,
      incidentType: input.incidentType,
      severity: input.severity,
      description: input.description,
      source: "skima.lpg.mobile",
      idempotencyKey: input.idempotencyKey,
      metadata: { workspace, reportedFrom: "support" },
    });
  };
  const canManage = permissions.includes("platform.support.manage")
    || permissions.includes("platform.support.manage.refill");
  return (
    <SupportCenter
      appKey="refill"
      workspace={workspace}
      supabase={session.supabase}
      palette={palette}
      canManage={canManage}
      safetyIncidentTypes={safetyIncidentTypes}
      safetySeverities={safetySeverities}
      onSafetyIncident={reportSafetyIncident}
      onBack={() => router.back()}
    />
  );
}
