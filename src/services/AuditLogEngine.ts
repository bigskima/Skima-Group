import { AuditEventType, AuditLogEntry, UserRole } from '../types';

export class AuditLogEngine {
  private static logs: AuditLogEntry[] = [];

  public static recordEvent(params: {
    eventType: AuditEventType;
    actorId: string;
    actorRole: UserRole;
    targetResource: string;
    resourceId: string;
    payload?: Record<string, unknown>;
  }): AuditLogEntry {
    const newEntry: AuditLogEntry = {
      id: `audit-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      eventType: params.eventType,
      actorId: params.actorId,
      actorRole: params.actorRole,
      targetResource: params.targetResource,
      resourceId: params.resourceId,
      payload: params.payload ?? {},
      createdAt: new Date().toISOString(),
    };

    this.logs.unshift(newEntry);
    console.log(`[AUDIT ENGINE] [${newEntry.eventType}] Actor ${params.actorId} (${params.actorRole}) -> ${params.targetResource}:${params.resourceId}`);
    return newEntry;
  }

  public static getLogs(filter?: {
    actorId?: string;
    targetResource?: string;
    eventType?: AuditEventType;
  }): AuditLogEntry[] {
    let result = [...this.logs];
    if (filter?.actorId) {
      result = result.filter((l) => l.actorId === filter.actorId);
    }
    if (filter?.targetResource) {
      result = result.filter((l) => l.targetResource === filter.targetResource);
    }
    if (filter?.eventType) {
      result = result.filter((l) => l.eventType === filter.eventType);
    }
    return result;
  }

  public static clearInMemoryLogs(): void {
    this.logs = [];
  }
}
