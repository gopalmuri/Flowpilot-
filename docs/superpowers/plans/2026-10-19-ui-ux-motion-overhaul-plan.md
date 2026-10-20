# UI/UX and Motion Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the landing page, sign in / sign up and the dashboard sidebar and top bar feel premium with slow, smooth, scroll-driven motion, fully responsive.

**Architecture:** A small shared motion kit (`frontend/src/motion/`) built on Framer Motion (`LazyMotion` + `domAnimation`) and one custom scroll-sequence hook. Pages and layout components consume the kit; existing business logic, API calls and route paths do not change. Routes are lazy-loaded.

**Tech Stack:** React 18, react-router 7, Tailwind, Lucide, Vitest + Testing Library, Framer Motion (new).

**Spec:** `docs/superpowers/specs/2026-10-19-ui-ux-motion-overhaul-design.md`

## Global Constraints

- Frontend only. No backend, API or route-path changes. `register({full_name,email,password,organization_name})` payload is unchanged.
- **No commits** until the user says so (standing instruction). Every "commit" step is replaced by "leave uncommitted".
- Do not alter `frontend/src/components/auth/AuthLayout.tsx` or `frontend/src/components/ui/ThemeSwitcher.tsx` without showing the user the diff first; their header z-index (`relative z-30`) and ThemeSwitcher click-outside handling must be preserved verbatim.
- Animate `transform` and `opacity` only (plus short `filter: blur` on text swaps). Entrances 0.9 to 1.8 s with `cubic-bezier(.16,1,.3,1)`; UI feedback 0.2 to 0.4 s.
- `prefers-reduced-motion`: final state, no movement. Touch devices (`(hover: none)`): no cursor effects.
- Pause off-screen work (IntersectionObserver). One shared rAF loop per scroll sequence, none left running after unmount.
- Existing 97 frontend tests stay green; `AuthFlow.test.tsx` and `DashboardShell.test.tsx` must pass unchanged unless a task says why they change.
- Verification commands (from `frontend/`): `npx vitest run`, `npx tsc -b`, `npx eslint .`, `npx vite build`.
- Responsive widths to verify: 360, 390, 768, 1024, 1440, 1920 px; light and dark theme.

## Review Focus

- Window resized across 768 px while the scroll story is mid-sequence: desktop pinned view and mobile timeline switch without a stuck state.
- User with `prefers-reduced-motion` on: every page is fully visible and usable, with no hidden (opacity 0) content.
- Mobile menu open then browser Back, route change, or Escape: scroll lock is released and focus returns to the toggle.
- Register step 2 then Back to step 1: entered values are kept; submit with a weak password is blocked on step 1.
- Sidebar badge request fails or returns zero: no badge and no error shown; collapsed rail still reachable by keyboard with tooltips.

---

### Task 1: Motion kit foundation

**Files:**
- Modify: `frontend/package.json` (add `framer-motion` at an exact pinned version via `npm install framer-motion`)
- Create: `frontend/src/motion/tokens.ts`, `useMotionPreference.ts`, `MotionProvider.tsx`, `Reveal.tsx`, `Stagger.tsx`, `MaskLines.tsx`, `CountUp.tsx`, `Magnetic.tsx`, `TiltCard.tsx`, `ScrollProgress.tsx`, `useScrollSequence.ts`, `index.ts`
- Modify: `frontend/src/main.tsx` (wrap app in `MotionProvider`)
- Test: `frontend/src/tests/MotionKit.test.tsx`

**Interfaces:**
- Produces:
  - `EASE_OUT: [0.16, 1, 0.3, 1]`, `DURATION = { feedback: 0.3, enter: 1.2, slow: 1.8 }`, `SPRING = { stiffness: 260, damping: 30 }` in `tokens.ts`.
  - `useMotionPreference(): { reduced: boolean; canHover: boolean }` (reads `prefers-reduced-motion` and `(hover: hover)` via `matchMedia`, updates on change).
  - `<MotionProvider>{children}</MotionProvider>`: `LazyMotion features={domAnimation} strict`.
  - `<Reveal delay?: number y?: number once?: boolean>`; `<Stagger gap?: number>` (children animate in sequence); `<MaskLines lines: ReactNode[]>` (each line slides up from behind a mask); `<CountUp to: number duration?: number suffix?: string>`; `<Magnetic strength?: number>`; `<TiltCard max?: number>`; `<ScrollProgress/>` (fixed top bar).
  - `useScrollSequence(ref: RefObject<HTMLElement>, opts?: { smoothing?: number }): { progress: number }` where `progress` is the lerped (default 0.07) 0..1 position of the element's scroll span, updated through one rAF loop that stops on unmount and when the element is off-screen.

- [ ] **Step 1: Write failing tests** in `MotionKit.test.tsx`: `useMotionPreference` returns `reduced: true` when `matchMedia('(prefers-reduced-motion: reduce)')` matches; `Reveal` renders its children visible (no `opacity: 0` inline style) when reduced; `CountUp to={1200}` renders `1,200` immediately when reduced and after animation otherwise (fake timers); `MaskLines` renders every line's text; `useScrollSequence` cancels its rAF on unmount (spy on `cancelAnimationFrame`).
- [ ] **Step 2: Run** `npx vitest run src/tests/MotionKit.test.tsx`. Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** the files above. Reduced motion: components render final state. `CountUp` uses ease-out quartic over `duration` (default 2.2 s) starting when in view. `TiltCard` and `Magnetic` do nothing when `!canHover`.
- [ ] **Step 4: Run** the new test file, then `npx tsc -b`. Expected: PASS, no type errors.
- [ ] **Step 5: Leave uncommitted.**

### Task 2: Route splitting and page transitions

**Files:**
- Modify: `frontend/src/routes/AppRoutes.tsx` (convert page imports to `React.lazy` with one `Suspense` fallback)
- Create: `frontend/src/motion/PageTransition.tsx`, `frontend/src/components/ui/RouteFallback.tsx`
- Modify: `frontend/src/layouts/DashboardLayout.tsx` (wrap `Outlet` in `PageTransition`, keyed by pathname)
- Test: `frontend/src/tests/RouteSplitting.test.tsx`

**Interfaces:**
- Consumes: `useMotionPreference` (Task 1).
- Produces: `<PageTransition>{children}</PageTransition>` (fade + 12 px rise, 0.35 s; no animation when reduced); `<RouteFallback/>` (minimal skeleton, `role="status"`).

- [ ] **Step 1: Write failing test:** rendering `/login` shows `RouteFallback` first then the sign-in heading; `DashboardLayout` still renders child route content (reuse `DashboardShell.test.tsx` setup).
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement** lazy routes (named exports adapted with `.then(m => ({default: m.X}))`) and `PageTransition`.
- [ ] **Step 4: Run** `npx vitest run`, then `npx vite build`; record chunk sizes in the task notes (before: 883 kB single bundle, 219 kB gzip). Expected: all tests pass, multiple chunks emitted.
- [ ] **Step 5: Leave uncommitted.**

### Task 3: Landing navbar and mobile menu

**Files:**
- Modify: `frontend/src/components/landing/LandingNavbar.tsx`
- Create: `frontend/src/components/landing/MobileMenu.tsx`, `frontend/src/hooks/useFocusTrap.ts`, `frontend/src/hooks/useScrollLock.ts`
- Test: `frontend/src/tests/LandingNavbar.test.tsx`

**Interfaces:**
- Consumes: `ScrollProgress`, `useMotionPreference`.
- Produces: `<MobileMenu open: boolean onClose: () => void links: {href:string,label:string}[]/>`; `useFocusTrap(ref, active: boolean)`; `useScrollLock(active: boolean)`.

- [ ] **Step 1: Write failing tests:** menu toggle has `aria-expanded` and opens a dialog; Escape closes and focus returns to the toggle; route change closes it; `document.body.style.overflow` is restored after close and after unmount while open; Tab cycles within the menu.
- [ ] **Step 2: Run** `npx vitest run src/tests/LandingNavbar.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement:** navbar transparent to blurred and shrunk after 24 px scroll, sliding active-section pill (Framer `layoutId`), `ScrollProgress` mounted once; mobile full-screen menu with staggered items.
- [ ] **Step 4: Run** tests and `npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Leave uncommitted.**

### Task 4: Hero

**Files:**
- Modify: `frontend/src/components/landing/LandingHero.tsx` (replace `setTimeout` staging with the kit)
- Create: `frontend/src/components/landing/HeroBackdrop.tsx` (drifting orbs and moving grid, CSS keyframes in `index.css`), `frontend/src/components/landing/ControlPlaneCard.tsx`
- Modify: `frontend/src/index.css` (keyframes `orb-drift-1/2`, `grid-move`, `text-shimmer`, `ring-pulse`)
- Test: `frontend/src/tests/LandingHero.test.tsx`

**Interfaces:**
- Consumes: `MaskLines`, `Reveal`, `TiltCard`, `Magnetic`, `CountUp`.
- Produces: `<ControlPlaneCard/>` (three status rows, progress bar, run counter; floats and tilts toward cursor with smoothing).

- [ ] **Step 1: Write failing tests:** headline text is present in the DOM for assistive tech in full (not split into per-letter nodes); both calls to action are links/buttons with their existing hrefs; with reduced motion nothing has `opacity: 0`.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement** per spec: masked headline lines (1.6 s, staggered 0.25 s), shimmering accent text, `ControlPlaneCard` entrance 2 s, pulsing primary button. Backdrop animations paused with `animation-play-state` when hero is off-screen.
- [ ] **Step 4: Run** tests and `npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Leave uncommitted.**

### Task 5: Request-to-execution scroll story

**Files:**
- Modify: `frontend/src/components/landing/HowItWorksSection.tsx`
- Create: `frontend/src/components/landing/ScrollStory.tsx` (desktop pinned), `frontend/src/components/landing/StoryTimeline.tsx` (mobile vertical), `frontend/src/components/landing/storySteps.ts`
- Test: `frontend/src/tests/ScrollStory.test.tsx`

**Interfaces:**
- Consumes: `useScrollSequence`, `useMotionPreference`.
- Produces: `STORY_STEPS: {id:'request'|'ai'|'approval'|'execute'; title:string; body:string}[]` (4 steps; titles/body copied from the approved mockup: "A request arrives", "AI drafts the reply", "A human approves", "It executes, audited"); `stepForProgress(progress: number): 0|1|2|3`.

- [ ] **Step 1: Write failing tests:** `stepForProgress(0)=0`, `(0.26)=1`, `(0.51)=2`, `(0.76)=3`, `(1)=3`; at width < 768 (`matchMedia` mock) `StoryTimeline` renders and the pinned section does not; all four step titles are in the DOM in both modes; reduced motion shows all steps expanded.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement:** section height 520vh with a sticky 100vh stage; SVG path drawn by `stroke-dashoffset` from `progress`; glowing packet positioned with `getPointAtLength`; node states `idle|on|done`; step text cross-fades with blur; four step bars fill. Resizing across 768 px swaps components without leaving a scroll lock.
- [ ] **Step 4: Run** tests and `npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Leave uncommitted.**

### Task 6: Remaining landing sections

**Files:**
- Modify: `frontend/src/components/landing/InteractiveDemoSection.tsx`, `AIArchitectureSection.tsx`, `ObservabilityTrustSection.tsx`, `LandingCTASection.tsx`, `LandingFooter.tsx`, `ProblemSection.tsx`, `frontend/src/pages/landing/LandingPage.tsx`
- Test: `frontend/src/tests/LandingSections.test.tsx`

**Interfaces:**
- Consumes: `Reveal`, `Stagger`, `CountUp`, `Magnetic`.

- [ ] **Step 1: Write failing tests:** demo tab buttons use `role="tab"` with `aria-selected` and switch panels; metric values render final numbers when reduced; CTA primary link keeps its `/register` href.
- [ ] **Step 2: Run** the test. Expected: FAIL.
- [ ] **Step 3: Implement** per spec: demo tabs with a sliding indicator (`layoutId`) and animated data-flow; AI-vs-control animated divider; count-up observability; CTA cursor spotlight (hidden when `!canHover`); section `Reveal`s with 1.2 s ease-out. Check no section has horizontal overflow at 360 px.
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Leave uncommitted.**

### Task 7: Auth split-screen shell

**Files:**
- Create: `frontend/src/components/auth/AuthShowcase.tsx` (animated left panel using `ControlPlaneCard`-style rotating cards), `frontend/src/components/auth/AuthMobileHeader.tsx`
- Modify (after showing the user the diff): `frontend/src/components/auth/AuthLayout.tsx` to render the existing, currently unused `showcase` prop in a left column at `lg` and above, leaving the header block, `relative z-30`, back link and `ThemeSwitcher` untouched and keeping the file's BOM and CRLF endings
- Test: extend `frontend/src/tests/AuthFlow.test.tsx` only by adding new cases

**Interfaces:**
- Produces: `<AuthShowcase/>`, `<AuthMobileHeader/>` (shown below `lg`).

- [ ] **Step 1: Write failing tests:** `AuthLayout` with a `showcase` prop renders it; without one, renders as before; ThemeSwitcher still present.
- [ ] **Step 2: Run** `npx vitest run src/tests/AuthFlow.test.tsx`. Expected: new cases FAIL, old pass.
- [ ] **Step 3: Show the user the `AuthLayout.tsx` diff and wait for consent**, then implement.
- [ ] **Step 4: Run** the file and `npx tsc -b`. Expected: all pass.
- [ ] **Step 5: Leave uncommitted.**

### Task 8: Sign-in UX

**Files:**
- Modify: `frontend/src/pages/auth/LoginPage.tsx`, `frontend/src/components/auth/PasswordField.tsx`, `PrimaryButton.tsx`
- Test: new cases in `frontend/src/tests/AuthFlow.test.tsx`

**Interfaces:**
- Produces: `PasswordField` props add `showToggle` (button with `aria-label` "Show password"/"Hide password") and `capsLockWarning` (message in an `aria-live="polite"` region); `PrimaryButton` props add `status?: 'idle'|'loading'|'success'`.

- [ ] **Step 1: Write failing tests:** blur on an invalid email shows an inline error with `role="alert"`; toggle flips the input `type`; keydown with `getModifierState('CapsLock')` true shows the warning; failed login keeps entered values and shows the server error; successful login still navigates to the `redirect` param.
- [ ] **Step 2: Run** the file. Expected: new cases FAIL.
- [ ] **Step 3: Implement** with the split layout from Task 7 and the success morph (button shows a check before navigation, 600 ms, skipped when reduced).
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Leave uncommitted.**

### Task 9: Two-step sign-up

**Files:**
- Modify: `frontend/src/pages/auth/RegisterPage.tsx`
- Create: `frontend/src/components/auth/PasswordStrengthMeter.tsx`, `frontend/src/components/auth/StepIndicator.tsx`
- Test: new cases in `frontend/src/tests/AuthFlow.test.tsx`

**Interfaces:**
- Produces: `passwordStrength(password: string): 0|1|2|3|4` (count of satisfied existing rules, 0 to 4 scale; five rules map to 0 to 4 buckets), `<PasswordStrengthMeter password/>`, `<StepIndicator step: 1|2 total: 2/>`.

- [ ] **Step 1: Write failing tests:** step 1 holds full name, email and password; Next is disabled until the existing five password rules pass and email is valid; step 2 holds organization name; Back returns with values intact; submit calls `register` with exactly `{full_name,email,password,organization_name}`; `passwordStrength('')=0` and a password meeting all rules returns 4.
- [ ] **Step 2: Run** the file. Expected: new cases FAIL.
- [ ] **Step 3: Implement** with a slide transition between steps (0.5 s, none when reduced), focus moved to the first field of each step.
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc -b`. Expected: PASS, including old register tests (adjust only selectors that depended on the single-step layout and note which).
- [ ] **Step 5: Leave uncommitted.**

### Task 10: Dashboard sidebar and top bar

**Files:**
- Modify: `frontend/src/components/layout/Sidebar.tsx`, `frontend/src/components/layout/Header.tsx`, `frontend/src/layouts/DashboardLayout.tsx`
- Create: `frontend/src/hooks/useNavBadges.ts`, `frontend/src/components/layout/SidebarUserBlock.tsx`
- Test: extend `frontend/src/tests/DashboardShell.test.tsx` with new cases

**Interfaces:**
- Consumes: existing `approvalService` list call (pending count) and executions service (failed count); if a count is not available from an existing call, omit that badge (no backend work).
- Produces: `useNavBadges(organizationId: string | null): { approvals: number; failedRuns: number }` (zero on error or loading, never throws); `<SidebarUserBlock/>` (user name, role, organization, Settings link).

- [ ] **Step 1: Write failing tests:** pending approvals badge shows the count and has an accessible name ("3 pending approvals"); failing fetch renders no badge and no error text; collapsing the rail keeps every item reachable by keyboard and each has a tooltip/`aria-label`; the duplicate theme switcher is gone from the sidebar footer while the header one remains; mobile drawer closes on Escape and backdrop click and restores scroll.
- [ ] **Step 2: Run** `npx vitest run src/tests/DashboardShell.test.tsx`. Expected: new cases FAIL.
- [ ] **Step 3: Implement:** stronger active state (tint, left accent bar, bolder icon), spring-gliding active pill (`layoutId`), hover slide and icon nudge, larger higher-contrast section labels, user block pinned at the bottom, collapse to icon rail with width transition, mobile slide-in drawer with backdrop and focus trap; merge the Header "Healthy" pill to link to `/status` and keep the System Status item.
- [ ] **Step 4: Run** `npx vitest run` and `npx tsc -b`. Expected: PASS (existing 97 plus new).
- [ ] **Step 5: Leave uncommitted.**

### Task 11: Full verification and report

**Files:**
- Modify: `docs/superpowers/specs/2026-10-19-ui-ux-motion-overhaul-design.md` (append a "Verification results" section with real numbers)

- [ ] **Step 1:** From `frontend/` run `npx vitest run`, `npx tsc -b`, `npx eslint .`, `npx vite build`. Expected: all green; report exact test count and chunk sizes versus 883 kB / 219 kB gzip.
- [ ] **Step 2:** Start the dev stack frontend and check in a real browser at 360, 390, 768, 1024, 1440, 1920 px, light and dark: no horizontal scroll, menu and drawer work, scroll story pins on desktop and shows the timeline on mobile, hero and auth animations run. Record anything not checked.
- [ ] **Step 3:** Reduced-motion pass (OS setting or devtools emulation): every page fully visible.
- [ ] **Step 4:** Run Lighthouse (performance, accessibility) on `/` and `/login` and record scores.
- [ ] **Step 5:** Report results truthfully, including any step that could not be run. Do not commit.
