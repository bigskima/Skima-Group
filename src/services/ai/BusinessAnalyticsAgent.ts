/**
 * SKIMA AI AGENT 8 - BUSINESS ANALYTICS ASSISTANT
 * Produces advisory summaries from operational metrics. It does not mutate data.
 */

export interface BusinessMetricSnapshot {
  completedOrders: number;
  grossMerchandiseValue: number;
  escrowHeld: number;
  failedPayments: number;
  activeDrivers: number;
  activeStations: number;
}

export interface BusinessAnalyticsInsight {
  headline: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  observations: string[];
  recommendedAdminReview: boolean;
}

export class BusinessAnalyticsAgent {
  public static summarize(snapshot: BusinessMetricSnapshot): BusinessAnalyticsInsight {
    const observations: string[] = [];

    if (snapshot.completedOrders > 0) {
      observations.push(`${snapshot.completedOrders} completed orders generated NGN ${snapshot.grossMerchandiseValue}.`);
    }

    if (snapshot.failedPayments >= 5) {
      observations.push(`${snapshot.failedPayments} failed payments should be reviewed by finance operations.`);
    }

    if (snapshot.activeDrivers < 3) {
      observations.push('Driver supply is low for a live LPG logistics zone.');
    }

    if (snapshot.activeStations < 2) {
      observations.push('Station redundancy is low; dispatch has limited fallback capacity.');
    }

    const riskLevel = snapshot.failedPayments >= 5 || snapshot.activeDrivers < 3 ? 'HIGH' : 'LOW';

    return {
      headline: 'Operational analytics summary generated for admin review.',
      riskLevel,
      observations,
      recommendedAdminReview: riskLevel !== 'LOW',
    };
  }
}
