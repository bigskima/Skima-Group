import { CurrencyCode, GasOrderStatus } from '../types';

export type EscrowSettlementTrigger = 'STATION_PAYMENT' | 'FULL_ORDER_COMPLETION' | 'REFUND';

export interface GasOrderSettlementInput {
  orderId: string;
  publicId: string;
  status: GasOrderStatus;
  escrowStatus: 'PENDING' | 'LOCKED' | 'PARTIALLY_RELEASED' | 'RELEASED' | 'REFUNDED';
  customerId: string;
  stationOwnerUserId?: string;
  driverId?: string;
  gasCost: number;
  deliveryFee: number;
  currency?: CurrencyCode;
  trigger: EscrowSettlementTrigger;
}

export interface SettlementInstruction {
  allowed: boolean;
  reason: string;
  reference?: string;
  transactionType?: 'ESCROW_RELEASE_STATION' | 'ESCROW_RELEASE_DRIVER' | 'ESCROW_REFUND';
  destinationUserId?: string;
  amount?: number;
  currency: CurrencyCode;
  nextEscrowStatus?: 'PARTIALLY_RELEASED' | 'RELEASED' | 'REFUNDED';
}

export class SettlementEngine {
  public static evaluateGasOrderSettlement(input: GasOrderSettlementInput): SettlementInstruction {
    const currency = input.currency ?? 'NGN';

    if (input.escrowStatus !== 'LOCKED' && input.escrowStatus !== 'PARTIALLY_RELEASED') {
      return {
        allowed: false,
        reason: 'Escrow funds must be locked before any settlement can be released.',
        currency,
      };
    }

    if (input.trigger === 'STATION_PAYMENT') {
      if (input.status !== 'REFILL_COMPLETED') {
        return {
          allowed: false,
          reason: 'Station payout requires verified refill completion.',
          currency,
        };
      }

      if (!input.stationOwnerUserId) {
        return {
          allowed: false,
          reason: 'Station payout requires an assigned station owner wallet.',
          currency,
        };
      }

      return {
        allowed: true,
        reason: 'Verified refill completed. Release station gas-cost settlement.',
        reference: `SETTLE-STATION-${input.publicId}`,
        transactionType: 'ESCROW_RELEASE_STATION',
        destinationUserId: input.stationOwnerUserId,
        amount: input.gasCost,
        currency,
        nextEscrowStatus: 'PARTIALLY_RELEASED',
      };
    }

    if (input.trigger === 'FULL_ORDER_COMPLETION') {
      if (input.status !== 'COMPLETED') {
        return {
          allowed: false,
          reason: 'Driver payout requires customer delivery confirmation.',
          currency,
        };
      }

      if (!input.driverId) {
        return {
          allowed: false,
          reason: 'Driver payout requires an assigned driver wallet.',
          currency,
        };
      }

      return {
        allowed: true,
        reason: 'Customer delivery confirmed. Release driver commission.',
        reference: `SETTLE-DRIVER-${input.publicId}`,
        transactionType: 'ESCROW_RELEASE_DRIVER',
        destinationUserId: input.driverId,
        amount: input.deliveryFee,
        currency,
        nextEscrowStatus: 'RELEASED',
      };
    }

    if (input.trigger === 'REFUND') {
      return {
        allowed: true,
        reason: 'Refund requested. Return remaining locked escrow to customer wallet.',
        reference: `ESCROW-REFUND-${input.publicId}`,
        transactionType: 'ESCROW_REFUND',
        destinationUserId: input.customerId,
        amount: input.gasCost + input.deliveryFee,
        currency,
        nextEscrowStatus: 'REFUNDED',
      };
    }

    return {
      allowed: false,
      reason: 'Unknown settlement trigger.',
      currency,
    };
  }
}
