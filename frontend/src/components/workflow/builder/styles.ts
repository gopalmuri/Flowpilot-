/** Shared class recipes for the AI builder so every control has the same focus, disabled and hover behaviour. */
const focus =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:ring-offset-2 focus-visible:ring-offset-white dark:focus-visible:ring-offset-charcoal-950';
const base = `inline-flex items-center justify-center gap-2 rounded-lg px-3.5 h-9 text-sm font-medium whitespace-nowrap transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${focus}`;

export const btn = {
  primary: `${base} bg-brand-600 text-white hover:bg-brand-700 dark:bg-brand-500 dark:hover:bg-brand-600`,
  secondary: `${base} border border-warm-300 bg-white text-warm-800 hover:bg-warm-100 dark:border-charcoal-700 dark:bg-charcoal-900 dark:text-charcoal-200 dark:hover:bg-charcoal-800`,
  dark: `${base} bg-warm-900 text-white hover:bg-warm-800 dark:bg-charcoal-100 dark:text-charcoal-950 dark:hover:bg-white`,
  ghost: `${base} text-warm-700 hover:bg-warm-100 dark:text-charcoal-300 dark:hover:bg-charcoal-800`,
};

export const iconBtn = `inline-flex items-center justify-center w-8 h-8 rounded-lg text-warm-600 hover:bg-warm-100 hover:text-warm-900 dark:text-charcoal-400 dark:hover:bg-charcoal-800 dark:hover:text-charcoal-100 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${focus}`;

export const focusRing = focus;

export const panel =
  'rounded-xl border border-warm-300 bg-white dark:border-charcoal-750 dark:bg-charcoal-900';
