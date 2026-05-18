import { NavLink, Outlet } from 'react-router-dom';
import { motion } from 'framer-motion';
import { LayoutDashboard, ListOrdered, ArrowLeftRight, Scale, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';

const NAV = [
  { to: '/', label: '主页', icon: LayoutDashboard },
  { to: '/transactions', label: '交易', icon: ListOrdered },
  { to: '/cashflows', label: '资金流', icon: ArrowLeftRight },
  { to: '/rebalance', label: '再平衡', icon: Scale },
  { to: '/settings', label: '设置', icon: Settings },
] as const;

export function AppShell() {
  return (
    <div className="flex h-full flex-col lg:flex-row">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex w-56 shrink-0 border-r bg-card/50 p-4">
        <nav className="flex w-full flex-col gap-1">
          <div className="px-3 py-2 text-lg font-semibold tracking-tight">DCA</div>
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )
              }
            >
              <Icon className="h-4 w-4" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto safe-top">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="lg:hidden sticky bottom-0 z-10 border-t bg-background/95 backdrop-blur safe-bottom">
        <div className="flex">
          {NAV.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                cn(
                  'relative flex flex-1 flex-col items-center gap-1 py-2 text-[10px] transition-colors',
                  isActive ? 'text-foreground' : 'text-muted-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <Icon className="h-5 w-5" />
                  <span>{label}</span>
                  {isActive && (
                    <motion.span
                      layoutId="bottom-nav-pill"
                      className="absolute inset-x-3 top-0 h-0.5 rounded-full bg-foreground"
                      transition={{ type: 'spring', damping: 30, stiffness: 350 }}
                    />
                  )}
                </>
              )}
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
