import { randomInt } from 'node:crypto';
import type { OrderStatus } from './types.js';

/** Admin actions available from the order notification buttons. */
export type OrderAction = 'confirm' | 'ship' | 'deliver' | 'cancel';

const ACTION_TARGET: Record<OrderAction, OrderStatus> = {
  confirm: 'confirmed',
  ship: 'shipped',
  deliver: 'delivered',
  cancel: 'cancelled',
};

/** Allowed status transitions. Delivered and cancelled are final. */
const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export function isOrderAction(value: string): value is OrderAction {
  return value in ACTION_TARGET;
}

export function targetStatus(action: OrderAction): OrderStatus {
  return ACTION_TARGET[action];
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Buttons to show for an order in a given status. */
export function nextActions(status: OrderStatus): OrderAction[] {
  return (Object.keys(ACTION_TARGET) as OrderAction[]).filter((a) => canTransition(status, ACTION_TARGET[a]));
}

// No 0/O/1/I to keep IDs easy to read over the phone.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Order id like `ORD-261115-7KQ2`: date in Dhaka time plus 4 random characters. */
export function generateOrderId(now: Date = new Date(), random: (max: number) => number = randomInt): string {
  const dhaka = new Date(now.getTime() + 6 * 3600_000);
  const date =
    String(dhaka.getUTCFullYear()).slice(2) +
    String(dhaka.getUTCMonth() + 1).padStart(2, '0') +
    String(dhaka.getUTCDate()).padStart(2, '0');
  let suffix = '';
  for (let i = 0; i < 4; i++) suffix += ALPHABET[random(ALPHABET.length)];
  return `ORD-${date}-${suffix}`;
}

export const ORDER_ID_RE = /^ORD-\d{6}-[2-9A-HJ-NP-Z]{4}$/;
