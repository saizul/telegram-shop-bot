import type { Logger } from '../logger.js';
import type { Order, OrderStatus } from '../shop/types.js';

export type OrderEvent =
  | { type: 'order.created'; order: Order; at: string }
  | { type: 'order.status_changed'; order: Order; previousStatus: OrderStatus; by?: number; at: string };

/** Something that wants to hear about orders: a spreadsheet, a webhook, a CRM... */
export interface OrderEventSink {
  readonly name: string;
  handle(event: OrderEvent): Promise<void>;
}

/**
 * Sends each event to every sink. A failing sink is logged and never blocks the customer
 * flow or the other sinks.
 */
export class OrderEvents {
  constructor(
    private readonly sinks: OrderEventSink[],
    private readonly logger: Logger,
  ) {}

  async emit(event: OrderEvent): Promise<void> {
    await Promise.all(
      this.sinks.map(async (sink) => {
        try {
          await sink.handle(event);
        } catch (err) {
          this.logger.error('order event sink failed', {
            sink: sink.name,
            event: event.type,
            orderId: event.order.id,
            error: (err as Error).message,
          });
        }
      }),
    );
  }
}
