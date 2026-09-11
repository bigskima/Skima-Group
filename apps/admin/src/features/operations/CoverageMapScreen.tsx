import { useQuery } from "@tanstack/react-query";
import { Layers3, MapPinned, RefreshCcw } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

import {
  Button,
  ErrorState,
  LoadingState,
  SelectInput,
  StatusBadge,
  TextInput,
} from "@skima/ui";

import { useSessionState } from "../../session";
import { AdminV2PageHeader } from "../../shared/patterns/AdminV2Patterns";

const CoverageMapFeatureSchema = z.object({
  id: z.string(),
  type: z.literal("Feature"),
  geometry: z.object({
    type: z.enum(["Point", "Polygon", "MultiPolygon"]),
    coordinates: z.unknown(),
  }),
  properties: z.object({
    layer: z.enum([
      "SERVICE_POLICY",
      "OPERATIONAL_COVERAGE",
      "REQUESTED_COVERAGE",
      "OPERATING_BASE",
      "STATION_PHYSICAL",
      "APPLICATION_SUBMISSION",
      "LOCATION_EVIDENCE",
      "LIVE_LOCATION",
    ]),
    name: z.string(),
    effect: z.enum(["ALLOW", "DENY"]).optional(),
    coverageType: z.string().optional(),
    status: z.string(),
  }).passthrough(),
});
const CoverageMapSchema = z.object({
  type: z.literal("FeatureCollection"),
  generatedAt: z.string(),
  truncated: z.boolean(),
  features: z.array(CoverageMapFeatureSchema),
});

type CoverageMapFeature = z.infer<typeof CoverageMapFeatureSchema>;

export function CoverageMapScreen() {
  const { supabase, status } = useSessionState();
  const [serviceKey, setServiceKey] = useState("lpg");
  const [entityType, setEntityType] = useState("");
  const [capabilityKey, setCapabilityKey] = useState("");
  const [entityId, setEntityId] = useState("");
  const [applicationId, setApplicationId] = useState("");
  const validAdvancedIds = (!entityId.trim() || isUuid(entityId)) && (!applicationId.trim() || isUuid(applicationId));
  const filters = [serviceKey, entityType, capabilityKey, entityId, applicationId] as const;

  const query = useQuery({
    queryKey: ["coverage-v2", "map", ...filters],
    enabled: status === "authenticated" && validAdvancedIds,
    queryFn: async () => {
      const at = new Date().toISOString();
      const [effectiveResult, evidenceResult] = await Promise.all([
        supabase.rpc("read_coverage_map_features", {
          p_service_key: serviceKey.trim() || null,
          p_capability_key: capabilityKey.trim() || null,
          p_entity_type: entityType.trim().toUpperCase() || null,
          p_entity_id: uuidOrNull(entityId),
          p_at: at,
          p_limit: 500,
          p_simplify_tolerance: 0.00001,
        }),
        supabase.rpc("read_coverage_evidence_map_features", {
          p_service_key: serviceKey.trim() || null,
          p_entity_type: entityType.trim().toUpperCase() || null,
          p_entity_id: uuidOrNull(entityId),
          p_application_id: uuidOrNull(applicationId),
          p_at: at,
          p_limit: 500,
          p_simplify_tolerance: 0.00001,
        }),
      ]);
      if (effectiveResult.error) throw effectiveResult.error;
      if (evidenceResult.error) throw evidenceResult.error;
      const effective = CoverageMapSchema.parse(effectiveResult.data);
      const evidence = CoverageMapSchema.parse(evidenceResult.data);
      return {
        ...effective,
        truncated: effective.truncated || evidence.truncated,
        features: [...effective.features, ...evidence.features],
      };
    },
  });

  return (
    <div className="coverage-v2__screen">
      <AdminV2PageHeader
        eyebrow="Service coverage · Map"
        title="Coverage map"
        description="See service availability, approved partner coverage and location evidence as separate visual layers. Technical record filters stay under Advanced."
        actions={<Button icon={RefreshCcw} variant="outline" disabled={!validAdvancedIds} onClick={() => void query.refetch()}>Refresh map</Button>}
      />

      <section className="sk-panel">
        <div className="sk-panel__header">
          <div><h2>What should the map show?</h2><p className="skima-muted">Keep the default LPG view, or narrow it to one partner type. The layer buttons below control what is visible without changing stored coverage.</p></div>
        </div>
        <div className="skima-form-grid">
          <SelectInput label="SKIMA service" value={serviceKey} onChange={(event) => setServiceKey(event.currentTarget.value)} options={[{ label: "LPG refill service", value: "lpg" }]} />
          <SelectInput label="Partner type" value={entityType} onChange={(event) => setEntityType(event.currentTarget.value)} options={[{ label: "All partners", value: "" }, { label: "Drivers", value: "DRIVER" }, { label: "Stations", value: "STATION" }]} />
        </div>
        <details className="coverage-v2__advanced">
          <summary>Advanced support filters</summary>
          <p className="skima-muted">Use these only when support or engineering asks you to isolate one internal record.</p>
          <div className="skima-form-grid">
            <TextInput label="Activity key" value={capabilityKey} onChange={(event) => setCapabilityKey(event.currentTarget.value)} placeholder="Optional" />
            <TextInput label="Partner record ID" value={entityId} onChange={(event) => setEntityId(event.currentTarget.value)} placeholder="Optional UUID" />
            <TextInput label="Application record ID" value={applicationId} onChange={(event) => setApplicationId(event.currentTarget.value)} placeholder="Optional UUID" />
          </div>
        </details>
      </section>

      {!validAdvancedIds ? (
        <StatusBadge tone="warning">One of the advanced record IDs is incomplete. Paste the complete UUID or clear the field.</StatusBadge>
      ) : query.isLoading ? (
        <LoadingState label="Loading coverage map" />
      ) : query.error ? (
        <ErrorState title="Coverage map unavailable" message={readError(query.error)} onRetry={() => void query.refetch()} />
      ) : (
        <CoverageGeometryMap features={query.data?.features ?? []} truncated={query.data?.truncated ?? false} />
      )}
    </div>
  );
}

function CoverageGeometryMap(props: { readonly features: CoverageMapFeature[]; readonly truncated: boolean }) {
  const [hiddenLayers, setHiddenLayers] = useState<string[]>([]);
  const layerNames = [...new Set(props.features.map((feature) => feature.properties.layer))];
  const visibleFeatures = props.features.filter((feature) => !hiddenLayers.includes(feature.properties.layer));
  const points = visibleFeatures.flatMap((feature) => geometryPoints(feature.geometry.coordinates));

  if (!props.features.length) {
    return <ErrorState title="No coverage found" message="No active service rules, partner operating areas or location evidence match these filters." />;
  }

  const toggleLayer = (layer: string) => setHiddenLayers((current) =>
    current.includes(layer) ? current.filter((item) => item !== layer) : [...current, layer]
  );

  if (!points.length) {
    return (
      <section className="sk-panel">
        <LayerControls layers={layerNames} hiddenLayers={hiddenLayers} onToggle={toggleLayer} />
        <p className="skima-muted">All map geometry is currently hidden. Turn on a layer to show it.</p>
      </section>
    );
  }

  const longitudes = points.map(([longitude]) => longitude);
  const latitudes = points.map(([, latitude]) => latitude);
  const minLongitude = Math.min(...longitudes);
  const maxLongitude = Math.max(...longitudes);
  const minLatitude = Math.min(...latitudes);
  const maxLatitude = Math.max(...latitudes);
  const longitudeSpan = Math.max(maxLongitude - minLongitude, 0.001);
  const latitudeSpan = Math.max(maxLatitude - minLatitude, 0.001);
  const project = ([longitude, latitude]: [number, number]) => [
    24 + ((longitude - minLongitude) / longitudeSpan) * 852,
    436 - ((latitude - minLatitude) / latitudeSpan) * 412,
  ] as const;

  return (
    <section className="sk-panel coverage-v2__map-panel">
      <div className="sk-panel__header"><div><h2>Effective coverage layers</h2><p className="skima-muted">Toggle layers to isolate service policy, partner coverage or recent location evidence.</p></div>{props.truncated ? <StatusBadge tone="warning">Too many items — narrow filters</StatusBadge> : null}</div>
      <LayerControls layers={layerNames} hiddenLayers={hiddenLayers} onToggle={toggleLayer} />
      <svg role="img" aria-label="Effective SKIMA service and operational coverage" viewBox="0 0 900 460" className="coverage-v2__map-svg">
        <defs><pattern id="coverage-v2-grid" width="45" height="45" patternUnits="userSpaceOnUse"><path d="M 45 0 L 0 0 0 45" fill="none" stroke="#dce4e7" strokeWidth="1" /></pattern></defs>
        <rect width="900" height="460" fill="url(#coverage-v2-grid)" />
        {visibleFeatures.map((feature) => feature.geometry.type === "Point"
          ? <MapEvidencePoint key={`${feature.properties.layer}:${feature.id}`} feature={feature} project={project} />
          : <path
              key={`${feature.properties.layer}:${feature.id}`}
              d={geometryPath(feature.geometry.coordinates, project)}
              fill={feature.properties.layer === "OPERATIONAL_COVERAGE" ? "#246bdb55" : feature.properties.layer === "REQUESTED_COVERAGE" ? "#d98b2455" : feature.properties.effect === "DENY" ? "#d9383855" : "#1d9b6255"}
              stroke={feature.properties.layer === "OPERATIONAL_COVERAGE" ? "#246bdb" : feature.properties.layer === "REQUESTED_COVERAGE" ? "#b86a10" : feature.properties.effect === "DENY" ? "#b42323" : "#157a4c"}
              strokeWidth="2"
              strokeDasharray={feature.properties.layer === "REQUESTED_COVERAGE" ? "8 5" : undefined}
              fillRule="evenodd"
            ><title>{feature.properties.name} — {friendlyLayer(feature.properties.layer)}</title></path>)}
      </svg>
      <p className="skima-muted">Recent driver locations are only returned when your admin permissions allow tracking evidence.</p>
    </section>
  );
}

function LayerControls(props: { readonly layers: string[]; readonly hiddenLayers: string[]; readonly onToggle: (layer: string) => void }) {
  return (
    <div className="coverage-v2__layer-controls" aria-label="Map layers">
      <Layers3 aria-hidden="true" />
      {props.layers.map((layer) => (
        <Button key={layer} size="sm" variant={props.hiddenLayers.includes(layer) ? "outline" : "primary"} aria-pressed={!props.hiddenLayers.includes(layer)} onClick={() => props.onToggle(layer)}>
          {friendlyLayer(layer)}
        </Button>
      ))}
    </div>
  );
}

function MapEvidencePoint(props: { readonly feature: CoverageMapFeature; readonly project: (point: [number, number]) => readonly [number, number] }) {
  const point = geometryPoints(props.feature.geometry.coordinates)[0];
  if (!point) return null;
  const [x, y] = props.project(point);
  const color = props.feature.properties.layer === "LIVE_LOCATION" ? "#d93838" : props.feature.properties.layer === "OPERATING_BASE" ? "#6b3fd1" : "#334e68";
  return <g><circle cx={x} cy={y} r={props.feature.properties.layer === "LIVE_LOCATION" ? 9 : 7} fill={color} stroke="white" strokeWidth="3" /><title>{props.feature.properties.name} — {friendlyLayer(props.feature.properties.layer)}</title></g>;
}

function geometryPoints(value: unknown): [number, number][] {
  if (!Array.isArray(value)) return [];
  if (value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number" && Number.isFinite(value[0]) && Number.isFinite(value[1])) return [[value[0], value[1]]];
  return value.flatMap(geometryPoints);
}

function geometryPath(value: unknown, project: (point: [number, number]) => readonly [number, number]): string {
  if (!Array.isArray(value)) return "";
  if (value.length > 0 && Array.isArray(value[0]) && typeof value[0][0] === "number") {
    const ring = geometryPoints(value);
    return ring.map((point, index) => {
      const [x, y] = project(point);
      return `${index === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
    }).join(" ") + " Z";
  }
  return value.map((part) => geometryPath(part, project)).join(" ");
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim());
}

function uuidOrNull(value: string) {
  return isUuid(value) ? value.trim() : null;
}

function friendlyLayer(value: string) {
  const labels: Record<string, string> = {
    SERVICE_POLICY: "Service rules",
    OPERATIONAL_COVERAGE: "Approved partner areas",
    REQUESTED_COVERAGE: "Requested partner areas",
    OPERATING_BASE: "Operating bases",
    STATION_PHYSICAL: "Station locations",
    APPLICATION_SUBMISSION: "Application locations",
    LOCATION_EVIDENCE: "Location evidence",
    LIVE_LOCATION: "Recent live locations",
  };
  return labels[value] ?? value.replaceAll("_", " ").toLowerCase();
}

function readError(error: unknown) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return String((error as { message: string }).message);
  return "The coverage map could not be loaded. Refresh and try again.";
}
