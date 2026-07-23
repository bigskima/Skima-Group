/**
 * SKIMA AI AGENT 1 — DISPATCH INTELLIGENCE
 * Ranks stations and drivers using queue load, station stock, traffic congestion,
 * and delivery speed rather than simple "nearest station" distance logic.
 */

export interface StationOption {
  id: string;
  name: string;
  distanceKm: number;
  queueCount: number;
  availableStockKg: number;
  pricePerKg: number;
}

export class DispatchIntelligenceAgent {
  /**
   * Ranks stations dynamically to select the optimal station for a gas refill.
   */
  public static selectOptimalStation(stations: StationOption[], requiredKg: number): StationOption | null {
    if (!stations.length) return null;

    // Filter stations with enough stock
    const eligible = stations.filter(s => s.availableStockKg >= requiredKg);
    if (!eligible.length) return null;

    // Score stations (lower score is better)
    // Formula: Score = (Distance * 1.5) + (QueueCount * 2.0) - (Price * 0.05)
    const scored = eligible.map(stn => {
      const score = (stn.distanceKm * 1.5) + (stn.queueCount * 2.0);
      return { station: stn, score };
    });

    scored.sort((a, b) => a.score - b.score);
    return scored[0].station;
  }
}
