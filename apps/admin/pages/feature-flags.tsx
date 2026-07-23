import React, { useState } from 'react';
import { DEFAULT_PLATFORM_CONFIG } from '../../src/services/ConfigurationEngine';
import { FeatureAvailability } from '../../src/types';

export default function FeatureFlagsPage() {
  const [flags, setFlags] = useState<FeatureAvailability>(DEFAULT_PLATFORM_CONFIG.featureAvailability);

  const toggle = (key: keyof FeatureAvailability) => {
    setFlags((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  return (
    <div style={{ backgroundColor: '#090D16', color: '#F8FAFC', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', padding: '32px' }}>
      
      {/* HEADER */}
      <header style={{ borderBottom: '1px solid #232F4A', paddingBottom: '20px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <a href="/" style={{ color: '#06B6D4', textDecoration: 'none', fontSize: '13px', fontWeight 700 }}>← Back to Executive Overview</a>
          <h1 style={{ fontSize: '28px', margin: '8px 0 0 0', fontWeight 800 }}>FEATURE FLAGS & EXPANSION GATES</h1>
          <p style={{ color: '#94A3B8', margin: '4px 0 0 0', fontSize: '14px' }}>System Module Controls • Multi-Currency Toggles • Registration Gates</p>
        </div>
      </header>

      <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '24px' }}>
        <h2 style={{ fontSize: '20px', margin: '0 0 16px 0', fontWeight: 700, color: '#10B981' }}>Active Feature Flag Matrix</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
          {Object.keys(flags).map((key) => {
            const featKey = key as keyof FeatureAvailability;
            const isEnabled = flags[featKey];
            return (
              <div
                key={featKey}
                onClick={() => toggle(featKey)}
                style={{
                  backgroundColor: isEnabled ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  border: isEnabled ? '1px solid #10B981' : '1px solid #232F4A',
                  borderRadius: '12px',
                  padding: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span style={{ fontSize: '14px', fontWeight: 700, color: isEnabled ? '#10B981' : '#94A3B8' }}>{featKey}</span>
                <span style={{ fontSize: '12px', fontWeight: 800, color: isEnabled ? '#10B981' : '#EF4444' }}>
                  {isEnabled ? 'ENABLED' : 'DISABLED'}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
