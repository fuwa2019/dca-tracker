import { cn } from '@/lib/utils';

/**
 * Editorial section header used site-wide: an optional serif index numeral,
 * an uppercase English kicker, and a Chinese title. Gives every page the same
 * magazine masthead rhythm.
 */
export function Kicker({
  index,
  en,
  zh,
  className,
}: {
  index?: string;
  en: string;
  zh: string;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline gap-3', className)}>
      {index && <span className="font-serif text-2xl italic leading-none text-brand">{index}</span>}
      <div className="min-w-0">
        <div className="kicker">{en}</div>
        <div className="font-display text-base font-semibold tracking-tight">{zh}</div>
      </div>
    </div>
  );
}
