import React, { useState } from 'react';
import { DisputeEngine, DisputeClaim } from '../../../src/services/DisputeEngine';

export default function DisputeManagementPage() {
  const [disputes, setDisputes] = useState<DisputeClaim[]>([
    {
      id: 'DSP-8801',
      orderId: 'ORD-MKT-9912',
      orderType: 'MARKETPLACE',
      claimantUserId: 'cust-402',
      claimantRole: 'CUSTOMER',
      reason: 'DEFECTIVE_PRODUCT',
      description: 'LPG Hose regulator received was cracked and leaked gas during installation.',
      evidenceUrls: ['https://storage.skima.ng/disputes/img-8801-1.jpg'],
      disputedAmountNgn: 18500,
      status: 'SUBMITTED',
      createdAt: new Date().toISOString(),
    },
    {
      id: 'DSP-8802',
      orderId: 'ORD-LPG-3310',
      orderType: 'GAS_REFILL',
      claimantUserId: 'cust-109',
      claimantRole: 'CUSTOMER',
      reason: 'WRONG_GAS_QUANTITY',
      description: 'Ordered 12.5kg refill but station scale tag recorded 10.8kg tare weight difference.',
      evidenceUrls: ['https://storage.skima.ng/disputes/img-8802-scale.jpg'],
      disputedAmountNgn: 17500,
      status: 'SUBMITTED',
      createdAt: new Date().toISOString(),
    },
  ]);

  const handleArbitrate = (disputeId: string, action: 'REFUND_BUYER' | 'RELEASE_TO_SELLER' | 'PARTIAL_REFUND') => {
    try {
      // Seed DisputeEngine if not present
      const existing = DisputeEngine.getDispute(disputeId);
      if (!existing) {
        const item = disputes.find((d) => d.id === disputeId);
        if (item) {
          DisputeEngine.createDispute({
            orderId: item.orderId,
            orderType: item.orderType,
            claimantUserId: item.claimantUserId,
            claimantRole: item.claimantRole,
            reason: item.reason,
            description: item.description,
            disputedAmountNgn: item.disputedAmountNgn,
          });
        }
      }

      const res = DisputeEngine.arbitrateDispute({
        disputeId,
        adminUserId: 'admin-primary',
        action,
        partialRefundPercent: 50,
        adminNotes: `Arbitrated via Admin Operations Portal: Action=${action}`,
      });

      setDisputes((prev) =>
        prev.map((d) => (d.id === disputeId ? { ...d, status: res.nextStatus } : d))
      );

      alert(`Dispute ${disputeId} resolved successfully!\nStatus: ${res.nextStatus}\nRefund to Buyer: ₦${res.refundAmountNgn.toLocaleString()}\nPayout to Seller: ₦${res.payoutAmountNgn.toLocaleString()}`);
    } catch (err: any) {
      alert(`Error arbitrating dispute: ${err.message}`);
    }
  };

  return (
    <div style={{ backgroundColor: '#090D16', color: '#F8FAFC', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', padding: '32px' }}>
      
      {/* HEADER */}
      <header style={{ borderBottom: '1px solid #232F4A', paddingBottom: '20px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <a href="/" style={{ color: '#06B6D4', textDecoration: 'none', fontSize: '13px', fontWeight: 700 }}>← Back to Executive Overview</a>
          <h1 style={{ fontSize: '28px', margin: '8px 0 0 0', fontWeight: 800 }}>FINANCIAL DISPUTE & ESCROW ARBITRATION CONSOLE</h1>
          <p style={{ color: '#94A3B8', margin: '4px 0 0 0', fontSize: '14px' }}>Review buyer claims, inspect evidence, and execute atomic escrow refunds or payouts.</p>
        </div>
      </header>

      {/* DISPUTE QUEUE TABLE */}
      <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '24px' }}>
        <h2 style={{ fontSize: '20px', margin: '0 0 16px 0', fontWeight: 700, color: '#EF4444' }}>Open Escrow Dispute Claims</h2>
        
        {disputes.map((dsp) => (
          <div key={dsp.id} style={{ backgroundColor: '#1A2238', borderRadius: '12px', padding: '20px', marginBottom: '16px', border: '1px solid #232F4A' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #232F4A', paddingBottom: '12px', marginBottom: '12px' }}>
              <div>
                <span style={{ backgroundColor: dsp.orderType === 'GAS_REFILL' ? '#0284C7' : '#D97706', color: '#FFF', fontSize: '11px', fontWeight: 700, padding: '4px 8px', borderRadius: '4px', marginRight: '8px' }}>
                  {dsp.orderType}
                </span>
                <span style={{ fontWeight: 800, fontSize: '16px' }}>{dsp.id}</span>
                <span style={{ color: '#94A3B8', fontSize: '13px', marginLeft: '12px' }}>Order Ref: {dsp.orderId}</span>
              </div>
              <div style={{ color: dsp.status.startsWith('RESOLVED') ? '#10B981' : '#EF4444', fontWeight: 800, fontSize: '14px' }}>
                Status: {dsp.status}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px' }}>
              <div>
                <div style={{ color: '#CBD5E1', fontSize: '14px', marginBottom: '8px' }}>
                  <strong>Reason:</strong> {dsp.reason}
                </div>
                <div style={{ color: '#94A3B8', fontSize: '13px', backgroundColor: '#090D16', padding: '12px', borderRadius: '8px' }}>
                  "{dsp.description}"
                </div>
              </div>
              <div style={{ backgroundColor: '#090D16', padding: '12px', borderRadius: '8px', border: '1px solid #232F4A' }}>
                <div style={{ color: '#94A3B8', fontSize: '12px' }}>Disputed Escrow Value</div>
                <div style={{ color: '#10B981', fontSize: '22px', fontWeight: 800, marginTop: '4px' }}>
                  ₦{dsp.disputedAmountNgn.toLocaleString()}
                </div>
                <div style={{ color: '#64748b', fontSize: '11px', marginTop: '4px' }}>Claimant ID: {dsp.claimantUserId}</div>
              </div>
            </div>

            {dsp.status === 'SUBMITTED' && (
              <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid #232F4A', display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => handleArbitrate(dsp.id, 'REFUND_BUYER')}
                  style={{ backgroundColor: '#EF4444', color: '#FFF', border: 'none', borderRadius: '6px', padding: '10px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Full Refund to Buyer
                </button>
                <button
                  onClick={() => handleArbitrate(dsp.id, 'PARTIAL_REFUND')}
                  style={{ backgroundColor: '#D97706', color: '#FFF', border: 'none', borderRadius: '6px', padding: '10px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >
                  50/50 Partial Split
                </button>
                <button
                  onClick={() => handleArbitrate(dsp.id, 'RELEASE_TO_SELLER')}
                  style={{ backgroundColor: '#10B981', color: '#FFF', border: 'none', borderRadius: '6px', padding: '10px 16px', fontSize: '13px', fontWeight 700, cursor: 'pointer' }}
                >
                  Release to Seller
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
