/**
 * DEPRECATED COMPATIBILITY WRAPPER
 * Offline mutation capabilities are now powered by SyncEngine.ts (Synchronization Capability).
 */

import { SyncEngine } from './SyncEngine';

export class OfflineQueueEngine {
  public static enqueueMutation(
    actionType: string,
    userId: string,
    payload: Record<string, unknown>,
    userRole: any = 'DRIVER'
  ) {
    return SyncEngine.enqueueSyncEvent(actionType, userId, payload, userRole);
  }

  public static flushQueue() {
    return SyncEngine.flushSyncQueue();
  }

  public static getQueueLength(): number {
    return SyncEngine.getQueueLength();
  }

  public static clearQueue(): void {
    SyncEngine.clearSyncQueue();
  }
}
