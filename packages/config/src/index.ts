import { assertPlatformKey } from "../../core/src/index.ts";

export const CONFIG_SCOPE_TYPES = [
  "global",
  "organization",
  "user",
  "module",
  "provider",
] as const;

export type ConfigScopeType = (typeof CONFIG_SCOPE_TYPES)[number];

export interface ConfigurationRecord<TValue = unknown> {
  readonly namespace: string;
  readonly key: string;
  readonly scopeType: ConfigScopeType;
  readonly scopeId: string | null;
  readonly value: TValue;
  readonly version: number;
  readonly status: "draft" | "active" | "retired";
  readonly effectiveFrom: string | null;
  readonly effectiveUntil: string | null;
}

export interface ConfigurationRequest {
  readonly namespace: string;
  readonly key: string;
  readonly scopeType: ConfigScopeType;
  readonly scopeId: string | null;
  readonly at?: Date;
}

export function defineConfigKey(namespace: string, key: string): string {
  return `${assertPlatformKey(namespace, "namespace")}.${assertPlatformKey(key, "key")}`;
}

export function resolveConfigurationValue<TValue>(
  records: readonly ConfigurationRecord<TValue>[],
  request: ConfigurationRequest,
): TValue | undefined {
  const namespace = assertPlatformKey(request.namespace, "namespace");
  const key = assertPlatformKey(request.key, "key");
  const at = request.at ?? new Date();

  const candidates = records
    .filter((record) => record.namespace === namespace)
    .filter((record) => record.key === key)
    .filter((record) => record.status === "active")
    .filter((record) => isEffective(record, at))
    .map((record) => ({ record, score: scopeScore(record, request) }))
    .filter((candidate) => candidate.score >= 0)
    .sort((left, right) => {
      if (left.score !== right.score) {
        return right.score - left.score;
      }

      return right.record.version - left.record.version;
    });

  return candidates[0]?.record.value;
}

function isEffective(record: ConfigurationRecord, at: Date): boolean {
  const from = record.effectiveFrom ? new Date(record.effectiveFrom) : null;
  const until = record.effectiveUntil ? new Date(record.effectiveUntil) : null;

  return (!from || from <= at) && (!until || until > at);
}

function scopeScore(record: ConfigurationRecord, request: ConfigurationRequest): number {
  if (record.scopeType === request.scopeType && record.scopeId === request.scopeId) {
    return 100;
  }

  if (record.scopeType === "global" && record.scopeId === null) {
    return 0;
  }

  return -1;
}
