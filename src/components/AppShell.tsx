import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { Component, Suspense, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { motion } from 'framer-motion';
import {
  Activity,
  BarChart3,
  BookOpen,
  Layers,
  LayoutDashboard,
  List,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  type LucideIcon,
} from '@/components/icons';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/ThemeToggle';
import { MarketStatusBar } from '@/components/MarketStatusBar';
import { RouteFallback } from '@/components/RouteFallback';
import { LOCAL_MODE } from '@/lib/localMode';

function LocalBadge({ className }: { className?: string }) {
  if (!LOCAL_MODE) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-brand',
        className,
      )}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-brand" />
      本地预览
    </span>
  );
}

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Section the item belongs to. The rail switches sections; tabs switch views. */
  section: 'analysis' | 'ledger' | 'ops';
  /** Views that are reachable only through their section's tabs. */
  tabOnly?: boolean;
  /** `end` matching so a parent route does not stay active on its child. */
  exact?: boolean;
}

const NAV: ReadonlyArray<NavItem> = [
  { to: '/', label: '总览', icon: LayoutDashboard, section: 'analysis', exact: true },
  { to: '/performance', label: '绩效', icon: BarChart3, section: 'analysis' },
  { to: '/exposure', label: '穿透敞口', icon: Layers, section: 'analysis' },
  { to: '/transactions', label: '账本与导入', icon: BookOpen, section: 'ledger', exact: true },
  { to: '/transactions/all', label: '全部交易', icon: List, section: 'ledger', tabOnly: true },
  { to: '/health', label: '数据健康', icon: Activity, section: 'ops' },
  { to: '/settings', label: '设置', icon: Settings, section: 'ops' },
];

/**
 * The rail switches sections, the tabs switch views inside one — so the two
 * never repeat a name, which is how the reference keeps them distinguishable.
 */
interface RailItem {
  section: NavItem['section'];
  to: string;
  label: string;
  icon: LucideIcon;
}

const RAIL_ITEMS: ReadonlyArray<RailItem> = [
  { section: 'analysis', to: '/', label: '分析', icon: LayoutDashboard },
  { section: 'ledger', to: '/transactions', label: '账本', icon: BookOpen },
  { section: 'ops', to: '/health', label: '维护', icon: Activity },
];


const MOBILE_NAV: ReadonlyArray<NavItem> = [
  NAV[0],
  NAV[1],
  { ...NAV[2], label: '敞口' },
  { ...NAV[3], label: '账本' },
  NAV[6],
];

function activeItem(pathname: string) {
  return (
    NAV.filter((item) => (item.exact ? pathname === item.to : pathname.startsWith(item.to)))
      .sort((a, b) => b.to.length - a.to.length)[0] ?? NAV[0]
  );
}

function pageTitle(pathname: string) {
  return activeItem(pathname).label;
}

/**
 * Route-enter animation key. Settings panes are views inside one surface — the
 * reference swaps them without a page transition, and re-keying here would also
 * remount the shared settings form and drop a pending edit.
 */
function motionKey(pathname: string) {
  return pathname.startsWith('/settings') ? '/settings' : pathname;
}

export function AppShell() {
  const location = useLocation();
  const scrollContainerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    scrollContainerRef.current?.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location.key]);

  return (
    <div className="flex h-full w-full overflow-hidden bg-background lg:flex-row">
      <DesktopNav />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar title={pageTitle(location.pathname)} section={activeItem(location.pathname).section} />
        <main ref={scrollContainerRef} className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto pb-24 lg:pb-10">
          <RouteErrorBoundary resetKey={location.pathname}>
            <motion.div
              key={motionKey(location.pathname)}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
              className="min-h-full min-w-0 overflow-x-hidden"
            >
              {/* Route chunks are lazy, so this boundary is what keeps the nav
                  and top bar painted while one is in flight. */}
              <Suspense fallback={<RouteFallback />}>
                <Outlet />
              </Suspense>
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

function RouteTabs({ section }: { section: NavItem['section'] }) {
  const items = NAV.filter((item) => item.section === section);
  if (items.length < 2) return null;
  return (
    <nav aria-label="视图切换" className="tab-pills">
      {items.map(({ to, label, icon: Icon, exact }) => (
        <NavLink
          key={to}
          to={to}
          end={exact}
          className={({ isActive }) => cn('tab-pill', isActive && 'tab-pill-active')}
        >
          <Icon className="h-4 w-4 shrink-0" />
          <span className="truncate">{label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

/**
 * Reference layout: no page banner. The toolbar row carries the view tabs on
 * the left and scope controls on the right; the route name stays in the
 * accessibility tree as the single `h1`.
 */
function TopBar({ title, section }: { title: string; section: NavItem['section'] }) {
  return (
    <header className="safe-top sticky top-0 z-20 border-b border-border bg-background/95 lg:bg-background/90 lg:backdrop-blur lg:supports-[backdrop-filter]:bg-background/75">
      <h1 className="sr-only">{title}</h1>
      <div className="flex flex-col gap-y-2 px-3 py-2.5 lg:flex-row lg:items-center lg:gap-x-3 lg:px-6 lg:py-2.5">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Logo className="lg:hidden" />
          <div className="min-w-0 flex-1 overflow-x-auto">
            <RouteTabs section={section} />
          </div>
          <LocalBadge className="hidden sm:inline-flex lg:hidden" />
          <div className="lg:hidden">
            <ThemeToggle />
          </div>
        </div>

        <div className="lg:hidden">
          <MarketStatusBar className="flex" compact />
        </div>

        <div className="hidden items-center gap-3 lg:flex lg:shrink-0">
          <MarketStatusBar className="flex" />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}

/**
 * Icon rail. The reference keeps navigation to icons at ~70px and treats the
 * labelled column as the opt-in state, so the rail starts collapsed.
 */
function RailLink({
  item,
  expanded,
  activeSection,
}: {
  item: RailItem;
  expanded: boolean;
  activeSection: NavItem['section'];
}) {
  const { to, label, icon: Icon, section } = item;
  return (
    <NavLink
      to={to}
      end={to === '/'}
      title={expanded ? undefined : label}
      aria-label={expanded ? undefined : label}
      className={() =>
        cn(
          'flex items-center rounded-md text-sm transition-colors',
          expanded ? 'h-10 gap-2.5 px-3' : 'h-11 justify-center px-0',
          activeSection === section
            ? 'bg-surface-elevated font-medium text-foreground'
            : 'text-muted-foreground hover:bg-surface-elevated/60 hover:text-foreground',
        )
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      {expanded && <span className="truncate">{label}</span>}
    </NavLink>
  );
}

function DesktopNav() {
  const location = useLocation();
  const activeSection = activeItem(location.pathname).section;
  const [expanded, setExpanded] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('dca-sidebar-expanded') === '1';
  });

  useEffect(() => {
    window.localStorage.setItem('dca-sidebar-expanded', expanded ? '1' : '0');
  }, [expanded]);

  return (
    <aside
      aria-label="侧栏"
      className={cn(
        'hidden shrink-0 flex-col border-r border-border bg-surface transition-[width] duration-200 lg:flex',
        expanded ? 'w-[200px]' : 'w-[70px]',
      )}
    >
      <div className={cn('flex items-center pt-4', expanded ? 'gap-2.5 px-4' : 'justify-center px-2')}>
        <Logo className="h-9 w-9" />
        {expanded && (
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-sm font-semibold tracking-tight">DCA Tracker</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">单组合 · 可核对账本</div>
          </div>
        )}
      </div>

      {LOCAL_MODE && expanded && <div className="px-4 pt-3"><LocalBadge /></div>}

      <nav aria-label="主导航" className="mt-5 flex flex-col gap-1 px-3">
        {RAIL_ITEMS.map((item) => (
          <RailLink key={item.to} item={item} expanded={expanded} activeSection={activeSection} />
        ))}
      </nav>

      <div className={cn('mt-auto border-t border-border py-3', expanded ? 'px-4' : 'px-2')}>
        <button
          type="button"
          className={cn(
            'inline-flex h-9 items-center rounded-md text-xs font-medium text-muted-foreground transition-colors hover:bg-surface-elevated hover:text-foreground',
            expanded ? 'w-full gap-2 px-2.5' : 'w-full justify-center px-0',
          )}
          onClick={() => setExpanded((value) => !value)}
          title={expanded ? '收起侧栏' : '展开侧栏'}
          aria-label={expanded ? '收起侧栏' : '展开侧栏'}
        >
          {expanded ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
          {expanded && <span>收起侧栏</span>}
        </button>
        {expanded && (
          <div className="mt-2">
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Build · {__APP_COMMIT_DATE__}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {LOCAL_MODE ? '本地演示 · 免登录' : '投资记录 · 公开报告'}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}

function MobileNav() {
  return (
    <nav aria-label="底部导航" className="safe-bottom fixed bottom-3 left-3 z-30 w-[calc(100vw-1.5rem)] max-w-[calc(100vw-1.5rem)] lg:hidden">
      <div className="flex overflow-hidden rounded-lg border border-border bg-surface px-1.5 py-1 shadow-[0_10px_28px_-18px_hsl(var(--elevation)/0.4)]">
        {MOBILE_NAV.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              cn(
                'relative flex min-h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md text-[10px] transition-colors',
                isActive ? 'bg-brand/10 text-brand' : 'text-muted-foreground hover:bg-surface-elevated hover:text-foreground',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className="h-[18px] w-[18px]" />
                <span className="max-w-full truncate font-medium">{label}</span>
                {isActive && (
                  <motion.span
                    layoutId="mobile-nav-pill"
                    className="absolute inset-x-5 top-1 h-0.5 rounded-full bg-brand"
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
        'relative flex h-8 w-8 items-center justify-center rounded-md bg-brand text-sm font-semibold text-brand-foreground',
        'ring-1 ring-inset ring-white/20',
        className,
      )}
    >
      $
    </div>
  );
}
