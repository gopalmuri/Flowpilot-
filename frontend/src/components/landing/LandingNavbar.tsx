import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Menu, X, ArrowRight } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { ThemeSwitcher } from '../ui/ThemeSwitcher';

export const LandingNavbar: React.FC = () => {
  const { isAuthenticated } = useAuth();
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      // Background & blur threshold
      setIsScrolled(window.scrollY > 20);

      // Scroll progress percentage
      const totalScroll = document.documentElement.scrollHeight - window.innerHeight;
      if (totalScroll > 0) {
        const progress = (window.scrollY / totalScroll) * 100;
        setScrollProgress(Math.min(100, Math.max(0, progress)));
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const navLinks = [
    { label: 'Product', href: '#hero-workflow' },
    { label: 'How It Works', href: '#how-it-works' },
    { label: 'Architecture', href: '#architecture' },
    { label: 'Observability', href: '#security' }
  ];

  const handleLinkClick = (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
    if (href.startsWith('#')) {
      e.preventDefault();
      setIsMobileMenuOpen(false);
      const element = document.querySelector(href);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth' });
      }
    }
  };

  return (
    <>
      {/* 2px Emerald Scroll Progress Indicator at Very Top */}
      <div
        className="fixed top-0 left-0 right-0 h-[2px] bg-brand-500 z-50 transition-all duration-75 pointer-events-none"
        style={{ width: `${scrollProgress}%` }}
        role="progressbar"
        aria-valuenow={Math.round(scrollProgress)}
        aria-valuemin={0}
        aria-valuemax={100}
      />

      <nav
        className={`sticky top-0 z-40 transition-all duration-200 border-b ${
          isScrolled
            ? 'bg-[var(--bg-app)]/90 backdrop-blur-md border-[var(--border-subtle)] py-2.5 shadow-xs'
            : 'bg-[var(--bg-app)]/60 backdrop-blur-xs border-transparent py-4'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between gap-4">
            {/* Brand Logo */}
            <Link
              to="/"
              className="flex items-center gap-2.5 group focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 rounded-lg p-1"
            >
              <div className="w-8 h-8 rounded-xl bg-brand-600 dark:bg-brand-500 text-white flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform duration-150">
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="w-4 h-4 text-white"
                >
                  <polygon points="12 2 19 8 12 14 5 8 12 2" />
                  <polyline points="5 15 12 21 19 15" />
                </svg>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base tracking-tight text-[var(--text-primary)]">
                  FlowPilot
                </span>
                <span className="text-[10px] font-mono uppercase tracking-wider text-brand-700 dark:text-brand-300 bg-[var(--brand-soft)] px-1.5 py-0.5 rounded border border-brand-200 dark:border-brand-700/60 font-semibold">
                  Control Plane
                </span>
              </div>
            </Link>

            {/* Desktop Navigation Links with subtle animated underline (width 0 -> 100%, opacity 0 -> 1 in 180ms) */}
            <div className="hidden md:flex items-center gap-1 lg:gap-2">
              {navLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  onClick={(e) => handleLinkClick(e, link.href)}
                  className="relative px-3 py-1.5 rounded-lg text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition-colors duration-150 group"
                >
                  <span>{link.label}</span>
                  <span className="absolute bottom-0.5 left-3 right-3 h-[1.5px] bg-brand-500 rounded-full scale-x-0 opacity-0 group-hover:scale-x-100 group-hover:opacity-100 transition-all duration-[180ms] origin-left" />
                </a>
              ))}
            </div>

            {/* Right Action Controls */}
            <div className="hidden sm:flex items-center gap-2.5 sm:gap-3">
              <ThemeSwitcher compact={true} />

              {isAuthenticated ? (
                <Link
                  to="/dashboard"
                  className="btn-micro-hover inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white bg-brand-600 dark:bg-brand-500 shadow-xs"
                >
                  <span>Dashboard</span>
                  <ArrowRight className="w-3.5 h-3.5 btn-arrow" />
                </Link>
              ) : (
                <>
                  <Link
                    to="/login"
                    className="px-3 py-1.5 rounded-xl text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition-colors duration-150"
                  >
                    Sign In
                  </Link>
                  <Link
                    to="/register"
                    className="btn-micro-hover inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-white bg-brand-600 dark:bg-brand-500 shadow-xs"
                  >
                    <span>Get Started</span>
                    <ArrowRight className="w-3.5 h-3.5 btn-arrow" />
                  </Link>
                </>
              )}
            </div>

            {/* Mobile Hamburger Menu Toggle */}
            <div className="flex sm:hidden items-center gap-2">
              <ThemeSwitcher compact={true} />
              <button
                type="button"
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                className="p-2 rounded-xl text-[var(--text-secondary)] hover:bg-[var(--bg-surface-hover)] transition-colors focus:outline-none focus:ring-2 focus:ring-brand-500"
                aria-label="Toggle navigation menu"
                aria-expanded={isMobileMenuOpen}
              >
                {isMobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>

          {/* Mobile Navigation Drawer */}
          {isMobileMenuOpen && (
            <div className="md:hidden mt-3 pt-3 pb-4 border-t border-[var(--border-subtle)] space-y-2 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="space-y-1">
                {navLinks.map((link) => (
                  <a
                    key={link.label}
                    href={link.href}
                    onClick={(e) => handleLinkClick(e, link.href)}
                    className="block px-3 py-2 rounded-lg text-sm font-medium text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition-colors"
                  >
                    {link.label}
                  </a>
                ))}
              </div>

              <div className="pt-3 border-t border-[var(--border-subtle)] flex flex-col gap-2">
                {isAuthenticated ? (
                  <Link
                    to="/dashboard"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="w-full text-center py-2.5 rounded-xl text-xs font-semibold text-white bg-brand-600 dark:bg-brand-500 transition-colors"
                  >
                    Go to Dashboard
                  </Link>
                ) : (
                  <>
                    <Link
                      to="/login"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="w-full text-center py-2 rounded-xl text-xs font-medium text-[var(--text-primary)] bg-[var(--bg-surface-secondary)] hover:bg-[var(--bg-surface-hover)] transition-colors"
                    >
                      Sign In
                    </Link>
                    <Link
                      to="/register"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="w-full text-center py-2 rounded-xl text-xs font-semibold text-white bg-brand-600 dark:bg-brand-500 transition-colors"
                    >
                      Get Started Free
                    </Link>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </nav>
    </>
  );
};
