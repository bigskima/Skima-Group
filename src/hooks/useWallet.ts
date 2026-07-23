import { useState, useCallback } from 'react';
import { Wallet, LedgerEntry } from '../types';
import { formatCurrency } from '../utils';

export function useWallet(initialUserId?: string) {
  const [wallet, setWallet] = useState<Wallet>({
    id: 'w-mock-1',
    userId: initialUserId || 'u-mock-1',
    currency: 'NGN',
    balance: 45800.0,
    lockedBalance: 0.0,
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  /**
   * Initializes wallet deposit via Payment Gateway Adapter.
   */
  const fundWallet = useCallback(async (amount: number, provider: 'PAYSTACK' | 'FLUTTERWAVE' = 'PAYSTACK') => {
    setLoading(true);
    try {
      // Calls Edge Function: /functions/v1/initialize-wallet-funding
      const ref = `DEP-${Math.floor(100000 + Math.random() * 900000)}`;
      
      setWallet(prev => ({
        ...prev,
        balance: prev.balance + amount,
      }));

      setLedger(prev => [
        {
          id: `l-${Date.now()}`,
          reference: ref,
          transactionType: 'DEPOSIT',
          sourceWalletId: 'SYSTEM_GATEWAY',
          destinationWalletId: wallet.id,
          amount,
          currency: 'NGN',
          status: 'COMPLETED',
          metadata: { provider },
          createdAt: new Date().toISOString(),
        },
        ...prev,
      ]);
      setLoading(false);
      return { success: true, reference: ref };
    } catch (error) {
      setLoading(false);
      throw error;
    }
  }, [wallet.id]);

  /**
   * Locks funds in Escrow for gas orders.
   */
  const lockEscrow = useCallback((amount: number): boolean => {
    if (wallet.balance < amount) return false;

    setWallet(prev => ({
      ...prev,
      balance: prev.balance - amount,
      lockedBalance: prev.lockedBalance + amount,
    }));
    return true;
  }, [wallet.balance]);

  /**
   * Releases locked escrow balance upon order completion.
   */
  const releaseEscrow = useCallback((amount: number) => {
    setWallet(prev => ({
      ...prev,
      lockedBalance: Math.max(0, prev.lockedBalance - amount),
    }));
  }, []);

  return {
    wallet,
    ledger,
    loading,
    formattedBalance: formatCurrency(wallet.balance, wallet.currency),
    formattedLocked: formatCurrency(wallet.lockedBalance, wallet.currency),
    fundWallet,
    lockEscrow,
    releaseEscrow,
  };
}
