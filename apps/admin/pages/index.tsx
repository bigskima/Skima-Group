import React, { useState } from 'react';
import { ConfigurationEngine, DEFAULT_PLATFORM_CONFIG } from '../../src/services/ConfigurationEngine';

export default function AdminDashboardPage() {
  const [systemEscrowTotal] = useState<number>(348500.0);
  const [gasPriceNgn] = useState<number>(DEFAULT_PLATFORM_CONFIG.lpgPricing.gasPricePerKg);
  const launchZone = ConfigurationEngine.getLaunchZone();

  const adminModules = [
    { title: 'Pricing & Policy Governance', href: '/pricing-policy', desc: 'Gas prices, delivery per-km fees, commissions & wallet limits', icon: '💰', color: '#F97316' },
    { title: 'Service Zones & Geofencing', href: '/service-zones', desc: 'Multi-city polygons, Awka launch zone & landmark dictionary', icon: '📍', color: '#10B981' },
    { title: 'KYC & Role Verifications', href: '/verifications', desc: 'Approve driver licenses, station permits & merchant stores', icon: '🛡️', color: '#06B6D4' },
    { title: 'Marketplace & Inventory', href: '/marketplace', desc: 'Supervise product catalog, stock controls & order escrow payouts', icon: '🛍️', color: '#8B5CF6' },
    { title: 'Double-Entry Wallet Ledger', href: '/wallet-ledger', desc: 'Atomic ledger history, escrow holds & Paystack reconciliation', icon: '📑', color: '#EC4899' },
    { title: '10 AI Agents Operations', href: '/ai-operations', desc: 'Gemini operations assistant, natural language query & fraud alerts', icon: '🤖', color: '#3B82F6' },
    { title: 'Feature Flags & Expansion', href: '/feature-flags', desc: 'Module flags, USD/USDC gates & registration controls', icon: '⚙️', color: '#64748B' },
  ];

  return (
    <div style={{ backgroundColor: '#090D16', color: '#F8FAFC', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', padding: '32px' }}>
      
      {/* HEADER */}
      <header style={{ borderBottom: '1px solid #232F4A', paddingBottom: '20px', marginBottom: '32px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ fontSize: '28px', margin: 0, fontWeight: 800 }}>SKIMA OPERATING SYSTEM — ADMIN CONTROL CENTER</h1>
          <p style={{ color: '#94A3B8', margin: '4px 0 0 0', fontSize: '14px' }}>Platform Operations Governance • Multi-Country Architecture • 10 AI Agents Integration</p>
        </div>
        <div style={{ backgroundColor: 'rgba(249, 115, 22, 0.15)', color: '#F97316', border: '1px solid rgba(249, 115, 22, 0.3)', padding: '6px 16px', borderRadius: '99px', fontSize: '13px', fontWeight: 700 }}>
          ● LIVE SYSTEM CONTROL
        </div>
      </header>

      {/* METRICS ROW */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', marginBottom: '32px' }}>
        <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '20px' }}>
          <div style={{ color: '#94A3B8', fontSize: '12px', fontWeight: 600 }}>SYSTEM ESCROW HOLD</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#06B6D4', marginTop: '8px' }}>₦ {systemEscrowTotal.toLocaleString()}</div>
        </div>

        <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '20px' }}>
          <div style={{ color: '#94A3B8', fontSize: '12px', fontWeight: 600 }}>CURRENT GAS PRICE</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#F97316', marginTop: '8px' }}>₦ {gasPriceNgn} / kg</div>
        </div>

        <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '20px' }}>
          <div style={{ color: '#94A3B8', fontSize: '12px', fontWeight: 600 }}>ACTIVE SERVICE ZONE</div>
          <div style={{ fontSize: '18px', fontWeight: 700, color: '#10B981', marginTop: '12px' }}>{launchZone.city}, {launchZone.state}</div>
        </div>

        <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '20px' }}>
          <div style={{ color: '#94A3B8', fontSize: '12px', fontWeight: 600 }}>AI AGENT MODULES</div>
          <div style={{ fontSize: '28px', fontWeight: 800, color: '#3B82F6', marginTop: '8px' }}>10 Agents Active</div>
        </div>
      </div>

      {/* ADMIN CONTROL MODULES GRID */}
      <h2 style={{ fontSize: '20px', marginBottom: '20px', fontWeight: 700 }}>Platform Governance Portals</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px' }}>
        {adminModules.map((mod) => (
          <a
            key={mod.href}
            href={mod.href}
            style={{
              backgroundColor: '#111726',
              border: '1px solid #232F4A',
              borderRadius: '16px',
              padding: '24px',
              textDecoration: 'none',
              color: '#FFF',
              display: 'block',
              transition: 'border-color 0.2s',
            }}
          >
            <div style={{ fontSize: '32px', marginBottom: '12px' }}>{mod.icon}</div>
            <div style={{ fontSize: '18px', fontWeight: 800, color: mod.color, marginBottom: '6px' }}>{mod.title}</div>
            <div style={{ color: '#94A3B8', fontSize: '13px', lineHeight: 1.4 }}>{mod.desc}</div>
          </a>
        ))}
      </div>

    </div>
  );
}
