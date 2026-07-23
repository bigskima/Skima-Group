import React from 'react';

export default function AdminMarketplacePage() {
  const marketplaceOrders = [
    { id: 'MKT-ORD-101', customerName: 'Emeka N.', merchantName: 'Awka Gas Accessories Store', productTitle: 'Heavy Duty LPG Hose & Regulator Kit', totalAmount: 9500.0, status: 'ESCROW_LOCKED' },
    { id: 'MKT-ORD-102', customerName: 'Nneka O.', merchantName: 'Standard Commerce Ltd', productTitle: 'Digital Gas Cylinder Scale', totalAmount: 13000.0, status: 'FULFILLED' },
  ];

  return (
    <div style={{ backgroundColor: '#090D16', color: '#F8FAFC', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', padding: '32px' }}>
      
      {/* HEADER */}
      <header style={{ borderBottom: '1px solid #232F4A', paddingBottom: '20px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <a href="/" style={{ color: '#06B6D4', textDecoration: 'none', fontSize: '13px', fontWeight: 700 }}>← Back to Executive Overview</a>
          <h1 style={{ fontSize: '28px', margin: '8px 0 0 0', fontWeight: 800 }}>MARKETPLACE & MERCHANT CONTROL</h1>
          <p style={{ color: '#94A3B8', margin: '4px 0 0 0', fontSize: '14px' }}>Product Catalog Oversight • Order Escrow Supervision • Merchant Settlements</p>
        </div>
      </header>

      <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '24px' }}>
        <h2 style={{ fontSize: '20px', margin: '0 0 16px 0', fontWeight: 700, color: '#10B981' }}>Marketplace Escrow Orders ({marketplaceOrders.length})</h2>
        {marketplaceOrders.map((ord) => (
          <div key={ord.id} style={{ backgroundColor: '#1A2238', borderRadius: '10px', padding: '16px', marginBottom: '12px', border: '1px solid #232F4A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: '15px' }}>{ord.id}: {ord.productTitle}</div>
              <div style={{ color: '#94A3B8', fontSize: '12px', marginTop: '4px' }}>Customer: {ord.customerName} • Merchant: {ord.merchantName}</div>
              <div style={{ color: '#F97316', fontSize: '12px', fontWeight: 700, marginTop: '4px' }}>Status: {ord.status} • Total: ₦{ord.totalAmount.toLocaleString()}</div>
            </div>
            <button
              onClick={() => alert(`Escrow funds for order ${ord.id} released to ${ord.merchantName} wallet.`)}
              style={{ backgroundColor: '#10B981', color: '#FFF', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
            >
              Release Merchant Payout
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
