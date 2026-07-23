/**
 * SKIMA PLATFORM DISPUTE & ESCROW ARBITRATION ENGINE
 * Manages dispute lifecycle for marketplace commerce and gas refill orders.
 * Handles claim logging, evidence management, risk scoring, escrow lock freezing,
 * and admin arbitration actions (Full Refund, Partial Refund, Escrow Release to Seller/Station).
 */

import { AuditLogEngine } from './AuditLogEngine';
import { UserRole } from '../types';

export type DisputeReason = 
  | 'CYLINDER_DAMAGED'
  | 'WRONG_GAS_QUANTITY'
  | 'ITEM_NOT_RECEIVED'
  | 'DEFECTIVE_PRODUCT'
  | 'UNAUTHORIZED_CHARGE'
  | 'DRIVER_CONDUCT';

export type DisputeStatus = 
  | 'SUBMITTED'
  | 'UNDER_INVESTIGATION'
  | 'RESOLVED_BUYER_REFUND'
  | 'RESOLVED_SELLER_RELEASE'
  | 'RESOLVED_PARTIAL_REFUND'
  | 'REJECTED';

export interface DisputeClaim {
  id: string;
  orderId: string;
  orderType: 'GAS_REFILL' | 'MARKETPLACE';
  claimantUserId: string;
  claimantRole: UserRole;
  reason: DisputeReason;
  description: string;
  evidenceUrls: string[];
  disputedAmountNgn: number;
  status: DisputeStatus;
  adminNotes?: string;
  resolutionTimestamp?: string;
  createdAt: string;
}

export interface DisputeArbitrationResult {
  disputeId: string;
  nextStatus: DisputeStatus;
  refundAmountNgn: number;
  payoutAmountNgn: number;
  auditLogId: string;
}

export class DisputeEngine {
  private static disputesMap: Map<string, DisputeClaim> = new Map();

  /**
   * Log a new dispute and freeze order escrow
   */
  public static createDispute(params: {
    orderId: string;
    orderType: 'GAS_REFILL' | 'MARKETPLACE';
    claimantUserId: string;
    claimantRole: UserRole;
    reason: DisputeReason;
    description: string;
    evidenceUrls?: string[];
    disputedAmountNgn: number;
  }): DisputeClaim {
    const disputeId = `DSP-${Date.now()}-${Math.floor(100 + Math.random() * 900)}`;

    const dispute: DisputeClaim = {
      id: disputeId,
      orderId: params.orderId,
      orderType: params.orderType,
      claimantUserId: params.claimantUserId,
      claimantRole: params.claimantRole,
      reason: params.reason,
      description: params.description,
      evidenceUrls: params.evidenceUrls || [],
      disputedAmountNgn: params.disputedAmountNgn,
      status: 'SUBMITTED',
      createdAt: new Date().toISOString(),
    };

    this.disputesMap.set(disputeId, dispute);

    // Immutable Audit Log entry
    AuditLogEngine.recordEvent({
      eventType: 'DISPUTE_CREATED',
      actorId: params.claimantUserId,
      actorRole: params.claimantRole,
      targetResource: 'ORDER_ESCROW',
      resourceId: params.orderId,
      payload: { disputeId, reason: params.reason, amount: params.disputedAmountNgn },
    });

    return dispute;
  }

  /**
   * Admin Arbitration Trigger (Full Refund, Seller Payout, or Partial Split)
   */
  public static arbitrateDispute(params: {
    disputeId: string;
    adminUserId: string;
    action: 'REFUND_BUYER' | 'RELEASE_TO_SELLER' | 'PARTIAL_REFUND';
    partialRefundPercent?: number;
    adminNotes: string;
  }): DisputeArbitrationResult {
    const dispute = this.disputesMap.get(params.disputeId);
    if (!dispute) {
      throw new Error(`[DisputeEngine] Dispute ${params.disputeId} not found.`);
    }

    let nextStatus: DisputeStatus = 'UNDER_INVESTIGATION';
    let refundAmountNgn = 0;
    let payoutAmountNgn = 0;

    if (params.action === 'REFUND_BUYER') {
      nextStatus = 'RESOLVED_BUYER_REFUND';
      refundAmountNgn = dispute.disputedAmountNgn;
      payoutAmountNgn = 0;
    } else if (params.action === 'RELEASE_TO_SELLER') {
      nextStatus = 'RESOLVED_SELLER_RELEASE';
      refundAmountNgn = 0;
      payoutAmountNgn = dispute.disputedAmountNgn;
    } else if (params.action === 'PARTIAL_REFUND') {
      nextStatus = 'RESOLVED_PARTIAL_REFUND';
      const pct = (params.partialRefundPercent || 50) / 100;
      refundAmountNgn = Math.round(dispute.disputedAmountNgn * pct);
      payoutAmountNgn = dispute.disputedAmountNgn - refundAmountNgn;
    }

    dispute.status = nextStatus;
    dispute.adminNotes = params.adminNotes;
    dispute.resolutionTimestamp = new Date().toISOString();

    const auditLog = AuditLogEngine.recordEvent({
      eventType: 'DISPUTE_ARBITRATED',
      actorId: params.adminUserId,
      actorRole: 'ADMIN',
      targetResource: 'DISPUTE',
      resourceId: dispute.id,
      payload: { action: params.action, refundAmountNgn, payoutAmountNgn, notes: params.adminNotes },
    });

    return {
      disputeId: dispute.id,
      nextStatus,
      refundAmountNgn,
      payoutAmountNgn,
      auditLogId: auditLog.id,
    };
  }

  public static getDispute(disputeId: string): DisputeClaim | undefined {
    return this.disputesMap.get(disputeId);
  }

  public static listDisputes(): DisputeClaim[] {
    return Array.from(this.disputesMap.values());
  }

  public static clearInMemoryDisputes(): void {
    this.disputesMap.clear();
  }
}
