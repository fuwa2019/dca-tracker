import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { useSettingsForm } from './formState';

/**
 * Pane header: a back affordance that only exists in the narrow list/detail
 * layout, the pane name, one muted line under it, and optional right-aligned
 * actions — then a hairline before the cards.
 */
export function SettingsPaneHeader({
  heading,
  text,
  children,
}: {
  heading: string;
  text?: string;
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[1fr_auto] sm:gap-2">
        <div className="flex min-w-0 items-center gap-1.5 sm:items-start sm:gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={() => navigate('/settings')}
            className="-ml-1 h-8 w-8 shrink-0 text-muted-foreground lg:hidden"
            aria-label="返回设置列表"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="grid min-w-0 gap-1">
            <h2 className="break-words text-base font-bold lg:text-lg">{heading}</h2>
            {text && <p className="break-words text-xs text-muted-foreground">{text}</p>}
          </div>
        </div>
        {children && <div className="justify-self-start sm:justify-self-end">{children}</div>}
      </div>
      <div className="h-px bg-border" />
    </div>
  );
}

/** Label, one muted description line, then the control. */
export function SettingsField({
  htmlFor,
  label,
  description,
  className,
  children,
}: {
  htmlFor?: string;
  label: string;
  description?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="space-y-0.5">
        <Label htmlFor={htmlFor}>{label}</Label>
        {description && <p className="text-[11px] leading-4 text-muted-foreground">{description}</p>}
      </div>
      {children}
    </div>
  );
}

/** A switch or toggle sitting opposite its label, inside its own hairline box. */
export function SettingsToggleRow({
  htmlFor,
  label,
  description,
  children,
}: {
  htmlFor?: string;
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border px-3 py-2.5">
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={htmlFor} className="cursor-pointer">
          {label}
        </Label>
        {description && <p className="text-[11px] leading-4 text-muted-foreground">{description}</p>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

/**
 * Every pane that edits the settings row carries its own save action. The write
 * covers the whole row, so the hint tells the truth when the pending edit was
 * made in a sibling pane.
 */
export function SettingsSaveRow() {
  const { dirty, saving, savedFlash, save } = useSettingsForm();
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button onClick={save} disabled={saving}>
        {saving ? '保存中…' : '保存设置'}
      </Button>
      {savedFlash && (
        <motion.span
          initial={{ opacity: 0, x: -4 }}
          animate={{ opacity: 1, x: 0 }}
          className="inline-flex items-center gap-1 text-xs text-gain"
        >
          <Check className="h-3.5 w-3.5" /> 已保存
        </motion.span>
      )}
      {!savedFlash && dirty && (
        <span className="text-[11px] text-muted-foreground">
          有未保存的修改，保存会一并写入其他设置面板的改动
        </span>
      )}
    </div>
  );
}
