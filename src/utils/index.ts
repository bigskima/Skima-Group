/**
 * SKIMA REUSABLE UTILITIES SUITE
 * Single source of helper functions across mobile, web, and server.
 */

import { CurrencyCode } from '../types';

/**
 * Formats a numeric balance or transaction amount into standard currency display format.
 */
export function formatCurrency(amount: number, currency: CurrencyCode | string = 'NGN'): string {
  const normalizedCurrency = currency.toUpperCase();
  const formattedAmount = amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  if (normalizedCurrency === 'USD') return `USD ${formattedAmount}`;
  if (normalizedCurrency === 'USDC') return `USDC ${formattedAmount}`;
  return `NGN ${formattedAmount}`;
}

/**
 * Formats ISO date timestamps into human-readable timeline dates.
 */
export function formatDate(isoString: string): string {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Validates and normalizes Nigerian phone numbers (+234 format).
 */
export function validateNigerianPhone(phone: string): { isValid: boolean; normalized: string } {
  const cleaned = phone.replace(/\s+/g, '').replace(/-/g, '');
  if (/^(\+234|234|0)[789][01]\d{8}$/.test(cleaned)) {
    let normalized = cleaned;
    if (normalized.startsWith('0')) {
      normalized = '+234' + normalized.substring(1);
    } else if (normalized.startsWith('234')) {
      normalized = '+' + normalized;
    }
    return { isValid: true, normalized };
  }
  return { isValid: false, normalized: phone };
}

/**
 * Generates UX-friendly public IDs (e.g., SKM-ORD-891023).
 */
export function generatePublicId(
  prefix: 'USR' | 'ORD' | 'CYL' | 'STN' | 'MCH' | 'TRX' | 'BIL' | 'SET' | 'NTF',
): string {
  const randomNum = Math.floor(100000 + Math.random() * 900000);
  return `SKM-${prefix}-${randomNum}`;
}
