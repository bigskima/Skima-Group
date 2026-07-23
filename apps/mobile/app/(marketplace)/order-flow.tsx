import React, { useState } from 'react';
import { MarketplaceOrderEnvelope, ShippingStatus } from '../../../../src/types';

export const MarketplaceOrderFlowScreen: React.FC = () => {
  const [order, setOrder] = useState<MarketplaceOrderEnvelope>({
    id: 'mp-ord-88190',
    customerUserId: 'cust-102',
    productId: 'prod-uuid-99102',
    quantity: 1,
    unitPriceNgn: 34500,
    totalAmountNgn: 34500,
    escrowStatus: 'LOCKED',
    orderStatus: 'PLACED',
    shippingAddress: 'Plot 12, Ngozika Housing Estate, Awka, Anambra State',
    createdAt: new Date().toISOString(),
  });

  const advanceOrderStatus = (next: ShippingStatus, nextEscrow?: 'LOCKED' | 'RELEASED' | 'REFUNDED' | 'DISPUTED') => {
    setOrder((prev) => ({
      ...prev,
      orderStatus: next,
      escrowStatus: nextEscrow ?? prev.escrowStatus,
    }));
  };

  return (
    <div style={{ padding: '24px', maxWidth: '800px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h2 style={{ margin: '0 0 4px 0', color: '#0F172A' }}>Marketplace Order Lifecycle</h2>
      <p style={{ margin: '0 0 20px 0', color: '#64748B', fontSize: '14px' }}>
        Directive 12 — Cart ➔ Escrow Lock ➔ Merchant Fulfillment ➔ Delivery ➔ Escrow Settlement
      </p>

      <div
        style={{
          backgroundColor: '#FFFFFF',
          border: '1px solid #E2E8F0',
          borderRadius: '12px',
          padding: '24px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px' }}>
          <div>
            <div style={{ fontSize: '12px', color: '#64748B' }}>ORDER REFERENCE</div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: '#0F172A' }}>{order.id}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '12px', color: '#64748B' }}>ESCROW STATUS</div>
            <div
              style={{
                fontSize: '14px',
                fontWeight: 700,
                color: order.escrowStatus === 'RELEASED' ? '#16A34A' : '#D97706',
              }}
            >
              🔒 {order.escrowStatus}
            </div>
          </div>
        </div>

        <div
          style={{
            backgroundColor: '#F8FAFC',
            padding: '16px',
            borderRadius: '8px',
            marginBottom: '20px',
          }}
        >
          <div style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>
            Double Burner Auto-Ignition LPG Stove (x{order.quantity})
          </div>
          <div style={{ fontSize: '13px', color: '#64748B', marginTop: '4px' }}>
            Total Amount Locked in Escrow: <strong>₦{order.totalAmountNgn.toLocaleString()} NGN</strong>
          </div>
          <div style={{ fontSize: '12px', color: '#64748B', marginTop: '4px' }}>
            Shipping to: {order.shippingAddress}
          </div>
        </div>

        {/* Workflow Lifecycle Step Buttons */}
        <h4 style={{ margin: '0 0 12px 0', color: '#0F172A' }}>Order Telemetry State Controls</h4>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px' }}>
          <button
            onClick={() => advanceOrderStatus('SHIPPED', 'LOCKED')}
            style={{
              padding: '10px',
              border: '1px solid #CBD5E1',
              borderRadius: '6px',
              backgroundColor: order.orderStatus === 'SHIPPED' ? '#2563EB' : '#FFFFFF',
              color: order.orderStatus === 'SHIPPED' ? '#FFFFFF' : '#0F172A',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '12px',
            }}
          >
            1. Merchant Shipped
          </button>
          <button
            onClick={() => advanceOrderStatus('DELIVERED', 'LOCKED')}
            style={{
              padding: '10px',
              border: '1px solid #CBD5E1',
              borderRadius: '6px',
              backgroundColor: order.orderStatus === 'DELIVERED' ? '#2563EB' : '#FFFFFF',
              color: order.orderStatus === 'DELIVERED' ? '#FFFFFF' : '#0F172A',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '12px',
            }}
          >
            2. Customer Received
          </button>
          <button
            onClick={() => advanceOrderStatus('COMPLETED', 'RELEASED')}
            style={{
              padding: '10px',
              border: '1px solid #16A34A',
              borderRadius: '6px',
              backgroundColor: order.orderStatus === 'COMPLETED' ? '#16A34A' : '#FFFFFF',
              color: order.orderStatus === 'COMPLETED' ? '#FFFFFF' : '#16A34A',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '12px',
            }}
          >
            3. Release Escrow
          </button>
          <button
            onClick={() => advanceOrderStatus('CANCELLED', 'REFUNDED')}
            style={{
              padding: '10px',
              border: '1px solid #DC2626',
              borderRadius: '6px',
              backgroundColor: order.orderStatus === 'CANCELLED' ? '#DC2626' : '#FFFFFF',
              color: order.orderStatus === 'CANCELLED' ? '#FFFFFF' : '#DC2626',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: '12px',
            }}
          >
            Refund Customer
          </button>
        </div>
      </div>
    </div>
  );
};

export default MarketplaceOrderFlowScreen;
