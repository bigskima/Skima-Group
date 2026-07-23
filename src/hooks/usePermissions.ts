import { useState, useCallback } from 'react';
import { UserRole, UserProfile } from '../types';
import { IdentityEngine, PlatformAction } from '../services/IdentityEngine';

export function usePermissions(initialProfile?: UserProfile) {
  const identity = IdentityEngine.getInstance();
  const [activeRole, setActiveRole] = useState<UserRole>('CUSTOMER');

  const availableRoles: UserRole[] = ['CUSTOMER'];
  if (initialProfile?.isDriver) availableRoles.push('DRIVER');
  if (initialProfile?.isStationAdmin) availableRoles.push('STATION_ADMIN');
  if (initialProfile?.isPumpAttendant) availableRoles.push('PUMP_ATTENDANT');
  if (initialProfile?.isMerchant) availableRoles.push('MERCHANT');
  if (initialProfile?.isAdmin) availableRoles.push('ADMIN');

  const switchRole = useCallback((targetRole: UserRole) => {
    const result = identity.switchRole(targetRole);
    if (result.success) {
      setActiveRole(targetRole);
    }
    return result;
  }, [identity]);

  const canPerform = useCallback((action: PlatformAction) => {
    return identity.hasPermission(action);
  }, [identity]);

  const requestUnlock = useCallback((role: UserRole) => {
    return identity.requestRoleUnlock(role);
  }, [identity]);

  return {
    activeRole,
    availableRoles,
    hasDriverRole: availableRoles.includes('DRIVER'),
    hasMerchantRole: availableRoles.includes('MERCHANT'),
    hasStationRole: availableRoles.includes('STATION_ADMIN') || availableRoles.includes('PUMP_ATTENDANT'),
    hasAdminRole: availableRoles.includes('ADMIN'),
    switchRole,
    canPerform,
    requestUnlock,
  };
}

