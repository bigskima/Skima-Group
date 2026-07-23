import React, { useState } from 'react';
import { MultiCurrencyRate } from '../../../src/types';

export const AdminMultiCurrencyPage: React.FC = () => {
  const [rates, setRates] = useState<MultiCurrencyRate[]>([
    {
      code: 'NGN',
      name: 'Nigerian Naira',
      symbol: '₦',
      exchangeRateToNgn: 1.0,
      isActive: true,
      isFutureGated: false,
    },
    {
      code: 'USD',
      name: 'United States Dollar',
      symbol: '$',
      exchangeRateToNgn: 1550.0,
      isActive: false,
      isFutureGated: true,
    },
    {
      code: 'USDC',
      name: 'USD Coin (Crypto Stablecoin)',
      symbol: 'USDC',
      exchangeRateToNgn: 1550.0,
      isActive: false,
      isFutureGated: true,
    },
  ]);

  const toggleCurrencyActive = (code: string) => {
    setRates((prev) =>
      prev.map((r) => (r.code === code ? { ...r, isActive: !r.isActive } : r))
    );
  };

  const updateExchangeRate = (code: string, newRate: number) => {
    setRates((prev) =>
      prev.map((r) => (r.code === code ? { ...r, exchangeRateToNgn: newRate } : r))
    );
  };

  return (
    <div style={{ padding: '32px', fontFamily: 'sans-serif', backgroundColor: '#F8FAFC', minHeight: '100vh' }}>
      <div style={{ maxWidth: '1000px', margin: '0 auto' }}>
        <h1 style={{ margin: '0 0 8px 0', color: '#0F172A' }}>Multi-Currency Exchange Rate Matrix</h1>
        <p style={{ color: '#64748B', margin: '0 0 24px 0' }}>
          Directive 10 — Administrative Currency Gateways & FX Conversion Matrix (NGN, USD, USDC)
        </p>

        <div style={{ display: 'grid', gap: '16px' }}>
          {rates.map((curr) => (
            <div
              key={curr.code}
              style={{
                backgroundColor: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '12px',
                padding: '20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <h3 style={{ margin: 0, color: '#0F172A' }}>
                    {curr.name} ({curr.code}) — {curr.symbol}
                  </h3>
                  {curr.isFutureGated && (
                    <span
                      style={{
                        backgroundColor: '#FEF3C7',
                        color: '#D97706',
                        fontSize: '11px',
                        padding: '2px 8px',
                        borderRadius: '12px',
                        fontWeight: 700,
                      }}
                    >
                      FUTURE GATED
                    </span>
                  )}
                </div>
                <div style={{ fontSize: '13px', color: '#64748B', marginTop: '4px' }}>
                  Base Conversion: 1 {curr.code} = {curr.exchangeRateToNgn} NGN
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                {curr.code !== 'NGN' && (
                  <div>
                    <label style={{ fontSize: '12px', color: '#64748B', display: 'block' }}>Exchange Rate (NGN)</label>
                    <input
                      type="number"
                      value={curr.exchangeRateToNgn}
                      onChange={(e) => updateExchangeRate(curr.code, parseFloat(e.target.value) || 1)}
                      style={{
                        width: '100px',
                        padding: '6px 10px',
                        border: '1px solid #CBD5E1',
                        borderRadius: '6px',
                      }}
                    />
                  </div>
                )}

                <button
                  onClick={() => toggleCurrencyActive(curr.code)}
                  style={{
                    backgroundColor: curr.isActive ? '#16A34A' : '#94A3B8',
                    color: '#FFFFFF',
                    border: 'none',
                    padding: '8px 16px',
                    borderRadius: '6px',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {curr.isActive ? 'ACTIVE IN PRODUCTION' : 'GATED / INACTIVE'}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default AdminMultiCurrencyPage;
