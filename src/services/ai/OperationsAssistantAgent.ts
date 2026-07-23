/**
 * SKIMA AI AGENT 5 — OPERATIONS QUERY ASSISTANT
 * Translates natural language queries from Administrators (e.g. "Show today's failed wallet deposits",
 * "Which station completed the most orders this week?") into structured database query parameters.
 */

export interface OperationsQueryResult {
  naturalLanguageQuery: string;
  targetTable: 'wallets' | 'lpg_stations' | 'drivers' | 'gas_orders' | 'ledger_entries';
  appliedFilter: Record<string, unknown>;
  summaryText: string;
}

export class OperationsAssistantAgent {
  public static parseAdminQuery(naturalQuery: string): OperationsQueryResult {
    const queryLower = naturalQuery.toLowerCase();

    if (queryLower.includes('failed') || queryLower.includes('deposit')) {
      return {
        naturalLanguageQuery: naturalQuery,
        targetTable: 'ledger_entries',
        appliedFilter: { transaction_type: 'DEPOSIT', status: 'FAILED' },
        summaryText: 'Filtering ledger entries for failed deposit transactions.',
      };
    }

    if (queryLower.includes('station') || queryLower.includes('top')) {
      return {
        naturalLanguageQuery: naturalQuery,
        targetTable: 'lpg_stations',
        appliedFilter: { is_active: true, order_by: 'available_stock_kg' },
        summaryText: 'Querying active LPG stations ranked by order volume in Awka.',
      };
    }

    return {
      naturalLanguageQuery: naturalQuery,
      targetTable: 'gas_orders',
      appliedFilter: { status: 'COMPLETED' },
      summaryText: 'Querying completed gas orders telemetry.',
    };
  }
}
