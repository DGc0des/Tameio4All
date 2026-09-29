import type { OwnerApi } from '../../data/remote/ownerApi';
import { OwnerHeader, type OwnerNavigate } from './OwnerUi';

export function ShopsScreen({ onSignOut }: { api: OwnerApi; navigate: OwnerNavigate; autoOpen: boolean; onLoaded: () => void; onSignOut: () => void }) {
  return (
    <div className="app">
      <OwnerHeader title="Καταστήματα" right={<button type="button" className="link" onClick={onSignOut}>Αποσύνδεση</button>} />
    </div>
  );
}
