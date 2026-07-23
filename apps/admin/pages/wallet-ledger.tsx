import React, { useState } from 'react';
import { FinancialPlatformEngine } from '../../src/services/FinancialPlatformEngine';

export default function WalletLedgerPage() {
  const companyWallet = FinancialPlatformEngine.getCompanyWallet();
  const [recipientSkimaId, setRecipientSkimaId] = useState<string>('');
  const [transferAmount, setTransferAmount] = useState<number>(1000);
  const [transferStatus, setTransferStatus] = useState<string>('');

  const demoSenderId = 'admin-user-001';
  const senderSkimaId = FinancialPlatformEngine.getOrCreateSkimaId(demoSenderId);

  // Register demo recipient
  const demoRecipientId = 'user-ada-88';
  const demoRecipientSkimaId = FinancialPlatformEngine.getOrCreateSkimaId(demoRecipientId);
  FinancialPlatformEngine.fundWallet(demoSenderId, 50000, 'PAYSTACK', 'DEMO-TOPUP');

  const handleInternalTransfer = () => {
    if (!recipientSkimaId.trim()) return;
    const res = FinancialPlatformEngine.executeInternalTransfer({
      senderUserId: demoSenderId,
      recipientSkimaId: recipientSkimaId.trim(),
      amountNgn: transferAmount,
      note: 'Admin test internal transfer',
    });

    if (res.success) {
      setTransferStatus(`✅ Transfer of ₦${transferAmount.toLocaleString()} to ${recipientSkimaId} successful! Transfer ID: ${res.transferId}`);
    } else {
      setTransferStatus(`❌ Transfer failed: ${res.error}`);
    }
  };

  const ledgerEntries = [
    { ref: 'TX-INT-901823', type: 'INTERNAL_TRANSFER', amount: transferAmount, recipient: demoRecipientSkimaId, status: 'COMPLETED', time: 'Just now' },
    { ref: 'SETTLE-STATION-ORD-LPG-90812', type: 'ESCROW_RELEASE_STATION', amount: 17500.0, recipient: 'SKM-00812918', status: 'COMPLETED', time: '10 mins ago' },
    { ref: 'SETTLE-DRIVER-ORD-LPG-90812', type: 'ESCROW_RELEASE_DRIVER', amount: 500.0, recipient: 'SKM-77182910', status: 'COMPLETED', time: '12 mins ago' },
    { ref: 'PSTK-DEP-90812398', type: 'DEPOSIT', amount: 50000.0, recipient: senderSkimaId, status: 'COMPLETED', time: '1 hour ago' },
  ];

  return (
    <div style={{ backgroundColor: '#090D16', color: '#F8FAFC', minHeight: '100vh', fontFamily: 'system-ui, sans-serif', padding: '32px' }}>
      
      {/* HEADER */}
      <header style={{ borderBottom: '1px solid #232F4A', paddingBottom: '20px', marginBottom: '24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <a href="/" style={{ color: '#06B6D4', textDecoration: 'none', fontSize: '13px', fontWeight: 700 }}>← Back to Executive Overview</a>
          <h1 style={{ fontSize: '28px', margin: '8px 0 0 0', fontWeight: 800 }}>SKIMA WALLET PLATFORM & IMMUTABLE LEDGER</h1>
          <p style={{ color: '#94A3B8', margin: '4px 0 0 0', fontSize: '14px' }}>Permanent Skima IDs (SKM-XXXXXXXX) • Internal Wallet Transfers • Company Wallet Revenue</p>
        </div>
      </header>

      {/* COMPANY WALLET & INTERNAL TRANSFER CONSOLE */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '24px' }}>
        
        {/* COMPANY WALLET SUMMARY */}
        <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '24px' }}>
          <h2 style={{ fontSize: '18px', margin: '0 0 16px 0', fontWeight: 700, color: '#10B981' }}>Company Master Revenue Wallet</h2>
          <div style={{ fontSize: '32px', fontWeight: 900, color: '#FFF', marginBottom: '16px' }}>
            ₦ {companyWallet.availableBalance.toLocaleString()}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', fontSize: '13px', color: '#94A3B8' }}>
            <div>Commissions Earned: <strong style={{ color: '#FFF' }}>₦{companyWallet.totalCommissionsEarned.toLocaleString()}</strong></div>
            <div>Withdrawal Fees: <strong style={{ color: '#FFF' }}>₦{companyWallet.totalWithdrawalFeesEarned.toLocaleString()}</strong></div>
            <div>LPG Margin Total: <strong style={{ color: '#FFF' }}>₦{companyWallet.totalLpgMarginsEarned.toLocaleString()}</strong></div>
            <div>Your Skima ID: <strong style={{ color: '#06B6D4' }}>{senderSkimaId}</strong></div>
          </div>
        </div>

        {/* INTERNAL P2P TRANSFER CONSOLE */}
        <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '24px' }}>
          <h2 style={{ fontSize: '18px', margin: '0 0 8px 0', fontWeight: 700, color: '#06B6D4' }}>Internal Wallet Transfer (P2P)</h2>
          <p style={{ color: '#94A3B8', fontSize: '12px', marginBottom: '12px' }}>
            Transfer money instantly using recipient's permanent Skima ID (e.g. {demoRecipientSkimaId}). 0 Gateway Fees.
          </p>

          <div style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
            <input
              type="text"
              placeholder={`Recipient Skima ID (e.g. ${demoRecipientSkimaId})`}
              value={recipientSkimaId}
              onChange={(e) => setRecipientSkimaId(e.target.value)}
              style={{ flex: 1, backgroundColor: '#090D16', border: '1px solid #232F4A', borderRadius: '8px', padding: '10px', color: '#FFF', fontSize: '13px' }}
            />
            <input
              type="number"
              value={transferAmount}
              onChange={(e) => setTransferAmount(parseInt(e.target.value) || 0)}
              style={{ width: '120px', backgroundColor: '#090D16', border: '1px solid #232F4A', borderRadius: '8px', padding: '10px', color: '#FFF', fontSize: '13px' }}
            />
            <button
              onClick={handleInternalTransfer}
              style={{ backgroundColor: '#06B6D4', color: '#FFF', border: 'none', borderRadius: '8px', padding: '10px 18px', fontWeight: 700, cursor: 'pointer' }}
            >
              Send Money
            </button>
          </div>

          {transferStatus && <div style={{ fontSize: '12px', marginTop: '8px' }}>{transferStatus}</div>}
        </div>

      </div>

      {/* LEDGER TABLE */}
      <div style={{ backgroundColor: '#111726', border: '1px solid #232F4A', borderRadius: '16px', padding: '24px' }}>
        <h2 style={{ fontSize: '20px', margin: '0 0 16px 0', fontWeight: 700, color: '#06B6D4' }}>Recent Double-Entry Settlement Ledger Logs ({ledgerEntries.length})</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid #232F4A', color: '#94A3B8', fontSize: '12px' }}>
              <th style={{ padding: '12px' }}>REFERENCE</th>
              <th style={{ padding: '12px' }}>TRANSACTION TYPE</th>
              <th style={{ padding: '12px' }}>TARGET SKIMA ID</th>
              <th style={{ padding: '12px' }}>AMOUNT (NGN)</th>
              <th style={{ padding: '12px' }}>STATUS</th>
              <th style={{ padding: '12px' }}>TIMESTAMP</th>
            </tr>
          </thead>
          <tbody>
            {ledgerEntries.map((e) => (
              <tr key={e.ref} style={{ borderBottom: '1px solid rgba(255,255,255,0.05)', fontSize: '13px' }}>
                <td style={{ padding: '12px', fontWeight: 700, fontFamily: 'monospace' }}>{e.ref}</td>
                <td style={{ padding: '12px', color: '#F97316', fontWeight: 700 }}>{e.type}</td>
                <td style={{ padding: '12px', color: '#06B6D4', fontWeight: 700 }}>{e.recipient}</td>
                <td style={{ padding: '12px', color: '#10B981', fontWeight 700 }}>₦ {e.amount.toLocaleString()}</td>
                <td style={{ padding: '12px', color: '#10B981' }}>{e.status}</td>
                <td style={{ padding: '12px', color: '#94A3B8' }}>{e.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
