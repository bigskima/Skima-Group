/**
 * SKIMA IDENTITY & AUTHENTICATION ENGINE
 * Manages Supabase Auth, single-identity profiles, dynamic role unlocking,
 * and JWT session persistence.
 */

import { UserProfile, UserRole } from '../types';

export interface AuthSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export interface AuthState {
  isAuthenticated: boolean;
  userProfile?: UserProfile;
  activeRole: UserRole;
  availableRoles: UserRole[];
  session?: AuthSession;
}

export type PlatformAction = 
  | 'PLACE_GAS_ORDER'
  | 'TRACK_LIVE_DELIVERY'
  | 'ACCEPT_DELIVERY_JOB'
  | 'SCAN_CYLINDER_CUSTODY'
  | 'CONFIRM_STATION_REFILL'
  | 'MANAGE_STATION_PRICING'
  | 'MANAGE_MERCHANT_INVENTORY'
  | 'FULFILL_MARKETPLACE_ORDER'
  | 'PAY_UTILITY_BILLS'
  | 'MANAGE_SYSTEM_CONFIG'
  | 'APPROVE_ROLE_VERIFICATION';

export class IdentityEngine {
  private static instance: IdentityEngine;
  private state: AuthState = {
    isAuthenticated: false,
    activeRole: 'CUSTOMER',
    availableRoles: ['CUSTOMER'],
  };

  private constructor() {}

  public static getInstance(): IdentityEngine {
    if (!IdentityEngine.instance) {
      IdentityEngine.instance = new IdentityEngine();
    }
    return IdentityEngine.instance;
  }

  /**
   * Returns current authenticated user state.
   */
  public getAuthState(): AuthState {
    return this.state;
  }

  /**
   * Initializes session from login/signup.
   */
  public initializeSession(profile: UserProfile, session: AuthSession): AuthState {
    const roles: UserRole[] = ['CUSTOMER'];
    if (profile.isDriver) roles.push('DRIVER');
    if (profile.isStationAdmin) roles.push('STATION_ADMIN');
    if (profile.isPumpAttendant) roles.push('PUMP_ATTENDANT');
    if (profile.isMerchant) roles.push('MERCHANT');
    if (profile.isAdmin) roles.push('ADMIN');

    this.state = {
      isAuthenticated: true,
      userProfile: profile,
      activeRole: 'CUSTOMER',
      availableRoles: roles,
      session,
    };

    return this.state;
  }

  /**
   * Checks whether the active role or user profile has authorization for a specific action.
   */
  public hasPermission(action: PlatformAction): boolean {
    if (!this.state.isAuthenticated) return false;
    const role = this.state.activeRole;
    const profile = this.state.userProfile;

    switch (action) {
      case 'PLACE_GAS_ORDER':
      case 'TRACK_LIVE_DELIVERY':
      case 'PAY_UTILITY_BILLS':
        return true; // Any authenticated user can perform customer actions

      case 'ACCEPT_DELIVERY_JOB':
        return role === 'DRIVER' && Boolean(profile?.isDriver);

      case 'SCAN_CYLINDER_CUSTODY':
        return (
          role === 'DRIVER' ||
          role === 'STATION_ADMIN' ||
          role === 'PUMP_ATTENDANT' ||
          role === 'CUSTOMER'
        );

      case 'CONFIRM_STATION_REFILL':
        return role === 'STATION_ADMIN' || role === 'PUMP_ATTENDANT';

      case 'MANAGE_STATION_PRICING':
        return role === 'STATION_ADMIN' || role === 'ADMIN';

      case 'MANAGE_MERCHANT_INVENTORY':
      case 'FULFILL_MARKETPLACE_ORDER':
        return role === 'MERCHANT' && Boolean(profile?.isMerchant);

      case 'MANAGE_SYSTEM_CONFIG':
      case 'APPROVE_ROLE_VERIFICATION':
        return role === 'ADMIN' && Boolean(profile?.isAdmin);

      default:
        return false;
    }
  }

  /**
   * Switches active role interface if permitted by profile flags.
   */
  public switchRole(targetRole: UserRole): { success: boolean; activeRole: UserRole; message: string } {
    if (!this.state.availableRoles.includes(targetRole)) {
      return {
        success: false,
        activeRole: this.state.activeRole,
        message: `Account is not verified for ${targetRole} role. Complete verification in settings to unlock.`,
      };
    }

    this.state.activeRole = targetRole;
    return {
      success: true,
      activeRole: targetRole,
      message: `Switched view to ${targetRole}.`,
    };
  }

  /**
   * Requests role unlock (e.g. Driver KYC, Merchant application).
   * Note: AI advisory agents can check eligibility, but Admin approval is required to grant role permissions.
   */
  public requestRoleUnlock(roleToUnlock: UserRole): { success: boolean; message: string } {
    if (this.state.availableRoles.includes(roleToUnlock)) {
      return { success: true, message: `Role ${roleToUnlock} is already unlocked.` };
    }
    return {
      success: true,
      message: `Verification request submitted for ${roleToUnlock}. Platform admin review pending.`,
    };
  }

  /**
   * Sign out and clear active session state.
   */
  public signOut(): void {
    this.state = {
      isAuthenticated: false,
      activeRole: 'CUSTOMER',
      availableRoles: ['CUSTOMER'],
    };
  }
}

