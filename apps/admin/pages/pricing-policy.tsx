import React, { useState } from 'react';
import { ConfigurationEngine, DEFAULT_PLATFORM_CONFIG } from '../../src/services/ConfigurationEngine';

export default function PricingPolicyPage() {
  const [gasPriceNgn, setGasPriceNgn] = useState<number>(DEFAULT_PLATFORM_CONFIG.lpgPricing.gasPricePerKg);
  const [deliveryBaseFee, setDeliveryBaseFee] = useState<number>(DEFAULT_PLATFORM_CONFIG.lpgPricing.deliveryBaseFee);
  const [deliveryPerKmFee, setDeliveryPerKmFee] = useState<number>(DEFAULT_PLATFORM_CONFIG.lpgPricing.deliveryPerKmFee);
  const [commissionPercent, setCommissionPercent] = useState<number>(DEFAULT_PLATFORM_CONFIG.lpgPricing.platformCommissionPercent);
  const [minOrderKg, setMinOrderKg] = useState<number>(DEFAULT_PLATFORM_CONFIG.lpgPricing.minimumOrderKg);

  const handleSavePricing = () => {
    alert(
      `Pricing Policy Saved!\n` +
      `• Gas Price: ₦${gasPriceNgn}/kg\n` +
      `• Base Delivery Fee: ₦${deliveryBaseFee}\n` +
      `• Per KM Fee: ₦${deliveryPerKmFee}/km\n` +
      `• Platform Commission: ${commissionPercent}%\n` +
      `• Min Refill Order: ${minOrderKg}kg\n` +
      `Synced platform-wide across all customer quotes & driver payouts.`
    );
  };

  return (
    <div style={{ backgroundColor: '#090D16', color: '#F8FAFC', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', padding: '32px' }}>
      
      {/* HEADER */}
      <header style={{ borderBottom: '1px solid #232F4A', paddingBottom: '20px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <a href="/" style={{ color: '#06B6D4', textDecoration: 'none', fontSize: '13px', fontWeight: 700 }}>← Back to Executive Overview</a>
          <h1 style={{ fontSize: '28px', margin: '8px 0 0 0', fontWeight: 800 }}>DYNAMIC PRICING & COMMISSION POLICY</h1>
          <p style={{ color: '#94A3B8', margin: '4px 0 0 0', fontSize: '14px' }}>Platform Financial Controls • Gas Rates • Delivery Formulas • Wallet Limits</p>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* LPG PRICING CONFIGURATION */}
        <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '24px' }}>
          <h2 style={{ fontSize: '20px', margin: '0 0 16px 0', fontWeight: 700, color: '#F97316' }}>LPG Gas & Delivery Rates (NGN)</h2>
          
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: '#94A3B8', fontSize: '13px', marginBottom: '6px' }}>Gas Price per KG (₦)</label>
            <input
              type="number"
              value={gasPriceNgn}
              onChange={(e) => setGasPriceNgn(parseFloat(e.target.value) || 0)}
              style={{ width: '100%', backgroundColor: '#090D16', border: '1px solid #232F4A', borderRadius: '8px', padding: '12px', color: '#FFF', fontSize: '16px' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: '#94A3B8', fontSize: '13px', marginBottom: '6px' }}>Base Delivery Fee (₦)</label>
            <input
              type="number"
              value={deliveryBaseFee}
              onChange={(e) => setDeliveryBaseFee(parseFloat(e.target.value) || 0)}
              style={{ width: '100%', backgroundColor: '#090D16', border: '1px solid #232F4A', borderRadius: '8px', padding: '12px', color: '#FFF', fontSize: '16px' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: '#94A3B8', fontSize: '13px', marginBottom: '6px' }}>Per Kilometer Delivery Rate (₦/km)</label>
            <input
              type="number"
              value={deliveryPerKmFee}
              onChange={(e) => setDeliveryPerKmFee(parseFloat(e.target.value) || 0)}
              style={{ width: '100%', backgroundColor: '#090D16', border: '1px solid #232F4A', borderRadius: '8px', padding: '12px', color: '#FFF', fontSize: '16px' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: '#94A3B8', fontSize: '13px', marginBottom: '6px' }}>Platform Revenue Commission (%)</label>
            <input
              type="number"
              value={commissionPercent}
              onChange={(e) => setCommissionPercent(parseFloat(e.target.value) || 0)}
              style={{ width: '100%', backgroundColor: '#090D16', border: '1px solid #232F4A', borderRadius: '8px', padding: '12px', color: '#FFF', fontSize: '16px' }}
            />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', color: '#94A3B8', fontSize: '13px', marginBottom: '6px' }}>Minimum Refill Order Weight (KG)</label>
            <input
              type="number"
              value={minOrderKg}
              onChange={(e) => setMinOrderKg(parseFloat(e.target.value) || 0)}
              style={{ width: '100%', backgroundColor: '#090D16', border: '1px solid #232F4A', borderRadius: '8px', padding: '12px', color: '#FFF', fontSize: '16px' }}
            />
          </div>

          <button
            onClick={handleSavePricing}
            style={{ backgroundColor: '#F97316', color: '#FFF', border: 'none', borderRadius: '8px', padding: '14px 24px', fontWeight: 700, cursor: 'pointer', width: '100%', fontSize: '15px' }}
          >
            Save Pricing Configuration
          </button>
        </div>

        {/* WALLET LIMITS & CURRENCIES */}
        <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '24px' }}>
          <h2 style={{ fontSize: '20px', margin: '0 0 16px 0', fontWeight: 700, color: '#06B6D4' }}>Multi-Currency Wallet Limits</h2>
          
          <div style={{ backgroundColor: '#1A2238', borderRadius: '10px', padding: '16px', marginBottom: '16px', border: '1px solid #232F4A' }}>
            <div style={{ fontWeight: 700, color: '#10B981', fontSize: '16px', marginBottom: '8px' }}>NGN Account Limits</div>
            <div style={{ color: '#94A3B8', fontSize: '13px', marginVertical: '4px' }}>• Min Deposit: ₦100</div>
            <div style={{ color: '#94A3B8', fontSize: '13px', marginVertical: '4px' }}>• Max Single Deposit: ₦500,000</div>
            <div style={{ color: '#94A3B8', fontSize: '13px', marginVertical: '4px' }}>• Daily Outgoing Limit: ₦1,000,000</div>
            <div style={{ color: '#94A3B8', fontSize: '13px', marginVertical: '4px' }}>• Max Wallet Balance: ₦5,000,000</div>
          </div>

          <div style={{ backgroundColor: '#1A2238', borderRadius: '10px', padding: '16px', border: '1px solid #232F4A' }}>
            <div style={{ fontWeight: 700, color: '#06B6D4', fontSize: '16px', marginBottom: '8px' }}>Future Expansion Currencies (USD / USDC)</div>
            <div style={{ color: '#94A3B8', fontSize: '13px', marginVertical: '4px' }}>• USD Wallet Adapter: Ready (Disabled by Feature Flag)</div>
            <div style={{ color: '#94A3B8', fontSize: '13px', marginVertical: '4px' }}>• USDC Stablecoin Escrow: Ready (Disabled by Feature Flag)</div>
          </div>
        </div>
      </div>
    </div>
  );
}
