import { useState, useEffect, useRef } from 'react';

/**
 * Hook to detect whether the user has requested reduced motion.
 */
export function useReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    const listener = (event: MediaQueryListEvent) => {
      setPrefersReducedMotion(event.matches);
    };

    mediaQuery.addEventListener('change', listener);
    return () => mediaQuery.removeEventListener('change', listener);
  }, []);

  return prefersReducedMotion;
}

/**
 * Hook to track when an element enters the viewport using IntersectionObserver.
 */
export function useInView(options: IntersectionObserverInit = { threshold: 0.15, rootMargin: '0px 0px -50px 0px' }): [React.RefObject<HTMLDivElement>, boolean] {
  const ref = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    if (!('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setInView(true);
        observer.disconnect();
      }
    }, options);

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [options.threshold, options.rootMargin]);

  return [ref, inView];
}

/**
 * Hook for animating numeric values smoothly (e.g. 0 -> 84ms or 0 -> 94%).
 */
export function useCountUp(end: number, duration: number = 1000, trigger: boolean = true): number {
  const [count, setCount] = useState(0);
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    if (!trigger) {
      setCount(0);
      return;
    }

    if (prefersReduced) {
      setCount(end);
      return;
    }

    let startTime: number | null = null;
    let animationFrameId: number;

    const step = (timestamp: number) => {
      if (!startTime) startTime = timestamp;
      const progress = Math.min((timestamp - startTime) / duration, 1);
      const easedProgress = 1 - Math.pow(1 - progress, 3);
      setCount(Math.floor(easedProgress * end));

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(step);
      } else {
        setCount(end);
      }
    };

    animationFrameId = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [end, duration, trigger, prefersReduced]);

  return count;
}

/**
 * Hook for very subtle scroll parallax (5-15px maximum) on non-text visual panels.
 */
export function useScrollParallax(speed: number = 0.04, maxPx: number = 12): number {
  const [offsetY, setOffsetY] = useState(0);
  const prefersReduced = useReducedMotion();

  useEffect(() => {
    if (prefersReduced) {
      setOffsetY(0);
      return;
    }

    let rafId: number;
    const handleScroll = () => {
      rafId = requestAnimationFrame(() => {
        const scrolled = window.scrollY;
        const offset = Math.max(-maxPx, Math.min(maxPx, (scrolled - 300) * speed));
        setOffsetY(offset);
      });
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', handleScroll);
      cancelAnimationFrame(rafId);
    };
  }, [speed, maxPx, prefersReduced]);

  return offsetY;
}
