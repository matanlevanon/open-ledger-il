import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from 'tailwindcss';

const here = dirname(fileURLToPath(import.meta.url));

// Colors come from CSS variables in src/styles/tokens.css, so light and dark share one palette name.
const token = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  content: [join(here, 'index.html'), join(here, 'src/**/*.{ts,tsx}')],
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: token('color-canvas'),
        surface: token('color-surface'),
        'surface-2': token('color-surface-2'),
        band: token('color-band'),
        ink: token('color-ink'),
        muted: token('color-muted'),
        line: token('color-line'),
        brand: token('color-brand'),
        'brand-ink': token('color-brand-ink'),
        // accent: brand moments and destructive actions only. accent-2: every interactive
        // element (links, focus rings, primary buttons; 'brand' above is an alias of accent-2,
        // kept for the many existing bg-brand/text-brand call sites). blue-2: a secondary,
        // calmer blue for a middle state (the ceiling meter's "notice" band, for example).
        accent: token('color-accent'),
        'accent-2': token('color-accent-2'),
        'blue-2': token('color-blue-2'),
        danger: token('color-danger'),
        success: token('color-success'),
        warning: token('color-warning'),
        'tile-blue': token('color-tile-blue'),
        'tile-green': token('color-tile-green'),
        'tile-peach': token('color-tile-peach'),
        'tile-lilac': token('color-tile-lilac'),
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        heading: ['var(--font-heading)'],
        hebrew: ['var(--font-hebrew)'],
      },
      borderRadius: {
        card: 'var(--radius-card)',
      },
      boxShadow: {
        card: 'var(--shadow-card)',
      },
    },
  },
  plugins: [],
} satisfies Config;
