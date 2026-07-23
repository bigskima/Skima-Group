/**
 * SKIMA PLATFORM DESIGN SYSTEM THEME & COLOR PALETTE
 * Single source of visual truth across all mobile role views.
 */

export const Colors = {
  // Primary Palette (Deep Midnight Navy & Vibrant Flame Accent)
  primary: '#0F172A',       // Slate 900
  primaryLight: '#1E293B',  // Slate 800
  accentFlame: '#F97316',   // Bright Gas Orange
  accentTeal: '#06B6D4',    // Clean Logistics Cyan
  accentGreen: '#10B981',   // Verified Green

  // Backgrounds
  bgDark: '#0B0F19',
  bgCard: '#161F33',
  bgCardBorder: '#26344F',
  
  // Status Colors
  success: '#10B981',
  warning: '#F59E0B',
  error: '#EF4444',
  info: '#3B82F6',

  // Neutral Text & Icons
  textPrimary: '#F8FAFC',
  textSecondary: '#94A3B8',
  textMuted: '#64748B',
  divider: '#1E293B',

  // Role Badges
  roleCustomer: '#3B82F6',
  roleDriver: '#F97316',
  roleStation: '#06B6D4',
  roleMerchant: '#8B5CF6',
  roleAdmin: '#EC4899',
};

export const Typography = {
  fontFamily: {
    regular: 'System',
    medium: 'System',
    bold: 'System',
  },
  size: {
    xs: 11,
    sm: 13,
    md: 15,
    lg: 18,
    xl: 22,
    xxl: 28,
    hero: 36,
  },
  weight: {
    regular: '400' as const,
    medium: '600' as const,
    bold: '700' as const,
    black: '900' as const,
  },
};

export const Spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
};

export const Radius = {
  sm: 6,
  md: 12,
  lg: 20,
  full: 9999,
};

export const Shadows = {
  card: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  glowFlame: {
    shadowColor: '#F97316',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
};
