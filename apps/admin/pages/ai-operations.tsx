import React, { useState } from 'react';

export default function AiOperationsPage() {
  const [query, setQuery] = useState('');
  const [result, setResult] = useState('');

  const aiFraudAlerts = [
    { id: 'ALT-101', type: 'RAPID_DELIVERY_ANOMALY', details: 'Driver Chidi K. reported 4.2km delivery completed in 1.8 mins.', risk: 'HIGH (0.92)' },
    { id: 'ALT-102', type: 'FAILED_DEPOSIT_ATTEMPTS', details: 'User SKM-U-891023 had 6 failed Paystack deposit attempts in 10 mins.', risk: 'MEDIUM (0.75)' },
  ];

  const handleQuery = () => {
    if (!query) return;
    setResult(`AI Agent 5 parsed query: "${query}". Querying table 'ledger_entries'... Executed 1.2s. Output: 3 failed deposits found in Awka Launch Zone.`);
  };

  return (
    <div style={{ backgroundColor: '#090D16', color: '#F8FAFC', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', padding: '32px' }}>
      
      {/* HEADER */}
      <header style={{ borderBottom: '1px solid #232F4A', paddingBottom: '20px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <a href="/" style={{ color: '#06B6D4', textDecoration: 'none', fontSize: '13px', fontWeight 700 }}>← Back to Executive Overview</a>
          <h1 style={{ fontSize: '28px', margin: '8px 0 0 0', fontWeight 800 }}>10 AI AGENTS OPERATIONS CONSOLE</h1>
          <p style={{ color: '#94A3B8', margin: '4px 0 0 0', fontSize: '14px' }}>Gemini Operations Assistant • Fraud Anomaly Monitor • Advisory Guardrails Enforcement</p>
        </div>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        {/* AGENT 5: OPERATIONS QUERY ASSISTANT */}
        <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '24px' }}>
          <h2 style={{ fontSize: '20px', margin: '0 0 12px 0', fontWeight: 700, color: '#06B6D4' }}>Agent 5 — Natural Language Operations Assistant</h2>
          <p style={{ color: '#94A3B8', fontSize: '13px', marginBottom: '16px' }}>Ask natural language questions to query system database analytics.</p>
          
          <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
            <input
              type="text"
              placeholder="e.g. Show today's failed wallet deposits"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              style={{ flex: 1, backgroundColor: '#090D16', border: '1px solid #232F4A', borderRadius: '8px', padding: '12px', color: '#FFF', fontSize: '14px' }}
            />
            <button
              onClick={handleQuery}
              style={{ backgroundColor: '#06B6D4', color: '#FFF', border: 'none', borderRadius: '8px', padding: '12px 20px', fontWeight: 700, cursor: 'pointer' }}
            >
              Ask AI Agent
            </button>
          </div>

          {result && (
            <div style={{ backgroundColor: '#1A2238', border: '1px solid #232F4A', borderRadius: '8px', padding: '12px', color: '#10B981', fontSize: '13px', fontFamily: 'monospace' }}>
              {result}
            </div>
          )}
        </div>

        {/* AGENT 4: FRAUD DETECTION MONITOR */}
        <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '24px' }}>
          <h2 style={{ fontSize: '20px', margin: '0 0 12px 0', fontWeight: 700, color: '#EF4444' }}>Agent 4 — Real-time Fraud Anomaly Monitor</h2>
          {aiFraudAlerts.map((alt) => (
            <div key={alt.id} style={{ backgroundColor: '#1A2238', border: '1px solid rgba(239, 68, 68, 0.3)', borderRadius: '10px', padding: '12px 16px', marginBottom: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ color: '#EF4444', fontWeight: 700, fontSize: '13px' }}>{alt.type} (Risk: {alt.risk})</div>
                <div style={{ color: '#94A3B8', fontSize: '12px', marginTop: '2px' }}>{alt.details}</div>
              </div>
              <button
                onClick={() => alert(`Alert ${alt.id} investigated and marked resolved.`)}
                style={{ backgroundColor: 'rgba(255,255,255,0.1)', color: '#FFF', border: '1px solid #232F4A', borderRadius: '6px', padding: '6px 12px', fontSize: '12px', cursor: 'pointer' }}
              >
                Resolve
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
