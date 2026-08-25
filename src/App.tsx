import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';
import { RouteFallback } from '@/components/RouteFallback';
import { LOCAL_MODE } from '@/lib/localMode';

// Every route is a separate chunk. The entry bundle otherwise carried all of
// them plus recharts, which is what bound emulated-mobile LCP to script
// evaluation rather than to the network. Named exports are unwrapped here
// because `lazy()` wants a default export; the settings panes all resolve to
// the same module, so they share one chunk.
const LoginPage = lazy(() => import('@/app/login').then((m) => ({ default: m.LoginPage })));
const SharePage = lazy(() => import('@/app/share').then((m) => ({ default: m.SharePage })));
const DashboardPage = lazy(() => import('@/app/dashboard').then((m) => ({ default: m.DashboardPage })));
const PerformancePage = lazy(() => import('@/app/performance').then((m) => ({ default: m.PerformancePage })));
const ExposurePage = lazy(() => import('@/app/exposure').then((m) => ({ default: m.ExposurePage })));
const TransactionsPage = lazy(() => import('@/app/transactions').then((m) => ({ default: m.TransactionsPage })));
const TransactionsAllPage = lazy(() => import('@/app/transactions-all').then((m) => ({ default: m.TransactionsAllPage })));
const CashflowsPage = lazy(() => import('@/app/cashflows').then((m) => ({ default: m.CashflowsPage })));
const DataHealthPage = lazy(() => import('@/app/data-health').then((m) => ({ default: m.DataHealthPage })));
const SettingsLayout = lazy(() => import('@/app/settings').then((m) => ({ default: m.SettingsLayout })));
const SettingsIndex = lazy(() => import('@/app/settings').then((m) => ({ default: m.SettingsIndex })));
const GoalPane = lazy(() => import('@/app/settings').then((m) => ({ default: m.GoalPane })));
const BasisPane = lazy(() => import('@/app/settings').then((m) => ({ default: m.BasisPane })));
const EmailPane = lazy(() => import('@/app/settings').then((m) => ({ default: m.EmailPane })));
const SharePane = lazy(() => import('@/app/settings').then((m) => ({ default: m.SharePane })));
const AppearancePane = lazy(() => import('@/app/settings').then((m) => ({ default: m.AppearancePane })));
const AccountPane = lazy(() => import('@/app/settings').then((m) => ({ default: m.AccountPane })));

export default function App() {
  return (
    // Routes inside the shell suspend against the boundary in `AppShell`, which
    // keeps the navigation painted. This outer boundary only ever catches the
    // two shell-less routes.
    <Suspense fallback={<RouteFallback />}>
      <Routes>
        <Route path="/login" element={LOCAL_MODE ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route path="/share/:token" element={<SharePage />} />
        <Route
          element={
            <RequireAuth>
              <AppShell />
            </RequireAuth>
          }
        >
          <Route index element={<DashboardPage />} />
          <Route path="/performance" element={<PerformancePage />} />
          <Route path="/exposure" element={<ExposurePage />} />
          <Route path="/transactions" element={<TransactionsPage />} />
          <Route path="/transactions/all" element={<TransactionsAllPage />} />
          <Route path="/cashflows" element={LOCAL_MODE ? <Navigate to="/transactions" replace /> : <CashflowsPage />} />
          <Route path="/health" element={<DataHealthPage />} />
          <Route path="/settings" element={<SettingsLayout />}>
            <Route index element={<SettingsIndex />} />
            <Route path="goal" element={<GoalPane />} />
            <Route path="basis" element={<BasisPane />} />
            <Route path="email" element={<EmailPane />} />
            <Route path="share" element={<SharePane />} />
            <Route path="appearance" element={<AppearancePane />} />
            <Route path="account" element={<AccountPane />} />
            <Route path="*" element={<Navigate to="/settings" replace />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
