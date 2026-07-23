import React, { useState } from 'react';
import { MarketplaceProductItem } from '../../../../src/types';

interface ProductSlugViewProps {
  slug?: string;
}

export const MarketplaceProductSlugScreen: React.FC<ProductSlugViewProps> = ({ slug = 'gas-stove-double-burner' }) => {
  const [product] = useState<MarketplaceProductItem>({
    id: 'prod-uuid-99102',
    merchantUserId: 'merch-881',
    title: 'Double Burner Auto-Ignition LPG Stove',
    slug,
    description: 'Heavy duty stainless steel double burner gas cooker with piezo auto-ignition and flame safety valves.',
    priceNgn: 34500,
    category: 'COOKING_APPLIANCES',
    stockQuantity: 14,
    images: ['https://skima.ng/images/products/double-burner-stove.png'],
    isActive: true,
    createdAt: new Date().toISOString(),
  });

  const [quantity, setQuantity] = useState(1);

  return (
    <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <div style={{ fontSize: '12px', color: '#64748B', marginBottom: '8px' }}>
        MARKETPLACE ROUTE: <span style={{ fontFamily: 'monospace', color: '#2563EB' }}>/marketplace/{product.slug}</span>
      </div>

      <div
        style={{
          backgroundColor: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: '12px',
          padding: '24px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '24px',
        }}
      >
        <div
          style={{
            backgroundColor: '#F8FAFC',
            borderRadius: '8px',
            height: '240px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#94A3B8',
            fontWeight: 600,
          }}
        >
          [ PRODUCT IMAGE PLACEHOLDER ]
        </div>

        <div>
          <span style={{ fontSize: '12px', fontWeight: 700, color: '#16A34A', textTransform: 'uppercase' }}>
            {product.category}
          </span>
          <h2 style={{ margin: '4px 0 8px 0', color: '#0F172A' }}>{product.title}</h2>
          <div style={{ fontSize: '24px', fontWeight: 800, color: '#0F172A', marginBottom: '12px' }}>
            ₦{product.priceNgn.toLocaleString()} NGN
          </div>

          <p style={{ color: '#475569', fontSize: '14px', lineHeight: '1.5', marginBottom: '20px' }}>
            {product.description}
          </p>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '20px' }}>
            <span style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>Quantity:</span>
            <button
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              style={{ padding: '4px 12px', border: '1px solid #CBD5E1', borderRadius: '4px' }}
            >
              -
            </button>
            <span style={{ fontWeight: 700 }}>{quantity}</span>
            <button
              onClick={() => setQuantity((q) => Math.min(product.stockQuantity, q + 1))}
              style={{ padding: '4px 12px', border: '1px solid #CBD5E1', borderRadius: '4px' }}
            >
              +
            </button>
            <span style={{ fontSize: '12px', color: '#64748B' }}>({product.stockQuantity} in stock)</span>
          </div>

          <button
            style={{
              width: '100%',
              backgroundColor: '#2563EB',
              color: '#FFFFFF',
              border: 'none',
              padding: '14px',
              borderRadius: '8px',
              fontSize: '16px',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Buy Now with Escrow (₦{(product.priceNgn * quantity).toLocaleString()})
          </button>
          <div style={{ fontSize: '11px', color: '#64748B', textAlign: 'center', marginTop: '8px' }}>
            🔒 Protected by Skima Double-Entry Escrow Lock & Buyer Guarantee
          </div>
        </div>
      </div>
    </div>
  );
};

export default MarketplaceProductSlugScreen;
