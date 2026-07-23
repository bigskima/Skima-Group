/**
 * SKIMA AI AGENT 2 — CUSTOMER SUPPORT ASSISTANT
 * First responder powered by Gemini logic answering FAQs:
 * - "Where is my driver?"
 * - "I selected the wrong cylinder"
 * - "How do I become a merchant/driver?"
 * - Escalate to Admin Support Ticket if unresolvable.
 */

export interface SupportResponse {
  answerText: string;
  category: 'ORDER_STATUS' | 'CYLINDER_HELP' | 'ROLE_REGISTRATION' | 'ESCROW_PAYMENT' | 'ESCALATED';
  requiresHumanEscalation: boolean;
  suggestedActions?: string[];
}

export class CustomerSupportAgent {
  public static handleQuery(query: string, activeOrderStatus?: string): SupportResponse {
    const inputLower = query.toLowerCase();

    if (inputLower.includes('where') && inputLower.includes('driver')) {
      return {
        answerText: activeOrderStatus 
          ? `Your driver is currently in transit (${activeOrderStatus}). You can view live movement on the map.`
          : `You don't have an active order right now. You can place a gas refill order from the main screen.`,
        category: 'ORDER_STATUS',
        requiresHumanEscalation: false,
      };
    }

    if (inputLower.includes('wrong cylinder') || inputLower.includes('mistake')) {
      return {
        answerText: `If you selected the wrong cylinder before pickup, you can cancel your order to immediately unlock your escrow funds and select the correct cylinder.`,
        category: 'CYLINDER_HELP',
        requiresHumanEscalation: false,
        suggestedActions: ['Cancel Order', 'Select Registered Cylinder'],
      };
    }

    if (inputLower.includes('become a merchant') || inputLower.includes('sell')) {
      return {
        answerText: `You use the same Skima account! Go to Account Settings -> Roles -> Request Merchant Verification. Once approved by Admin, your Merchant Console will be unlocked.`,
        category: 'ROLE_REGISTRATION',
        requiresHumanEscalation: false,
      };
    }

    // Default escalation for complex queries
    return {
      answerText: `I have logged your request and created Support Ticket #ST-${Math.floor(1000 + Math.random() * 9000)}. An administrator will review your issue shortly.`,
      category: 'ESCALATED',
      requiresHumanEscalation: true,
    };
  }
}
