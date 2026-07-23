/**
 * SKIMA NOTIFICATION TEMPLATE ENGINE
 * Manages reusable multi-channel notification templates (In-App, Push, SMS, Email, WhatsApp)
 * for order status events, escrow releases, wallet deposits, bill payments, and security alerts.
 */

export type NotificationChannel = 'IN_APP' | 'SMS' | 'EMAIL' | 'PUSH' | 'WHATSAPP';
export type NotificationEventType =
  | 'ORDER_CREATED'
  | 'DRIVER_ASSIGNED'
  | 'CYLINDER_PICKED_UP'
  | 'STATION_REFILL_COMPLETED'
  | 'RETURN_DELIVERY_IN_TRANSIT'
  | 'ORDER_COMPLETED'
  | 'WALLET_FUNDED'
  | 'ESCROW_LOCKED'
  | 'ESCROW_RELEASED'
  | 'BILL_PAYMENT_SUCCESS'
  | 'MARKETPLACE_ORDER_PLACED'
  | 'SECURITY_ALERT';

export interface NotificationPayload {
  userId: string;
  eventType: NotificationEventType;
  channels: NotificationChannel[];
  title: string;
  body: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export class NotificationEngine {
  /**
   * Builds standardized notification payload for system events.
   */
  public static buildNotification(
    userId: string,
    eventType: NotificationEventType,
    params: { orderPublicId?: string; amountNgn?: number; providerName?: string; extraDetails?: string }
  ): NotificationPayload {
    let title = 'Skima System Update';
    let body = 'You have a new notification from Skima.';
    const channels: NotificationChannel[] = ['IN_APP', 'PUSH'];

    switch (eventType) {
      case 'ORDER_CREATED':
        title = 'Gas Refill Order Placed';
        body = `Order ${params.orderPublicId ?? ''} created. Funds are locked in escrow until refill verification.`;
        break;

      case 'DRIVER_ASSIGNED':
        title = 'Driver Dispatched';
        body = `A driver has accepted your gas refill request for Order ${params.orderPublicId ?? ''}.`;
        break;

      case 'CYLINDER_PICKED_UP':
        title = 'Cylinder Picked Up';
        body = `Driver has picked up your cylinder for Order ${params.orderPublicId ?? ''} and is heading to the station.`;
        break;

      case 'STATION_REFILL_COMPLETED':
        title = 'Refill Completed at Station';
        body = `Cylinder refilled successfully. Gas cost payout released to station wallet.`;
        break;

      case 'RETURN_DELIVERY_IN_TRANSIT':
        title = 'Refilled Cylinder on the Way';
        body = `Driver is returning your refilled cylinder to your delivery location.`;
        break;

      case 'ORDER_COMPLETED':
        title = 'Delivery Confirmed & Completed';
        body = `Order ${params.orderPublicId ?? ''} completed. Thank you for using Skima!`;
        break;

      case 'WALLET_FUNDED':
        title = 'Wallet Funded Successfully';
        body = `Your Skima NGN wallet has been credited with ₦${(params.amountNgn ?? 0).toLocaleString()}.`;
        channels.push('SMS');
        break;

      case 'ESCROW_LOCKED':
        title = 'Escrow Funds Locked';
        body = `₦${(params.amountNgn ?? 0).toLocaleString()} locked in escrow for Order ${params.orderPublicId ?? ''}.`;
        break;

      case 'ESCROW_RELEASED':
        title = 'Escrow Settlement Released';
        body = `₦${(params.amountNgn ?? 0).toLocaleString()} released from escrow to your wallet.`;
        break;

      case 'BILL_PAYMENT_SUCCESS':
        title = 'Bill Payment Successful';
        body = `Your ₦${(params.amountNgn ?? 0).toLocaleString()} ${params.providerName ?? 'utility'} bill payment was completed.`;
        break;

      case 'MARKETPLACE_ORDER_PLACED':
        title = 'Marketplace Order Confirmed';
        body = `Marketplace order ${params.orderPublicId ?? ''} placed. Escrow locked.`;
        break;

      case 'SECURITY_ALERT':
        title = 'Security Alert';
        body = params.extraDetails ?? 'A new login or role switch was detected on your Skima account.';
        channels.push('SMS', 'EMAIL');
        break;
    }

    return {
      userId,
      eventType,
      channels,
      title,
      body,
      metadata: params,
      createdAt: new Date().toISOString(),
    };
  }
}
