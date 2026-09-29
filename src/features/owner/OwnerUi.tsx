import { useEffect, type ReactNode } from 'react';
import type { OwnerRoute } from '../../app/router';
import type { ActionState } from './useAction';

export type OwnerNavigate = (route: OwnerRoute, opts?: { replace?: boolean }) => void;

export function OwnerHeader({ title, onBack, right }: { title: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="top">
      {onBack ? (
        <button type="button" className="icon-btn" aria-label="Πίσω" onClick={onBack}>
          ←
        </button>
      ) : (
        <span />
      )}
      <h1>{title}</h1>
      {right ?? <span />}
    </header>
  );
}

export function ErrorText({ state }: { state: ActionState }) {
  if (state.status !== 'error') return null;
  return (
    <p className="form-error" role="alert">
      {state.message}
    </p>
  );
}

/** Declarative redirect: replaces the history entry once rendered. */
export function Go({ to, navigate }: { to: OwnerRoute; navigate: OwnerNavigate }) {
  useEffect(() => {
    navigate(to, { replace: true });
  }, [to, navigate]);
  return null;
}
