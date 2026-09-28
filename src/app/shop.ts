import type { ShopConfig } from '../core/config';
import { joinJuicePreset } from '../core/presets';

export interface LocalShop {
  id: string;
  name: string;
  config: ShopConfig;
}

/** DEV ONLY (Plan 2): the only shop until owner setup arrives in Plan 4. */
export const LOCAL_SHOP: LocalShop = { id: 'local', name: 'Join Juice', config: joinJuicePreset };
