import { assertPlatformKey } from "../../core/src/index.ts";

export const PROVIDER_KINDS = [
  "payment",
  "storage",
  "maps",
  "notification",
  "ai",
  "queue",
  "cache",
  "observability",
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export interface AdapterHealth {
  readonly ok: boolean;
  readonly checkedAt: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export interface ProviderAdapter<TRequest, TResponse> {
  readonly key: string;
  readonly kind: ProviderKind;
  healthCheck(): Promise<AdapterHealth>;
  execute(request: TRequest): Promise<TResponse>;
}

export interface ProviderSelection {
  readonly kind: ProviderKind;
  readonly activeProviderKey: string;
  readonly selectedBy: "configuration" | "policy" | "workflow";
}

export interface AiProviderRequest {
  readonly taskKey: string;
  readonly modelKey: string;
  readonly prompt: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly responseFormat: "json_object" | "text";
  readonly idempotencyKey: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface AiProviderResponse {
  readonly output: Readonly<Record<string, unknown>> | string;
  readonly modelInfo: Readonly<Record<string, unknown>>;
  readonly usage?: Readonly<Record<string, unknown>>;
  readonly safety?: Readonly<Record<string, unknown>>;
}

export type MapOperation =
  | "geocode"
  | "reverse_geocode"
  | "route"
  | "distance_matrix"
  | "eta"
  | "geofence";

export interface GeoPoint {
  readonly latitude: number;
  readonly longitude: number;
}

export interface MapProviderRequest {
  readonly operation: MapOperation;
  readonly subjectType?: string;
  readonly subjectId?: string;
  readonly origin?: GeoPoint;
  readonly destination?: GeoPoint;
  readonly query?: string;
  readonly options?: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
}

export interface MapProviderResponse {
  readonly standardized: Readonly<Record<string, unknown>>;
  readonly providerMetadata: Readonly<Record<string, unknown>>;
}

export interface WebhookDeliveryRequest {
  readonly deliveryId: string;
  readonly endpointId: string;
  readonly eventId: string;
  readonly eventTypeKey: string;
  readonly url: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly signingSecretRef: string;
  readonly idempotencyKey: string;
  readonly deliveryConfig?: Readonly<Record<string, unknown>>;
}

export interface WebhookDeliveryResponse {
  readonly delivered: boolean;
  readonly responseStatus?: number;
  readonly responseBody?: string;
  readonly attemptId?: string;
  readonly providerExecutionLogId?: string;
  readonly errorMessage?: string;
}

export class ProviderRegistry {
  private readonly adapters = new Map<string, ProviderAdapter<unknown, unknown>>();

  register(adapter: ProviderAdapter<unknown, unknown>): void {
    const key = registryKey(adapter.kind, adapter.key);

    if (this.adapters.has(key)) {
      throw new Error(`Provider adapter already registered: ${key}`);
    }

    this.adapters.set(key, adapter);
  }

  resolve<TRequest, TResponse>(
    kind: ProviderKind,
    key: string,
  ): ProviderAdapter<TRequest, TResponse> {
    const adapter = this.adapters.get(registryKey(kind, key));

    if (!adapter) {
      throw new Error(`Provider adapter is not registered: ${kind}.${key}`);
    }

    return adapter as ProviderAdapter<TRequest, TResponse>;
  }

  list(kind?: ProviderKind): readonly ProviderAdapter<unknown, unknown>[] {
    const adapters = Array.from(this.adapters.values());
    return kind ? adapters.filter((adapter) => adapter.kind === kind) : adapters;
  }
}

function registryKey(kind: ProviderKind, key: string): string {
  return `${kind}.${assertPlatformKey(key, "providerKey")}`;
}
