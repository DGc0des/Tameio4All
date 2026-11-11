import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { ShopTab } from '../../app/router';
import type { KeyValueStore } from '../../data/local/storage';
import type { OwnerApi } from '../../data/remote/ownerApi';
import { Card } from '../../ui/Card';
import { checkName, SHOP_NAME_MAX } from './model/limits';
import { nameProblemMessage, ownerErrorMessage } from './model/messages';
import { DevicesScreen } from './DevicesScreen';
import { ErrorText, OwnerHeader, type OwnerNavigate } from './OwnerUi';
import { OwnerStaffScreen } from './OwnerStaffScreen';
import { DayScreen } from './history/DayScreen';
import { HistoryScreen, type HistoryRange } from './history/HistoryScreen';
import { TodayScreen } from './TodayScreen';
import { SettingsScreen } from './settings/SettingsScreen';
import { useAction } from './useAction';

export interface ShopLayoutProps {
  api: OwnerApi;
  shopId: string;
  tab: ShopTab;
  /** A day of the history tab (`#/owner/shop/<id>/history/<date>`). */
  date?: string;
  navigate: OwnerNavigate;
  store: KeyValueStore;
  now: () => Date;
  email: string | null;
  onSignOut: () => void;
  /** Leaves the owner area back to the register. */
  onExit: () => void;
}

const TABS: { tab: ShopTab; label: string }[] = [
  { tab: 'today', label: 'Σήμερα' },
  { tab: 'history', label: 'Ιστορικό' },
  { tab: 'settings', label: 'Ρυθμίσεις' },
  { tab: 'staff', label: 'Προσωπικό' },
  { tab: 'devices', label: 'Συσκευές' },
];

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'missing' } | { status: 'ready'; name: string };

export function ShopLayout({ api, shopId, tab, date, navigate, store, now, email, onSignOut, onExit }: ShopLayoutProps) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const rename = useAction();
  /** The history week shown (its Monday and Sunday), kept here because the list unmounts while a day is open. Per shop. */
  const [historyRange, setHistoryRange] = useState<({ shopId: string } & HistoryRange) | null>(null);
  const keepHistoryRange = useCallback((from: string, to: string) => setHistoryRange({ shopId, from, to }), [shopId]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    void api.listShops().then((r) => {
      if (cancelled) return;
      if (!r.ok) return setLoad({ status: 'error', message: ownerErrorMessage(r.error) });
      const shop = r.data.find((s) => s.id === shopId);
      setLoad(shop ? { status: 'ready', name: shop.name } : { status: 'missing' });
    });
    return () => {
      cancelled = true;
    };
  }, [api, shopId, attempt]);

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
            <>
              <p className="form-error" role="alert">
                {load.message}
              </p>
              <button type="button" className="btn btn-text" onClick={retry}>
                Ξανά
              </button>
            </>
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
        <TabBody
          tab={tab}
          date={date}
          api={api}
          shopId={shopId}
          shopName={load.name}
          navigate={navigate}
          store={store}
          now={now}
          historyRange={historyRange?.shopId === shopId ? historyRange : null}
          onHistoryRange={keepHistoryRange}
        />
      </main>
      <footer className="notice-soft" style={{ padding: '0 12px 16px' }}>
        <button type="button" className="link" onClick={onExit}>
          ← Ταμείο
        </button>{' '}
        · {email ?? ''}{' '}
        <button type="button" className="link" onClick={onSignOut}>
          Αποσύνδεση
        </button>
      </footer>
    </div>
  );
}

interface TabBodyProps {
  tab: ShopTab;
  date?: string;
  api: OwnerApi;
  shopId: string;
  shopName: string;
  navigate: OwnerNavigate;
  store: KeyValueStore;
  now: () => Date;
  historyRange: HistoryRange | null;
  onHistoryRange: (from: string, to: string) => void;
}

function TabBody({ tab, date, api, shopId, shopName, navigate, store, now, historyRange, onHistoryRange }: TabBodyProps) {
  if (tab === 'today') return <TodayScreen key={shopId} api={api} shopId={shopId} store={store} now={now} />;
  if (tab === 'history') {
    return date ? (
      <DayScreen key={shopId + date} api={api} shopId={shopId} date={date} navigate={navigate} now={now} />
    ) : (
      <HistoryScreen key={shopId} api={api} shopId={shopId} navigate={navigate} initialRange={historyRange} onRangeLoaded={onHistoryRange} />
    );
  }
  if (tab === 'settings') return <SettingsScreen key={shopId} api={api} shopId={shopId} store={store} now={now} />;
  if (tab === 'staff') return <OwnerStaffScreen api={api} shopId={shopId} now={now} />;
  return <DevicesScreen api={api} shopId={shopId} shopName={shopName} />;
}
