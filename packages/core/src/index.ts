export const PLATFORM_LAYERS = [
  "identity",
  "organizations",
  "platform-engines",
  "workflow-engine",
  "business-modules",
  "reusable-frontend",
  "artificial-intelligence",
] as const;

export type PlatformLayer = (typeof PLATFORM_LAYERS)[number];

export const FOUNDATION_ENGINE_KEYS = [
  "authentication",
  "authorization",
  "users",
  "roles",
  "permissions",
  "organizations",
  "partners",
  "drivers",
  "vehicles",
  "assets",
  "media",
  "storage",
  "configuration",
  "audit",
  "logging",
  "errors",
  "queue",
  "background-jobs",
  "webhooks",
  "api-gateway",
  "rate-limiting",
  "caching",
  "database",
  "edge-functions",
  "security",
  "health-monitoring",
  "documentation",
] as const;

export type FoundationEngineKey = (typeof FOUNDATION_ENGINE_KEYS)[number];

export const ENTITY_KINDS = [
  "user",
  "organization",
  "partner",
  "driver",
  "vehicle",
  "asset",
  "platform-admin",
  "platform-admin-role-template",
  "pricing-policy",
  "settlement-policy",
  "wallet",
  "financial-transaction",
  "escrow",
  "verification",
  "dispatch",
  "tracking",
  "notification",
  "ai-task",
  "map-request",
  "workflow",
  "event",
  "provider",
  "configuration",
] as const;

export type EntityKind = (typeof ENTITY_KINDS)[number];

export const LIFECYCLE_STATUSES = [
  "draft",
  "pending",
  "active",
  "suspended",
  "archived",
] as const;

export type LifecycleStatus = (typeof LIFECYCLE_STATUSES)[number];

export interface EntityReference {
  readonly type: EntityKind;
  readonly id: string;
}

export interface VersionedRecord {
  readonly id: string;
  readonly version: number;
  readonly status: LifecycleStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

const PLATFORM_KEY_PATTERN = /^[a-z][a-z0-9_.:-]{2,120}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertPlatformKey(value: string, fieldName = "key"): string {
  if (!PLATFORM_KEY_PATTERN.exec(value)) {
    throw new Error(
      `${fieldName} must be 3-121 characters and use lowercase letters, digits, dots, underscores, colons, or hyphens.`,
    );
  }

  return value;
}

export function isUuid(value: string): boolean {
  return Boolean(UUID_PATTERN.exec(value));
}

export function assertEntityReference(reference: EntityReference): EntityReference {
  if (!ENTITY_KINDS.includes(reference.type)) {
    throw new Error(`Unsupported entity type: ${reference.type}`);
  }

  if (!isUuid(reference.id)) {
    throw new Error(`Entity id must be a UUID for ${reference.type}.`);
  }

  return reference;
}

export function metadataOrEmpty(
  metadata?: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return metadata ? { ...metadata } : {};
}
