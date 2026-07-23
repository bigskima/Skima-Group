/**
 * SKIMA MARKETPLACE ENGINE
 * Governs merchant storefront inventory, cart pricing, marketplace order escrow,
 * fulfillment workflows, disputes, and merchant payout settlements.
 */

import { CurrencyCode, LedgerEntry } from '../types';
import { SettlementEngine, SettlementInstruction } from './SettlementEngine';

export interface ProductItem {
  id: string;
  merchantId: string;
  merchantName: string;
  title: string;
  description: string;
  price: number;
  currency: CurrencyCode;
  stockQuantity: number;
  category: 'LPG_ACCESSORIES' | 'COOKWARE' | 'STOVES' | 'SAFETY_GEAR' | 'SOLAR_EQUIPMENT';
  status: 'DRAFT' | 'ACTIVE' | 'PAUSED' | 'REJECTED' | 'ARCHIVED';
  imageUrls: string[];
}

export interface CartItem {
  product: ProductItem;
  quantity: number;
}

export interface MarketplaceOrderQuote {
  merchantId: string;
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
  currency: CurrencyCode;
  items: CartItem[];
}

export interface MarketplaceOrder {
  id: string;
  publicId: string;
  customerId: string;
  merchantId: string;
  subtotal: number;
  deliveryFee: number;
  totalAmount: number;
  currency: CurrencyCode;
  status: 'CREATED' | 'ESCROW_LOCKED' | 'ACCEPTED' | 'FULFILLED' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED' | 'REFUNDED';
  escrowStatus: 'PENDING' | 'LOCKED' | 'PARTIALLY_RELEASED' | 'RELEASED' | 'REFUNDED';
  deliveryAddress: string;
  createdAt: string;
}

export class MarketplaceEngine {
  /**
   * Calculates order totals for a set of marketplace cart items.
   */
  public static quoteMarketplaceOrder(
    items: CartItem[],
    deliveryFee: number = 1000,
    currency: CurrencyCode = 'NGN'
  ): MarketplaceOrderQuote {
    if (items.length === 0) {
      throw new Error('Cart must contain at least one product.');
    }

    const merchantId = items[0].product.merchantId;
    const subtotal = items.reduce((acc, item) => acc + item.product.price * item.quantity, 0);

    return {
      merchantId,
      subtotal,
      deliveryFee,
      totalAmount: subtotal + deliveryFee,
      currency,
      items,
    };
  }

  /**
   * Validates product stock availability before placing order.
   */
  public static validateStockAvailability(items: CartItem[]): { valid: boolean; errorMessage?: string } {
    for (const item of items) {
      if (item.product.stockQuantity < item.quantity) {
        return {
          valid: false,
          errorMessage: `Insufficient stock for "${item.product.title}". Only ${item.product.stockQuantity} remaining.`,
        };
      }
    }
    return { valid: true };
  }

  /**
   * Evaluates merchant settlement release upon order completion or refund upon dispute resolution.
   */
  public static evaluateMarketplaceSettlement(
    order: MarketplaceOrder,
    merchantOwnerUserId: string,
    action: 'FULFILL_AND_RELEASE' | 'REFUND_CUSTOMER'
  ): SettlementInstruction {
    if (order.escrowStatus !== 'LOCKED') {
      return {
        allowed: false,
        reason: 'Marketplace escrow must be in LOCKED state before settlement can occur.',
        currency: order.currency,
      };
    }

    if (action === 'FULFILL_AND_RELEASE') {
      return {
        allowed: true,
        reason: 'Marketplace order fulfilled & confirmed by customer. Release payout to merchant wallet.',
        reference: `SETTLE-MKT-${order.publicId}`,
        transactionType: 'MARKETPLACE_PAYMENT',
        destinationUserId: merchantOwnerUserId,
        amount: order.totalAmount,
        currency: order.currency,
        nextEscrowStatus: 'RELEASED',
      };
    }

    return {
      allowed: true,
      reason: 'Order dispute resolved in favor of customer. Escrow funds refunded to customer wallet.',
      reference: `ESCROW-REFUND-MKT-${order.publicId}`,
      transactionType: 'ESCROW_REFUND',
      destinationUserId: order.customerId,
      amount: order.totalAmount,
      currency: order.currency,
      nextEscrowStatus: 'REFUNDED',
    };
  }
}
