/**
 * SKIMA AI AGENT 8 — ORDER TIMELINE SUMMARIZER
 * Converts raw event logs into plain, friendly language summaries for customers.
 */

export class TimelineSummarizerAgent {
  public static summarizeOrderStatus(status: string, driverName?: string, stationName?: string): string {
    switch (status) {
      case 'ESCROW_LOCKED':
        return 'Your order has been placed and payment is secured in Escrow. Finding the best driver in Awka.';
      case 'CYLINDER_PICKED_UP':
        return `Driver ${driverName || 'assigned'} collected your cylinder and is heading to the refill station.`;
      case 'AT_STATION':
        return `Your cylinder has arrived at ${stationName || 'the station'} and is being refilled by the pump attendant.`;
      case 'REFILL_COMPLETED':
        return 'Refill verified! Station payout released. Driver is picking up your refilled cylinder.';
      case 'RETURN_IN_TRANSIT':
        return `Driver ${driverName || 'on the way'} is returning your cylinder to your delivery address.`;
      case 'COMPLETED':
        return 'Delivery confirmed! Your cylinder is safely returned and the order is complete.';
      default:
        return 'Your order is being coordinated by Skima.';
    }
  }
}
