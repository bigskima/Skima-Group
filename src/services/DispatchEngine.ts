/**
 * SKIMA DISPATCH RANKING ENGINE
 * Combines multi-factor station/driver availability logic (distance, stock, queue, online state)
 * with advisory output from the DispatchIntelligenceAgent.
 * 
 * AI GUARDRAIL ENFORCED: AI output is strictly advisory. Platform deterministic rules
 * determine valid dispatch candidates and assign jobs.
 */

import { Driver, LPGStation, ServiceZone } from '../types';
import { AddressEngine, GeoCoordinates } from './AddressEngine';
import { DispatchIntelligenceAgent, DispatchRecommendation } from './ai/DispatchIntelligenceAgent';
import { GeographyEngine } from './GeographyEngine';

export interface StationScore {
  station: LPGStation;
  distanceKm: number;
  score: number; // 0 to 100
  reasons: string[];
}

export interface DriverScore {
  driver: Driver;
  distanceKm: number;
  score: number; // 0 to 100
  reasons: string[];
}

export interface DispatchEvaluationResult {
  recommendedStation?: LPGStation;
  recommendedDriver?: Driver;
  rankedStations: StationScore[];
  rankedDrivers: DriverScore[];
  aiAdvisory?: DispatchRecommendation;
  matchedZoneName?: string;
}

export class DispatchEngine {
  /**
   * Evaluates best station and driver candidates for a customer refill request.
   */
  public static evaluateDispatch(
    customerCoords: GeoCoordinates,
    requiredGasKg: number,
    stations: LPGStation[],
    drivers: Driver[],
    serviceZone: ServiceZone
  ): DispatchEvaluationResult {
    // Determine customer service polygon coverage via Geography Engine
    const coverage = GeographyEngine.evaluateLocationCoverage({
      lat: customerCoords.latitude,
      lng: customerCoords.longitude,
    });

    // 1. Filter and score LPG Stations
    const rankedStations: StationScore[] = stations
      .filter((s) => s.isActive && s.availableStockKg >= requiredGasKg)
      .map((station) => {
        const distanceKm = AddressEngine.calculateDistanceKm(customerCoords, {
          latitude: station.latitude,
          longitude: station.longitude,
        });

        // Base score starts at 100, drops with distance and low stock
        let score = 100 - distanceKm * 3;
        const reasons: string[] = [];

        if (coverage.matchedPolygon) {
          reasons.push(`Matched Service Zone: ${coverage.matchedPolygon.label}`);
        }

        if (distanceKm <= 5) {
          reasons.push('Proximity under 5km');
          score += 10;
        }


        if (station.availableStockKg > requiredGasKg * 5) {
          reasons.push('Ample gas stock available');
          score += 5;
        }

        return {
          station,
          distanceKm,
          score: Math.max(0, Math.min(100, Math.round(score))),
          reasons,
        };
      })
      .sort((a, b) => b.score - a.score);

    // 2. Filter and score Available Drivers
    const rankedDrivers: DriverScore[] = drivers
      .filter((d) => d.isOnline && d.isAvailable && d.verificationStatus === 'APPROVED')
      .map((driver) => {
        const distanceKm = driver.currentLatitude && driver.currentLongitude
          ? AddressEngine.calculateDistanceKm(customerCoords, {
              latitude: driver.currentLatitude,
              longitude: driver.currentLongitude,
            })
          : 10.0;

        let score = 100 - distanceKm * 4;
        const reasons: string[] = ['Verified & online driver'];

        if (distanceKm <= 3) {
          reasons.push('Immediate pickup proximity (<3km)');
          score += 15;
        }

        return {
          driver,
          distanceKm,
          score: Math.max(0, Math.min(100, Math.round(score))),
          reasons,
        };
      })
      .sort((a, b) => b.score - a.score);

    const recommendedStation = rankedStations[0]?.station;
    const recommendedDriver = rankedDrivers[0]?.driver;

    // 3. Advisory AI Agent Recommendation
    let aiAdvisory: DispatchRecommendation | undefined;
    try {
      const aiAgent = new DispatchIntelligenceAgent();
      aiAdvisory = aiAgent.evaluateStationAndDriver({
        orderLocation: `${customerCoords.latitude}, ${customerCoords.longitude}`,
        cylinderSizeKg: requiredGasKg,
        availableStations: stations.map((s) => ({ id: s.id, name: s.name, pricePerKg: s.pricePerKg, distanceKm: 2 })),
        availableDrivers: drivers.map((d) => ({ id: d.id, vehicle: d.vehicleType, currentLat: d.currentLatitude, currentLng: d.currentLongitude })),
      });
    } catch {
      // AI fallback if offline/mocked
    }

    return {
      recommendedStation,
      recommendedDriver,
      rankedStations,
      rankedDrivers,
      aiAdvisory,
      matchedZoneName: coverage.matchedPolygon?.label,
    };
  }
}

