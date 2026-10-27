import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ThemeSwitcher } from '../ui/ThemeSwitcher';
import { LandingLogo } from './LandingLogo';
import { NAV_LINKS } from './landingContent';

export const LandingNavbar: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const close = useCallback((returnFocus = false) => {
    setOpen(false);
    if (returnFocus) toggleRef.current?.focus();
  }, []);

  // Esc closes the menu and returns focus to the toggle; an outside click closes it too.
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close(true);
    };
    const onPointer = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !toggleRef.current?.contains(t)) close();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open, close]);

  // Move focus into the menu when it opens.
  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLElement>('a')?.focus();
  }, [open]);

  return (
    <header className="lp-nav">
      <nav aria-label="Primary" className="lp-container">
        <div className="flex items-center justify-between gap-4 h-16">
          <LandingLogo descriptor onClick={() => close()} />

          <ul className="hidden lg:flex items-center gap-1 list-none m-0 p-0">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <a href={l.href} className="lp-navlink">
                  {l.label}
                </a>
              </li>
            ))}
          </ul>

          <div className="hidden lg:flex items-center gap-2">
            <ThemeSwitcher compact />
            {isAuthenticated ? (
              <Link to="/dashboard" className="lp-btn lp-btn--primary lp-btn--sm">
                Dashboard
              </Link>
            ) : (
              <>
                <Link to="/login" className="lp-btn lp-btn--ghost lp-btn--sm">
                  Sign In
                </Link>
                <Link to="/register" className="lp-btn lp-btn--primary lp-btn--sm">
                  Get Started
                </Link>
              </>
            )}
          </div>

          <button
            ref={toggleRef}
            type="button"
            className="lg:hidden inline-flex items-center justify-center w-11 h-11 rounded-lg"
            style={{ color: 'var(--lp-text)' }}
            aria-expanded={open}
            aria-controls={menuId}
            aria-label={open ? 'Close menu' : 'Open menu'}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? <X className="w-5 h-5" aria-hidden="true" /> : <Menu className="w-5 h-5" aria-hidden="true" />}
          </button>
        </div>

        <div id={menuId} ref={menuRef} className="lp-mobile-menu lg:hidden" data-open={open}>
          <div>
            <ul className="list-none m-0 p-0 pb-2 flex flex-col">
              {NAV_LINKS.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    onClick={() => close()}
                    className="flex items-center min-h-[44px] px-3 rounded-lg text-[15px] font-medium"
                    style={{ color: 'var(--lp-text)' }}
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="flex flex-col gap-2 pt-3 pb-4 border-t" style={{ borderColor: 'var(--lp-border)' }}>
              {isAuthenticated ? (
                <Link to="/dashboard" onClick={() => close()} className="lp-btn lp-btn--primary">
                  Dashboard
                </Link>
              ) : (
                <>
                  <Link to="/login" onClick={() => close()} className="lp-btn lp-btn--secondary">
                    Sign In
                  </Link>
                  <Link to="/register" onClick={() => close()} className="lp-btn lp-btn--primary">
                    Get Started
                  </Link>
                </>
              )}
              <div className="flex items-center justify-between pt-1">
                <span className="lp-label">Theme</span>
                <ThemeSwitcher compact />
              </div>
            </div>
          </div>
        </div>
      </nav>
    </header>
  );
};
