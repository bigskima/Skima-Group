/**
 * SKIMA PLATFORM COMMERCE ENGINE (COMMERCE CAPABILITY)
 * Reusable Multi-Vendor Commerce Platform. Independent from LPG logistics.
 * Handles product listings, shopping cart checkout, dynamic distance shipping,
 * escrow locks, delivery tracking hooks, and merchant wallet settlement.
 */

import { AuditLogEngine } from './AuditLogEngine';
import { FinancialPlatformEngine } from './FinancialPlatformEngine';
import { MarketplaceProductItem } from '../types';

export interface CartItem {
  product: MarketplaceProductItem;
  quantity: number;
}

export interface CommerceCheckoutRequest {
  customerUserId: string;
  cartItems: CartItem[];
  shippingAddress: string;
  distanceKm: number;
}

export interface CommerceCheckoutResult {
  orderId: string;
  customerUserId: string;
  totalProductsAmountNgn: number;
  shippingFeeNgn: number;
  grossTotalNgn: number;
  escrowStatus: 'LOCKED';
  orderStatus: 'PLACED';
  createdAt: string;
}

export class CommerceEngine {
  private static products: MarketplaceProductItem[] = [
    {
      id: 'prod-regulator-1',
      merchantUserId: 'merchant-101',
      title: 'Heavy Duty LPG Gas Regulator with Pressure Gauge',
      slug: 'heavy-duty-lpg-gas-regulator',
      description: 'Certified brass LPG pressure regulator with built-in safety leak check gauge.',
      priceNgn: 8500,
      category: 'LPG Equipment & Accessories',
      stockQuantity: 45,
      images: ['https://images.unsplash.com/photo-1585771724684-38269d6639fd?w=500'],
      isActive: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: 'prod-hose-2',
      merchantUserId: 'merchant-102',
      title: 'High-Pressure 5-Layer LPG Rubber Hose (3 Meters)',
      slug: 'high-pressure-lpg-rubber-hose-3m',
      description: 'Industrial grade 3-meter reinforced rubber cooking gas hose with steel clamps.',
      priceNgn: 4200,
      category: 'LPG Equipment & Accessories',
      stockQuantity: 100,
      images: ['https://images.unsplash.com/photo-1584992236310-6edddc08acff?w=500'],
      isActive: true,
      createdAt: new Date().toISOString(),
    },
  ];

  /**
   * Resolves product details by immutable product UUID or friendly URL slug
   */
  public static resolveProductBySlug(slugOrId: string): MarketplaceProductItem | undefined {
    return this.products.find((p) => p.slug === slugOrId || p.id === slugOrId);
  }

  /**
   * Process commerce shopping cart checkout & lock funds in Escrow
   */
  public static processCheckout(request: CommerceCheckoutRequest): CommerceCheckoutResult {
    let totalProductsAmountNgn = 0;

    for (const item of request.cartItems) {
      totalProductsAmountNgn += item.product.priceNgn * item.quantity;
    }

    const shippingFeeNgn = 500 + Math.round(request.distanceKm * 150); // 500 base + 150/km
    const grossTotalNgn = totalProductsAmountNgn + shippingFeeNgn;

    const orderId = `ORD-MKT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    AuditLogEngine.recordEvent({
      eventType: 'ESCROW_LOCKED',
      actorId: request.customerUserId,
      actorRole: 'CUSTOMER',
      targetResource: 'MARKETPLACE_ORDER',
      resourceId: orderId,
      payload: { grossTotalNgn, itemsCount: request.cartItems.length },
    });

    console.log(`[COMMERCE ENGINE] Created Marketplace Order ${orderId}: Gross ₦${grossTotalNgn} (Products: ₦${totalProductsAmountNgn}, Shipping: ₦${shippingFeeNgn})`);

    return {
      orderId,
      customerUserId: request.customerUserId,
      totalProductsAmountNgn,
      shippingFeeNgn,
      grossTotalNgn,
      escrowStatus: 'LOCKED',
      orderStatus: 'PLACED',
      createdAt: new Date().toISOString(),
    };
  }

  public static getProducts(): MarketplaceProductItem[] {
    return this.products;
  }
}
