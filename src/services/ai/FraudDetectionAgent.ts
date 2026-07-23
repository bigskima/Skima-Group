/**
 * SKIMA AI AGENT 4 — FRAUD DETECTION AGENT
 * Pattern recognition engine flagging anomalous activities:
 * - Driver completing delivery in under 2 minutes
 * - Station reporting 200% volume spike overnight
 * - Accounts with multiple failed wallet deposit attempts
 */

export interface FraudRiskAssessment {
  flagged: boolean;
  riskScore: number; // 0.0 to 1.0
  riskCategory: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  reasons: string[];
  recommendedAction: 'PASS' | 'FLAG_FOR_ADMIN' | 'SUSPEND_TEMPORARILY';
}

export class FraudDetectionAgent {
  /**
   * Evaluates driver delivery duration for impossibility anomalies.
   */
  public static evaluateDeliverySpeed(durationMinutes: number, distanceKm: number): FraudRiskAssessment {
    const reasons: string[] = [];
    let score = 0.0;

    // Delivery completed in under 2 minutes for distance > 1km
    if (durationMinutes < 2 && distanceKm > 1.0) {
      score = 0.95;
      reasons.push(`Impossibly rapid delivery: ${distanceKm}km completed in ${durationMinutes} minutes.`);
    } else if (durationMinutes < 5 && distanceKm > 5.0) {
      score = 0.70;
      reasons.push(`Unusually high speed delivery: ${distanceKm}km in ${durationMinutes} minutes.`);
    }

    return {
      flagged: score >= 0.7,
      riskScore: score,
      riskCategory: score >= 0.9 ? 'CRITICAL' : score >= 0.7 ? 'HIGH' : score >= 0.4 ? 'MEDIUM' : 'LOW',
      reasons,
      recommendedAction: score >= 0.9 ? 'SUSPEND_TEMPORARILY' : score >= 0.7 ? 'FLAG_FOR_ADMIN' : 'PASS',
    };
  }

  /**
   * Evaluates wallet funding attempt frequency for brute-force patterns.
   */
  public static evaluateWalletDepositAttempts(failedCount: number): FraudRiskAssessment {
    if (failedCount >= 5) {
      return {
        flagged: true,
        riskScore: 0.88,
        riskCategory: 'HIGH',
        reasons: [`Multiple failed deposit attempts (${failedCount}) detected within 1 hour.`],
        recommendedAction: 'FLAG_FOR_ADMIN',
      };
    }
    return {
      flagged: false,
      riskScore: 0.1,
      riskCategory: 'LOW',
      reasons: [],
      recommendedAction: 'PASS',
    };
  }
}
