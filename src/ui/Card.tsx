import type { ReactNode } from 'react';

export function Card({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      {title !== undefined && (
        <div className="card-head">
          <h2>{title}</h2>
          {aside !== undefined && <span>{aside}</span>}
        </div>
      )}
      {children}
    </section>
  );
}
