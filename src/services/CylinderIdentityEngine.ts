import {
  CylinderAsset,
  CylinderCustodyStatus,
  CylinderInspectionRecord,
  UserRole,
} from '../types';

export interface CylinderHandoffRequest {
  cylinderId: string;
  qrCode: string;
  actorUserId: string;
  actorRole: UserRole;
  targetCustodyUserId: string;
  targetCustodyRole: UserRole;
  currentStatus: CylinderCustodyStatus;
}

export interface CylinderHandoffResult {
  allowed: boolean;
  nextStatus?: CylinderCustodyStatus;
  reason?: string;
  escrowTrigger?: 'STATION_PAYMENT' | 'FULL_ORDER_COMPLETION' | 'NONE';
}

export interface PublicCylinderVerificationView {
  isVerified: boolean;
  publicTag: string;
  capacityKg: number;
  safetyClearance: boolean;
  registeredDate: string;
  currentStatus: CylinderCustodyStatus;
  notice: string;
}

export interface CylinderPrintableMetadata {
  publicTag: string;
  qrCode: string;
  qrUrl: string;
  capacityKg: number;
  tareWeightKg: number;
  safetyClearance: boolean;
  registeredDate: string;
}

export type PrintableCardData = CylinderPrintableMetadata;

export class CylinderIdentityEngine {
  private static registry: Map<string, CylinderAsset> = new Map();
  private static inspectionHistory: Map<string, CylinderInspectionRecord[]> = new Map();

  /**
   * Generates permanent QR Code & Public Tag for a physical cylinder asset
   */
  public static createPermanentCylinder(params: {
    capacityKg: number;
    tareWeightKg: number;
    ownerType: 'SKIMA_POOL' | 'CUSTOMER_OWNED' | 'STATION_OWNED';
    ownerUserId?: string;
    zonePrefix?: string;
  }): CylinderAsset {
    const randomSuffix = Math.floor(10000 + Math.random() * 90000);
    const prefix = params.zonePrefix ?? 'AWK';
    const publicTag = `CYL-${prefix}-${params.capacityKg.toFixed(1)}-${randomSuffix}`;
    const qrCode = `SKM-CYL-QR-${randomSuffix}`;

    const newCylinder: CylinderAsset = {
      id: `cyl-${Date.now()}-${randomSuffix}`,
      publicTag,
      qrCode,
      capacityKg: params.capacityKg,
      tareWeightKg: params.tareWeightKg,
      ownerType: params.ownerType,
      ownerUserId: params.ownerUserId,
      currentCustodyUserId: params.ownerUserId,
      currentCustodyRole: params.ownerType === 'CUSTOMER_OWNED' ? 'CUSTOMER' : 'STATION_ADMIN',
      currentStatus: 'IDLE',
      safetyClearance: true,
      lastInspectedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    this.registry.set(newCylinder.qrCode, newCylinder);
    this.registry.set(newCylinder.publicTag, newCylinder);
    this.inspectionHistory.set(newCylinder.id, []);

    console.log(`[ASSET IDENTITY ENGINE] Registered Permanent Cylinder: ${newCylinder.publicTag} (${newCylinder.qrCode})`);
    return newCylinder;
  }

  public static lookupByQrCode(qrCodeOrTag: string): CylinderAsset | undefined {
    return this.registry.get(qrCodeOrTag);
  }

  public static getAllCylinders(): CylinderAsset[] {
    const unique = new Map<string, CylinderAsset>();
    for (const item of this.registry.values()) {
      unique.set(item.id, item);
    }
    return Array.from(unique.values());
  }

  /**
   * Resolves scanner access based on viewer permissions:
   * Public (Unauthenticated) -> Basic verified status only. No private info exposed.
   * Authenticated Users (Customer, Driver, Station, Admin) -> Full operational history.
   */
  public static resolveCylinderPermissions(
    qrCodeOrTag: string,
    viewerRole: UserRole | 'PUBLIC',
    viewerUserId?: string
  ): {
    accessLevel: 'PUBLIC' | 'FULL_OPERATIONAL';
    publicView?: PublicCylinderVerificationView;
    fullAsset?: CylinderAsset;
    inspectionHistory?: CylinderInspectionRecord[];
  } {
    const cylinder = this.lookupByQrCode(qrCodeOrTag);
    if (!cylinder) {
      throw new Error(`Cylinder not found for identifier: ${qrCodeOrTag}`);
    }

    if (viewerRole === 'PUBLIC' || !viewerUserId) {
      return {
        accessLevel: 'PUBLIC',
        publicView: {
          isVerified: cylinder.safetyClearance,
          publicTag: cylinder.publicTag,
          capacityKg: cylinder.capacityKg,
          safetyClearance: cylinder.safetyClearance,
          registeredDate: cylinder.createdAt,
          currentStatus: cylinder.currentStatus,
          notice: 'Verified Skima Physical LPG Asset. Public scan mode active.',
        },
      };
    }

    return {
      accessLevel: 'FULL_OPERATIONAL',
      fullAsset: cylinder,
      inspectionHistory: this.getInspectionHistory(cylinder.id),
    };
  }

  public static generatePrintableCardData(cylinderIdOrTag: string): CylinderPrintableMetadata {
    const cylinder = this.lookupByQrCode(cylinderIdOrTag);
    if (!cylinder) {
      throw new Error(`Cylinder asset not found: ${cylinderIdOrTag}`);
    }

    return {
      publicTag: cylinder.publicTag,
      qrCode: cylinder.qrCode,
      qrUrl: `https://app.skima.com/cylinder/${cylinder.publicTag}`,
      capacityKg: cylinder.capacityKg,
      tareWeightKg: cylinder.tareWeightKg,
      safetyClearance: cylinder.safetyClearance,
      registeredDate: cylinder.createdAt,
    };
  }

  public static recordInspection(record: Omit<CylinderInspectionRecord, 'id' | 'createdAt'>): CylinderInspectionRecord {
    const fullRecord: CylinderInspectionRecord = {
      ...record,
      id: `insp-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      createdAt: new Date().toISOString(),
    };

    const existingLogs = this.inspectionHistory.get(record.cylinderId) ?? [];
    existingLogs.unshift(fullRecord);
    this.inspectionHistory.set(record.cylinderId, existingLogs);

    return fullRecord;
  }

  public static getInspectionHistory(cylinderId: string): CylinderInspectionRecord[] {
    return this.inspectionHistory.get(cylinderId) ?? [];
  }

  public static evaluateCustodyHandoff(req: CylinderHandoffRequest): CylinderHandoffResult {
    if (req.currentStatus === 'IDLE') {
      if (req.actorRole === 'DRIVER') {
        return {
          allowed: true,
          nextStatus: 'IN_TRANSIT_TO_STATION',
          reason: 'Driver successfully picked up empty cylinder from customer.',
          escrowTrigger: 'NONE',
        };
      }
      return { allowed: false, reason: 'Only a verified Driver can pick up an IDLE cylinder.' };
    }

    if (req.currentStatus === 'IN_TRANSIT_TO_STATION') {
      if (req.actorRole === 'PUMP_ATTENDANT' || req.actorRole === 'STATION_ADMIN') {
        return {
          allowed: true,
          nextStatus: 'AT_STATION',
          reason: 'Station received cylinder from driver for refill.',
          escrowTrigger: 'NONE',
        };
      }
      return { allowed: false, reason: 'Only Station Attendants can accept cylinder at gas station.' };
    }

    if (req.currentStatus === 'AT_STATION') {
      if (req.actorRole === 'PUMP_ATTENDANT' || req.actorRole === 'STATION_ADMIN') {
        return {
          allowed: true,
          nextStatus: 'REFILLING',
          reason: 'Station refilled cylinder to specified weight.',
          escrowTrigger: 'STATION_PAYMENT',
        };
      }
      return { allowed: false, reason: 'Only Station Staff can refill cylinders.' };
    }

    if (req.currentStatus === 'REFILLING') {
      if (req.actorRole === 'DRIVER') {
        return {
          allowed: true,
          nextStatus: 'IN_TRANSIT_TO_CUSTOMER',
          reason: 'Driver picked up refilled cylinder from station for delivery return.',
          escrowTrigger: 'NONE',
        };
      }
      return { allowed: false, reason: 'Only Driver can retrieve refilled cylinder from station.' };
    }

    if (req.currentStatus === 'IN_TRANSIT_TO_CUSTOMER') {
      if (req.actorRole === 'CUSTOMER') {
        return {
          allowed: true,
          nextStatus: 'DELIVERED',
          reason: 'Customer verified QR scan and took delivery of refilled cylinder.',
          escrowTrigger: 'FULL_ORDER_COMPLETION',
        };
      }
      return { allowed: false, reason: 'Customer scan required to confirm final delivery.' };
    }

    return { allowed: false, reason: `Invalid custody transition state: ${req.currentStatus}` };
  }
}
