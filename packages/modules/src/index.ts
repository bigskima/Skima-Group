import { assertPlatformKey } from "../../core/src/index.ts";

export const BUSINESS_MODULE_STATUSES = ["draft", "active", "suspended", "retired"] as const;
export type BusinessModuleStatus = (typeof BUSINESS_MODULE_STATUSES)[number];

export const BUSINESS_MODULE_VERSION_STATUSES = ["draft", "active", "retired"] as const;
export type BusinessModuleVersionStatus = (typeof BUSINESS_MODULE_VERSION_STATUSES)[number];

export const BUSINESS_MODULE_COMPONENT_TYPES = [
  "capability",
  "workflow",
  "pricing_policy",
  "settlement_policy",
  "event",
  "permission",
  "vehicle_requirement",
  "driver_requirement",
  "document_requirement",
  "ai_behavior",
  "report",
  "screen",
] as const;
export type BusinessModuleComponentType = (typeof BUSINESS_MODULE_COMPONENT_TYPES)[number];

export interface BusinessModuleDefinition {
  readonly key: string;
  readonly displayName: string;
  readonly description?: string | null;
  readonly status: BusinessModuleStatus;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface BusinessModuleVersionDefinition {
  readonly moduleKey: string;
  readonly version: number;
  readonly status: BusinessModuleVersionStatus;
  readonly manifest: Readonly<Record<string, unknown>>;
}

export interface BusinessModuleComponentDefinition {
  readonly componentType: BusinessModuleComponentType;
  readonly componentKey: string;
  readonly referenceKey?: string | null;
  readonly isRequired: boolean;
  readonly config: Readonly<Record<string, unknown>>;
  readonly status: BusinessModuleVersionStatus;
}

export function defineBusinessModule(
  key: string,
  displayName: string,
  metadata: Readonly<Record<string, unknown>> = {},
  description: string | null = null,
): BusinessModuleDefinition {
  if (displayName.trim().length === 0) {
    throw new Error("displayName is required.");
  }

  return {
    key: assertPlatformKey(key, "moduleKey"),
    displayName,
    description,
    status: "draft",
    metadata: { ...metadata },
  };
}

export function defineBusinessModuleVersion(
  moduleKey: string,
  version: number,
  manifest: Readonly<Record<string, unknown>> = {},
): BusinessModuleVersionDefinition {
  if (version < 1) {
    throw new Error("version must be greater than zero.");
  }

  return {
    moduleKey: assertPlatformKey(moduleKey, "moduleKey"),
    version,
    status: "draft",
    manifest: { ...manifest },
  };
}

export function defineBusinessModuleComponent(
  componentType: BusinessModuleComponentType,
  componentKey: string,
  config: Readonly<Record<string, unknown>> = {},
  referenceKey: string | null = null,
): BusinessModuleComponentDefinition {
  if (!BUSINESS_MODULE_COMPONENT_TYPES.includes(componentType)) {
    throw new Error("componentType is not supported.");
  }

  return {
    componentType,
    componentKey: assertPlatformKey(componentKey, "componentKey"),
    referenceKey: referenceKey ? assertPlatformKey(referenceKey, "referenceKey") : null,
    isRequired: true,
    config: { ...config },
    status: "active",
  };
}
