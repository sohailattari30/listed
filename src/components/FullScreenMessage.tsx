import type { ReactNode } from 'react';

export function FullScreenMessage({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: '60dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28, fontSize: 15, fontWeight: 600, color: 'var(--muted)', textAlign: 'center' }}>
      {children}
    </div>
  );
}
