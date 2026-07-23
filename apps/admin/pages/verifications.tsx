import React, { useState } from 'react';

export default function VerificationsPage() {
  const [drivers, setDrivers] = useState([
    { id: 'DRV-901', name: 'Kenechukwu M.', vehicle: 'TRICYCLE (Keke)', license: 'AWK-892-XA', phone: '+2348031112233', status: 'PENDING' },
    { id: 'DRV-902', name: 'Ifeanyi U.', vehicle: 'MOTORCYCLE', license: 'AWK-104-ZB', phone: '+2348039998877', status: 'PENDING' },
  ]);

  const [merchants, setMerchants] = useState([
    { id: 'MRC-401', storeName: 'Awka Solar & Accessories', ownerName: 'Chibuike N.', category: 'SOLAR_EQUIPMENT', phone: '+2348035554411', status: 'PENDING' },
  ]);

  const handleApproveDriver = (id: string) => {
    setDrivers((prev) => prev.map((d) => (d.id === id ? { ...d, status: 'APPROVED' } : d)));
    alert(`Driver ${id} verified and granted DRIVER role permissions.`);
  };

  const handleApproveMerchant = (id: string) => {
    setMerchants((prev) => prev.map((m) => (m.id === id ? { ...m, status: 'APPROVED' } : m)));
    alert(`Merchant ${id} verified and store unlocked on Skima Marketplace.`);
  };

  return (
    <div style={{ backgroundColor: '#090D16', color: '#F8FAFC', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', padding: '32px' }}>
      
      {/* HEADER */}
      <header style={{ borderBottom: '1px solid #232F4A', paddingBottom: '20px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <a href="/" style={{ color: '#06B6D4', textDecoration: 'none', fontSize: '13px', fontWeight: 700 }}>← Back to Executive Overview</a>
          <h1 style={{ fontSize: '28px', margin: '8px 0 0 0', fontWeight: 800 }}>IDENTITY & ROLE VERIFICATION QUEUE</h1>
          <p style={{ color: '#94A3B8', margin: '4px 0 0 0', fontSize: '14px' }}>AI Guardrail Enforced: Admin Approval Required to Grant Platform Role Permissions</p>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* DRIVER VERIFICATION QUEUE */}
        <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '24px' }}>
          <h2 style={{ fontSize: '20px', margin: '0 0 16px 0', fontWeight: 700, color: '#F97316' }}>Driver KYC Applications</h2>
          {drivers.map((drv) => (
            <div key={drv.id} style={{ backgroundColor: '#1A2238', borderRadius: '10px', padding: '16px', marginBottom: '12px', border: '1px solid #232F4A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '15px' }}>{drv.name} ({drv.vehicle})</div>
                <div style={{ color: '#94A3B8', fontSize: '12px', marginTop: '4px' }}>Plate: {drv.license} • {drv.phone}</div>
                <div style={{ color: drv.status === 'APPROVED' ? '#10B981' : '#F97316', fontSize: '12px', fontWeight: 700, marginTop: '4px' }}>
                  Status: {drv.status}
                </div>
              </div>
              {drv.status === 'PENDING' && (
                <button
                  onClick={() => handleApproveDriver(drv.id)}
                  style={{ backgroundColor: '#10B981', color: '#FFF', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Approve Driver
                </button>
              )}
            </div>
          ))}
        </div>

        {/* MERCHANT VERIFICATION QUEUE */}
        <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '24px' }}>
          <h2 style={{ fontSize: '20px', margin: '0 0 16px 0', fontWeight: 700, color: '#06B6D4' }}>Merchant Storefront Applications</h2>
          {merchants.map((mrc) => (
            <div key={mrc.id} style={{ backgroundColor: '#1A2238', borderRadius: '10px', padding: '16px', marginBottom: '12px', border: '1px solid #232F4A', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: '15px' }}>{mrc.storeName} ({mrc.category})</div>
                <div style={{ color: '#94A3B8', fontSize: '12px', marginTop: '4px' }}>Owner: {mrc.ownerName} • {mrc.phone}</div>
                <div style={{ color: mrc.status === 'APPROVED' ? '#10B981' : '#F97316', fontSize: '12px', fontWeight: 700, marginTop: '4px' }}>
                  Status: {mrc.status}
                </div>
              </div>
              {mrc.status === 'PENDING' && (
                <button
                  onClick={() => handleApproveMerchant(mrc.id)}
                  style={{ backgroundColor: '#10B981', color: '#FFF', border: 'none', borderRadius: '6px', padding: '8px 16px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' }}
                >
                  Approve Store
                </button>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
