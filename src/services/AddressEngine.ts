/**
 * SKIMA ADDRESS & GEO-FENCING ENGINE
 * Manages service area availability, Awka launch zone validation,
 * distance calculation, and Google Maps API abstractions.
 */

import { ConfigurationEngine } from './ConfigurationEngine';

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
}

export interface ServiceZoneConfig {
  country: string;
  state: string;
  city: string;
  centerLat: number;
  centerLng: number;
  radiusKm: number;
}

export class AddressEngine {
  private static getDefaultZone(): ServiceZoneConfig {
    const zone = ConfigurationEngine.getLaunchZone();

    return {
      country: zone.country,
      state: zone.state,
      city: zone.city,
      centerLat: zone.centerLat,
      centerLng: zone.centerLng,
      radiusKm: zone.radiusKm,
    };
  }

  /**
   * Calculates Haversine distance in kilometers between two geographic coordinates.
   */
  public static calculateDistanceKm(coord1: GeoCoordinates, coord2: GeoCoordinates): number {
    const R = 6371; // Earth's radius in km
    const dLat = this.deg2rad(coord2.latitude - coord1.latitude);
    const dLng = this.deg2rad(coord2.longitude - coord1.longitude);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(coord1.latitude)) *
        Math.cos(this.deg2rad(coord2.latitude)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return parseFloat((R * c).toFixed(2));
  }

  /**
   * Checks whether a given location falls within active Skima launch coverage (Awka Zone).
   */
  public static isWithinServiceArea(
    coords: GeoCoordinates,
    zone: ServiceZoneConfig = AddressEngine.getDefaultZone()
  ): { supported: boolean; distanceToCenterKm: number; message: string } {
    const distance = this.calculateDistanceKm(coords, {
      latitude: zone.centerLat,
      longitude: zone.centerLng,
    });

    if (distance <= zone.radiusKm) {
      return {
        supported: true,
        distanceToCenterKm: distance,
        message: `Location is within active service coverage (${zone.city}, ${zone.state}).`,
      };
    }

    return {
      supported: false,
      distanceToCenterKm: distance,
      message: `Skima currently operates within ${zone.city}, ${zone.state} (${zone.radiusKm}km radius). Your location is ${distance}km away.`,
    };
  }

  /**
   * Calculates dynamic LPG delivery fee based on distance.
   */
  public static calculateDeliveryFee(
    distanceKm: number,
    baseFeeNgn: number = ConfigurationEngine.getDefaultConfiguration().lpgPricing.deliveryBaseFee,
    perKmFeeNgn: number = ConfigurationEngine.getDefaultConfiguration().lpgPricing.deliveryPerKmFee
  ): number {
    const fee = baseFeeNgn + distanceKm * perKmFeeNgn;
    return Math.round(fee);
  }

  private static deg2rad(deg: number): number {
    return deg * (Math.PI / 180);
  }
}
