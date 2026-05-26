import { useEffect, useState } from 'react';
import { Laptop, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { applyThemeMode, readThemeMode, type ThemeMode } from '@/lib/theme';

const MODES: ThemeMode[] = ['system', 'light', 'dark'];

const META: Record<ThemeMode, { label: string; icon: typeof Laptop }> = {
  system: { label: '跟随系统', icon: Laptop },
  light: { label: '浅色', icon: Sun },
  dark: { label: '深色', icon: Moon },
};

export function ThemeToggle({ className, compact = true }: { className?: string; compact?: boolean }) {
  const [mode, setMode] = useState<ThemeMode>(readThemeMode);

  useEffect(() => {
    setMode(readThemeMode());
    const query = window.matchMedia?.('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (readThemeMode() === 'system') applyThemeMode('system');
    };
    query?.addEventListener?.('change', onChange);
    return () => query?.removeEventListener?.('change', onChange);
  }, []);

  if (!compact) {
    return (
      <div className={cn('inline-grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface-elevated p-1', className)}>
        {MODES.map((value) => {
          const Icon = META[value].icon;
          const active = mode === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                applyThemeMode(value);
                setMode(value);
              }}
              className={cn(
                'inline-flex h-8 min-w-16 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors',
                active ? 'bg-surface text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {META[value].label}
            </button>
          );
        })}
      </div>
    );
  }

  const next = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
  const Icon = META[mode].icon;
  const label = `主题：${META[mode].label}，点击切到${META[next].label}`;

  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={() => {
        applyThemeMode(next);
        setMode(next);
      }}
      className={cn(
        'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted-foreground transition-colors hover:border-brand/40 hover:text-foreground',
        className,
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}
