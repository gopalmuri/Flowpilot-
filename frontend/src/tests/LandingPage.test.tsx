import { render, screen, fireEvent, within, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

const authState = { isAuthenticated: false };
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ isAuthenticated: authState.isAuthenticated, isLoading: false }),
}));

import { LandingPage } from '../pages/landing/LandingPage';
import { ANCHOR_IDS } from '../components/landing/landingContent';

const LocationProbe = () => <div data-testid="loc">{useLocation().pathname}</div>;

const renderLanding = () =>
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>
  );

const primaryNav = () => screen.getByRole('navigation', { name: 'Primary' });

beforeEach(() => {
  authState.isAuthenticated = false;
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Landing navigation', () => {
  it('points the nav links at the right in-page anchors', () => {
    renderLanding();
    const nav = primaryNav();
    const expected: Record<string, string> = {
      Product: '#product',
      'How It Works': '#how-it-works',
      Architecture: '#architecture',
      Observability: '#observability',
    };
    for (const [label, href] of Object.entries(expected)) {
      const links = within(nav).getAllByRole('link', { name: label });
      expect(links.length).toBeGreaterThan(0);
      links.forEach((l) => expect(l).toHaveAttribute('href', href));
    }
  });

  it('every in-page anchor target exists, and no link is a bare #', () => {
    const { container } = renderLanding();
    for (const id of ANCHOR_IDS) {
      expect(container.querySelector(`#${id}`)).not.toBeNull();
    }
    container.querySelectorAll('a[href^="#"]').forEach((a) => {
      const href = a.getAttribute('href') as string;
      expect(href.length).toBeGreaterThan(1);
      expect(container.querySelector(href)).not.toBeNull();
    });
  });

  it('has one h1 and the expected landmarks', () => {
    renderLanding();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
  });

  it('Sign In navigates to /login', () => {
    renderLanding();
    fireEvent.click(within(primaryNav()).getAllByRole('link', { name: 'Sign In' })[0]);
    expect(screen.getByTestId('loc')).toHaveTextContent('/login');
  });

  it('Get Started navigates to /register', () => {
    renderLanding();
    fireEvent.click(within(primaryNav()).getAllByRole('link', { name: 'Get Started' })[0]);
    expect(screen.getByTestId('loc')).toHaveTextContent('/register');
  });

  it('hero and final CTAs go to real routes', () => {
    renderLanding();
    const main = screen.getByRole('main');
    within(main)
      .getAllByRole('link', { name: /Get Started/ })
      .forEach((l) => expect(l).toHaveAttribute('href', '/register'));
    expect(within(main).getByRole('link', { name: 'Sign In' })).toHaveAttribute('href', '/login');
    expect(within(main).getByRole('link', { name: 'Explore How It Works' })).toHaveAttribute('href', '#how-it-works');
  });

  it('shows Dashboard instead of auth links for a signed-in visitor', () => {
    authState.isAuthenticated = true;
    renderLanding();
    expect(within(primaryNav()).getAllByRole('link', { name: 'Dashboard' })[0]).toHaveAttribute('href', '/dashboard');
    expect(within(primaryNav()).queryByRole('link', { name: 'Sign In' })).toBeNull();
  });
});

describe('Mobile menu', () => {
  const toggle = () => screen.getByRole('button', { name: /open menu|close menu/i });
  const menu = () => document.getElementById(toggle().getAttribute('aria-controls') as string) as HTMLElement;

  it('opens and closes with the toggle and wires aria-expanded/aria-controls', () => {
    renderLanding();
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(menu()).toHaveAttribute('data-open', 'false');
    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    expect(menu()).toHaveAttribute('data-open', 'true');
    fireEvent.click(toggle());
    expect(menu()).toHaveAttribute('data-open', 'false');
  });

  it('closes on Escape and returns focus to the toggle', () => {
    renderLanding();
    fireEvent.click(toggle());
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(menu()).toHaveAttribute('data-open', 'false');
    expect(toggle()).toHaveFocus();
  });

  it('closes after choosing an anchor', () => {
    renderLanding();
    fireEvent.click(toggle());
    fireEvent.click(within(menu()).getByRole('link', { name: 'Architecture' }));
    expect(menu()).toHaveAttribute('data-open', 'false');
  });

  it('closes after navigating to a route', () => {
    renderLanding();
    fireEvent.click(toggle());
    fireEvent.click(within(menu()).getByRole('link', { name: 'Sign In' }));
    expect(screen.getByTestId('loc')).toHaveTextContent('/login');
  });
});

describe('Product examples tabs', () => {
  it('switches content on click', () => {
    renderLanding();
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Classify company size');
    fireEvent.click(tabs[1]);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Route exceptions for human approval');
    expect(screen.getByRole('tabpanel')).not.toHaveTextContent('Classify company size');
  });

  it('is keyboard operable (arrows, Home, End, roving tabindex)', () => {
    renderLanding();
    const tablist = screen.getByRole('tablist', { name: 'Example workflows' });
    const tabs = within(tablist).getAllByRole('tab');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[1]).toHaveFocus();
    expect(tabs[0]).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(tabs[1], { key: 'End' });
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Validate requester permissions');
    fireEvent.keyDown(tabs[2], { key: 'ArrowRight' });
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(tabs[2]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(tabs[2], { key: 'Home' });
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('labels the examples as demonstrations', () => {
    renderLanding();
    expect(screen.getAllByText(/demonstration/i).length).toBeGreaterThan(0);
  });
});

const tick = (n: number) => {
  for (let i = 0; i < n; i++) {
    act(() => {
      vi.advanceTimersByTime(750);
    });
  }
};

describe('Hero lifecycle demo', () => {
  const demo = () => screen.getByRole('region', { name: 'Request lifecycle' });

  it('is labelled illustrative and lists the seven stages', () => {
    renderLanding();
    expect(within(demo()).getByText('Illustrative demo')).toBeInTheDocument();
    const stages = within(demo()).getByRole('list', { name: 'Lifecycle stages' });
    expect(within(stages).getAllByRole('button')).toHaveLength(7);
  });

  it('selecting a stage updates the detail panel and makes no network or service calls', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const xhrSpy = vi.fn();
    vi.stubGlobal('XMLHttpRequest', xhrSpy);
    renderLanding();
    const stages = within(demo()).getByRole('list', { name: 'Lifecycle stages' });
    const buttons = within(stages).getAllByRole('button');
    fireEvent.click(buttons[2]);
    expect(buttons[2]).toHaveAttribute('aria-pressed', 'true');
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'false');
    expect(within(demo()).getByRole('heading', { level: 3 })).toHaveTextContent('3. AI Classify');
    expect(demo()).toHaveTextContent('It does not approve or execute anything');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(xhrSpy).not.toHaveBeenCalled();
  });

  it('replay restarts the progression deterministically and finishes, without any network call', () => {
    vi.useFakeTimers();
    try {
      const fetchSpy = vi.fn();
      vi.stubGlobal('fetch', fetchSpy);
      renderLanding();
      expect(demo()).toHaveTextContent('7 of 7 stages');
      fireEvent.click(within(demo()).getByRole('button', { name: /Replay/ }));
      expect(demo()).toHaveTextContent('0 of 7 stages');
      expect(demo()).toHaveTextContent('Running');
      tick(3);
      expect(demo()).toHaveTextContent('3 of 7 stages');
      tick(10);
      expect(demo()).toHaveTextContent('7 of 7 stages');
      expect(demo()).toHaveTextContent('Completed (demo)');
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('a rejected decision shows rejected and skipped states, not success', () => {
    vi.useFakeTimers();
    try {
      renderLanding();
      fireEvent.click(within(demo()).getByRole('button', { name: 'Rejects' }));
      tick(10);
      expect(demo()).toHaveTextContent('Stopped at approval (demo)');
      expect(demo()).not.toHaveTextContent('Completed (demo)');
      const buttons = within(within(demo()).getByRole('list', { name: 'Lifecycle stages' })).getAllByRole('button');
      expect(buttons[4]).toHaveTextContent('Rejected');
      expect(buttons[5]).toHaveTextContent('Skipped');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('Observability timeline', () => {
  it('selecting an event updates the detail and the demo is labelled', () => {
    renderLanding();
    const list = screen.getByRole('list', { name: 'Execution events' });
    const buttons = within(list).getAllByRole('button');
    fireEvent.click(buttons[0]);
    expect(buttons[0]).toHaveAttribute('aria-current', 'step');
    expect(screen.getByRole('heading', { level: 4 })).toHaveTextContent('Request received');
    expect(screen.getAllByText('Illustrative demo').length).toBeGreaterThan(1);
  });

  it('marks context enrichment as Planned and does not claim it as available', () => {
    renderLanding();
    const item = screen.getByText('Context enrichment').closest('li') as HTMLElement;
    expect(within(item).getByText('Planned')).toBeInTheDocument();
  });
});

describe('Reduced motion', () => {
  it('renders all content visible and keeps the demo operable', () => {
    vi.stubGlobal(
      'matchMedia',
      (query: string) =>
        ({
          matches: query.includes('reduce'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList
    );
    // Even if IntersectionObserver exists, reduced motion must never arm (hide) content.
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      }
    );
    const { container } = renderLanding();
    expect(container.querySelectorAll('.lp-reveal--hidden')).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Nothing disappears after execution.' })).toBeInTheDocument();
    const demo = screen.getByRole('region', { name: 'Request lifecycle' });
    expect(demo).toHaveTextContent('7 of 7 stages'); // no autoplay
    fireEvent.click(within(demo).getByRole('button', { name: /Replay/ }));
    expect(demo).toHaveTextContent('0 of 7 stages');
  });
});

describe('Footer', () => {
  it('has the product and account links and no Privacy or Terms links', () => {
    renderLanding();
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: 'How It Works' })).toHaveAttribute('href', '#how-it-works');
    expect(within(footer).getByRole('link', { name: 'Architecture' })).toHaveAttribute('href', '#architecture');
    expect(within(footer).getByRole('link', { name: 'Observability' })).toHaveAttribute('href', '#observability');
    expect(within(footer).getByRole('link', { name: 'Sign In' })).toHaveAttribute('href', '/login');
    expect(within(footer).getByRole('link', { name: 'Get Started' })).toHaveAttribute('href', '/register');
    expect(within(footer).queryByRole('link', { name: /privacy|terms/i })).toBeNull();
  });
});
