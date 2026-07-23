import { CurrencyCode, LpgOrderQuote, LpgPricingPolicy, ServiceZone } from '../types';
import { ConfigurationEngine } from './ConfigurationEngine';

export interface ComprehensivePriceCalculationRequest {
  marketPricePerKg: number;
  companyMarkupPercent: number;
  quantityKg: number;
  distanceKm: number;
  currency?: CurrencyCode;
  exchangeRateToNgn?: number;
  zone?: ServiceZone;
}

export interface ComprehensivePriceBreakdown {
  currency: CurrencyCode;
  quantityKg: number;
  rawMarketCost: number;
  companyMarkupAmount: number;
  customerGasPricePerKg: number;
  totalGasCost: number;
  deliveryBaseFee: number;
  deliveryDistanceFee: number;
  totalDeliveryFee: number;
  grossCustomerTotal: number;
  stationPayoutAmount: number;
  driverDeliveryEarnings: number;
  skimaPlatformMargin: number;
}

export class LpgPricingEngine {
  /**
   * Calculates LPG Customer Price & Platform Revenue Breakdown
   * Formula: Market Price * (1 + Company Margin %) = Customer Selling Price Per Kg
   */
  public static calculateQuote(
    request: ComprehensivePriceCalculationRequest
  ): ComprehensivePriceBreakdown {
    const currency = request.currency ?? 'NGN';
    const rate = request.exchangeRateToNgn ?? 1.0;
    const quantityKg = Math.max(0, request.quantityKg);
    const distanceKm = Math.max(0, request.distanceKm);

    // Baseline configuration
    const config = ConfigurationEngine.getDefaultConfiguration();
    const basePolicy = config.lpgPricing;

    const marketPricePerKg = request.marketPricePerKg ?? basePolicy.gasPricePerKg;
    const markupPercent = request.companyMarkupPercent ?? 7.5; // default 7.5%

    // Calculate per kg customer price
    const customerPricePerKg = Math.round(marketPricePerKg * (1 + markupPercent / 100));

    // Gas cost calculations
    const rawMarketCost = Math.round(marketPricePerKg * quantityKg);
    const totalGasCost = Math.round(customerPricePerKg * quantityKg);
    const companyMarkupAmount = totalGasCost - rawMarketCost;

    // Delivery fee calculations
    const deliveryBaseFee = basePolicy.deliveryBaseFee;
    const deliveryDistanceFee = Math.round(distanceKm * basePolicy.deliveryPerKmFee);
    const totalDeliveryFee = deliveryBaseFee + deliveryDistanceFee;

    // Payout splits
    const stationPayoutAmount = rawMarketCost; // Station gets raw market price per kg refilled
    const driverDeliveryEarnings = Math.round(totalDeliveryFee * 0.70); // Driver gets 70% of delivery fee
    const skimaPlatformMargin = companyMarkupAmount + Math.round(totalDeliveryFee * 0.30); // Skima retains margin + 30% delivery share

    // Apply currency exchange if non-NGN
    const scale = (val: number) => (currency === 'NGN' ? val : parseFloat((val / rate).toFixed(2)));

    return {
      currency,
      quantityKg,
      rawMarketCost: scale(rawMarketCost),
      companyMarkupAmount: scale(companyMarkupAmount),
      customerGasPricePerKg: scale(customerPricePerKg),
      totalGasCost: scale(totalGasCost),
      deliveryBaseFee: scale(deliveryBaseFee),
      deliveryDistanceFee: scale(deliveryDistanceFee),
      totalDeliveryFee: scale(totalDeliveryFee),
      grossCustomerTotal: scale(totalGasCost + totalDeliveryFee),
      stationPayoutAmount: scale(stationPayoutAmount),
      driverDeliveryEarnings: scale(driverDeliveryEarnings),
      skimaPlatformMargin: scale(skimaPlatformMargin),
    };
  }

  public static toLpgOrderQuote(breakdown: ComprehensivePriceBreakdown): LpgOrderQuote {
    return {
      quantityKg: breakdown.quantityKg,
      currency: breakdown.currency,
      gasCost: breakdown.totalGasCost,
      deliveryFee: breakdown.totalDeliveryFee,
      platformCommission: breakdown.skimaPlatformMargin,
      totalAmount: breakdown.grossCustomerTotal,
      serviceZone: ConfigurationEngine.getLaunchZone(),
    };
  }
}
