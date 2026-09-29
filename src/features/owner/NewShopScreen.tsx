import type { OwnerApi } from '../../data/remote/ownerApi';
import { OwnerHeader, type OwnerNavigate } from './OwnerUi';

export function NewShopScreen(_: { api: OwnerApi; navigate: OwnerNavigate }) {
  return <OwnerHeader title="Νέο κατάστημα" />;
}
