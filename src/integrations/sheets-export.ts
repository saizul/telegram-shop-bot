import type { SheetsClient } from '../google/sheets.js';
import type { Order } from '../shop/types.js';
import type { OrderEvent, OrderEventSink } from './events.js';

/** Column order of the Orders sheet. Put this as the header row of the tab. */
export const ORDER_COLUMNS = [
  'order_id',
  'created_at',
  'status',
  'customer_name',
  'phone',
  'district',
  'address',
  'items',
  'subtotal',
  'delivery_fee',
  'total',
  'payment',
  'bkash_trx_id',
  'telegram_user_id',
  'telegram_username',
  'event',
] as const;

export function orderToRow(order: Order, event: OrderEvent['type']): Array<string | number> {
  return [
    order.id,
    order.createdAt,
    order.status,
    order.customer.name,
    order.customer.phone,
    order.customer.district,
    order.customer.address,
    order.lines.map((l) => `${l.qty} x ${l.name} (${l.productId})`).join('; '),
    order.subtotal,
    order.deliveryFee,
    order.total,
    order.payment.method,
    order.payment.bkashTrxId ?? '',
    order.userId,
    order.username ?? '',
    event,
  ];
}

export interface SheetsExportOptions {
  spreadsheetId: string;
  /** Default `Orders!A1`. */
  range?: string;
  /** Also append a row on every status change (an audit log). Default true. */
  logStatusChanges?: boolean;
}

/** Appends one row per order (and optionally per status change) to a Google Sheet. */
export class SheetsOrderSink implements OrderEventSink {
  readonly name = 'google-sheets';
  constructor(
    private readonly sheets: SheetsClient,
    private readonly options: SheetsExportOptions,
  ) {}

  async handle(event: OrderEvent): Promise<void> {
    if (event.type === 'order.status_changed' && this.options.logStatusChanges === false) return;
    await this.sheets.appendValues(this.options.spreadsheetId, this.options.range ?? 'Orders!A1', [
      orderToRow(event.order, event.type),
    ]);
  }
}
