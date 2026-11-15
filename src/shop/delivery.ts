import type { DeliveryZone } from './types.js';

export interface DeliveryConfig {
  /** Fee for districts in `insideDistricts`. */
  insideFee: number;
  /** Fee everywhere else. */
  outsideFee: number;
  /** District ids treated as "inside Dhaka". Default `['dhaka']`. */
  insideDistricts: string[];
  /** Orders with a subtotal at or above this get free delivery. `undefined` = never. */
  freeAbove?: number;
}

export const DEFAULT_DELIVERY: DeliveryConfig = {
  insideFee: 70,
  outsideFee: 130,
  insideDistricts: ['dhaka'],
};

export function zoneFor(districtId: string, config: DeliveryConfig): DeliveryZone {
  return config.insideDistricts.includes(districtId) ? 'inside' : 'outside';
}

export function deliveryFee(districtId: string, subtotal: number, config: DeliveryConfig): { zone: DeliveryZone; fee: number } {
  const zone = zoneFor(districtId, config);
  if (config.freeAbove !== undefined && subtotal >= config.freeAbove) return { zone, fee: 0 };
  return { zone, fee: zone === 'inside' ? config.insideFee : config.outsideFee };
}
