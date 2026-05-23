import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from '@/app/login';
import { DashboardPage } from '@/app/dashboard';
import { PerformancePage } from '@/app/performance';
import { TransactionsPage } from '@/app/transactions';
import { TransactionsAllPage } from '@/app/transactions-all';
import { CashflowsPage } from '@/app/cashflows';
import { RebalancePage } from '@/app/rebalance';
import { SettingsPage } from '@/app/settings';
import { SharePage } from '@/app/share';
import { DataHealthPage } from '@/app/data-health';
import { AppShell } from '@/components/AppShell';
import { RequireAuth } from '@/components/RequireAuth';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
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
        <Route path="/transactions" element={<TransactionsPage />} />
        <Route path="/transactions/all" element={<TransactionsAllPage />} />
        <Route path="/cashflows" element={<CashflowsPage />} />
        <Route path="/rebalance" element={<RebalancePage />} />
        <Route path="/health" element={<DataHealthPage />} />
        <Route path="/settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
