/**
 * SKIMA ENTERPRISE FINANCIAL PLATFORM ENGINE
 * Single Source of Truth for all platform money, wallets, double-entry ledger entries,
 * permanent Skima ID (SKM-XXXXXXXX) P2P transfers, company fee retention, and withdrawal holds.
 * 
 * ARCHITECTURAL MANDATE:
 * - ZERO Virtual Accounts / NO NUBAN Generation
 * - Permanent Skima ID (SKM-XXXXXXXX) for internal user-to-user transfers
 * - Controlled Withdrawal Engine (Money exits platform ONLY via user bank payout requests)
 */

import { AuditLogEngine } from './AuditLogEngine';
import { ConfigurationEngine } from './ConfigurationEngine';
import { CompanyWallet, InternalTransferRequest, UserRole, Wallet, WithdrawalRequest } from '../types';

export class FinancialPlatformEngine {
  private static userWallets: Map<string, Wallet> = new Map();
  private static userSkimaIds: Map<string, string> = new Map(); // userId -> skimaId
  private static skimaIdToUserId: Map<string, string> = new Map(); // skimaId -> userId
  private static withdrawals: Map<string, WithdrawalRequest> = new Map();

  private static companyWallet: CompanyWallet = {
    id: 'company-master-wallet',
    currency: 'NGN',
    availableBalance: 0.0,
    totalCommissionsEarned: 0.0,
    totalWithdrawalFeesEarned: 0.0,
    totalLpgMarginsEarned: 0.0,
    updatedAt: new Date().toISOString(),
  };

  /**
   * Generates or retrieves permanent public Skima ID (SKM-XXXXXXXX) for a user
   */
  public static getOrCreateSkimaId(userId: string): string {
    let skimaId = this.userSkimaIds.get(userId);
    if (!skimaId) {
      const randomNum = Math.floor(10000000 + Math.random() * 90000000);
      skimaId = `SKM-${randomNum}`;
      this.userSkimaIds.set(userId, skimaId);
      this.skimaIdToUserId.set(skimaId, userId);
    }
    return skimaId;
  }

  /**
   * Resolve permanent Skima ID to internal userId
   */
  public static resolveSkimaId(skimaId: string): string | undefined {
    return this.skimaIdToUserId.get(skimaId.trim().toUpperCase());
  }

  /**
   * Get or initialize single Skima Wallet for a user
   */
  public static getWallet(userId: string): Wallet {
    let wallet = this.userWallets.get(userId);
    if (!wallet) {
      wallet = {
        id: `wal-${userId}`,
        userId,
        currency: 'NGN',
        balance: 0.0,
        lockedBalance: 0.0,
        pendingBalance: 0.0,
        lifetimeCredits: 0.0,
        lifetimeDebits: 0.0,
        status: 'ACTIVE',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      this.userWallets.set(userId, wallet);
    }
    return wallet;
  }

  /**
   * Execute P2P Internal Wallet Transfer using recipient's permanent Skima ID
   */
  public static executeInternalTransfer(request: InternalTransferRequest): {
    success: boolean;
    transferId?: string;
    senderBalance?: number;
    error?: string;
  } {
    const amount = Math.max(0, request.amountNgn);
    if (amount <= 0) {
      return { success: false, error: 'Transfer amount must be greater than zero.' };
    }

    const recipientUserId = this.resolveSkimaId(request.recipientSkimaId);
    if (!recipientUserId) {
      return { success: false, error: `Recipient Skima ID "${request.recipientSkimaId}" not found.` };
    }

    if (recipientUserId === request.senderUserId) {
      return { success: false, error: 'Cannot transfer funds to your own Skima ID.' };
    }

    const senderWallet = this.getWallet(request.senderUserId);
    if (senderWallet.balance < amount) {
      return { success: false, error: `Insufficient available balance (₦${senderWallet.balance}).` };
    }

    const recipientWallet = this.getWallet(recipientUserId);

    // Debit Sender
    senderWallet.balance -= amount;
    senderWallet.lifetimeDebits += amount;
    senderWallet.updatedAt = new Date().toISOString();

    // Credit Recipient
    recipientWallet.balance += amount;
    recipientWallet.lifetimeCredits += amount;
    recipientWallet.updatedAt = new Date().toISOString();

    const transferId = `TX-INT-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

    AuditLogEngine.recordEvent({
      eventType: 'ROLE_SWITCH', // Audit logging entry
      actorId: request.senderUserId,
      actorRole: 'CUSTOMER',
      targetResource: 'SKIMA_WALLET',
      resourceId: transferId,
      payload: { recipientSkimaId: request.recipientSkimaId, amountNgn: amount, note: request.note },
    });

    console.log(`[FINANCIAL PLATFORM] P2P Transfer: ${request.senderUserId} -> ${request.recipientSkimaId} (₦${amount})`);

    return {
      success: true,
      transferId,
      senderBalance: senderWallet.balance,
    };
  }

  /**
   * Funds user wallet following payment provider checkout webhook confirmation
   */
  public static fundWallet(userId: string, amountNgn: number, providerName: string, reference: string): Wallet {
    const wallet = this.getWallet(userId);
    wallet.balance += amountNgn;
    wallet.lifetimeCredits += amountNgn;
    wallet.updatedAt = new Date().toISOString();

    console.log(`[FINANCIAL PLATFORM] Funded Wallet ${userId}: +₦${amountNgn} via ${providerName} (${reference})`);
    return wallet;
  }

  /**
   * Request bank withdrawal from available wallet balance
   */
  public static requestWithdrawal(params: {
    userId: string;
    amountNgn: number;
    bankName: string;
    accountNumber: string;
    accountName: string;
  }): { success: boolean; withdrawal?: WithdrawalRequest; error?: string } {
    const wallet = this.getWallet(params.userId);
    const feeNgn = 100.0; // Fixed withdrawal fee
    const totalRequired = params.amountNgn + feeNgn;

    if (wallet.balance < totalRequired) {
      return { success: false, error: `Insufficient balance for withdrawal + ₦${feeNgn} fee.` };
    }

    // Move to locked balance
    wallet.balance -= totalRequired;
    wallet.lockedBalance += totalRequired;
    wallet.updatedAt = new Date().toISOString();

    const withdrawalId = `WD-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    const withdrawal: WithdrawalRequest = {
      id: withdrawalId,
      userId: params.userId,
      walletId: wallet.id,
      amountNgn: params.amountNgn,
      feeNgn,
      netPayoutNgn: params.amountNgn,
      bankName: params.bankName,
      accountNumber: params.accountNumber,
      accountName: params.accountName,
      status: 'PENDING',
      providerName: 'PAYSTACK',
      createdAt: new Date().toISOString(),
    };

    this.withdrawals.set(withdrawalId, withdrawal);
    console.log(`[FINANCIAL PLATFORM] Withdrawal Requested: ${params.userId} -> ₦${params.amountNgn} to ${params.bankName} (${params.accountNumber})`);

    return { success: true, withdrawal };
  }

  /**
   * Complete withdrawal payout & credit company wallet fee
   */
  public static completeWithdrawal(withdrawalId: string, providerReference: string): boolean {
    const withdrawal = this.withdrawals.get(withdrawalId);
    if (!withdrawal || withdrawal.status !== 'PENDING') return false;

    const wallet = this.getWallet(withdrawal.userId);
    const totalLocked = withdrawal.amountNgn + withdrawal.feeNgn;

    wallet.lockedBalance -= totalLocked;
    wallet.lifetimeDebits += totalLocked;
    wallet.updatedAt = new Date().toISOString();

    // Credit Company Wallet fee
    this.companyWallet.availableBalance += withdrawal.feeNgn;
    this.companyWallet.totalWithdrawalFeesEarned += withdrawal.feeNgn;
    this.companyWallet.updatedAt = new Date().toISOString();

    withdrawal.status = 'COMPLETED';
    withdrawal.providerReference = providerReference;

    console.log(`[FINANCIAL PLATFORM] Withdrawal Completed ${withdrawalId}: Payout ₦${withdrawal.netPayoutNgn}, Fee ₦${withdrawal.feeNgn} credited to Company Wallet.`);
    return true;
  }

  public static getCompanyWallet(): CompanyWallet {
    return this.companyWallet;
  }
}
