/**
 * SKIMA PLATFORM DOMAIN TYPES & INTERFACES (REFACTORED ARCHITECTURE)
 * Single Source of Truth for Skima Platform Layers:
 * Presentation | Design System | Domain Modules | Platform Engines | AI Layer | Supabase
 */

export type UserRole = 'CUSTOMER' | 'DRIVER' | 'MERCHANT' | 'STATION_ADMIN' | 'PUMP_ATTENDANT' | 'ADMIN';
export type CurrencyCode = 'NGN' | 'USD' | 'USDC';

export interface UserProfile {
  id: string;
  publicId: string;
  skimaId: string; // Permanent Public Identifier e.g. SKM-48392018
  fullName: string;
  phoneNumber: string;
  email: string;
  avatarUrl?: string;
  isDriver: boolean;
  isMerchant: boolean;
  isStationAdmin: boolean;
  isPumpAttendant: boolean;
  isAdmin: boolean;
  status: 'ACTIVE' | 'SUSPENDED' | 'PENDING_VERIFICATION';
  createdAt: string;
  updatedAt: string;
}

export interface Wallet {
  id: string;
  userId: string;
  currency: CurrencyCode;
  balance: number; // Available Balance
  lockedBalance: number; // Escrow / Withdrawal hold
  pendingBalance: number; // Unsettled incoming transactions
  lifetimeCredits: number;
  lifetimeDebits: number;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  createdAt: string;
  updatedAt: string;
}

export interface CompanyWallet {
  id: string;
  currency: CurrencyCode;
  availableBalance: number;
  totalCommissionsEarned: number;
  totalWithdrawalFeesEarned: number;
  totalLpgMarginsEarned: number;
  updatedAt: string;
}

export interface WithdrawalRequest {
  id: string;
  userId: string;
  walletId: string;
  amountNgn: number;
  feeNgn: number;
  netPayoutNgn: number;
  bankName: string;
  accountNumber: string;
  accountName: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'REJECTED';
  providerName: string;
  providerReference?: string;
  createdAt: string;
}

export interface InternalTransferRequest {
  senderUserId: string;
  recipientSkimaId: string; // Target recipient's permanent SKM-XXXXXXXX ID
  amountNgn: number;
  note?: string;
}

export type TransactionType = 
  | 'DEPOSIT'
  | 'INTERNAL_TRANSFER'
  | 'GAS_PAYMENT'
  | 'ESCROW_HOLD'
  | 'ESCROW_RELEASE_STATION'
  | 'ESCROW_RELEASE_DRIVER'
  | 'ESCROW_REFUND'
  | 'BILL_PAYMENT' 
  | 'MARKETPLACE_PAYMENT' 
  | 'WITHDRAWAL' 
  | 'REFUND'
  | 'REWARD';

export interface LedgerEntry {
  id: string;
  reference: string;
  transactionType: TransactionType;
  sourceWalletId: string;
  destinationWalletId: string;
  amount: number;
  currency: string;
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'REVERSED';
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type CylinderCustodyStatus = 
  | 'IDLE' 
  | 'IN_TRANSIT_TO_STATION' 
  | 'AT_STATION' 
  | 'REFILLING'
  | 'IN_TRANSIT_TO_CUSTOMER'
  | 'DELIVERED';

export type CylinderOwnerType = 'SKIMA_POOL' | 'CUSTOMER_OWNED' | 'STATION_OWNED';

export interface CylinderAsset {
  id: string;
  publicTag: string; // e.g. CYL-AWK-12.5-90182
  qrCode: string;
  nfcTagId?: string;
  capacityKg: number;
  tareWeightKg: number;
  ownerType: CylinderOwnerType;
  ownerUserId?: string;
  currentCustodyUserId?: string;
  currentCustodyRole: UserRole;
  currentStatus: CylinderCustodyStatus;
  activeOrderId?: string;
  assignedRefillKg?: number;
  safetyClearance: boolean;
  lastInspectedAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface CylinderInspectionRecord {
  id: string;
  cylinderId: string;
  inspectorUserId: string;
  actionType: 'INSPECTION' | 'REFILL' | 'CUSTODY_HANDOFF' | 'SAFETY_FLAG';
  tareWeightChecked?: number;
  grossWeightChecked?: number;
  pressureBar?: number;
  passedInspection: boolean;
  notes?: string;
  createdAt: string;
}

export interface LPGStation {
  id: string;
  name: string;
  ownerUserId: string;
  address: string;
  latitude: number;
  longitude: number;
  pricePerKg: number;
  availableStockKg: number;
  isActive: boolean;
}

export interface Driver {
  id: string;
  vehicleType: 'MOTORCYCLE' | 'TRICYCLE' | 'VAN' | 'TRUCK';
  licensePlate: string;
  currentLatitude?: number;
  currentLongitude?: number;
  isOnline: boolean;
  isAvailable: boolean;
  verificationStatus: 'APPROVED' | 'PENDING' | 'REJECTED';
}

export type GasOrderStatus = 
  | 'CREATED' 
  | 'ESCROW_LOCKED' 
  | 'ASSIGNED_TO_DRIVER' 
  | 'CYLINDER_PICKED_UP' 
  | 'DELIVERED_TO_STATION' 
  | 'REFILL_COMPLETED' 
  | 'RETURN_IN_TRANSIT' 
  | 'DELIVERED_TO_CUSTOMER' 
  | 'COMPLETED' 
  | 'CANCELLED' 
  | 'DISPUTED';

export interface GasOrder {
  id: string;
  publicId: string;
  customerId: string;
  cylinderId: string;
  stationId?: string;
  driverId?: string;
  quantityKg: number;
  gasCost: number;
  deliveryFee: number;
  totalAmount: number;
  status: GasOrderStatus;
  deliveryAddress: string;
  deliveryLatitude: number;
  deliveryLongitude: number;
  escrowStatus: 'PENDING' | 'LOCKED' | 'PARTIALLY_RELEASED' | 'RELEASED' | 'REFUNDED';
  createdAt: string;
  updatedAt: string;
}

export interface OrderTimelineEvent {
  id: string;
  orderId: string;
  eventType: string;
  actorUserId: string;
  latitude?: number;
  longitude?: number;
  photoUrl?: string;
  notes?: string;
  createdAt: string;
}

export interface BillTransaction {
  id: string;
  reference: string;
  userId: string;
  billerType: 'AIRTIME' | 'DATA' | 'ELECTRICITY' | 'CABLE_TV' | 'EDUCATION';
  providerName: string;
  customerIdentifier: string;
  amount: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  providerReference?: string;
  createdAt: string;
}

export interface Country {
  id: string;
  code: string; // e.g. NGA, GHA, GBR, USA
  name: string;
  currencyCode: CurrencyCode;
  phoneCode: string;
  isActive: boolean;
}

export interface State {
  id: string;
  countryId: string;
  code: string;
  name: string;
  isActive: boolean;
}

export interface City {
  id: string;
  stateId: string;
  name: string;
  centerLat: number;
  centerLng: number;
  isActive: boolean;
}

export interface ServiceArea {
  id: string;
  cityId: string;
  code: string;
  name: string;
  description?: string;
  isActive: boolean;
}

export interface ServiceZonePolygon {
  id: string;
  serviceAreaId: string;
  label: string;
  coordinates: { lat: number; lng: number }[]; // Array of boundary points forming a closed polygon
  surgeMultiplier: number;
  baseDeliveryFee: number;
  perKmFee: number;
  companyMarginPercent: number;
  isActive: boolean;
}

export interface ServiceZone {
  id: string;
  country: string;
  state: string;
  city: string;
  label: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
  isActive: boolean;
  streets?: string[];
  landmarks?: string[];
  estates?: string[];
  localDirections?: string[];
}

export interface LpgPricingPolicy {
  currency: CurrencyCode;
  gasPricePerKg: number;
  companyMarkupPercent: number;
  deliveryBaseFee: number;
  deliveryPerKmFee: number;
  platformCommissionPercent: number;
  minimumOrderKg: number;
}

export interface LpgOrderQuote {
  quantityKg: number;
  currency: CurrencyCode;
  gasCost: number;
  deliveryFee: number;
  platformCommission: number;
  totalAmount: number;
  serviceZone?: ServiceZone;
  serviceAreaId?: string;
  zonePolygonId?: string;
  surgeMultiplier?: number;
}

export interface MultiCurrencyRate {
  code: CurrencyCode;
  name: string;
  symbol: string;
  exchangeRateToNgn: number;
  isActive: boolean;
  isFutureGated: boolean;
}

export type VerificationStatus = 'PENDING' | 'UNDER_REVIEW' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export interface VerificationApplication {
  id: string;
  userId: string;
  role: UserRole;
  status: VerificationStatus;
  businessName?: string;
  tinOrBvn?: string;
  operatingLicenseNo?: string;
  epaPermitNo?: string;
  vehicleType?: string;
  plateNumber?: string;
  documents: { title: string; url: string; type: string }[];
  bankDetails: { bankName: string; accountNumber: string; accountName: string };
  rejectionReason?: string;
  reviewedBy?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface MarketplaceProductItem {
  id: string;
  merchantUserId: string;
  title: string;
  slug: string;
  description: string;
  priceNgn: number;
  category: string;
  stockQuantity: number;
  images: string[];
  isActive: boolean;
  createdAt: string;
}

export type ShippingStatus = 'PLACED' | 'SHIPPED' | 'DELIVERED' | 'COMPLETED' | 'CANCELLED';

export interface MarketplaceOrderEnvelope {
  id: string;
  customerUserId: string;
  productId: string;
  quantity: number;
  unitPriceNgn: number;
  totalAmountNgn: number;
  escrowStatus: 'LOCKED' | 'RELEASED' | 'REFUNDED' | 'DISPUTED';
  orderStatus: ShippingStatus;
  shippingAddress: string;
  createdAt: string;
}

export type AuditEventType = 
  | 'ROLE_SWITCH'
  | 'CONFIG_CHANGE'
  | 'PRICING_UPDATE'
  | 'VERIFICATION_SUBMITTED'
  | 'VERIFICATION_APPROVED'
  | 'VERIFICATION_REJECTED'
  | 'VERIFICATION_SUSPENDED'
  | 'CYLINDER_INSPECTED'
  | 'CYLINDER_HANDOFF'
  | 'WALLET_WITHDRAWAL_REQUEST'
  | 'ESCROW_LOCKED'
  | 'ESCROW_RELEASED'
  | 'AI_ORCHESTRATION_EXECUTED'
  | 'DISPUTE_CREATED'
  | 'DISPUTE_ARBITRATED'
  | 'OFFLINE_MUTATION_FLUSHED';

export interface AuditLogEntry {
  id: string;
  eventType: AuditEventType;
  actorId: string;
  actorRole: UserRole;
  targetResource: string;
  resourceId: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface FeatureAvailability {
  lpgLogistics: boolean;
  wallet: boolean;
  marketplace: boolean;
  merchantPlatform: boolean;
  billPayments: boolean;
  identityVerification: boolean;
  escrow: boolean;
  settlement: boolean;
  notifications: boolean;
  analytics: boolean;
  adminControlCenter: boolean;
  aiOperations: boolean;
  usdWallet: boolean;
  usdcWallet: boolean;
  multiCountry: boolean;
}
