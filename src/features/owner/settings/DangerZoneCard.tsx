import { useState } from 'react';
import { clearShop } from '../../../data/local/openClosing';
import { clearOwnerDraft } from '../../../data/local/ownerDrafts';
import type { KeyValueStore } from '../../../data/local/storage';
import type { OwnerApi } from '../../../data/remote/ownerApi';
import { Card } from '../../../ui/Card';
import { ErrorText, type OwnerNavigate } from '../OwnerUi';
import { useAction } from '../useAction';

interface Props {
  api: OwnerApi;
  shopId: string;
  shopName: string;
  navigate: OwnerNavigate;
  store: KeyValueStore;
}

/** Deletes the shop for good, once its name is typed exactly. */
export function DangerZoneCard({ api, shopId, shopName, navigate, store }: Props) {
  const [typed, setTyped] = useState('');
  const action = useAction();
  const matches = typed.trim() === shopName;

  const remove = async () => {
    const r = await action.run(() => api.deleteShop(shopId, typed.trim()));
    if (!r.ok) return;
    clearShop(store, shopId);
    clearOwnerDraft(store, shopId);
    navigate({ name: 'shops' });
  };

  return (
    <Card title="Διαγραφή καταστήματος">
      <p className="notice-soft">
        Σβήνονται οριστικά το κατάστημα, το προσωπικό, οι συσκευές και όλα τα κλεισίματα. Γράψε το όνομα του καταστήματος
        για επιβεβαίωση.
      </p>
      <div className="form">
        <input
          className="text-field"
          aria-label="Όνομα καταστήματος για επιβεβαίωση"
          placeholder={shopName}
          autoComplete="off"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
        <button type="button" className="btn btn-primary" disabled={!matches || action.busy} onClick={() => void remove()}>
          Διαγραφή καταστήματος
        </button>
        <ErrorText state={action.state} />
      </div>
    </Card>
  );
}
