import { useQuery } from "@tanstack/react-query";
import { Crosshair, Minus, Plus, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { z } from "zod";

import { Button, StatusBadge } from "@skima/ui";
import { useSessionState } from "./session";

type Coordinate = readonly [number, number];
type RendererConfiguration = {
  readonly key: string;
  readonly tileTemplate: string;
  readonly attribution: string;
  readonly maxZoom: number;
  readonly defaultCenter: Coordinate;
  readonly defaultZoom: number;
  readonly source: "backend" | "build" | "safe-fallback";
};

const WIDTH = 800;
const HEIGHT = 420;
const TILE = 256;
const SAFE_TILE_TEMPLATE = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const SAFE_ATTRIBUTION = "OpenStreetMap contributors";
const SAFE_CENTER: Coordinate = [8.6753, 9.082];

const RendererConfigurationSchema = z.object({
  active_renderer_key: z.string().min(1),
  tile_url_template: z.string().refine(isUsableTileTemplate),
  attribution: z.string().min(1),
  max_zoom: z.coerce.number().int().min(1).max(22),
  default_center: z.object({
    latitude: z.coerce.number().min(-85.051129).max(85.051129),
    longitude: z.coerce.number().min(-180).max(180),
  }),
  default_zoom: z.coerce.number().int().min(1).max(22),
  source: z.string().optional(),
});

const BUILD_RENDERER = readBuildRenderer();

export function AdminGeometryEditor(props: {
  value?: string;
  onChange?: (geojson: string) => void;
  point?: Coordinate | null;
  onPointChange?: (point: Coordinate) => void;
  mode: "polygon" | "point";
}) {
  const { status, supabase } = useSessionState();
  const rendererQuery = useQuery({
    queryKey: ["maps-renderer-configuration"],
    enabled: status === "authenticated",
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async (): Promise<RendererConfiguration> => {
      const { data, error } = await supabase.rpc("read_maps_renderer_configuration");
      if (error) throw error;
      const configuration = RendererConfigurationSchema.parse(data);
      return {
        key: configuration.active_renderer_key,
        tileTemplate: configuration.tile_url_template,
        attribution: configuration.attribution,
        maxZoom: configuration.max_zoom,
        defaultCenter: [configuration.default_center.longitude, configuration.default_center.latitude],
        defaultZoom: Math.min(configuration.default_zoom, configuration.max_zoom),
        source: "backend",
      };
    },
  });
  const renderer = rendererQuery.data ?? BUILD_RENDERER;
  const initial = useMemo(() => readPolygons(props.value), [props.value]);
  const [polygons, setPolygons] = useState<Coordinate[][]>(initial.length ? initial : [[]]);
  const [active, setActive] = useState(Math.max(initial.length - 1, 0));
  const [center, setCenter] = useState<Coordinate>(
    () => average(initial.flat()) ?? props.point ?? BUILD_RENDERER.defaultCenter,
  );
  const [zoom, setZoom] = useState(
    initial.length ? Math.min(12, BUILD_RENDERER.maxZoom) : BUILD_RENDERER.defaultZoom,
  );

  useEffect(() => {
    const next = initial.length ? initial : [[]];
    setPolygons(next);
    setActive(Math.max(next.length - 1, 0));
    const nextCenter = average(initial.flat());
    if (nextCenter) setCenter(nextCenter);
  }, [initial]);

  useEffect(() => {
    if (initial.length === 0 && !props.point) {
      setCenter(renderer.defaultCenter);
      setZoom(renderer.defaultZoom);
    }
  }, [initial.length, props.point, renderer.defaultCenter, renderer.defaultZoom]);

  const layout = tiles(center, zoom, renderer.tileTemplate);
  const paths = polygons.map((polygon) => polygonPath(polygon, center, zoom));
  const pointPosition = props.point ? screenPoint(props.point, center, zoom) : null;
  const emit = (next: Coordinate[][]) => {
    setPolygons(next);
    const completed = next.filter((polygon) => polygon.length >= 3).map(closeRing);
    if (!props.onChange) return;
    if (completed.length === 0) props.onChange("");
    else {
      props.onChange(JSON.stringify(
        completed.length === 1
          ? { type: "Polygon", coordinates: [completed[0]] }
          : { type: "MultiPolygon", coordinates: completed.map((ring) => [ring]) },
        null,
        2,
      ));
    }
  };
  const select = (event: MouseEvent<SVGSVGElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const point = unproject(
      center,
      zoom,
      ((event.clientX - rect.left) / rect.width) * WIDTH,
      ((event.clientY - rect.top) / rect.height) * HEIGHT,
    );
    if (props.mode === "point") {
      props.onPointChange?.(point);
      setCenter(point);
      return;
    }
    emit(polygons.map((polygon, index) => index === active ? [...polygon, point] : polygon));
  };
  const undo = () => emit(
    polygons.map((polygon, index) => index === active ? polygon.slice(0, -1) : polygon),
  );
  const clear = () => {
    setActive(0);
    emit([[]]);
  };
  const addPolygon = () => {
    const next = [...polygons, []];
    setActive(next.length - 1);
    emit(next);
  };

  return (
    <section className="sk-panel">
      <div className="sk-panel__header">
        <div>
          <h3>{props.mode === "polygon" ? "Interactive boundary editor" : "Select radius center"}</h3>
          <p className="skima-muted">
            {props.mode === "polygon"
              ? "Click the map to add vertices. Create another ring for a MultiPolygon."
              : "Click the map to set the approved center point."}
          </p>
        </div>
        <div className="skima-action-row">
          <Button
            size="sm"
            variant="outline"
            icon={Minus}
            onClick={() => setZoom(Math.max(1, zoom - 1))}
          >
            Zoom out
          </Button>
          <Button
            size="sm"
            variant="outline"
            icon={Plus}
            onClick={() => setZoom(Math.min(renderer.maxZoom, zoom + 1))}
          >
            Zoom in
          </Button>
        </div>
      </div>
      {rendererQuery.error
        ? (
          <StatusBadge tone="warning">
            Saved map settings are temporarily unavailable. The safe map fallback is active.
          </StatusBadge>
        )
        : null}
      <svg
        role="application"
        aria-label={props.mode === "polygon"
          ? "Interactive polygon boundary map"
          : "Interactive radius center map"}
        onClick={select}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        style={{
          width: "100%",
          minHeight: 360,
          border: "1px solid #ccd7dc",
          borderRadius: 16,
          background: "#eaf0f2",
          cursor: "crosshair",
        }}
      >
        {layout.map((tile) => (
          <image
            key={`${tile.z}:${tile.x}:${tile.y}`}
            href={tile.url}
            x={tile.left}
            y={tile.top}
            width={TILE}
            height={TILE}
            preserveAspectRatio="none"
          />
        ))}
        {paths.map((path, index) => (
          <path
            key={index}
            d={path}
            fill="#246bdb44"
            stroke={index === active ? "#1457b8" : "#50769e"}
            strokeWidth={index === active ? 3 : 2}
            fillRule="evenodd"
          />
        ))}
        {polygons.flatMap((polygon, polygonIndex) => polygon.map((coordinate, index) => {
          const [x, y] = screenPoint(coordinate, center, zoom);
          return (
            <circle
              key={`${polygonIndex}:${index}`}
              cx={x}
              cy={y}
              r={polygonIndex === active ? 5 : 3}
              fill="#1457b8"
              stroke="white"
              strokeWidth="2"
            />
          );
        }))}
        {pointPosition
          ? (
            <>
              <circle
                cx={pointPosition[0]}
                cy={pointPosition[1]}
                r="10"
                fill="#1457b8"
                stroke="white"
                strokeWidth="4"
              />
              <path
                d={`M${pointPosition[0] - 16} ${pointPosition[1]}H${pointPosition[0] + 16} M${pointPosition[0]} ${pointPosition[1] - 16}V${pointPosition[1] + 16}`}
                stroke="#1457b8"
              />
            </>
          )
          : null}
      </svg>
      <div className="skima-action-row">
        <StatusBadge tone="info">
          {props.mode === "polygon"
            ? `${polygons.reduce((sum, polygon) => sum + polygon.length, 0)} vertices · ${
              polygons.filter((polygon) => polygon.length >= 3).length
            } polygon(s)`
            : props.point
            ? `${props.point[1].toFixed(6)}, ${props.point[0].toFixed(6)}`
            : "No center selected"}
        </StatusBadge>
        {props.mode === "polygon"
          ? (
            <>
              <Button size="sm" variant="outline" icon={RotateCcw} onClick={undo}>Undo vertex</Button>
              <Button size="sm" variant="outline" onClick={addPolygon}>New polygon</Button>
              <Button size="sm" variant="destructive" onClick={clear}>Clear</Button>
            </>
          )
          : (
            <Button
              size="sm"
              variant="outline"
              icon={Crosshair}
              onClick={() => props.point && setCenter(props.point)}
            >
              Recenter
            </Button>
          )}
      </div>
      <p className="skima-muted">
        Basemap: {renderer.attribution}. Geometry becomes authoritative only after server preview and activation.
      </p>
    </section>
  );
}

function readBuildRenderer(): RendererConfiguration {
  const configuredTemplate = import.meta.env.VITE_MAP_TILE_URL_TEMPLATE as string | undefined;
  const hasConfiguredTemplate = isUsableTileTemplate(configuredTemplate);
  const configuredAttribution = (import.meta.env.VITE_MAP_ATTRIBUTION as string | undefined)?.trim();
  return {
    key: hasConfiguredTemplate ? "renderer.maps.build-configured" : "renderer.maps.openstreetmap-standard",
    tileTemplate: hasConfiguredTemplate ? configuredTemplate.trim() : SAFE_TILE_TEMPLATE,
    attribution: hasConfiguredTemplate && configuredAttribution ? configuredAttribution : SAFE_ATTRIBUTION,
    maxZoom: 19,
    defaultCenter: SAFE_CENTER,
    defaultZoom: 5,
    source: hasConfiguredTemplate ? "build" : "safe-fallback",
  };
}

function isUsableTileTemplate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const template = value.trim();
  if (!template.startsWith("https://")) return false;
  if (!["{z}", "{x}", "{y}"].every((token) => template.includes(token))) return false;
  return !requiresPublicMapCredential(template);
}

function requiresPublicMapCredential(value: string) {
  const normalized = value.toLowerCase();
  const credentialMarkers = [
    "{access_token}",
    "{api_key}",
    "{apikey}",
    "{key}",
    "access_token=",
    "api_key=",
    "apikey=",
    "token=",
    "key=",
  ];
  const credentialProviders = [
    "locationiq.com",
    "maps.googleapis.com",
    "api.mapbox.com",
    "tiles.mapbox.com",
    "api.maptiler.com",
    "maps.geoapify.com",
    "api.geoapify.com",
    "hereapi.com",
    "tomtom.com",
    "tile.thunderforest.com",
    "tiles.stadiamaps.com",
  ];
  return credentialMarkers.some((marker) => normalized.includes(marker)) ||
    credentialProviders.some((provider) => normalized.includes(provider));
}

function readPolygons(value?: string): Coordinate[][] {
  if (!value?.trim()) return [];
  try {
    const geometry = JSON.parse(value) as { type?: string; coordinates?: unknown };
    if (geometry.type === "Polygon" && Array.isArray(geometry.coordinates)) {
      return [(geometry.coordinates[0] as Coordinate[]).slice(0, -1)];
    }
    if (geometry.type === "MultiPolygon" && Array.isArray(geometry.coordinates)) {
      return geometry.coordinates.map((polygon) => ((polygon as Coordinate[][])[0] ?? []).slice(0, -1));
    }
  } catch {
    return [];
  }
  return [];
}

function closeRing(points: Coordinate[]): Coordinate[] {
  return [...points, points[0]];
}

function average(points: Coordinate[]): Coordinate | null {
  if (!points.length) return null;
  return [
    points.reduce((sum, point) => sum + point[0], 0) / points.length,
    points.reduce((sum, point) => sum + point[1], 0) / points.length,
  ];
}

function world(point: Coordinate, zoom: number): Coordinate {
  const scale = TILE * 2 ** zoom;
  const sin = Math.sin(point[1] * Math.PI / 180);
  return [
    (point[0] + 180) / 360 * scale,
    (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  ];
}

function screenPoint(point: Coordinate, center: Coordinate, zoom: number): Coordinate {
  const projectedPoint = world(point, zoom);
  const projectedCenter = world(center, zoom);
  return [
    WIDTH / 2 + projectedPoint[0] - projectedCenter[0],
    HEIGHT / 2 + projectedPoint[1] - projectedCenter[1],
  ];
}

function unproject(center: Coordinate, zoom: number, x: number, y: number): Coordinate {
  const scale = TILE * 2 ** zoom;
  const projectedCenter = world(center, zoom);
  const worldX = projectedCenter[0] + x - WIDTH / 2;
  const worldY = projectedCenter[1] + y - HEIGHT / 2;
  const longitude = worldX / scale * 360 - 180;
  const n = Math.PI - 2 * Math.PI * worldY / scale;
  return [
    Math.max(-180, Math.min(180, longitude)),
    Math.max(
      -85.051129,
      Math.min(85.051129, 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))),
    ),
  ];
}

function polygonPath(points: Coordinate[], center: Coordinate, zoom: number): string {
  return points.map((point, index) => {
    const [x, y] = screenPoint(point, center, zoom);
    return `${index ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ") + (points.length >= 3 ? " Z" : "");
}

function tiles(center: Coordinate, zoom: number, template: string) {
  const projectedCenter = world(center, zoom);
  const minX = Math.floor((projectedCenter[0] - WIDTH / 2) / TILE);
  const maxX = Math.floor((projectedCenter[0] + WIDTH / 2) / TILE);
  const minY = Math.floor((projectedCenter[1] - HEIGHT / 2) / TILE);
  const maxY = Math.floor((projectedCenter[1] + HEIGHT / 2) / TILE);
  const count = 2 ** zoom;
  const result: { z: number; x: number; y: number; left: number; top: number; url: string }[] = [];
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (y < 0 || y >= count) continue;
      const wrapped = ((x % count) + count) % count;
      result.push({
        z: zoom,
        x: wrapped,
        y,
        left: x * TILE - (projectedCenter[0] - WIDTH / 2),
        top: y * TILE - (projectedCenter[1] - HEIGHT / 2),
        url: template
          .replaceAll("{z}", String(zoom))
          .replaceAll("{x}", String(wrapped))
          .replaceAll("{y}", String(y)),
      });
    }
  }
  return result;
}
