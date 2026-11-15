import type { Lang } from '../i18n/strings.js';

export interface CartItem {
  productId: string;
  qty: number;
}

export type CheckoutStep = 'profile' | 'name' | 'phone' | 'district' | 'address' | 'payment' | 'bkash' | 'confirm';

export type PaymentMethod = 'cod' | 'bkash';

export type DeliveryZone = 'inside' | 'outside';

export interface CustomerProfile {
  name: string;
  /** Local format, 01XXXXXXXXX. */
  phone: string;
  districtId: string;
  address: string;
}

export interface CheckoutDraft {
  step: CheckoutStep;
  startedAt: number;
  name?: string;
  phone?: string;
  districtId?: string;
  /** Division currently shown in the district picker. */
  divisionId?: string;
  address?: string;
  payment?: PaymentMethod;
  bkashTrxId?: string;
}

export interface Session {
  userId: number;
  chatId: number;
  lang: Lang;
  checkout?: CheckoutDraft;
  profile?: CustomerProfile;
  updatedAt: number;
}

export type OrderStatus = 'pending' | 'confirmed' | 'shipped' | 'delivered' | 'cancelled';

export interface OrderLine {
  productId: string;
  name: string;
  unitPrice: number;
  qty: number;
  total: number;
}

export interface Order {
  id: string;
  userId: number;
  chatId: number;
  username?: string;
  lang: Lang;
  status: OrderStatus;
  lines: OrderLine[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  zone: DeliveryZone;
  customer: {
    name: string;
    phone: string;
    districtId: string;
    district: string;
    address: string;
  };
  payment: { method: PaymentMethod; bkashTrxId?: string };
  createdAt: string;
  updatedAt: string;
  history: Array<{ status: OrderStatus; at: string; by?: number }>;
  /** Admin group message, so status changes can edit it. */
  adminMessage?: { chatId: number; messageId: number };
}
