import { useCallback, useEffect, useRef, useState } from 'react';
import { inviteLink, inviteMailto } from '../../../app/inviteToken';
import { mapError } from '../../../data/remote/errors';
import type { MemberRow, OwnerApi } from '../../../data/remote/ownerApi';
import { Card } from '../../../ui/Card';
import { Sheet } from '../../../ui/Sheet';
import { checkName, isEmail } from '../model/limits';
import { ownerErrorMessage } from '../model/messages';
import { ROLE_LABEL, type MemberRole } from '../model/roles';
import { ErrorText } from '../OwnerUi';
import { useAction } from '../useAction';

interface Props {
  api: OwnerApi;
  shopId: string;
  shopName: string;
  /** origin + pathname: the invite link is built on it. */
  redirectBase: string;
}

const ROLES: MemberRole[] = ['manager', 'accountant'];
const STATUS_LABEL: Record<MemberRow['status'], string> = { pending: 'Σε αναμονή', expired: 'Έληξε', active: 'Ενεργός' };
const NAME_MAX = 40;
const COPIED_MS = 2000;

type Load = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; members: MemberRow[] };
type Copy = 'idle' | 'copied' | 'fallback';
interface Shown {
  link: string;
  email: string;
  shopNames: string[];
  role: MemberRole;
}

/** The invite link with copy / share / mail. The owner sends it themselves: the server sends nothing. */
function InviteLink({ shown }: { shown: Shown }) {
  const [copy, setCopy] = useState<Copy>('idle');
  const timer = useRef<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
  }, []);
  useEffect(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    setCopy('idle');
  }, [shown.link]);
  useEffect(() => {
    if (copy !== 'fallback') return;
    input.current?.focus();
    input.current?.select();
  }, [copy]);

  const copyLink = async () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('no clipboard');
      await navigator.clipboard.writeText(shown.link);
      setCopy('copied');
      timer.current = window.setTimeout(() => {
        timer.current = null;
        setCopy((c) => (c === 'copied' ? 'idle' : c));
      }, COPIED_MS);
    } catch {
      setCopy('fallback');
    }
  };
  const share = () => {
    try {
      navigator.share({ title: 'Πρόσκληση στο Tameio4All', url: shown.link }).catch(() => {});
    } catch {
      /* a cancelled share is the person's choice */
    }
  };

  return (
    <div>
      <div className="choices">
        <button type="button" className="choice" onClick={() => void copyLink()}>
          {copy === 'copied' ? 'Αντιγράφηκε' : 'Αντιγραφή συνδέσμου'}
        </button>
        {typeof navigator.share === 'function' && (
          <button type="button" className="choice" onClick={share}>
            Κοινοποίηση
          </button>
        )}
        <a className="choice" href={inviteMailto(shown.email, shown.shopNames, shown.role, shown.link)}>
          Αποστολή με email
        </a>
      </div>
      {copy === 'fallback' && (
        <input ref={input} className="field text wide" aria-label="Σύνδεσμος πρόσκλησης" readOnly value={shown.link} onFocus={(e) => e.currentTarget.select()} />
      )}
      <p className="notice-soft">Ο σύνδεσμος ισχύει 7 ημέρες. Στείλ' τον μόνο σε αυτό το άτομο.</p>
    </div>
  );
}

/** Owner only: who else may use this shop, and the invite form. */
export function MembersCard({ api, shopId, shopName, redirectBase }: Props) {
  const [load, setLoad] = useState<Load>({ status: 'loading' });
  const [ownedShops, setOwnedShops] = useState<{ id: string; name: string }[]>([{ id: shopId, name: shopName }]);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('manager');
  const [picked, setPicked] = useState<string[]>([shopId]);
  const [shown, setShown] = useState<Shown | null>(null);
  const [removing, setRemoving] = useState<MemberRow | null>(null);
  const invite = useAction();
  const manage = useAction();
  const busy = useRef(false);

  const reload = useCallback(async () => {
    try {
      const r = await api.listMembers(shopId);
      setLoad(r.ok ? { status: 'ready', members: r.data } : { status: 'error', message: ownerErrorMessage(r.error) });
    } catch (e) {
      setLoad({ status: 'error', message: ownerErrorMessage(mapError(e)) });
    }
  }, [api, shopId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let live = true;
    void api.listShops().then(
      (r) => {
        if (!live || !r.ok) return;
        const owned = r.data.filter((s) => s.role === 'owner').map((s) => ({ id: s.id, name: s.name }));
        if (owned.length > 0) setOwnedShops(owned);
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [api]);

  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const submit = async () => {
    if (busy.current) return;
    const n = checkName(name, NAME_MAX);
    const e = email.trim().toLowerCase();
    if (!n.ok) return invite.fail('Το όνομα είναι κενό ή πολύ μεγάλο.');
    if (!isEmail(e)) return invite.fail('Γράψε ένα έγκυρο email.');
    if (picked.length === 0) return invite.fail('Διάλεξε τουλάχιστον ένα κατάστημα.');
    busy.current = true;
    try {
      // Keep the list's order, so the shop names match the ids sent.
      const ids = ownedShops.filter((s) => picked.includes(s.id)).map((s) => s.id);
      const r = await invite.run(() => api.inviteMember(ids, e, n.value, role));
      if (!r.ok) return;
      setShown({
        link: inviteLink(redirectBase, r.data),
        email: e,
        shopNames: ownedShops.filter((s) => ids.includes(s.id)).map((s) => s.name),
        role,
      });
      setName('');
      setEmail('');
      void reload();
    } finally {
      busy.current = false;
    }
  };

  const changeRole = async (m: MemberRow, next: MemberRole) => {
    const r = await manage.run(() => api.setMemberRole(m.id, next));
    if (r.ok) void reload();
  };

  const reissue = async (m: MemberRow) => {
    const r = await manage.run(() => api.reissueInvite(m.id));
    if (!r.ok) return;
    setShown({ link: inviteLink(redirectBase, r.data), email: m.email ?? '', shopNames: [shopName], role: m.role });
    void reload();
  };

  const confirmRemove = async () => {
    if (removing === null) return;
    const r = await manage.run(() => api.removeMember(removing.id));
    if (r.ok) {
      setRemoving(null);
      void reload();
    }
  };

  return (
    <Card title="Συνεργάτες">
      {load.status === 'loading' && <p className="notice-soft">Φόρτωση…</p>}
      {load.status === 'error' && (
        <p className="form-error" role="alert">
          {load.message}
        </p>
      )}
      {load.status === 'ready' && (
        <ul className="list">
          {load.members.map((m) => (
            <li key={m.id}>
              <strong>{m.displayName}</strong>
              {m.email !== null && <span> {m.email}</span>}
              <span> · {ROLE_LABEL[m.role]} · </span>
              <span>{STATUS_LABEL[m.status]}</span>
              <div className="choices">
                <select className="text-field" aria-label="Αλλαγή ρόλου" value={m.role} onChange={(e) => void changeRole(m, e.target.value as MemberRole)}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_LABEL[r]}
                    </option>
                  ))}
                </select>
                {m.status !== 'active' && (
                  <button type="button" className="btn btn-text" onClick={() => void reissue(m)}>
                    Νέος σύνδεσμος
                  </button>
                )}
                <button type="button" className="btn btn-text" onClick={() => setRemoving(m)}>
                  Αφαίρεση
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {removing === null && <ErrorText state={manage.state} />}
      {shown !== null && <InviteLink shown={shown} />}
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          Όνομα
          <input className="text-field" value={name} autoComplete="off" onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          Email
          <input className="text-field" inputMode="email" value={email} autoComplete="off" onChange={(e) => setEmail(e.target.value)} />
        </label>
        <div className="choices" role="radiogroup" aria-label="Ρόλος">
          {ROLES.map((r) => (
            <label key={r} className="choice">
              <input type="radio" name="member-role" checked={role === r} onChange={() => setRole(r)} />
              {ROLE_LABEL[r]}
            </label>
          ))}
        </div>
        <div role="group" aria-label="Καταστήματα">
          {ownedShops.map((s) => (
            <label key={s.id} className="choice">
              <input type="checkbox" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
              {s.name}
            </label>
          ))}
        </div>
        <button type="submit" className="btn btn-primary" disabled={invite.busy}>
          Πρόσκληση
        </button>
        <ErrorText state={invite.state} />
      </form>
      {removing !== null && (
        <Sheet
          title="Αφαίρεση συνεργάτη"
          onClose={() => {
            setRemoving(null);
            manage.clear();
          }}
        >
          <p>{`Αφαίρεση του/της ${removing.displayName}; Χάνει αμέσως την πρόσβαση σε αυτό το κατάστημα.`}</p>
          <ErrorText state={manage.state} />
          <div className="sheet-actions">
            <button
              type="button"
              className="btn btn-text"
              onClick={() => {
                setRemoving(null);
                manage.clear();
              }}
            >
              Άκυρο
            </button>
            <button type="button" className="btn btn-primary" disabled={manage.busy} onClick={() => void confirmRemove()}>
              Αφαίρεση
            </button>
          </div>
        </Sheet>
      )}
    </Card>
  );
}
