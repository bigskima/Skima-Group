/**
 * DEPRECATED COMPATIBILITY WRAPPER
 * AI Agent Orchestration is now powered by AiEngine.ts (Location-Agnostic AI Capability).
 */

import { AiEngine } from './AiEngine';

export class AiAgentOrchestrator {
  public static processQuery(
    prompt: string,
    userRole: any = 'CUSTOMER',
    userId: string = 'anon',
    contextData?: any
  ) {
    const res = AiEngine.processQuery(prompt, userRole, userId, contextData);
    return {
      ...res,
      intent: res.intent === 'LOCATION_PARSING' ? 'ADDRESS_PARSING' : res.intent,
    };
  }
}
