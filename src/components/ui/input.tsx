import * as React from 'react';
import { cn } from '@/lib/utils';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    ref={ref}
    className={cn(
      'flex h-10 min-h-10 w-full appearance-none rounded-lg border border-input bg-background px-3 py-2 text-base leading-5 tnum ring-offset-background transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm',
      type === 'date' && [
        'items-center',
        '[&::-webkit-date-and-time-value]:m-0',
        '[&::-webkit-date-and-time-value]:min-h-5',
        '[&::-webkit-date-and-time-value]:p-0',
        '[&::-webkit-date-and-time-value]:text-left',
        '[&::-webkit-date-and-time-value]:leading-5',
        '[&::-webkit-calendar-picker-indicator]:my-0',
      ],
      className,
    )}
    {...props}
  />
));
Input.displayName = 'Input';
