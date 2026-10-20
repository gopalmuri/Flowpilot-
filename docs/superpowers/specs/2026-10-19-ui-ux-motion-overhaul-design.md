# UI/UX and Motion Overhaul - Design

Date: 2026-10-19. Status: draft for user review. Frontend only; no backend changes.

## Intent

Anyone who opens FlowPilot should think "this is an amazing site". The user said the current UI is fine but the motion is
"nothing", and asked for powerful, smooth animation, proper mobile responsiveness, and polished sign in / sign up, plus the
app sidebar and top bar (UI and UX). Feedback on the first mockups: too fast, too subtle, not smooth. The approved direction
is the slower, cinematic, scroll-driven mockup (`motion-v2-cinematic-scroll`).

Assumption to confirm: the user has not explicitly approved the v2 mockup, only moved on to the sidebar.

## Scope

In: landing page (all sections), navbar and mobile menu, login and register (split screen), the dashboard app shell
(sidebar, top bar, page transitions), a shared motion kit, route-level code splitting, tests, responsive verification.
Out: redesign of dashboard page contents, backend, copy rewrite, new pages. The user's edits to `AuthLayout.tsx` and
`ThemeSwitcher.tsx` are preserved (z-index fix, click-outside handling).

## Motion principles

- Slow and soft: 0.9 to 1.8 s for entrances with a long ease-out `cubic-bezier(.16,1,.3,1)`; 0.2 to 0.4 s for UI feedback.
- Transform and opacity only (plus brief blur on text swaps). No layout-thrashing properties.
- Scroll-linked values are smoothed (lerp ~0.07) so scrolling feels buttery.
- Pause off-screen (IntersectionObserver); one shared rAF loop, not one per component.
- `prefers-reduced-motion`: final state shown, no movement. Touch devices: no cursor effects.
- Library: Framer Motion via `LazyMotion`/`domAnimation` (~15-20 kB) for entrances, layout pill and page transitions;
  scroll-driven sequence uses a small custom rAF hook. No GSAP, Lenis or WebGL.

## Motion kit (`frontend/src/motion/`)

`tokens.ts` (durations, easings, springs), `Reveal`, `Stagger`, `MaskLines` (headline line reveal), `Magnetic`, `TiltCard`,
`CountUp`, `ScrollProgress`, `useSmoothScroll`/`useScrollSequence`, `PageTransition`, `useMotionPreference`. Each has one
job and is unit-testable. Existing `hooks/useMotion.ts` is kept and reused where it fits.

## Landing page

- Navbar: transparent to blurred and shrunk on scroll, sliding active pill, top scroll-progress bar. Mobile: full-screen
  menu with staggered items, focus trap, Escape closes, body scroll lock.
- Hero: masked line-by-line headline, shimmering accent text, drifting orbs and grid, floating control-plane card that
  tilts toward the cursor with smoothing, pulsing primary button.
- Interactive demo: tabs with a sliding indicator and animated data flow.
- "Request to execution": pinned scroll sequence on desktop (a line draws through Request, AI draft, Approval, Execute with
  a travelling glow; text blurs between steps; step bars fill). Mobile: vertical timeline that fills as it scrolls.
- AI vs control boundary: animated divider between what AI does and what humans approve.
- Observability: count-up metrics. Final CTA: cursor spotlight. Footer: reveal.

## Auth (split screen)

- Left: animated brand showcase (orbs, rotating workflow card). Right: form. Mobile: compact animated header above form.
- Sign in: inline validation, show/hide password, caps-lock warning, success morph on the button, `aria-live` errors.
- Sign up: 2 steps (account, then organization) with animated transition and a password strength meter. API payload
  unchanged: `register({full_name, email, password, organization_name})`.

## App shell (sidebar and top bar)

- Sidebar: stronger active state (tint, left accent bar, bolder icon); spring-gliding active pill; hover slide and icon
  nudge; live badges (pending approvals count, failed-runs dot) from existing queries; user and organization block pinned
  at the bottom with Settings; larger, higher-contrast section labels; collapse to an icon rail with tooltips and a smooth
  width transition; mobile slide-in drawer with backdrop, swipe to close, focus trap.
- Top bar: remove the duplicate theme switcher from the sidebar footer (keep the top bar one); merge the "Healthy" pill
  and System Status so one is a link to the other; search shortcut hint kept.
- Page transitions: short fade and rise between routes (`PageTransition`).

## Performance and smoothness

`React.lazy` route splitting (today one 883 kB bundle, 219 kB gzip); record bundle size and Lighthouse before and after;
target landing JS well under the current size despite the new library; no long tasks over 50 ms during scroll.

## Testing and verification

- Unit tests: reduced-motion path, `CountUp` final value, mobile menu open/close/focus trap, register 2-step flow and
  unchanged payload, sidebar badges and collapse.
- `AuthFlow.test.tsx` stays green; run vitest, tsc, eslint, production build.
- Real-browser checks at 360, 390, 768, 1024, 1440, 1920 px (no horizontal scroll, menus work, animations run), light and
  dark theme, and a reduced-motion pass.

## Risks

- Pinned scroll sequences are fragile on mobile; mitigated by using the vertical timeline below 768 px.
- Heavy motion can hurt low-end devices; mitigated by transform/opacity only and pausing off-screen.
- Sidebar badges need existing API data; if a count is not cheaply available, the badge is omitted rather than adding
  backend work.
