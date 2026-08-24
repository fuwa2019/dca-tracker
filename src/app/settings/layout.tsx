import { Link, NavLink, Navigate, Outlet } from 'react-router-dom';
import { ChevronRight } from '@/components/icons';
import { cn } from '@/lib/utils';
import { DESKTOP_QUERY, useMediaQuery } from '@/hooks/useMediaQuery';
import { FIRST_SETTINGS_PANE, SETTINGS_NAV } from './nav';
import { SettingsFormProvider } from './formState';

/**
 * The reference splits settings into one pane per concern, reached from a
 * grouped column on wide screens and from a list on narrow ones. Only one of
 * the two structures is rendered, so control ids stay unique.
 */
export function SettingsLayout() {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  return (
    <SettingsFormProvider>
      <div className="workbench-page max-w-5xl">
        {desktop ? (
          <div className="flex gap-10">
            <SettingsNavColumn />
            <div className="min-w-0 flex-1">
              <Outlet />
            </div>
          </div>
        ) : (
          <Outlet />
        )}
      </div>
    </SettingsFormProvider>
  );
}

/** `/settings` itself: the list on narrow screens, the first pane on wide ones. */
export function SettingsIndex() {
  const desktop = useMediaQuery(DESKTOP_QUERY);
  if (desktop) return <Navigate to={FIRST_SETTINGS_PANE} replace />;
  return <SettingsList />;
}

function SettingsNavColumn() {
  return (
    <nav aria-label="设置分组" className="w-[240px] shrink-0 space-y-6">
      {SETTINGS_NAV.map((group) => (
        <div key={group.title} className="space-y-1.5">
          <div className="workbench-eyebrow pl-2">{group.title}</div>
          <div className="flex flex-col gap-0.5">
            {group.items.map(({ href, title, icon: Icon }) => (
              <NavLink
                key={href}
                to={href}
                className={({ isActive }) => cn('settings-nav-link', isActive && 'settings-nav-link-active')}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate text-left">{title}</span>
              </NavLink>
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

function SettingsList() {
  return (
    <div className="space-y-5">
      <header className="workbench-intro">
        <p className="workbench-lede">管理目标参数、成本口径、基准、自选和隐私分享。</p>
      </header>
      {SETTINGS_NAV.map((group) => (
        <section key={group.title} className="space-y-2">
          <h2 className="workbench-eyebrow px-1">{group.title}</h2>
          <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-surface">
            {group.items.map(({ href, title, subtitle, icon: Icon }) => (
              <Link
                key={href}
                to={href}
                className="flex min-h-[56px] w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-surface-elevated"
              >
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <Icon className="h-5 w-5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-foreground">{title}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span>
                  </span>
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
