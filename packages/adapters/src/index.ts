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
