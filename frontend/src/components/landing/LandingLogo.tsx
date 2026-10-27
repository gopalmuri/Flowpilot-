import React from 'react';
import { Link } from 'react-router-dom';

interface LandingLogoProps {
  descriptor?: boolean;
  onClick?: () => void;
}

export const LandingLogo: React.FC<LandingLogoProps> = ({ descriptor = false, onClick }) => (
  <Link
    to="/"
    onClick={onClick}
    aria-label="FlowPilot home"
    className="inline-flex items-center gap-2.5 min-h-[44px] rounded-lg"
  >
    <span
      className="w-8 h-8 rounded-lg flex items-center justify-center text-white"
      style={{ background: 'var(--lp-brand)' }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
        <polygon points="12 2 19 8 12 14 5 8 12 2" />
        <polyline points="5 15 12 21 19 15" />
      </svg>
    </span>
    <span className="font-bold text-[17px] tracking-tight" style={{ color: 'var(--lp-text)' }}>
      FlowPilot
    </span>
    {descriptor && (
      <span
        className="hidden sm:inline text-[12px] font-semibold tracking-[0.08em] uppercase"
        style={{ color: 'var(--lp-muted)' }}
      >
        Control Plane
      </span>
    )}
  </Link>
);
