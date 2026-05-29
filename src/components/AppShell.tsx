import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  ArrowLeftRight,
  BarChart3,
  LayoutDashboard,
  ListOrdered,
  Settings,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/ThemeToggle';
import { MarketStatusBar } from '@/components/MarketStatusBar';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Group it sits under in the desktop sidebar. */
  group: 'overview' | 'tracking' | 'ops';
}

const NAV: ReadonlyArray<NavItem> = [
  { to: '/', label: '总览', icon: LayoutDashboard, group: 'overview' },
  { to: '/performance', label: '业绩', icon: BarChart3, group: 'overview' },
  { to: '/transactions', label: '交易', icon: ListOrdered, group: 'tracking' },
  { to: '/cashflows', label: '资金', icon: ArrowLeftRight, group: 'tracking' },
  { to: '/health', label: '数据健康', icon: Activity, group: 'ops' },
  { to: '/settings', label: '设置', icon: Settings, group: 'ops' },
];

const GROUP_LABELS: Record<NavItem['group'], string> = {
  overview: '概览',
  tracking: '记录',
  ops: '工具',
};

const MOBILE_NAV: ReadonlyArray<NavItem> = [
  { to: '/', label: '总览', icon: LayoutDashboard, group: 'overview' },
  { to: '/performance', label: '业绩', icon: BarChart3, group: 'overview' },
  { to: '/transactions', label: '交易', icon: ListOrdered, group: 'tracking' },
  { to: '/health', label: '健康', icon: Activity, group: 'ops' },
  { to: '/settings', label: '设置', icon: Settings, group: 'ops' },
];

function pageTitle(pathname: string) {
  const found = NAV.find((n) => (n.to === '/' ? pathname === '/' : pathname.startsWith(n.to)));
  return found?.label ?? '';
}

export function AppShell() {
  const location = useLocation();
  return (
    <div className="flex h-full flex-col bg-background lg:flex-row">
      <DesktopNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={pageTitle(location.pathname)} />
        <main className="flex-1 overflow-auto pb-24 lg:pb-10">
          <RouteErrorBoundary resetKey={location.pathname}>
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="min-h-full"
            >
              <Outlet />
            </motion.div>
          </RouteErrorBoundary>
        </main>
        <MobileNav />
      </div>
    </div>
  );
}

class RouteErrorBoundary extends Component<
  { resetKey: string; children: ReactNode },
  { hasError: boolean; message: string }
> {
  state = { hasError: false, message: '' };

  static getDerivedStateFromError(error: unknown) {
    return {
      hasError: true,
      message: error instanceof Error ? error.message : '页面渲染失败',
    };
  }

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false, message: '' });
    }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[route-render]', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="container flex min-h-[420px] max-w-3xl items-center justify-center px-4 py-10">
        <div className="w-full rounded-lg border border-border bg-surface p-5">
          <div className="text-base font-semibold">页面加载失败</div>
          <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
            {this.state.message || '切换页面时发生了渲染错误。'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <NavLink
              to="/"
              className="inline-flex h-8 items-center rounded-md border border-border bg-surface-elevated px-3 text-xs font-medium"
            >
              回到总览
            </NavLink>
            <button
              type="button"
              className="inline-flex h-8 items-center rounded-md border border-border bg-surface-elevated px-3 text-xs font-medium"
              onClick={() => window.location.reload()}
            >
              重新加载
            </button>
          </div>
        </div>
      </div>
    );
  }
}

function TopBar({ title }: { title: string }) {
  return (
    <header className="safe-top sticky top-0 z-20 border-b border-border bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="flex flex-col gap-y-1 px-3 py-2 lg:flex-row lg:items-center lg:gap-x-3 lg:px-6 lg:py-2.5">
        {/* Row 1 (mobile): Logo + title + ThemeToggle; Row 1 (desktop): title only */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Logo className="lg:hidden" />
          <h1 className="min-w-0 flex-1 truncate text-base font-semibold tracking-tight">{title}</h1>
          <div className="lg:hidden">
            <ThemeToggle />
          </div>
        </div>

        {/* Row 2 (mobile): MarketStatusBar */}
        <div className="lg:hidden">
          <MarketStatusBar className="flex" />
        </div>

        {/* Desktop right side: MarketStatusBar + ThemeToggle */}
        <div className="hidden items-center gap-3 lg:flex lg:shrink-0">
          <MarketStatusBar className="flex" />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

function DesktopNav() {
  const groups: Array<NavItem['group']> = ['overview', 'tracking', 'ops'];
  return (
    <aside className="hidden w-56 shrink-0 flex-col border-r border-border bg-surface lg:flex">
      <div className="flex items-center gap-2 px-4 pt-4">
        <Logo />
        <div className="leading-tight">
          <div className="text-sm font-semibold">DCA Tracker</div>
          <div className="text-[11px] text-muted-foreground">个人定投分析</div>
        </div>
      </div>
      <nav className="mt-5 flex flex-col gap-4 px-2.5 pb-6">
        {groups.map((group) => (
          <div key={group}>
            <div className="px-3 pb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {GROUP_LABELS[group]}
            </div>
            <div className="flex flex-col gap-0.5">
              {NAV.filter((n) => n.group === group).map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    cn(
                      'group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors',
                      isActive
                        ? 'bg-brand/10 text-foreground'
                        : 'text-muted-foreground hover:bg-surface-elevated hover:text-foreground',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      {isActive && (
                        <motion.span
                          layoutId="desktop-nav-bar"
                          className="absolute left-0 top-1.5 h-[calc(100%-12px)] w-[3px] rounded-r-full bg-brand"
                          transition={{ type: 'spring', damping: 30, stiffness: 360 }}
                        />
                      )}
                      <Icon className={cn('h-4 w-4', isActive && 'text-brand')} />
                      <span className="font-medium">{label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="mt-auto border-t border-border px-4 py-3 text-[10px] text-muted-foreground">
        v3.0 · 高级主题与公开报告
      </div>
    </aside>
  );
}

function MobileNav() {
  return (
    <nav className="safe-bottom sticky bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur lg:hidden">
      <div className="flex px-1">
        {MOBILE_NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'relative flex flex-1 flex-col items-center gap-0.5 rounded-md py-2 text-[10px] transition-colors',
                isActive ? 'text-brand' : 'text-muted-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className="h-[18px] w-[18px]" />
                <span className="font-medium">{label}</span>
                {isActive && (
                  <motion.span
                    layoutId="mobile-nav-pill"
                    className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-brand"
                    transition={{ type: 'spring', damping: 30, stiffness: 350 }}
                  />
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

function Logo({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded-md bg-brand text-brand-foreground text-sm font-bold',
        className,
      )}
    >
      $
    </div>
  );
}
