import type { Config } from 'tailwindcss';
import animate from 'tailwindcss-animate';

export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '1rem',
      screens: {
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
      },
    },
    extend: {
      fontFamily: {
        sans: [
          '"Hanken Grotesk"',
          '-apple-system',
          'BlinkMacSystemFont',
          'system-ui',
          // Web Chinese face so every device (Win/Android included) renders
          // the same typeface instead of falling back to system 宋体/雅黑.
          '"Noto Sans SC"',
          '"PingFang SC"',
          '"Helvetica Neue"',
          'sans-serif',
        ],
        display: [
          '"Hanken Grotesk"',
          '-apple-system',
          'BlinkMacSystemFont',
          '"Noto Sans SC"',
          '"PingFang SC"',
          'sans-serif',
        ],
        // Editorial serif for magazine-style headlines / hero figures.
        serif: ['Fraunces', 'Georgia', '"Songti SC"', 'serif'],
        // Tabular ledger figures — the "terminal" voice for money.
        num: ['"JetBrains Mono"', '"SF Mono"', 'Menlo', 'Consolas', 'monospace'],
        mono: ['"JetBrains Mono"', '"SF Mono"', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      fontFeatureSettings: {
        tnum: '"tnum"',
      },
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        surface: {
          DEFAULT: 'hsl(var(--surface))',
          elevated: 'hsl(var(--surface-elevated))',
        },
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        brand: {
          DEFAULT: 'hsl(var(--brand))',
          foreground: 'hsl(var(--brand-foreground))',
        },
        // Semantic colors used as text/bg utilities throughout the app.
        // success/danger/warning are legacy names kept for back-compat with
        // existing className strings (text-success, text-danger, text-warning).
        success: 'hsl(var(--gain))',
        danger: 'hsl(var(--loss))',
        warning: 'hsl(var(--warn))',
        gain: 'hsl(var(--gain))',
        loss: 'hsl(var(--loss))',
        warn: 'hsl(var(--warn))',
        night: 'hsl(var(--night))',
        benchmark: 'hsl(var(--benchmark))',
        // Per-variant editorial accents (theme-aware).
        'accent-rose': 'hsl(var(--accent-rose))',
        'accent-amber': 'hsl(var(--accent-amber))',
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-up': {
          from: { transform: 'translateY(8px)', opacity: '0' },
          to: { transform: 'translateY(0)', opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out',
        'slide-up': 'slide-up 240ms cubic-bezier(0.16, 1, 0.3, 1)',
      },
    },
  },
  plugins: [animate],
} satisfies Config;
