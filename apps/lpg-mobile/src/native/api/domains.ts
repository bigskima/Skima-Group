import { RecordArraySchema, RecordObjectSchema } from "./records";
import { useGatewayQuery } from "./gateway";

export const domainQueries = {
  cylinders: () =>
    useGatewayQuery({
      key: ["cylinders"],
      path: "/lpg/cylinders",
      schema: RecordArraySchema,
    }),
  orders: () =>
    useGatewayQuery({
      key: ["orders"],
      path: "/lpg/orders",
      schema: RecordArraySchema,
    }),
  quotes: () =>
    useGatewayQuery({
      key: ["quotes"],
      path: "/lpg/quotes",
      schema: RecordArraySchema,
    }),
  activeOrders: () =>
    useGatewayQuery({
      key: ["orders", "active"],
      path: "/lpg/orders/active",
      schema: RecordArraySchema,
      refetchInterval: 15000,
    }),
  stations: () =>
    useGatewayQuery({
      key: ["stations"],
      path: "/lpg/stations",
      schema: RecordArraySchema,
    }),
  stationCatalogPrices: () =>
    useGatewayQuery({
      key: ["station-catalog-prices"],
      path: "/lpg/stations/catalog-prices",
      schema: RecordArraySchema,
    }),
  locations: () =>
    useGatewayQuery({
      key: ["locations"],
      path: "/lpg/locations",
      schema: RecordArraySchema,
    }),
  wallets: () =>
    useGatewayQuery({
      key: ["wallets"],
      path: "/runtime/wallet-balances",
      schema: RecordArraySchema,
    }),
  transactions: () =>
    useGatewayQuery({
      key: ["deposits"],
      path: "/runtime/payments/deposits",
      schema: RecordArraySchema,
    }),
  notifications: () =>
    useGatewayQuery({
      key: ["messages"],
      path: "/runtime/communications/messages",
      schema: RecordArraySchema,
      refetchInterval: 30000,
    }),
  driverJobs: () =>
    useGatewayQuery({
      key: ["jobs", "driver"],
      path: "/lpg/jobs?queue=driver&limit=50",
      schema: RecordArraySchema,
      refetchInterval: 15000,
    }),
  stationJobs: () =>
    useGatewayQuery({
      key: ["jobs", "station"],
      path: "/lpg/jobs?queue=station&limit=50",
      schema: RecordArraySchema,
      refetchInterval: 15000,
    }),
  vehicles: () =>
    useGatewayQuery({
      key: ["vehicles"],
      path: "/runtime/vehicles",
      schema: RecordArraySchema,
    }),
  vehicleTypes: () =>
    useGatewayQuery({
      key: ["vehicle-types"],
      path: "/runtime/vehicle-types",
      schema: RecordArraySchema,
      persist: true,
    }),
  drivers: () =>
    useGatewayQuery({
      key: ["drivers"],
      path: "/runtime/drivers",
      schema: RecordArraySchema,
    }),
  driverLocations: () =>
    useGatewayQuery({
      key: ["driver-locations"],
      path: "/lpg/driver-locations",
      schema: RecordArraySchema,
      refetchInterval: 15000,
    }),
  commissions: () =>
    useGatewayQuery({
      key: ["commissions"],
      path: "/runtime/commission-executions",
      schema: RecordArraySchema,
    }),
  settlements: () =>
    useGatewayQuery({
      key: ["settlements"],
      path: "/runtime/settlement-statements",
      schema: RecordArraySchema,
    }),
  applications: () =>
    useGatewayQuery({
      key: ["applications"],
      path: "/runtime/applications",
      schema: RecordArraySchema,
    }),
  applicationTypes: () =>
    useGatewayQuery({
      key: ["application-types"],
      path: "/runtime/application-types",
      schema: RecordArraySchema,
      persist: true,
    }),
  documentRequirements: () =>
    useGatewayQuery({
      key: ["document-requirements"],
      path: "/runtime/documents/requirements",
      schema: RecordArraySchema,
      persist: true,
    }),
  withdrawals: () =>
    useGatewayQuery({
      key: ["withdrawals"],
      path: "/runtime/withdrawals",
      schema: RecordArraySchema,
    }),
  beneficiaries: () =>
    useGatewayQuery({
      key: ["withdrawal-beneficiaries"],
      path: "/runtime/withdrawal-beneficiaries",
      schema: RecordArraySchema,
    }),
  aiTasks: () =>
    useGatewayQuery({
      key: ["ai-task-definitions"],
      path: "/engines/ai-task-definitions",
      schema: RecordArraySchema,
      persist: true,
    }),
  currencies: () =>
    useGatewayQuery({
      key: ["currencies"],
      path: "/engines/currencies",
      schema: RecordArraySchema,
      persist: true,
    }),
  providers: () =>
    useGatewayQuery({
      key: ["provider-adapters"],
      path: "/engines/provider-adapters",
      schema: RecordArraySchema,
      persist: true,
    }),
  documents: () =>
    useGatewayQuery({
      key: ["documents"],
      path: "/runtime/documents",
      schema: RecordArraySchema,
    }),
  inspections: () =>
    useGatewayQuery({
      key: ["inspections"],
      path: "/lpg/inspections",
      schema: RecordArraySchema,
    }),
  branches: () =>
    useGatewayQuery({
      key: ["branches"],
      path: "/runtime/organization-branches",
      schema: RecordArraySchema,
    }),
  staff: (organizationId: string | null) =>
    useGatewayQuery({
      key: ["staff", organizationId],
      path: `/runtime/organization-staff/directory?organizationId=${encodeURIComponent(organizationId ?? "")}`,
      schema: RecordArraySchema,
      enabled: Boolean(organizationId),
    }),
} as const;
export function useOrganizationRoles() {
  return useGatewayQuery({
    key: ["organization-roles"],
    path: "/runtime/organization-roles",
    schema: RecordArraySchema,
  });
}
export function useOrganizationInvitations() {
  return useGatewayQuery({
    key: ["organization-invitations"],
    path: "/runtime/organization-invitations",
    schema: RecordArraySchema,
  });
}
export function useLpgConfig() {
  return useGatewayQuery({
    key: ["config"],
    path: "/lpg/config",
    schema: RecordObjectSchema,
    persist: true,
  });
}
export function useApplicationPayload(applicationId: string | null) {
  return useGatewayQuery({
    key: ["application-payload", applicationId],
    path: `/runtime/applications/payload?applicationId=${encodeURIComponent(applicationId ?? "")}`,
    schema: RecordArraySchema,
    enabled: Boolean(applicationId),
  });
}

export function useJobDetails(id: string | null) {
  return useGatewayQuery({
    key: ["job", id],
    path: `/lpg/jobs?lpgOrderId=${encodeURIComponent(id ?? "")}`,
    schema: RecordObjectSchema,
    enabled: Boolean(id),
    refetchInterval: 15000,
  });
}
export function useStationRuntime() {
  return useGatewayQuery({
    key: ["station-runtime"],
    path: "/lpg/stations/runtime",
    schema: RecordObjectSchema,
    refetchInterval: 30000,
  });
}
export function useTrackingSessions() {
  return useGatewayQuery({
    key: ["tracking-sessions"],
    path: "/runtime/tracking/sessions",
    schema: RecordArraySchema,
    refetchInterval: 15000,
  });
}
export function useTrackingPoints(sessionId: string | null) {
  return useGatewayQuery({
    key: ["tracking-points", sessionId],
    path: `/runtime/tracking/points?trackingSessionId=${encodeURIComponent(sessionId ?? "")}`,
    schema: RecordArraySchema,
    enabled: Boolean(sessionId),
    refetchInterval: 15000,
  });
}
export function useEntityMediaLinks(
  entityType: string,
  entityId: string | null,
) {
  return useGatewayQuery({
    key: ["entity-media-links", entityType, entityId],
    path: `/runtime/media/entity-links?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId ?? "")}`,
    schema: RecordArraySchema,
    enabled: Boolean(entityId),
  });
}
