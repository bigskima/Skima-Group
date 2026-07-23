/**
 * SKIMA CUSTODY STATE MACHINE ENGINE
 * Governs cylinder QR code scanning, custody transfers, and physical state transitions.
 * Enforces ownership vs custody separation rules.
 */

import { CylinderStatus, UserRole } from '../types';

export interface CustodyTransitionRequest {
  cylinderId: string;
  qrCode: string;
  currentStatus: CylinderStatus;
  scannedByUserId: string;
  scannedByRole: UserRole;
  targetCustodyUserId: string;
  latitude?: number;
  longitude?: number;
  photoProofUrl?: string;
}

export interface CustodyTransitionResult {
  allowed: boolean;
  nextStatus?: CylinderStatus;
  newCustodyUserId?: string;
  reason?: string;
  triggerEscrowRelease?: 'NONE' | 'STATION_PAYMENT' | 'FULL_ORDER_COMPLETION';
}

export class CustodyEngine {
  /**
   * Validates whether a scanned custody transition is valid according to platform rules.
   */
  public static evaluateTransition(request: CustodyTransitionRequest): CustodyTransitionResult {
    const { currentStatus, scannedByRole, targetCustodyUserId } = request;

    switch (currentStatus) {
      case 'IDLE':
        // Customer cylinder collected by Driver
        if (scannedByRole === 'DRIVER') {
          return {
            allowed: true,
            nextStatus: 'IN_TRANSIT_TO_STATION',
            newCustodyUserId: targetCustodyUserId,
            triggerEscrowRelease: 'NONE',
          };
        }
        return { allowed: false, reason: 'Only a verified Driver can pick up an IDLE cylinder.' };

      case 'IN_TRANSIT_TO_STATION':
        // Driver delivers cylinder to Station Pump Attendant
        if (scannedByRole === 'PUMP_ATTENDANT' || scannedByRole === 'STATION_ADMIN') {
          return {
            allowed: true,
            nextStatus: 'AT_STATION',
            newCustodyUserId: targetCustodyUserId,
            triggerEscrowRelease: 'NONE',
          };
        }
        return { allowed: false, reason: 'Only a Station Pump Attendant can receive a cylinder at the station.' };

      case 'AT_STATION':
        // Station completes refilling
        if (scannedByRole === 'PUMP_ATTENDANT' || scannedByRole === 'STATION_ADMIN') {
          return {
            allowed: true,
            nextStatus: 'REFILLED',
            newCustodyUserId: targetCustodyUserId,
            triggerEscrowRelease: 'STATION_PAYMENT', // Triggers station payout release from escrow!
          };
        }
        return { allowed: false, reason: 'Only station staff can mark a cylinder as REFILLED.' };

      case 'REFILLED':
        // Driver collects refilled cylinder from Station
        if (scannedByRole === 'DRIVER') {
          return {
            allowed: true,
            nextStatus: 'IN_TRANSIT_TO_CUSTOMER',
            newCustodyUserId: targetCustodyUserId,
            triggerEscrowRelease: 'NONE',
          };
        }
        return { allowed: false, reason: 'Only a assigned Driver can pick up a REFILLED cylinder from the station.' };

      case 'IN_TRANSIT_TO_CUSTOMER':
        // Driver returns cylinder to Customer
        if (scannedByRole === 'CUSTOMER' || scannedByRole === 'DRIVER') {
          return {
            allowed: true,
            nextStatus: 'IDLE',
            newCustodyUserId: targetCustodyUserId,
            triggerEscrowRelease: 'FULL_ORDER_COMPLETION', // Triggers driver commission + order completion!
          };
        }
        return { allowed: false, reason: 'Delivery confirmation requires Customer verification.' };

      default:
        return { allowed: false, reason: 'Unknown cylinder status.' };
    }
  }
}
