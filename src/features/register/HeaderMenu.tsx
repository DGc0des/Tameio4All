import { useEffect, useRef, useState } from 'react';
import { THEME_LABELS } from '../../app/theme';
import type { ThemePref } from '../../data/local/prefs';
import { Sheet } from '../../ui/Sheet';

interface Props {
  themePref: ThemePref;
  onTheme: () => void;
  onOwner: () => void;
}

export function HeaderMenu({ themePref, onTheme, onOwner }: Props) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrapRef}>
      <button type="button" className="icon-btn" aria-label="Μενού" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <div className="menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onOwner();
            }}
          >
            Διαχείριση καταστήματος
          </button>
          <button type="button" role="menuitem" onClick={onTheme}>
            Θέμα: {THEME_LABELS[themePref]}
          </button>
        </div>
      )}
    </div>
  );
}

/** Opened from the header's date · cashier button: hands the phone to another person. */
export function CashierSheet({ name, onSignOut, onClose }: { name: string; onSignOut: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <Sheet title={name} onClose={onClose}>
      <div className="sheet-actions">
        <button
          type="button"
          className="btn btn-primary"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onSignOut();
          }}
        >
          Αλλαγή ατόμου
        </button>
      </div>
    </Sheet>
  );
}
