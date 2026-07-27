import {
  assertEntityReference,
  assertPlatformKey,
  EntityReference,
  isUuid,
} from "../../core/src/index.ts";

export const EVENT_STATUSES = [
  "received",
  "validated",
  "processing",
  "processed",
  "failed",
  "ignored",
] as const;

export type EventStatus = (typeof EVENT_STATUSES)[number];

export const WORKFLOW_INSTANCE_STATUSES = ["running", "completed", "failed", "cancelled"] as const;
export type WorkflowInstanceStatus = (typeof WORKFLOW_INSTANCE_STATUSES)[number];

export interface PlatformEvent {
  readonly id: string;
  readonly eventType: string;
  readonly source: string;
  readonly subject: EntityReference;
  readonly actor: EntityReference | null;
  readonly idempotencyKey: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly status: EventStatus;
  readonly occurredAt: string;
}

export interface CreatePlatformEventInput {
  readonly eventType: string;
  readonly source: string;
  readonly subject: EntityReference;
  readonly actor?: EntityReference | null;
  readonly idempotencyKey?: string | null;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly occurredAt?: Date;
}

export interface StartWorkflowInstanceInput {
  readonly workflowKey: string;
  readonly source: string;
  readonly subject: EntityReference;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
}

export interface AdvanceWorkflowInstanceInput {
  readonly instanceId: string;
  readonly eventType: string;
  readonly eventId?: string | null;
  readonly payload?: Readonly<Record<string, unknown>>;
  readonly idempotencyKey: string;
}

export function createPlatformEvent(input: CreatePlatformEventInput): PlatformEvent {
  return {
    id: crypto.randomUUID(),
    eventType: assertPlatformKey(input.eventType, "eventType"),
    source: assertPlatformKey(input.source, "source"),
    subject: assertEntityReference(input.subject),
    actor: input.actor ? assertEntityReference(input.actor) : null,
    idempotencyKey: input.idempotencyKey ?? null,
    payload: input.payload ? { ...input.payload } : {},
    status: "received",
    occurredAt: (input.occurredAt ?? new Date()).toISOString(),
  };
}

export function defineWorkflowStart(input: StartWorkflowInstanceInput): StartWorkflowInstanceInput {
  return {
    workflowKey: assertPlatformKey(input.workflowKey, "workflowKey"),
    source: assertPlatformKey(input.source, "source"),
    subject: assertEntityReference(input.subject),
    context: input.context ? { ...input.context } : {},
    idempotencyKey: assertRequiredIdempotencyKey(input.idempotencyKey),
  };
}

export function defineWorkflowAdvancement(
  input: AdvanceWorkflowInstanceInput,
): AdvanceWorkflowInstanceInput {
  const eventId = input.eventId ?? null;

  if (!isUuid(input.instanceId)) {
    throw new Error("instanceId must be a UUID.");
  }

  if (eventId !== null && !isUuid(eventId)) {
    throw new Error("eventId must be a UUID.");
  }

  return {
    instanceId: input.instanceId,
    eventType: assertPlatformKey(input.eventType, "eventType"),
    eventId,
    payload: input.payload ? { ...input.payload } : {},
    idempotencyKey: assertRequiredIdempotencyKey(input.idempotencyKey),
  };
}

export function buildEventType(namespace: string, action: string): string {
  return `${assertPlatformKey(namespace, "namespace")}.${assertPlatformKey(action, "action")}`;
}

function assertRequiredIdempotencyKey(value: string): string {
  if (value.trim().length === 0) {
    throw new Error("idempotencyKey is required.");
  }

  return value;
}
