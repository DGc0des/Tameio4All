import { newShopConfig, type ChannelType, type ShopConfig } from '../../../core/config';
import type { Cents } from '../../../core/money';

export interface FirstSetupChannel {
  label: string;
  type: ChannelType;
}

/**
 * The config a new shop starts with. Totals are core's defaultTotals(): they reference channel
 * *types*, so ΤΑΜΕΙΟ/ΜΕΤΡΗΤΑ are right for any channels without per-channel edits.
 */
export function buildFirstConfig(input: { floatCents: Cents; channels: FirstSetupChannel[] }): ShopConfig {
  return {
    ...newShopConfig(),
    floatCents: input.floatCents,
    channels: input.channels.map((c, i) => ({ id: `ch_${i + 1}`, label: c.label.trim(), type: c.type })),
  };
}
