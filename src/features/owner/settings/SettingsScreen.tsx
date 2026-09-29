import { useCallback, useEffect, useMemo, useState } from 'react';
import { newShopConfig, validateConfig, type ShopConfig } from '../../../core/config';
import { clearOwnerDraft, loadOwnerDraft, saveOwnerDraft, type OwnerDraft } from '../../../data/local/ownerDrafts';
import type { KeyValueStore } from '../../../data/local/storage';
import type { OwnerApi } from '../../../data/remote/ownerApi';
import { Card } from '../../../ui/Card';
import { Sheet } from '../../../ui/Sheet';
import { configErrorMessage, configErrorSection, ownerErrorMessage, type SettingsSection } from '../model/messages';
import { applySettings, isEditableConfig, type SettingsAction } from '../model/settingsDraft';
import { ErrorText } from '../OwnerUi';
import { useAction } from '../useAction';
import { ChannelsSection } from './ChannelsSection';
import { GeneralSection } from './GeneralSection';
import { PreviewCard } from './PreviewCard';
import { TareSection } from './TareSection';
import { TotalsSection } from './TotalsSection';

interface Props {
  api: OwnerApi;
  shopId: string;
  store: KeyValueStore;
  now: () => Date;
}

interface Server {
  version: number;
  /** null when the stored config is structurally unreadable. */
  config: ShopConfig | null;
}

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; server: Server };

const same = (a: ShopConfig | null, b: ShopConfig): boolean => a !== null && JSON.stringify(a) === JSON.stringify(b);

export function SettingsScreen({ api, shopId, store, now }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [draft, setDraft] = useState<{ config: ShopConfig; baseVersion: number } | null>(null);
  const [offer, setOffer] = useState<OwnerDraft | null>(null);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [conflict, setConflict] = useState<number | null | undefined>(undefined);
  const [published, setPublished] = useState<number | null>(null);
  const [formKey, setFormKey] = useState(0);
  const publish = useAction();

  const startFrom = useCallback((server: Server) => {
    setDraft({ config: server.config ?? newShopConfig(), baseVersion: server.version });
    setFormKey((k) => k + 1);
  }, []);

  const fetchLatest = useCallback(async (): Promise<Server | null> => {
    const r = await api.latestConfig(shopId);
    if (!r.ok) {
      setLoad({ status: 'error', message: ownerErrorMessage(r.error) });
      return null;
    }
    const version = r.data?.version ?? 0;
    const raw = r.data?.config;
    const server: Server = { version, config: r.data === null ? newShopConfig() : isEditableConfig(raw) ? raw : null };
    setLoad({ status: 'ready', server });
    return server;
  }, [api, shopId]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    void fetchLatest().then((server) => {
      if (cancelled || server === null) return;
      const saved = loadOwnerDraft(store, shopId);
      if (saved && saved.baseVersion === server.version) {
        setDraft({ config: saved.config, baseVersion: saved.baseVersion });
        setFormKey((k) => k + 1);
      } else {
        startFrom(server);
        if (saved && !same(server.config, saved.config)) setOffer(saved);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchLatest, store, shopId, startFrom, attempt]);

  const server = load.status === 'ready' ? load.server : null;
  const errors = useMemo(() => (draft ? validateConfig(draft.config) : []), [draft]);
  const dirty = draft !== null && server !== null && !same(server.config, draft.config);

  const dispatch = (action: SettingsAction) => {
    if (!draft) return;
    const r = applySettings(draft.config, action);
    setBlocked(r.blockedBy);
    setPublished(null);
    if (r.blockedBy.length > 0) return;
    const next = { config: r.config, baseVersion: draft.baseVersion };
    setDraft(next);
    if (server && same(server.config, r.config)) clearOwnerDraft(store, shopId);
    else saveOwnerDraft(store, shopId, { ...next, savedAt: now().getTime() });
  };

  const doPublish = async (baseVersion: number) => {
    if (!draft) return;
    const config = draft.config;
    const r = await publish.run(() => api.publishConfig(shopId, baseVersion, config));
    if (r.ok) {
      setLoad({ status: 'ready', server: { version: r.data, config } });
      setDraft({ config, baseVersion: r.data });
      clearOwnerDraft(store, shopId);
      setPublished(r.data);
      setConflict(undefined);
    } else if (r.error.code === 'version_conflict') {
      publish.clear();
      setConflict(r.error.currentVersion);
    }
  };

  const loadNewer = async () => {
    setConflict(undefined);
    const latest = await fetchLatest();
    if (latest) {
      clearOwnerDraft(store, shopId);
      startFrom(latest);
    }
  };

  const overwrite = async () => {
    let version = conflict;
    if (version === null || version === undefined) {
      const r = await api.latestConfig(shopId);
      version = r.ok ? (r.data?.version ?? 0) : null;
      if (version === null) return publish.fail('Δεν βρέθηκε η τρέχουσα έκδοση. Δοκίμασε ξανά.');
    }
    setConflict(undefined);
    if (draft) {
      saveOwnerDraft(store, shopId, { config: draft.config, baseVersion: version, savedAt: now().getTime() });
      setDraft({ ...draft, baseVersion: version });
    }
    await doPublish(version);
  };

  if (load.status === 'loading' || (load.status === 'ready' && draft === null)) return <p className="notice-soft">Φόρτωση…</p>;
  if (load.status === 'error') {
    return (
      <Card>
        <p className="form-error" role="alert">
          {load.message}
        </p>
        <button type="button" className="btn btn-text" onClick={() => setAttempt((n) => n + 1)}>
          Ξανά
        </button>
      </Card>
    );
  }
  if (!draft || !server) return null;

  const bySection = (s: SettingsSection): string[] =>
    [...new Set(errors.filter((e) => configErrorSection(e) === s).map((e) => configErrorMessage(e, draft.config)))];
  const sectionProps = (s: SettingsSection) => ({ config: draft.config, dispatch, errors: bySection(s) });

  return (
    <div key={formKey}>
      <p className="notice-soft">
        Έκδοση {server.version}
        {dirty ? ' · μη δημοσιευμένες αλλαγές' : ''}
      </p>
      {server.config === null && (
        <p className="notice" role="note">
          Οι αποθηκευμένες ρυθμίσεις δεν μπόρεσαν να διαβαστούν — ξεκινάς από κενές. Η δημοσίευση τις αντικαθιστά.
        </p>
      )}
      {offer && (
        <Card>
          <p>Βρέθηκε μη δημοσιευμένο πρόχειρο από την έκδοση {offer.baseVersion}. Στο μεταξύ δημοσιεύτηκε η έκδοση {server.version}.</p>
          <div className="sheet-actions">
            <button
              type="button"
              className="btn btn-text"
              onClick={() => {
                clearOwnerDraft(store, shopId);
                setOffer(null);
              }}
            >
              Απόρριψη
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setDraft({ config: offer.config, baseVersion: server.version });
                saveOwnerDraft(store, shopId, { config: offer.config, baseVersion: server.version, savedAt: now().getTime() });
                setOffer(null);
                setFormKey((k) => k + 1);
              }}
            >
              Συνέχεια πρόχειρου
            </button>
          </div>
        </Card>
      )}
      {!offer && (
        <>
          {blocked.length > 0 && (
            <p className="form-error" role="alert">
              Δεν γίνεται διαγραφή: χρησιμοποιείται στο {blocked.join(', ')}.
            </p>
          )}
          <GeneralSection {...sectionProps('general')} />
          <ChannelsSection {...sectionProps('channels')} />
          <TotalsSection {...sectionProps('totals')} />
          <PreviewCard config={draft.config} />
          <TareSection {...sectionProps('tare')} />

          <div className="publish-bar">
            <p>{published !== null ? `Δημοσιεύτηκε η έκδοση ${published}.` : errors.length > 0 ? 'Διόρθωσε τα λάθη για να δημοσιεύσεις.' : dirty ? 'Οι αλλαγές ισχύουν στα ταμεία μετά τη δημοσίευση.' : 'Καμία αλλαγή.'}</p>
            <button type="button" className="btn btn-primary" disabled={!dirty || errors.length > 0 || publish.busy} onClick={() => void doPublish(draft.baseVersion)}>
              Δημοσίευση
            </button>
          </div>
          <ErrorText state={publish.state} />
        </>
      )}

      {conflict !== undefined && (
        <Sheet title="Οι ρυθμίσεις άλλαξαν" subtitle={ownerErrorMessage({ code: 'version_conflict', currentVersion: conflict })} onClose={() => setConflict(undefined)}>
          <p className="notice-soft">Κάποιος δημοσίευσε ρυθμίσεις από άλλη καρτέλα ή συσκευή όσο έκανες αλλαγές.</p>
          <div className="sheet-actions">
            <button type="button" className="btn btn-text" onClick={() => void loadNewer()}>
              Φόρτωση νέας
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void overwrite()}>
              Δημοσίευση πάνω της
            </button>
          </div>
        </Sheet>
      )}
    </div>
  );
}
