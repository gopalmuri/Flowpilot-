import React from 'react';
import type { Capability } from './landingContent';

/** List of capabilities. Implemented items carry no badge; anything not implemented is visibly marked 'Planned'. */
export const CapabilityList: React.FC<{ items: Capability[] }> = ({ items }) => (
  <ul className="list-none m-0 p-0 grid gap-2">
    {items.map((c) => (
      <li
        key={c.name}
        className="rounded-lg px-3.5 py-2.5"
        style={{ background: 'var(--lp-surface-2)', border: '1px solid var(--lp-border)' }}
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-[15px] font-semibold">{c.name}</span>
          {c.status === 'planned' && <span className="lp-chip lp-chip--plan">Planned</span>}
        </div>
        <p className="lp-label mt-0.5" style={{ color: 'var(--lp-text-2)' }}>
          {c.detail}
        </p>
      </li>
    ))}
  </ul>
);
