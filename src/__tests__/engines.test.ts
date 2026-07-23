import { CustodyEngine } from '../services/CustodyEngine';
import { SettlementEngine } from '../services/SettlementEngine';
import { ConfigurationEngine } from '../services/ConfigurationEngine';
import { LpgPricingEngine } from '../services/LpgPricingEngine';
import { CylinderIdentityEngine } from '../services/CylinderIdentityEngine';
import { AuditLogEngine } from '../services/AuditLogEngine';
import { LiveTrackingPolicy } from '../services/LiveTrackingPolicy';
import { IdentityEngine } from '../services/IdentityEngine';
import { AiAgentOrchestrator } from '../services/ai/AiAgentOrchestrator';
import { AiEngine } from '../services/ai/AiEngine';
import { DisputeEngine } from '../services/DisputeEngine';
import { QrBatchExportEngine } from '../services/QrBatchExportEngine';
import { SyncEngine } from '../services/SyncEngine';
import { GeographyEngine } from '../services/GeographyEngine';
import { CommunicationEngine } from '../services/CommunicationEngine';
import { FinancialPlatformEngine } from '../services/FinancialPlatformEngine';
import { PaymentAdapterEngine } from '../services/PaymentAdapterEngine';
import { PartnerVerificationEngine } from '../services/PartnerVerificationEngine';
import { CommerceEngine } from '../services/CommerceEngine';
import { UserProfile } from '../types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`[TEST FAILURE] ${message}`);
  }
}

async function runMasterSuite() {
  console.log('--- STARTING SKIMA MASTER KERNEL TEST SUITE (PHASE 12 FINANCIAL PLATFORM INCLUDED) ---');

  // 1. CustodyEngine & CylinderIdentityEngine Tests
  console.log('1. Testing CylinderIdentityEngine & Permanent Physical Asset Creation...');
  const cylinder = CylinderIdentityEngine.createPermanentCylinder({
    capacityKg: 12.5,
    tareWeightKg: 14.2,
    ownerType: 'CUSTOMER_OWNED',
    ownerUserId: 'cust-1',
    zonePrefix: 'AWK',
  });

  assert(cylinder.publicTag.startsWith('CYL-AWK-12.5-'), 'Public tag must follow format CYL-AWK-12.5-xxxxx');
  assert(cylinder.qrCode.startsWith('SKM-CYL-QR-'), 'QR code must start with SKM-CYL-QR-');

  const handoffRes = CylinderIdentityEngine.evaluateCustodyHandoff({
    cylinderId: cylinder.id,
    qrCode: cylinder.qrCode,
    actorUserId: 'driver-1',
    actorRole: 'DRIVER',
    targetCustodyUserId: 'driver-1',
    targetCustodyRole: 'DRIVER',
    currentStatus: 'IDLE',
  });
  assert(handoffRes.allowed === true, 'Driver must be allowed to pick up IDLE cylinder.');
  assert(handoffRes.nextStatus === 'IN_TRANSIT_TO_STATION', 'Next status must be IN_TRANSIT_TO_STATION');

  // 2. Cylinder QR Resolution & Printable Card Data Tests
  console.log('2. Testing Permission-based QR Resolution & Printable Card Asset Metadata...');
  const publicResolution = CylinderIdentityEngine.resolveCylinderPermissions(cylinder.qrCode, 'PUBLIC');
  assert(publicResolution.accessLevel === 'PUBLIC', 'Unauthenticated scan must return PUBLIC access level');
  assert(publicResolution.publicView?.publicTag === cylinder.publicTag, 'Public view contains cylinder tag');
  assert(publicResolution.fullAsset === undefined, 'Public view MUST NOT expose internal user IDs or private asset data');

  const authResolution = CylinderIdentityEngine.resolveCylinderPermissions(cylinder.qrCode, 'CUSTOMER', 'cust-1');
  assert(authResolution.accessLevel === 'FULL_OPERATIONAL', 'Authenticated scan returns FULL_OPERATIONAL access level');
  assert(authResolution.fullAsset?.id === cylinder.id, 'Full asset payload provided for authenticated user');

  const printableData = CylinderIdentityEngine.generatePrintableCardData(cylinder.publicTag);
  assert(printableData.qrUrl === `https://app.skima.com/cylinder/${cylinder.publicTag}`, 'QR URL generated correctly for printing');
  assert(printableData.capacityKg === 12.5, 'Capacity matches physical asset');

  // 3. LpgPricingEngine Tests
  console.log('3. Testing LpgPricingEngine dynamic pricing matrix...');
  const priceBreakdown = LpgPricingEngine.calculateQuote({
    marketPricePerKg: 1400,
    companyMarkupPercent: 7.5,
    quantityKg: 12.5,
    distanceKm: 10,
  });

  assert(priceBreakdown.customerGasPricePerKg === 1505, '1400 * 1.075 = 1505 NGN customer price/kg');
  assert(priceBreakdown.totalGasCost === 18813, '12.5 * 1505 = 18813 NGN gas cost');
  assert(priceBreakdown.totalDeliveryFee === 2000, '500 base + 10km * 150/km = 2000 NGN delivery fee');
  assert(priceBreakdown.grossCustomerTotal === 20813, '18813 + 2000 = 20813 NGN total');
  assert(priceBreakdown.stationPayoutAmount === 17500, 'Station payout must equal raw market cost (12.5 * 1400 = 17500 NGN)');
  assert(priceBreakdown.driverDeliveryEarnings === 1400, 'Driver gets 70% of delivery fee (2000 * 0.7 = 1400 NGN)');

  // 4. AuditLogEngine Tests
  console.log('4. Testing AuditLogEngine immutable security logging...');
  AuditLogEngine.clearInMemoryLogs();
  const log = AuditLogEngine.recordEvent({
    eventType: 'VERIFICATION_APPROVED',
    actorId: 'admin-1',
    actorRole: 'ADMIN',
    targetResource: 'VERIFICATION',
    resourceId: 'ver-881',
    payload: { user_id: 'driver-99', role: 'DRIVER' },
  });

  assert(log.eventType === 'VERIFICATION_APPROVED', 'Event type recorded correctly');
  const logs = AuditLogEngine.getLogs({ actorId: 'admin-1' });
  assert(logs.length === 1, 'Exactly 1 audit log retrieved for admin-1');

  // 5. SettlementEngine Escrow Payout Tests
  console.log('5. Testing SettlementEngine escrow release logic...');
  const stationPayout = SettlementEngine.evaluateGasOrderSettlement({
    orderId: 'ord-101',
    publicId: 'ORD-LPG-101',
    status: 'REFILL_COMPLETED',
    escrowStatus: 'LOCKED',
    customerId: 'cust-1',
    stationOwnerUserId: 'station-owner-1',
    driverId: 'driver-1',
    gasCost: 17500,
    deliveryFee: 1500,
    trigger: 'STATION_PAYMENT',
  });
  assert(stationPayout.allowed === true, 'Station payout must be allowed after refill completion.');
  assert(stationPayout.amount === 17500, 'Station payout amount must equal gas cost.');
  assert(stationPayout.nextEscrowStatus === 'PARTIALLY_RELEASED', 'Escrow status must transition to PARTIALLY_RELEASED.');

  // 6. LiveTrackingPolicy Privacy Tests
  console.log('6. Testing LiveTrackingPolicy privacy rules...');
  const activeCustomerTrack = LiveTrackingPolicy.evaluate({
    orderStatus: 'RETURN_IN_TRANSIT',
    requesterRole: 'CUSTOMER',
    requesterUserId: 'cust-1',
    customerId: 'cust-1',
    driverId: 'driver-1',
  });
  assert(activeCustomerTrack.canViewDriverLocation === true, 'Customer should track driver during active delivery.');

  const completedCustomerTrack = LiveTrackingPolicy.evaluate({
    orderStatus: 'COMPLETED',
    requesterRole: 'CUSTOMER',
    requesterUserId: 'cust-1',
    customerId: 'cust-1',
    driverId: 'driver-1',
  });
  assert(completedCustomerTrack.canViewDriverLocation === false, 'Tracking MUST turn off automatically after delivery completion.');

  // 7. IdentityEngine & Permissions Tests
  console.log('7. Testing IdentityEngine permissions & role switching...');
  const identity = IdentityEngine.getInstance();
  const mockProfile: UserProfile = {
    id: 'usr-1',
    publicId: 'SKM-U-999',
    skimaId: 'SKM-10009999',
    fullName: 'Ada Obi',
    phoneNumber: '+2348012345678',
    email: 'ada@skima.ng',
    isDriver: true,
    isMerchant: false,
    isStationAdmin: false,
    isPumpAttendant: false,
    isAdmin: false,
    status: 'ACTIVE',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  identity.initializeSession(mockProfile, { accessToken: 'tok', refreshToken: 'ref', expiresAt: 9999999999 });
  assert(identity.getAuthState().availableRoles.includes('DRIVER'), 'Driver role unlocked for verified profile.');
  assert(!identity.getAuthState().availableRoles.includes('MERCHANT'), 'Merchant role locked when profile.isMerchant is false.');

  const switchRes = identity.switchRole('DRIVER');
  assert(switchRes.success === true, 'Switch to DRIVER view successful.');
  assert(identity.hasPermission('ACCEPT_DELIVERY_JOB') === true, 'Driver can accept delivery job in DRIVER view.');
  assert(identity.hasPermission('MANAGE_SYSTEM_CONFIG') === false, 'Driver cannot manage system config.');

  // 8. Phase 11: AiEngine Tests (Location-Agnostic AI Capability)
  console.log('8. Testing Phase 11: AiEngine location-agnostic intent routing...');
  const aiRes = AiEngine.processQuery('Where is my driver?', 'CUSTOMER', 'cust-1', {
    locationContext: { cityId: 'city-101', serviceAreaId: 'sa-metro-1' },
  });
  assert(aiRes.intent === 'CUSTOMER_SUPPORT', 'Query routed to CUSTOMER_SUPPORT intent');
  assert(aiRes.targetAgentName.includes('Agent 2'), 'Target agent is Customer Support Assistant');

  const landmarkRes = AiEngine.processQuery('Opposite Commercial Junction behind Main Pharmacy', 'CUSTOMER', 'cust-1');
  assert(landmarkRes.intent === 'LOCATION_PARSING', 'Landmark query routed to LOCATION_PARSING intent');

  // 9. Phase 11: DisputeEngine Tests
  console.log('9. Testing Phase 11: DisputeEngine arbitration & escrow refund...');
  DisputeEngine.clearInMemoryDisputes();
  const dispute = DisputeEngine.createDispute({
    orderId: 'ORD-MKT-991',
    orderType: 'MARKETPLACE',
    claimantUserId: 'cust-10',
    claimantRole: 'CUSTOMER',
    reason: 'DEFECTIVE_PRODUCT',
    description: 'Item damaged upon delivery',
    disputedAmountNgn: 15000,
  });
  assert(dispute.status === 'SUBMITTED', 'New dispute status must be SUBMITTED');

  const arbResult = DisputeEngine.arbitrateDispute({
    disputeId: dispute.id,
    adminUserId: 'admin-master',
    action: 'REFUND_BUYER',
    adminNotes: 'Damaged item confirmed by delivery photo evidence',
  });
  assert(arbResult.nextStatus === 'RESOLVED_BUYER_REFUND', 'Dispute resolved with buyer refund');
  assert(arbResult.refundAmountNgn === 15000, 'Full refund amount NGN equals 15000');

  // 10. Phase 11: GeographyEngine Tests (Geography Capability - Zero Hardcoding)
  console.log('10. Testing Phase 11: GeographyEngine Point-in-Polygon & dynamic coverage...');
  const coverage = GeographyEngine.evaluateLocationCoverage({ lat: 6.2215, lng: 7.0720 });
  assert(coverage.isCovered === true, 'Location must be covered inside registered polygon');
  assert(coverage.surgeMultiplier >= 1.0, 'Surge multiplier evaluated dynamically');

  // 11. Phase 11: CommunicationEngine Tests
  console.log('11. Testing Phase 11: CommunicationEngine multi-channel messaging...');
  CommunicationEngine.registerUserHandles('cust-1', { pushToken: 'ExponentPushToken[xxx]', email: 'user@skima.ng' });
  const commRes = await CommunicationEngine.notifyOrderStatusChange({
    userId: 'cust-1',
    orderId: 'ORD-LPG-99',
    status: 'REFILL_COMPLETED',
    message: 'Your cylinder refill is complete!',
  });
  assert(commRes.results.length === 2, 'Sent push & in-app notifications');

  // 12. Phase 11: SyncEngine Tests
  console.log('12. Testing Phase 11: SyncEngine offline event queue & flush...');
  SyncEngine.clearSyncQueue();
  SyncEngine.enqueueSyncEvent('DRIVER_TELEMETRY', 'drv-1', { lat: 6.22, lng: 7.07 });
  assert(SyncEngine.getQueueLength() === 1, 'Queue length is 1 after enqueuing');
  const flushRes = SyncEngine.flushSyncQueue();
  assert(flushRes.successfulCount === 1, 'Flush successfully processed queued sync event');

  // 13. Phase 12: FinancialPlatformEngine & Permanent Skima ID P2P Transfer Tests
  console.log('13. Testing Phase 12: FinancialPlatformEngine permanent Skima ID & P2P transfers...');
  const senderId = 'usr-sender-10';
  const recipientId = 'usr-recipient-20';

  const senderSkimaId = FinancialPlatformEngine.getOrCreateSkimaId(senderId);
  const recipientSkimaId = FinancialPlatformEngine.getOrCreateSkimaId(recipientId);

  assert(senderSkimaId.startsWith('SKM-'), 'Permanent Skima ID generated with format SKM-XXXXXXXX');
  assert(recipientSkimaId.startsWith('SKM-'), 'Recipient permanent Skima ID generated');

  FinancialPlatformEngine.fundWallet(senderId, 25000, 'PAYSTACK', 'REF-DEP-001');
  const senderWallet = FinancialPlatformEngine.getWallet(senderId);
  assert(senderWallet.balance === 25000, 'Sender wallet credited with ₦25,000');

  const transferRes = FinancialPlatformEngine.executeInternalTransfer({
    senderUserId: senderId,
    recipientSkimaId,
    amountNgn: 10000,
    note: 'Peer-to-peer gas split payment',
  });

  assert(transferRes.success === true, 'P2P transfer using recipient Skima ID successful');
  assert(senderWallet.balance === 15000, 'Sender balance debited ₦10,000 (Remaining ₦15,000)');

  const recipientWallet = FinancialPlatformEngine.getWallet(recipientId);
  assert(recipientWallet.balance === 10000, 'Recipient wallet credited ₦10,000');

  // 14. Phase 12: PaymentAdapterEngine Infrastructure Tests
  console.log('14. Testing Phase 12: PaymentAdapterEngine checkout & payout adapters...');
  const checkoutRes = await PaymentAdapterEngine.initializeCheckout({
    userId: senderId,
    userEmail: 'sender@skima.ng',
    amountNgn: 15000,
    provider: 'PAYSTACK',
  });
  assert(checkoutRes.reference.startsWith('SKM-PAY-'), 'Payment checkout session created');

  const payoutRes = await PaymentAdapterEngine.initiateBankPayout({
    withdrawalId: 'WD-881',
    bankName: 'Access Bank',
    accountNumber: '0123456789',
    amountNgn: 5000,
    recipientName: 'Ada Obi',
    provider: 'PAYSTACK',
  });
  assert(payoutRes.status === 'SUCCESS', 'Bank payout initiated through provider connector');

  // 15. Phase 12: PartnerVerificationEngine KYC Tests
  console.log('15. Testing Phase 12: PartnerVerificationEngine automated KYC evaluation...');
  const kycEval = PartnerVerificationEngine.evaluateSubmission({
    userId: 'driver-77',
    role: 'DRIVER',
    documentType: 'DRIVERS_LICENSE',
    documentNumber: 'DL-ANAMBRA-991823',
    documentUrls: ['https://skima.ng/docs/dl-77.jpg'],
  });
  assert(kycEval.status === 'APPROVED', 'Valid driver license submission approved');
  assert(kycEval.riskScore < 0.30, 'Low risk score assigned to valid partner document');

  // 16. Phase 12: CommerceEngine Multi-Vendor Marketplace Tests
  console.log('16. Testing Phase 12: CommerceEngine shopping cart & escrow checkout...');
  const product = CommerceEngine.resolveProductBySlug('heavy-duty-lpg-gas-regulator');
  assert(product !== undefined, 'Product resolved by friendly slug URL');

  const cartCheckout = CommerceEngine.processCheckout({
    customerUserId: 'cust-1',
    cartItems: [{ product: product!, quantity: 2 }],
    shippingAddress: 'Zik Avenue Axis, Awka',
    distanceKm: 5,
  });

  assert(cartCheckout.totalProductsAmountNgn === 17000, '2 * ₦8,500 = ₦17,000 products cost');
  assert(cartCheckout.shippingFeeNgn === 1250, '500 base + 5km * 150/km = ₦1,250 shipping fee');
  assert(cartCheckout.grossTotalNgn === 18250, '17000 + 1250 = ₦18,250 gross total');
  assert(cartCheckout.escrowStatus === 'LOCKED', 'Commerce order funds locked in Escrow');

  console.log('--- ALL REFACTORED SKIMA PLATFORM KERNEL TESTS (PHASES 1-12) PASSED 100% SUCCESSFULLY! ---');
}

runMasterSuite().catch((err) => {
  console.error(err);
  throw err;
});



