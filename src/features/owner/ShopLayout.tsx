import { useEffect, useState, type FormEvent } from 'react';
import type { ShopTab } from '../../app/router';
import type { KeyValueStore } from '../../data/local/storage';
import type { OwnerApi } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { checkName, SHOP_NAME_MAX } from './model/limits';
import { nameProblemMessage, ownerErrorMessage } from './model/messages';
import { DevicesScreen } from './DevicesScreen';
import { ErrorText, OwnerHeader, type OwnerNavigate } from './OwnerUi';
import { OwnerStaffScreen } from './OwnerStaffScreen';
import { SettingsScreen } from './settings/SettingsScreen';
import { useAction } from './useAction';

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

const TABS: { tab: ShopTab; label: string }[] = [
  { tab: 'settings', label: 'Ρυθμίσεις' },
  { tab: 'staff', label: 'Προσωπικό' },
  { tab: 'devices', label: 'Συσκευές' },
];

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'missing' } | { status: 'ready'; name: string };

export function ShopLayout({ api, shopId, tab, navigate, store, now, email, onSignOut }: ShopLayoutProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const rename = useAction();

  useEffect(() => {
    let cancelled = false;
    void api.listShops().then((r) => {
      if (cancelled) return;
      if (!r.ok) return setLoad({ status: 'error', message: ownerErrorMessage(r.error) });
      const shop = r.data.find((s) => s.id === shopId);
      setLoad(shop ? { status: 'ready', name: shop.name } : { status: 'missing' });
    });
    return () => {
      cancelled = true;
    };
  }, [api, shopId]);

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    const n = checkName(draftName, SHOP_NAME_MAX);
    if (!n.ok) return rename.fail(nameProblemMessage(n.problem, SHOP_NAME_MAX));
    const r = await rename.run(() => api.renameShop(shopId, n.value));
    if (r.ok) {
      setLoad({ status: 'ready', name: n.value });
      setRenaming(false);
    }
  };

  const back = () => navigate({ name: 'shops' });
  if (load.status !== 'ready') {
    return (
      <div className="app">
        <OwnerHeader title="Κατάστημα" onBack={back} />
        <main className="page">
          {load.status === 'loading' && <p className="notice-soft">Φόρτωση…</p>}
          {load.status === 'missing' && <p className="notice-soft">Το κατάστημα δεν βρέθηκε.</p>}
          {load.status === 'error' && (
            <p className="form-error" role="alert">
              {load.message}
            </p>
          )}
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <OwnerHeader
        title={load.name}
        onBack={back}
        right={
          <button
            type="button"
            className="icon-btn"
            aria-label="Μετονομασία καταστήματος"
            onClick={() => {
              setDraftName(load.name);
              setRenaming(true);
            }}
          >
            ✎
          </button>
        }
      />
      {renaming && (
        <Card>
          <form className="form" onSubmit={saveName} noValidate>
            <input className="text-field" aria-label="Νέο όνομα καταστήματος" value={draftName} onChange={(e) => setDraftName(e.target.value)} />
            <div className="sheet-actions">
              <button type="button" className="btn btn-text" onClick={() => setRenaming(false)}>
                Άκυρο
              </button>
              <button type="submit" className="btn btn-primary" aria-label="Αποθήκευση ονόματος" disabled={rename.busy}>
                Αποθήκευση
              </button>
            </div>
            <ErrorText state={rename.state} />
          </form>
        </Card>
      )}
      <nav className="tabs" aria-label="Ενότητες καταστήματος">
        {TABS.map((t) => (
          <button key={t.tab} type="button" aria-current={t.tab === tab ? 'page' : undefined} onClick={() => navigate({ name: 'shop', shopId, tab: t.tab })}>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="page">
        <TabBody tab={tab} api={api} shopId={shopId} store={store} now={now} />
      </main>
      <footer className="notice-soft" style={{ padding: '0 12px 16px' }}>
        {email ?? ''}{' '}
        <button type="button" className="link" onClick={onSignOut}>
          Αποσύνδεση
        </button>
      </footer>
    </div>
  );
}

function TabBody({ tab, api, shopId, store, now }: { tab: ShopTab; api: OwnerApi; shopId: string; store: KeyValueStore; now: () => Date }) {
  if (tab === 'settings') return <SettingsScreen key={shopId} api={api} shopId={shopId} store={store} now={now} />;
  if (tab === 'staff') return <OwnerStaffScreen api={api} shopId={shopId} now={now} />;
  return <DevicesScreen api={api} shopId={shopId} now={now} />;
}
