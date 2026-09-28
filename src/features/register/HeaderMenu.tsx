import { useState } from 'react';
import type { Route } from '../../app/router';
import { THEME_LABELS } from '../../app/theme';
import type { ThemePref } from '../../data/local/prefs';

interface Props {
  hasTare: boolean;
  themePref: ThemePref;
  onNavigate: (route: Route) => void;
  onTheme: () => void;
}

export function HeaderMenu({ hasTare, themePref, onNavigate, onTheme }: Props) {
  const [open, setOpen] = useState(false);
  const go = (route: Route) => {
    setOpen(false);
    onNavigate(route);
  };
  return (
    <div className="menu-wrap">
      <button type="button" className="icon-btn" aria-label="Μενού" aria-expanded={open} onClick={() => setOpen(!open)}>
        ⋯
      </button>
      {open && (
        <div className="menu" role="menu">
          {hasTare && (
            <button type="button" role="menuitem" onClick={() => go('tare')}>
              Αποβάρα
            </button>
          )}
          <button type="button" role="menuitem" onClick={() => go('staff')}>
            Προσωπικό
          </button>
          <button type="button" role="menuitem" onClick={onTheme}>
            Θέμα: {THEME_LABELS[themePref]}
          </button>
        </div>
      )}
    </div>
  );
}
