import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';

/** True when the visitor asked the OS/browser to reduce motion. Safe without matchMedia (SSR / jsdom). */
export const usePrefersReducedMotion = (): boolean => {
  const query = '(prefers-reduced-motion: reduce)';
  const read = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false;
  const [reduced, setReduced] = useState<boolean>(read);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    onChange();
    if (mq.addEventListener) {
      mq.addEventListener('change', onChange);
      return () => mq.removeEventListener('change', onChange);
    }
    return undefined;
  }, []);

  return reduced;
};

/**
 * Viewport reveal. Content is visible on first render (no-JS / SSR / test safe). Only after mount, and only when the
 * element is fully below the fold, is it armed (hidden) and then revealed once by an IntersectionObserver, which is
 * disconnected after the first reveal. Never armed when reduced motion is requested.
 */
export const useReveal = <T extends HTMLElement>(): [React.RefObject<T>, boolean] => {
  const ref = useRef<T>(null);
  const reduced = usePrefersReducedMotion();
  const [hidden, setHidden] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || reduced || typeof IntersectionObserver === 'undefined') {
      setHidden(false);
      return undefined;
    }
    const rect = el.getBoundingClientRect();
    if (rect.top < window.innerHeight) return undefined; // already on screen: stay visible
    setHidden(true);
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setHidden(false);
          io.disconnect();
        }
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced]);

  return [ref, hidden];
};

interface RevealProps extends React.HTMLAttributes<HTMLElement> {
  as?: keyof React.JSX.IntrinsicElements;
  /** Stagger delay in ms (applied through a CSS variable). */
  delay?: number;
}

/** Fade + short upward move on first entry into the viewport. Transform/opacity only: no layout shift. */
export const Reveal: React.FC<RevealProps> = ({ as = 'div', delay = 0, className = '', style, children, ...rest }) => {
  const [ref, hidden] = useReveal<HTMLElement>();
  const Tag = as as React.ElementType;
  return (
    <Tag
      ref={ref}
      className={`lp-reveal ${hidden ? 'lp-reveal--hidden' : ''} ${className}`}
      style={{ ...style, ['--lp-delay' as string]: `${delay}ms` }}
      {...rest}
    >
      {children}
    </Tag>
  );
};
