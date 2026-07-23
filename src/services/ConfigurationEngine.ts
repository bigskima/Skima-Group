import {
  CurrencyCode,
  FeatureAvailability,
  LpgOrderQuote,
  LpgPricingPolicy,
  ServiceZone,
  UserRole,
} from '../types';

export interface WalletLimitPolicy {
  currency: CurrencyCode;
  minimumFundingAmount: number;
  maximumSingleFundingAmount: number;
  dailyOutgoingLimit: number;
  maximumWalletBalance: number;
}

export interface RegistrationAvailabilityPolicy {
  customer: boolean;
  driver: boolean;
  merchant: boolean;
  stationAdmin: boolean;
  pumpAttendant: boolean;
}

export interface PlatformBusinessConfiguration {
  defaultCurrency: CurrencyCode;
  supportedCurrencies: CurrencyCode[];
  futureCurrencies: CurrencyCode[];
  maintenanceMode: boolean;
  registrationAvailability: RegistrationAvailabilityPolicy;
  featureAvailability: FeatureAvailability;
  lpgPricing: LpgPricingPolicy;
  walletLimits: WalletLimitPolicy[];
  serviceZones: ServiceZone[];
}

export interface LpgQuoteRequest {
  quantityKg: number;
  deliveryDistanceKm?: number;
  zoneId?: string;
  stationPricePerKg?: number;
}

export const AWKA_LAUNCH_ZONE_ID = 'ng-anambra-awka-launch';

export const DEFAULT_PLATFORM_CONFIG: PlatformBusinessConfiguration = {
  defaultCurrency: 'NGN',
  supportedCurrencies: ['NGN'],
  futureCurrencies: ['USD', 'USDC'],
  maintenanceMode: false,
  registrationAvailability: {
    customer: true,
    driver: true,
    merchant: true,
    stationAdmin: true,
    pumpAttendant: false,
  },
  featureAvailability: {
    lpgLogistics: true,
    wallet: true,
    marketplace: true,
    merchantPlatform: true,
    billPayments: true,
    identityVerification: true,
    escrow: true,
    settlement: true,
    notifications: true,
    analytics: true,
    adminControlCenter: true,
    aiOperations: true,
    usdWallet: false,
    usdcWallet: false,
    multiCountry: false,
  },
  lpgPricing: {
    currency: 'NGN',
    gasPricePerKg: 1400,
    companyMarkupPercent: 7.5,
    deliveryBaseFee: 500,
    deliveryPerKmFee: 150,
    platformCommissionPercent: 5,
    minimumOrderKg: 3,
  },
  walletLimits: [
    {
      currency: 'NGN',
      minimumFundingAmount: 100,
      maximumSingleFundingAmount: 500000,
      dailyOutgoingLimit: 1000000,
      maximumWalletBalance: 5000000,
    },
  ],
  serviceZones: [
    {
      id: AWKA_LAUNCH_ZONE_ID,
      country: 'Nigeria',
      state: 'Anambra',
      city: 'Awka',
      label: 'Awka Launch Zone',
      centerLat: 6.2209,
      centerLng: 7.0671,
      radiusKm: 25,
      isActive: true,
      streets: ['Zik Avenue', 'Arthur Eze Avenue', 'Ifite Road', 'Enugu-Onitsha Expressway'],
      landmarks: ['Aroma Junction', 'UNIZIK Temporary Site', 'Emma Pharmacy', 'Eke Awka Market'],
      estates: ['Ngozika Estate', 'Udoka Estate', 'Real Estate Ifite'],
      localDirections: [
        'near Aroma Junction',
        'around UNIZIK temporary site',
        'before Eke Awka Market',
        'close to Emma Pharmacy',
      ],
    },
  ],
};

export class ConfigurationEngine {
  public static getDefaultConfiguration(): PlatformBusinessConfiguration {
    return DEFAULT_PLATFORM_CONFIG;
  }

  public static getLaunchZone(): ServiceZone {
    return DEFAULT_PLATFORM_CONFIG.serviceZones[0];
  }

  public static getActiveServiceZones(
    config: PlatformBusinessConfiguration = DEFAULT_PLATFORM_CONFIG,
  ): ServiceZone[] {
    return config.serviceZones.filter((zone) => zone.isActive);
  }

  public static getServiceZone(
    zoneId: string = AWKA_LAUNCH_ZONE_ID,
    config: PlatformBusinessConfiguration = DEFAULT_PLATFORM_CONFIG,
  ): ServiceZone {
    return (
      config.serviceZones.find((zone) => zone.id === zoneId && zone.isActive) ??
      this.getLaunchZone()
    );
  }

  public static isRegistrationOpenFor(role: UserRole): boolean {
    const availability = DEFAULT_PLATFORM_CONFIG.registrationAvailability;

    switch (role) {
      case 'CUSTOMER':
        return availability.customer;
      case 'DRIVER':
        return availability.driver;
      case 'MERCHANT':
        return availability.merchant;
      case 'STATION_ADMIN':
        return availability.stationAdmin;
      case 'PUMP_ATTENDANT':
        return availability.pumpAttendant;
      case 'ADMIN':
        return false;
      default:
        return false;
    }
  }

  public static getWalletLimit(currency: CurrencyCode = 'NGN'): WalletLimitPolicy {
    return (
      DEFAULT_PLATFORM_CONFIG.walletLimits.find((limit) => limit.currency === currency) ??
      DEFAULT_PLATFORM_CONFIG.walletLimits[0]
    );
  }

  public static quoteLpgRefill(request: LpgQuoteRequest): LpgOrderQuote {
    const pricing = DEFAULT_PLATFORM_CONFIG.lpgPricing;
    const serviceZone = this.getServiceZone(request.zoneId);
    const quantityKg = Math.max(0, request.quantityKg);
    const pricePerKg = request.stationPricePerKg ?? pricing.gasPricePerKg;
    const distanceKm = Math.max(0, request.deliveryDistanceKm ?? 0);
    const gasCost = Math.round(quantityKg * pricePerKg);
    const deliveryFee = Math.round(pricing.deliveryBaseFee + distanceKm * pricing.deliveryPerKmFee);
    const platformCommission = Math.round((gasCost * pricing.platformCommissionPercent) / 100);

    return {
      quantityKg,
      currency: pricing.currency,
      gasCost,
      deliveryFee,
      platformCommission,
      totalAmount: gasCost + deliveryFee,
      serviceZone,
    };
  }
}
