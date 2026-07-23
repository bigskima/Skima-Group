import { GasOrderStatus, UserRole } from '../types';

export interface LiveTrackingPolicyInput {
  orderStatus: GasOrderStatus;
  requesterRole: UserRole;
  requesterUserId: string;
  customerId: string;
  driverId?: string;
}

export interface LiveTrackingPolicyResult {
  canViewDriverLocation: boolean;
  reason: string;
}

const CUSTOMER_VISIBLE_STATUSES: GasOrderStatus[] = [
  'ASSIGNED_TO_DRIVER',
  'CYLINDER_PICKED_UP',
  'RETURN_IN_TRANSIT',
  'DELIVERED_TO_CUSTOMER',
];

export class LiveTrackingPolicy {
  public static evaluate(input: LiveTrackingPolicyInput): LiveTrackingPolicyResult {
    if (input.requesterRole === 'ADMIN') {
      return {
        canViewDriverLocation: true,
        reason: 'Admin operational monitoring is allowed.',
      };
    }

    if (input.requesterRole === 'DRIVER' && input.requesterUserId === input.driverId) {
      return {
        canViewDriverLocation: true,
        reason: 'Assigned driver can view their active route context.',
      };
    }

    if (input.requesterRole !== 'CUSTOMER' || input.requesterUserId !== input.customerId) {
      return {
        canViewDriverLocation: false,
        reason: 'Driver location is visible only to the assigned customer during active delivery.',
      };
    }

    const canTrack = CUSTOMER_VISIBLE_STATUSES.includes(input.orderStatus);

    return {
      canViewDriverLocation: canTrack,
      reason: canTrack
        ? 'Live tracking is active for this delivery phase.'
        : 'Live tracking is off outside the active delivery phase.',
    };
  }
}
