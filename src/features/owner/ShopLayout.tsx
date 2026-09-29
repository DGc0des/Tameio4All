import type { ShopTab } from '../../app/router';
import type { KeyValueStore } from '../../data/local/storage';
import type { OwnerApi } from '../../data/remote/ownerApi';
import { OwnerHeader, type OwnerNavigate } from './OwnerUi';

export interface ShopLayoutProps {
  api: OwnerApi;
  shopId: string;
  tab: ShopTab;
  navigate: OwnerNavigate;
  store: KeyValueStore;
  now: () => Date;
  email: string | null;
  onSignOut: () => void;
}

export function ShopLayout(_: ShopLayoutProps) {
  return <OwnerHeader title="Κατάστημα" />;
}
