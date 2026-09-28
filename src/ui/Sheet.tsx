import { useEffect, type ReactNode } from 'react';

interface Props {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}

/** Bottom sheet over the page. Escape or a tap on the dimmed backdrop closes it. */
export function Sheet({ title, subtitle, onClose, children }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="sheet-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-grab" aria-hidden="true" />
        <h2>{title}</h2>
        {subtitle !== undefined && <p className="sub">{subtitle}</p>}
        {children}
      </div>
    </div>
  );
}
